#!/usr/bin/env node
/**
 * shadow-points.mjs: the nightly job behind the hidden shadow points tally
 * (Ames 2026-11-20: "Go"; review Monday 2026-11-30). Players see nothing.
 *
 * Fills two admin only tables that the view ew_shadow_points_week reads
 * (supabase-shadow-points.sql):
 *   ew_shadow_ops         for each in game merge or cut (edit_log), whether it
 *                         STAYED: a merge's supervoxels still share a root, a
 *                         cut's removed edges still sit on different roots.
 *                         Also the root the edit ended in (the per cell cap).
 *   ew_shadow_cell_sizes  the size in um3 of each completed cell, from the L2
 *                         cache, for the root saved at completion.
 * An edit is checked again every night for 14 days, so a later undo takes
 * its points away; after that its answer is kept.
 * The Sandbox (pinky_nf_v2) is not checked: resets undo practice edits, so
 * the view counts every Sandbox edit instead.
 *
 * Reads CAVE and Supabase; writes only ew_shadow_* tables.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CAVE_SERVICE_TOKEN.
 * Usage: node scripts/shadow-points.mjs [--dry-run]
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAVE_TOKEN = process.env.CAVE_SERVICE_TOKEN;
const DRY = process.argv.includes('--dry-run');
if (!SUPABASE_URL || !SUPABASE_KEY || !CAVE_TOKEN) {
  console.error('Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CAVE_SERVICE_TOKEN');
  process.exit(1);
}

const START = '2026-11-09T00:00:00Z';   // the Monday before the tally began; the past week is backfilled
const RECHECK_DAYS = 14;
const MAX_CELLS_PER_RUN = 3000;
const GRAPHS = {
  stroeh_mouse_retina: { seg: 'https://minnie.microns-daf.com/segmentation/api/v1/table/stroeh_mouse_retina',
                         l2: 'https://minnie.microns-daf.com/l2cache/api/v1/table/stroeh_mouse_retina/attributes' },
  pni_mec:             { seg: 'https://hc.himc-cave.com/segmentation/api/v1/table/pni_mec',
                         l2: 'https://hc.himc-cave.com/l2cache/api/v1/table/pni_mec/attributes' },
};
const CAVE_H = { Authorization: `Bearer ${CAVE_TOKEN}` };
const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...SB_H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`supabase ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** All rows of a query, by keyset on a numeric or text key (never offset). */
async function all(table, select, filters, key = 'id') {
  const out = []; let after = null;
  for (;;) {
    const past = after === null ? '' : `&${key}=gt.${encodeURIComponent(after)}`;
    const page = await sb(`${table}?select=${key},${select}&${filters}${past}&order=${key}.asc&limit=1000`);
    out.push(...page);
    if (page.length < 1000) return out;
    after = page[page.length - 1][key];
  }
}

async function cave(url, init = {}, tries = 3) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, { ...init, headers: { ...CAVE_H, ...(init.headers || {}) } });
    if (r.ok) return r;
    if (i >= tries || (r.status < 500 && r.status !== 429)) throw new Error(`CAVE ${r.status} ${url.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
    await new Promise(res => setTimeout(res, 2000 * i));
  }
}

async function details(ds, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const q = encodeURIComponent(JSON.stringify(ids.slice(i, i + 100).map(Number)));
    const r = await cave(`${GRAPHS[ds].seg}/operation_details?operation_ids=${q}`);
    // Ids are past 2^53: read them as text, never as JS numbers.
    const text = await r.text();
    const safe = text.replace(/(?<=[\[,\s:])(\d{16,20})(?=[\],\s}])/g, '"$1"');
    for (const [k, v] of Object.entries(JSON.parse(safe))) out.set(String(k), v);
  }
  return out;
}

async function roots(ds, svs) {
  const uniq = [...new Set(svs)]; const out = new Map();
  for (let i = 0; i < uniq.length; i += 5000) {
    const chunk = uniq.slice(i, i + 5000);
    const body = Buffer.from(new BigUint64Array(chunk.map(BigInt)).buffer);
    const r = await cave(`${GRAPHS[ds].seg}/roots_binary`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
    const got = new BigUint64Array((await r.arrayBuffer()));
    chunk.forEach((sv, j) => out.set(sv, got[j].toString()));
  }
  return out;
}

async function upsert(table, rows, conflict) {
  if (DRY || !rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    await sb(`${table}?on_conflict=${conflict}`, { method: 'POST', body: JSON.stringify(rows.slice(i, i + 500)),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  }
}

const pairs = v => Array.isArray(v) ? v.map(e => [String(e[0]), String(e[1])]) : [];

async function checkOps() {
  const frozenBefore = new Date(Date.now() - RECHECK_DAYS * 864e5).toISOString();
  const logged = await all('edit_log', 'user_id,operation,dataset,timestamp,op:metadata->>operation_id',
    `operation=in.(merge,split)&dataset=in.(${Object.keys(GRAPHS).join(',')})&timestamp=gte.${START}`);
  const done = await all('ew_shadow_ops', 'dataset', `ts=lt.${frozenBefore}&stayed=not.is.null`, 'operation_id');
  const frozen = new Set(done.map(d => `${d.dataset}|${d.operation_id}`));
  const todo = logged.filter(e => e.op && /^\d+$/.test(e.op) && !frozen.has(`${e.dataset}|${e.op}`));
  let checked = 0, stayedN = 0, errors = 0;
  for (const ds of Object.keys(GRAPHS)) {
    const rows = todo.filter(e => e.dataset === ds);
    if (!rows.length) continue;
    let det;
    try { det = await details(ds, rows.map(e => e.op)); }
    catch (e) { console.error(`${ds}: operation details failed, skipped this run: ${e.message}`); errors += rows.length; continue; }
    const svs = [];
    for (const d of det.values()) {
      for (const [a, b] of [...pairs(d.added_edges), ...pairs(d.removed_edges)]) svs.push(a, b);
      for (const s of d.source_ids || []) svs.push(String(s));
    }
    let rt;
    try { rt = await roots(ds, svs); }
    catch (e) { console.error(`${ds}: roots failed, skipped this run: ${e.message}`); errors += rows.length; continue; }
    const out = [];
    for (const e of rows) {
      const d = det.get(e.op); const kind = e.operation;
      let stayed = null, cell = null, error = null;
      if (!d) error = 'no operation details';
      else if (kind === 'merge') {
        const es = pairs(d.added_edges);
        stayed = es.length > 0 && es.every(([a, b]) => rt.get(a) && rt.get(a) === rt.get(b));
        cell = es.length ? rt.get(es[0][0]) || null : null;
      } else {
        const es = pairs(d.removed_edges);
        stayed = es.length > 0 && es.every(([a, b]) => rt.get(a) && rt.get(b) && rt.get(a) !== rt.get(b));
        const src = (d.source_ids || [])[0];
        cell = src != null ? rt.get(String(src)) || null : null;
      }
      if (stayed === null && !error) error = 'no edges';
      if (error) errors++; if (stayed) stayedN++;
      out.push({ dataset: ds, operation_id: Number(e.op), user_id: e.user_id, kind, ts: e.timestamp,
                 stayed, cell_root: cell, error, checked_at: new Date().toISOString() });
    }
    await upsert('ew_shadow_ops', out, 'dataset,operation_id');
    checked += out.length;
    console.log(`${ds}: ${out.length} edits checked, ${out.filter(o => o.stayed).length} stayed`);
  }
  return { checked, stayedN, errors };
}

async function sizeCells() {
  const marks = await all('ew_cell_marks', 'dataset,rid,ts',
    `operation=neq.unmark_complete&dataset=in.(${Object.keys(GRAPHS).join(',')})&ts=gte.${START}`);
  const have = new Set((await all('ew_shadow_cell_sizes', 'dataset', `done_at=gte.${START}`, 'root_id')).map(r => `${r.dataset}|${r.root_id}`));
  const want = new Map();
  for (const m of marks) {
    if (!m.rid || !/^\d{15,20}$/.test(m.rid)) continue;
    const k = `${m.dataset}|${m.rid}`;
    if (!have.has(k) && (!want.has(k) || want.get(k).ts > m.ts)) want.set(k, m);
  }
  const todo = [...want.values()].slice(0, MAX_CELLS_PER_RUN);
  const out = [];
  for (const m of todo) {
    const g = GRAPHS[m.dataset];
    let um3 = null, n = null, error = null;
    try {
      const lv = await (await cave(`${g.seg}/node/${m.rid}/leaves?stop_layer=2&int64_as_str=1`)).json();
      const ids = (lv.leaf_ids || []).map(String); n = ids.length; let vol = 0;
      for (let i = 0; i < ids.length; i += 5000) {
        const a = await (await cave(`${g.l2}?attribute_names=size_nm3&int64_as_str=1`, { method: 'POST',
          body: JSON.stringify({ l2_ids: ids.slice(i, i + 5000) }), headers: { 'Content-Type': 'application/json' } })).json();
        for (const v of Object.values(a)) vol += Number((v || {}).size_nm3) || 0;
      }
      um3 = vol / 1e9;
    } catch (e) { error = e.message.slice(0, 300); }
    out.push({ dataset: m.dataset, root_id: m.rid, done_at: m.ts, um3, l2_count: n, error, checked_at: new Date().toISOString() });
    if (out.length % 200 === 0) { await upsert('ew_shadow_cell_sizes', out.splice(0), 'dataset,root_id'); }
  }
  await upsert('ew_shadow_cell_sizes', out, 'dataset,root_id');
  console.log(`cells: ${todo.length} sized (${want.size} were waiting)`);
  return todo.length;
}

const started = new Date().toISOString();
const ops = await checkOps();
const cells = await sizeCells();
console.log(JSON.stringify({ ...ops, cells, dry: DRY }));
if (!DRY) await sb('ew_shadow_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
  started_at: started, finished_at: new Date().toISOString(), ops_checked: ops.checked, ops_stayed: ops.stayedN,
  cells_sized: cells, errors: ops.errors, note: 'scripts/shadow-points.mjs' }) });
