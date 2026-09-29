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

/**
 * Datasets that have a Cell Library sheet. Mirrors `cellLibrarySheetUrl` in
 * src/config.ts CAVE_CONFIGS_BY_DATASET. `dataset` is the canonical key stored
 * on the task row.
 */
const SHEETS = [
  {
    dataset: 'stroeh_mouse_retina',
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

(async () => {
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
