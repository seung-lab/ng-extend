#!/usr/bin/env node
/**
 * sync-sheet-cells.mjs
 * --------------------------------------------------------------------
 * Nightly: pull new cells from each dataset's Cell Library Google Sheet into
 * Supabase `proofreading_tasks`, so freshly-added rows show up under
 * "Available" without anyone having to re-import by hand.
 *
 * APPEND-ONLY BY DESIGN. Rows that disappear from a sheet are left alone:
 * someone may already have claimed or completed that cell, and deleting the
 * task would yank work out from under them. Cells are only ever added.
 *
 * Existing tasks are never modified either — status, assignment and final IDs
 * live in Supabase and are the source of truth once a cell exists.
 *
 * Column detection mirrors useProofreadingQueueStore.loadFromSheet in
 * src/store.ts (header row found by scanning the first 10 rows for a cell
 * containing "segment"; 'startseg' is matched BEFORE the generic patterns so
 * Stroeh's "Start SegID" wins over "Final SegID"). Keep the two in sync.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/sync-sheet-cells.mjs [--dry-run] [--dataset <name>] [--force] [--refresh-nucleus]
 *
 * Flags:
 *   --dry-run   report what would be inserted, write nothing
 *   --dataset   only sync this dataset key
 *   --force     skip the "is it midnight in ET?" guard (for manual runs)
 *   --refresh-nucleus  one-off for nucleus sheets (MEC): re-point tasks that
 *               were imported as the nucleus to the cell around it
 *   --statuses  instead of importing, carry the sheet's own progress onto
 *               tasks that are still Available (hourly, see
 *               .github/workflows/sheet-status-sync.yml):
 *                 Complete / Complete (cut off)  -> completed (+ Final SegID)
 *                 Can't Complete / Not BC        -> skipped
 *                 WIP, any other status, or a Proofreader name -> in_progress
 *               Only rows still pending and unassigned in Supabase change, and
 *               each PATCH re-checks that, so a claim or completion made in
 *               EyeWire II always wins over the sheet.
 *   --mirror    instead of importing, copy what the sheet says about each
 *               cell (status, proofreader, date complete, predicted type)
 *               into ew_sheet_cells, for the Dataset Progress panel
 *               (supabase-dataset-stats.sql). Touches no task. Hourly, after
 *               --statuses.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const dryRun = has('--dry-run');
const force = has('--force');
const onlyDataset = val('--dataset');
const refreshNucleus = has('--refresh-nucleus');
const statusesOnly = has('--statuses');
const mirrorOnly = has('--mirror');
// --retire-source <sheet id>: hide Available cells imported from a sheet the
// game no longer uses (they become skipped, with a note; nothing is deleted,
// and claimed or completed cells are left alone). Needs --dataset.
const retireSource = val('--retire-source');

/**
 * Datasets that have a Cell Library sheet. Mirrors `cellLibrarySheetUrl` in
 * src/config.ts CAVE_CONFIGS_BY_DATASET. `dataset` is the canonical key stored
 * on the task row.
 */
const SHEETS = [
  {
    dataset: 'stroeh_mouse_retina',
    // Proofreaders also work straight in this sheet; --statuses carries their
    // progress onto Available tasks. The older 1H9KV0 BC sheet is retired:
    // never read it (Ames 2026-09-29).
    url: 'https://docs.google.com/spreadsheets/d/10cPvkLYU5zGDe7AJ6SHjhMcfdqXyiPM4W4qgob2g70w/edit?gid=37544110',
  },
  {
    dataset: 'pinky_nf_v2',
    url: 'https://docs.google.com/spreadsheets/d/1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU/edit',
  },
  {
    // MEC (Ames 2026-09-28): rows carry "Starting XYZ Coords", not segment
    // IDs. Each new point is resolved to its supervoxel and root, and the
    // point becomes the task's claim point, which is also how the sheet
    // write-back finds the row again (functions/sheet-policy.js).
    dataset: 'pni_mec',
    url: 'https://docs.google.com/spreadsheets/d/1cGit_jEzUa3idCqM0w_KRW4P42KKN9RnPK4Zafa9Nzw/edit?gid=869365415',
    byPoint: {
      cloudpath: 'graphene://https://hc.himc-cave.com/segmentation/table/pni_mec',
      resolution: '16,16,45',
      // The starting points sit inside nuclei, and MEC segments the nucleus
      // separately from the cell body (Ames 2026-09-29). The task is the CELL
      // around the nucleus; the nucleus is kept in final_nucleus_id.
      nucleus: true,
    },
  },
];

// ── Eastern-time guard ───────────────────────────────────────────────
// GitHub cron only speaks UTC, and midnight ET is 04:00 UTC in EDT but 05:00
// in EST. The workflow fires at BOTH hours and this guard makes the job a
// no-op unless it really is the 0th hour in New York, so it runs exactly once
// a night year-round without needing a DST-aware scheduler.
function etHour(at = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit',
  }).format(at);
  return h === '24' ? 0 : Number(h);
}

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
  'Content-Type': 'application/json',
};

/** Quote-aware CSV parser (coordinate cells look like "48469, 47551, 2014"). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function csvUrlFor(sheetUrl) {
  const m = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error(`Unrecognised sheet URL: ${sheetUrl}`);
  const gid = (sheetUrl.match(/gid=(\d+)/) || [, '0'])[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

/** Extract {segId, nucCoords, somaCoords, notes} rows, mirroring the app. */
function extractCells(rows) {
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('segment'))) { headerIdx = i; break; }
  }
  const header = rows[headerIdx].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (name) => header.findIndex(h => h.includes(name));
  const firstCol = (...names) => {
    for (const n of names) { const i = col(n); if (i >= 0) return i; }
    return -1;
  };
  // 'startseg' before the generic patterns, so Stroeh's "Start SegID" is not
  // shadowed by "Final SegID".
  const iSeg  = firstCol('startseg', 'segmentid', 'segment');
  const iNuc  = col('nuccoord') >= 0 ? col('nuccoord') : col('nuc');
  const iSoma = firstCol('somacoord', 'somaorstem', 'soma');
  const iNotes = col('note');
  if (iSeg < 0) throw new Error('Could not find a Segment ID column');

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const segId = (rows[r][iSeg] || '').trim();
    if (!segId || !/^\d+$/.test(segId)) continue;
    out.push({
      segId,
      nucCoords: (iNuc  >= 0 ? rows[r][iNuc]  : '') || '',
      somaCoords:(iSoma >= 0 ? rows[r][iSoma] : '') || '',
      notes:     (iNotes>= 0 ? rows[r][iNotes]: '') || '',
    });
  }
  return out;
}

/** Rows of a coordinate sheet: {index, point:[x,y,z], coords, typeA, typeB, ais, notes}. */
function extractPointCells(rows) {
  const keys = ['startingxyz', 'startingcoord', 'startcoord'];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (h.some(c => keys.some(k => c.includes(k)))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('Could not find a Starting XYZ Coords column');
  const header = rows[headerIdx].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (...names) => { for (const n of names) { const i = header.findIndex(h => h.includes(n)); if (i >= 0) return i; } return -1; };
  const iPoint = col(...keys), iIndex = col('index'), iAis = col('aiscoord');
  const iTypes = header.map((h, i) => (h.startsWith('celltype') ? i : -1)).filter(i => i >= 0);
  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const nums = (rows[r][iPoint] || '').match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length !== 3) continue;
    const point = nums.map(n => Math.round(Number(n)));
    const types = [...new Set(iTypes.map(i => (rows[r][i] || '').trim()).filter(Boolean))];
    const ais = iAis >= 0 ? (rows[r][iAis] || '').trim() : '';
    const index = iIndex >= 0 ? (rows[r][iIndex] || '').trim() : '';
    out.push({ index, point, coords: point.join(', '), types, ais });
  }
  return out;
}

/** Claim points already imported for a dataset, as "x,y,z". */
async function existingPoints(dataset) {
  const pts = new Set();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/proofreading_tasks`
      + `?select=claim_point_x,claim_point_y,claim_point_z&dataset=eq.${encodeURIComponent(dataset)}`
      + `&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: supabaseHeaders });
    if (!res.ok) throw new Error(`read tasks ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    for (const r of rows) if (r.claim_point_x != null) pts.add(`${r.claim_point_x},${r.claim_point_y},${r.claim_point_z}`);
    if (rows.length < PAGE) break;
  }
  return pts;
}

/** Points -> {sv, root} via scripts/resolve_points.py (cloud-volume). */
async function resolvePoints(byPoint, points) {
  const { spawnSync } = await import('node:child_process');
  const py = process.env.PYTHON || 'python3';
  const args = [new URL('./resolve_points.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), byPoint.cloudpath, byPoint.resolution];
  if (byPoint.nucleus) args.push('--nucleus');
  const r = spawnSync(py, args,
    { input: JSON.stringify(points), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`resolve_points failed: ${(r.stderr || '').slice(-800)}`);
  for (const line of (r.stderr || '').split('\n')) if (line.startsWith('[resolve]')) console.log(line);
  return JSON.parse(r.stdout);
}

async function syncPointSheet(cfg) {
  console.log(`\n[cells] === ${cfg.dataset} (by starting coordinates) ===`);
  const res = await fetch(csvUrlFor(cfg.url));
  if (!res.ok) throw new Error(`sheet fetch ${res.status}`);
  const cells = extractPointCells(parseCsv(await res.text()));
  console.log(`[cells] sheet rows with a starting point: ${cells.length}`);
  const known = await existingPoints(cfg.dataset);
  console.log(`[cells] claim points already in proofreading_tasks: ${known.size}`);
  const seen = new Set();
  const fresh = cells.filter(c => { const k = c.point.join(','); if (known.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  if (!fresh.length) { console.log('[cells] nothing new'); return 0; }

  // Resolve even on a dry run: it's read-only, and it proves the points land on cells.
  const resolved = await resolvePoints(cfg.byPoint, fresh.map(c => c.point));
  const toInsert = [];
  let empty = 0;
  fresh.forEach((c, i) => {
    const r = resolved[i];
    if (!r || r.root === '0') { empty++; console.log(`[cells] #${c.index} ${c.coords}: no cell at this point, skipped`); return; }
    const notes = [c.index && `Sheet #${c.index}`, c.types.length && c.types.join(', '), c.ais && `AIS ${c.ais}`,
      cfg.byPoint.nucleus && !r.cell && 'Cell around the nucleus not found'].filter(Boolean).join('. ');
    toInsert.push({
      segment_id: r.root,
      supervoxel_id: r.sv,
      final_nucleus_id: cfg.byPoint.nucleus ? (r.nucleus || null) : null,
      dataset: cfg.dataset,
      nucleus_coords: c.coords,
      claim_point_x: c.point[0], claim_point_y: c.point[1], claim_point_z: c.point[2],
      notes: notes || null,
      status: 'pending',          // i.e. Available
      source_sheet_url: cfg.url,
    });
  });
  if (empty) console.log(`[cells] ${empty} point(s) had no cell`);
  if (dryRun) {
    console.log(`[cells] DRY-RUN would insert ${toInsert.length}: ${toInsert.slice(0, 3).map(t => `${t.notes} -> ${t.segment_id}`).join(' | ')}${toInsert.length > 3 ? ' ...' : ''}`);
    return toInsert.length;
  }
  for (let i = 0; i < toInsert.length; i += 500) await insertTasks(toInsert.slice(i, i + 500));
  console.log(`[cells] inserted ${toInsert.length} new cell(s)`);
  return toInsert.length;
}

/** One-off: tasks imported as the nucleus itself get the cell around it. */
async function refreshNucleusTasks(cfg) {
  console.log(`\n[cells] === ${cfg.dataset}: re-point nucleus tasks to their cells ===`);
  const url = `${SUPABASE_URL}/rest/v1/proofreading_tasks?select=id,segment_id,status,claim_point_x,claim_point_y,claim_point_z`
    + `&dataset=eq.${encodeURIComponent(cfg.dataset)}&final_nucleus_id=is.null&claim_point_x=not.is.null&limit=5000`;
  const res = await fetch(url, { headers: supabaseHeaders });
  if (!res.ok) throw new Error(`read tasks ${res.status}: ${await res.text()}`);
  const tasks = await res.json();
  console.log(`[cells] tasks without a nucleus id: ${tasks.length}`);
  if (!tasks.length) return 0;
  const resolved = await resolvePoints(cfg.byPoint, tasks.map(t => [t.claim_point_x, t.claim_point_y, t.claim_point_z]));
  let changed = 0, missed = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i], r = resolved[i];
    if (!r || !r.cell) { missed++; console.log(`[cells] task ${t.id}: cell not found (${Math.round((r?.share || 0) * 100)}% of ring), left as is`); continue; }
    const patch = { segment_id: r.cell, supervoxel_id: r.sv, final_nucleus_id: r.nucleus };
    if (dryRun) { console.log(`[cells] DRY-RUN task ${t.id} (${t.status}): ${t.segment_id} -> cell ${r.cell}, nucleus ${r.nucleus}`); changed++; continue; }
    const u = await fetch(`${SUPABASE_URL}/rest/v1/proofreading_tasks?id=eq.${t.id}`, {
      method: 'PATCH', headers: { ...supabaseHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
    if (!u.ok) throw new Error(`update task ${t.id} ${u.status}: ${await u.text()}`);
    changed++;
  }
  console.log(`[cells] ${dryRun ? 'would re-point' : 're-pointed'} ${changed} task(s); ${missed} left as is`);
  return changed;
}

async function existingSegmentIds(dataset) {
  // Paginate: a dataset can have thousands of tasks (Stroeh has ~2.3k).
  const ids = new Set();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/proofreading_tasks`
      + `?select=segment_id&dataset=eq.${encodeURIComponent(dataset)}`
      + `&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: supabaseHeaders });
    if (!res.ok) throw new Error(`read tasks ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    for (const r of rows) ids.add(String(r.segment_id));
    if (rows.length < PAGE) break;
  }
  return ids;
}

async function insertTasks(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/proofreading_tasks`, {
    method: 'POST',
    headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${res.status}: ${await res.text()}`);
}

async function syncSheet(cfg) {
  console.log(`\n[cells] === ${cfg.dataset} ===`);
  const res = await fetch(csvUrlFor(cfg.url));
  if (!res.ok) throw new Error(`sheet fetch ${res.status}`);
  const cells = extractCells(parseCsv(await res.text()));
  console.log(`[cells] sheet rows with a segment id: ${cells.length}`);

  const known = await existingSegmentIds(cfg.dataset);
  console.log(`[cells] already in proofreading_tasks: ${known.size}`);

  // Dedupe within the sheet too — the same id can appear on multiple rows.
  const seen = new Set();
  const toInsert = [];
  for (const c of cells) {
    if (known.has(c.segId) || seen.has(c.segId)) continue;
    seen.add(c.segId);
    toInsert.push({
      segment_id: c.segId,
      dataset: cfg.dataset,
      nucleus_coords: c.nucCoords || null,
      soma_coords: c.somaCoords || null,
      notes: c.notes || null,
      status: 'pending',          // i.e. Available
      source_sheet_url: cfg.url,
    });
  }

  if (!toInsert.length) { console.log('[cells] nothing new'); return 0; }
  if (dryRun) {
    console.log(`[cells] DRY-RUN would insert ${toInsert.length}: ${toInsert.slice(0, 5).map(t => t.segment_id).join(', ')}${toInsert.length > 5 ? ' …' : ''}`);
    return toInsert.length;
  }
  // Chunk so a big first run doesn't hit request limits.
  for (let i = 0; i < toInsert.length; i += 500) {
    await insertTasks(toInsert.slice(i, i + 500));
  }
  console.log(`[cells] inserted ${toInsert.length} new cell(s)`);
  return toInsert.length;
}

// ── Sheet progress -> Available tasks (--statuses) ─────────────────────
/** {segId, who, status, date, finalSeg} for every row with a start segment. */
function extractStatusRows(rows) {
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('segment') || c.toLowerCase().includes('segid'))) { headerIdx = i; break; }
  }
  const header = rows[headerIdx].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (...names) => { for (const n of names) { const i = header.findIndex(h => h.includes(n)); if (i >= 0) return i; } return -1; };
  const iSeg = col('startseg', 'segmentid'), iWho = col('proofreader'), iStatus = header.indexOf('status');
  const iDate = col('datecomplete', 'date'), iFinal = col('finalseg');
  const iType = col('predicted', 'celltype');
  if (iSeg < 0 || (iStatus < 0 && iWho < 0)) return [];
  const cell = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const segId = cell(rows[r], iSeg);
    if (!/^\d+$/.test(segId)) continue;
    out.push({ segId, who: cell(rows[r], iWho), status: cell(rows[r], iStatus), date: cell(rows[r], iDate), finalSeg: cell(rows[r], iFinal), type: cell(rows[r], iType) });
  }
  return out;
}

const RANK = { in_progress: 1, skipped: 2, completed: 3 };
/** What the sheet says about a cell, or null when it is untouched there. */
function sheetDecision(r) {
  const s = r.status.toLowerCase();
  const by = r.who ? ` by ${r.who}` : '';
  if (/^complete/.test(s)) {
    return { status: 'completed', note: `Completed in the spreadsheet${by}${r.date ? ` on ${r.date}` : ''}.`,
      final: /^\d+$/.test(r.finalSeg) ? r.finalSeg : null };
  }
  if (/can.?t complete|not bc|not a bc|skip/.test(s)) return { status: 'skipped', note: `Marked "${r.status}" in the spreadsheet${by}.` };
  if (s || r.who) return { status: 'in_progress', note: `Being proofread in the spreadsheet${by}${s ? ` (${r.status})` : ''}.` };
  return null;
}

async function pendingTasks(dataset) {
  const out = new Map();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/proofreading_tasks?select=id,segment_id,notes`
      + `&dataset=eq.${encodeURIComponent(dataset)}&status=eq.pending&assigned_to=is.null&order=id&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: supabaseHeaders });
    if (!res.ok) throw new Error(`read tasks ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    for (const r of rows) if (!out.has(String(r.segment_id))) out.set(String(r.segment_id), r);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function syncStatuses(cfg) {
  console.log(`\n[status] === ${cfg.dataset} ===`);
  const best = new Map(); // segId -> strongest decision across the sheets
  for (const url of cfg.statusUrls || [cfg.url]) {
    const res = await fetch(csvUrlFor(url));
    if (!res.ok) throw new Error(`sheet fetch ${res.status} for ${url}`);
    const rows = extractStatusRows(parseCsv(await res.text()));
    let marked = 0;
    for (const r of rows) {
      const d = sheetDecision(r);
      if (!d) continue;
      marked++;
      const prev = best.get(r.segId);
      if (!prev || RANK[d.status] > RANK[prev.status]) best.set(r.segId, d);
    }
    console.log(`[status] ${url.match(/\/d\/([^/]+)/)[1].slice(0, 8)}: ${rows.length} rows, ${marked} worked on in the sheet`);
  }
  const pending = await pendingTasks(cfg.dataset);
  const todo = [...best].filter(([seg]) => pending.has(seg));
  const tally = { completed: 0, skipped: 0, in_progress: 0 };
  for (const [, d] of todo) tally[d.status]++;
  console.log(`[status] Available in EyeWire II: ${pending.size}; the sheet says ${todo.length} of those are taken `
    + `(${tally.completed} completed, ${tally.skipped} skipped, ${tally.in_progress} in progress)`);
  if (dryRun || !todo.length) {
    if (dryRun && todo.length) console.log(`[status] DRY-RUN, e.g. ${todo.slice(0, 5).map(([s, d]) => `${s}:${d.status}`).join(', ')}`);
    return 0;
  }
  let changed = 0, skippedRace = 0;
  const now = new Date().toISOString();
  const queue = [...todo];
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [seg, d] = item;
      const task = pending.get(seg);
      const notes = [task.notes, d.note].filter(Boolean).join(' ').slice(0, 2000);
      const body = { status: d.status, notes, updated_at: now, ...(d.final ? { final_segment_id: d.final } : {}) };
      // The filter re-checks Available, so a claim made in EyeWire since the
      // read above is never overwritten.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/proofreading_tasks?id=eq.${task.id}&status=eq.pending&assigned_to=is.null`, {
        method: 'PATCH', headers: { ...supabaseHeaders, Prefer: 'return=representation' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`update task ${task.id} ${res.status}: ${await res.text()}`);
      if ((await res.json()).length) changed++; else skippedRace++;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`[status] updated ${changed} task(s)${skippedRace ? `; ${skippedRace} were claimed in EyeWire meanwhile and left alone` : ''}`);
  return changed;
}

/** A sheet date (4/30/2026, or 2026-04-30) as YYYY-MM-DD, or null. */
function sheetDate(text) {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) { const [, mo, d, y] = m; return validDate(+y, +mo, +d); }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  return m ? validDate(+m[1], +m[2], +m[3]) : null;
}
function validDate(y, mo, d) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/**
 * Copy the sheet's own record of each cell into ew_sheet_cells. One row per
 * starting segment id; where the sheet lists a segment twice, the row that
 * got furthest (completed, then skipped, then in progress) is kept.
 */
async function mirrorSheet(cfg) {
  console.log(`
[mirror] === ${cfg.dataset} ===`);
  const res = await fetch(csvUrlFor(cfg.url));
  if (!res.ok) throw new Error(`sheet fetch ${res.status}`);
  const rows = extractStatusRows(parseCsv(await res.text()));
  const best = new Map();
  for (const r of rows) {
    const rank = RANK[sheetDecision(r)?.status] || 0;
    const prev = best.get(r.segId);
    if (!prev || rank > prev.rank) best.set(r.segId, { rank, r });
  }
  const now = new Date().toISOString();
  const out = [...best.values()].map(({ r }) => ({
    dataset: cfg.dataset, segment_id: r.segId, status: r.status || null, proofreader: r.who || null,
    date_complete: sheetDate(r.date), cell_type: r.type || null, synced_at: now,
  }));
  const dated = out.filter(o => o.date_complete).length, typed = out.filter(o => o.cell_type).length;
  console.log(`[mirror] ${rows.length} sheet rows, ${out.length} cells (${dated} with a date, ${typed} with a type)`);
  if (dryRun || !out.length) return 0;
  for (let i = 0; i < out.length; i += 500) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ew_sheet_cells?on_conflict=dataset,segment_id`, {
      method: 'POST', headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(out.slice(i, i + 500)),
    });
    // Before supabase-dataset-stats.sql is installed there is nowhere to write.
    if (r.status === 404) { console.log('[mirror] ew_sheet_cells does not exist yet (run supabase-dataset-stats.sql). Nothing written.'); return 0; }
    if (!r.ok) throw new Error(`mirror write ${r.status}: ${await r.text()}`);
  }
  console.log(`[mirror] wrote ${out.length} row(s)`);
  return out.length;
}

async function retireOldSource(dataset, sheetId) {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(sheetId || '')) throw new Error('--retire-source needs a sheet id');
  const note = `Retired ${new Date().toISOString().slice(0, 10)}: imported from an old sheet (${sheetId.slice(0, 8)}) the game no longer uses.`;
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${SUPABASE_URL}/rest/v1/proofreading_tasks?select=id,notes&dataset=eq.${encodeURIComponent(dataset)}`
      + `&status=eq.pending&assigned_to=is.null&source_sheet_url=like.*${sheetId}*&order=id&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: supabaseHeaders });
    if (!res.ok) throw new Error(`read tasks ${res.status}: ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`[retire] ${dataset}: ${rows.length} Available cell(s) came from sheet ${sheetId}`);
  if (dryRun || !rows.length) return 0;
  let changed = 0;
  const queue = [...rows];
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/proofreading_tasks?id=eq.${t.id}&status=eq.pending&assigned_to=is.null`, {
        method: 'PATCH', headers: { ...supabaseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'skipped', notes: [t.notes, note].filter(Boolean).join(' ').slice(0, 2000), updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`update task ${t.id} ${res.status}: ${await res.text()}`);
      if ((await res.json()).length) changed++;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`[retire] hid ${changed} cell(s)`);
  return changed;
}

(async () => {
  if (retireSource) {
    if (!onlyDataset) { console.error('--retire-source needs --dataset'); process.exit(1); }
    await retireOldSource(onlyDataset, retireSource);
    return;
  }
  if (mirrorOnly) {
    const targets = SHEETS.filter(s => !s.byPoint && (!onlyDataset || s.dataset === onlyDataset));
    let wrote = 0, failed = 0;
    for (const cfg of targets) {
      try { wrote += await mirrorSheet(cfg); }
      catch (e) { console.error(`[mirror] ${cfg.dataset} failed:`, e.message); failed++; }
    }
    console.log(`
[mirror] done: ${wrote} row(s) written, ${failed} dataset(s) failed`);
    if (failed) process.exit(1);
    return;
  }
  if (statusesOnly) {
    const targets = SHEETS.filter(s => !s.byPoint && (!onlyDataset || s.dataset === onlyDataset));
    let changed = 0, failed = 0;
    for (const cfg of targets) {
      try { changed += await syncStatuses(cfg); }
      catch (e) { console.error(`[status] ${cfg.dataset} failed:`, e.message); failed++; }
    }
    console.log(`\n[status] done: ${changed} task(s) updated, ${failed} dataset(s) failed`);
    if (failed) process.exit(1);
    return;
  }
  const hour = etHour();
  if (!force && hour !== 0) {
    console.log(`[cells] ET hour is ${hour}, not midnight — skipping. (Use --force to override.)`);
    return;
  }
  const targets = onlyDataset ? SHEETS.filter(s => s.dataset === onlyDataset) : SHEETS;
  if (!targets.length) {
    console.error(`No sheet configured for --dataset=${onlyDataset}`);
    process.exit(1);
  }
  let added = 0, failed = 0;
  for (const cfg of targets) {
    try {
      if (refreshNucleus) { if (cfg.byPoint?.nucleus) added += await refreshNucleusTasks(cfg); continue; }
      added += await (cfg.byPoint ? syncPointSheet(cfg) : syncSheet(cfg));
    }
    catch (e) { console.error(`[cells] ${cfg.dataset} failed:`, e.message); failed++; }
  }
  console.log(`\n[cells] done — ${added} added, ${failed} dataset(s) failed`);
  if (failed) process.exit(1);
})();
