'use strict';
/**
 * Lost Fragments answers (Ames 2026-11-19: "a special lost fragment tag in our
 * cave table and backup in supabase", "eventually will write to a sheet",
 * "each fragment counts as a completed cell").
 *
 * The player's browser writes the CAVE point itself (tag lost_fragment in
 * eyewire_ii_cell_status_v2, with their own sign in) and hands the answer
 * here. This module:
 *   - keeps it in ew_lost_fragments (supabase-lost-fragments.sql), one row per
 *     player and fragment; Submit again updates the row;
 *   - reads the fragment's change log with the player's own CAVE sign in for
 *     their merges and cuts, and its size before and after for the volume;
 *   - writes the row to the researchers' sheet, "Pyr Lost Fragments results",
 *     columns A to T only (the lab's U to Y are never touched).
 *
 *   fragments.submit   the answer; returns {first} so the game counts a
 *                      completed cell only once
 *   fragments.list     this player's answers, and which fragments anyone has
 *   fragments.caveId   the CAVE row for an answer saved while CAVE was down
 */

const SHEET_ID = '1Ut0-X4ilf65enHs0SaLJf7CvZCs5wqVIZ5rmhgNGNi8';
const SHEET_TAB = 'Results';
const CG = 'https://minnie.microns-daf.com/segmentation/api/v1/table/stroeh_mouse_retina';
const L2 = 'https://minnie.microns-daf.com/l2cache/api/v1/table/stroeh_mouse_retina/attributes';
/** Players in the preview on live, beside admins (src/util/play.ts FRAGMENT_TESTERS). */
const TESTERS = new Set(['5bb0310a-b42d-4d13-937f-eab620794949']);  // Jan Lause
const GROUPS = { large: 'Large', smaller: 'Smaller', glia: 'Glia-like', soma: 'Soma-like' };
const FLAGS = ['no flag', 'soma', 'glia', 'soma, glia'];
const ID = /^\d{15,20}$/;
const MAX_L2 = 6000;  // a fragment past this is not sized (a whole cell merged in)

function bad(message, status = 400) { const e = new Error(message); e.status = status; return e; }
const eq = v => 'eq.' + encodeURIComponent(String(v));

/** The answer as stored, or throws a 400 the player reads. */
function cleanAnswer(a) {
  a = a && typeof a === 'object' ? a : {};
  const fragmentId = String(a.fragmentId || '');
  if (!ID.test(fragmentId)) throw bad('Not a fragment ID.');
  if (!GROUPS[a.group]) throw bad('Unknown fragment group.');
  const rootId = a.rootId == null || a.rootId === '' ? null : String(a.rootId);
  if (rootId !== null && !ID.test(rootId)) throw bad('Not a segment ID.');
  if (a.fixed !== true || a.ends !== true) throw bad('Tick both checks before you submit.');
  if (a.pointIn !== 'dendrite' && a.pointIn !== 'soma') throw bad('The point is in the dendrite or the soma.');
  const pt = Array.isArray(a.pt) && a.pt.length === 3 && a.pt.every(n => Number.isFinite(n) && Math.abs(n) < 1e7) ? a.pt.map(n => Math.round(n)) : null;
  if (!pt) throw bad('Use crosshairs to record the point first.');
  const nucleusId = String(a.nucleusId || '').trim();
  if (nucleusId && !/^\d{1,20}$/.test(nucleusId)) throw bad('A nucleus ID is a number.');
  const noNucleus = a.noNucleus === true;
  if (a.pointIn === 'soma' && !noNucleus && !nucleusId) throw bad('Add the nucleus ID, or tick No nucleus.');
  const note = String(a.note || '').trim();
  if (note.length > 2000) throw bad('The note is too long (2,000 characters at most).');
  const labFlag = FLAGS.includes(a.labFlag) ? a.labFlag : '';
  const labUm3 = Number.isFinite(Number(a.labUm3)) ? Math.round(Number(a.labUm3) * 100) / 100 : null;
  const cave = a.caveAnnotationId == null ? null : Number(a.caveAnnotationId);
  if (cave !== null && !(Number.isSafeInteger(cave) && cave > 0)) throw bad('Bad CAVE row.');
  return { fragment_id: fragmentId, group_key: a.group, root_id: rootId, lab_flag: labFlag, lab_um3: labUm3,
    fixed: true, ends: true, point_in: a.pointIn, pt, nucleus_id: nucleusId, no_nucleus: noNucleus, note, cave_annotation_id: cave };
}

// ── Merges, cuts and volume, read with the player's own CAVE sign in ────────
async function cg(token, path, init = {}) {
  const r = await fetch(path, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`graph server ${r.status}`);
  return r.json();
}
/** Cubic micrometers, from the L2 cache; null when it can't say. */
async function volume(token, root) {
  const leaves = await cg(token, `${CG}/node/${root}/leaves?stop_layer=2&int64_as_str=1`);
  const ids = (leaves.leaf_ids || []).map(String);
  if (!ids.length || ids.length > MAX_L2) return null;
  const data = await cg(token, `${L2}?attribute_names=size_nm3`, { method: 'POST', body: JSON.stringify({ l2_ids: ids }) });
  let nm3 = 0;
  for (const id of ids) nm3 += Number((data[id] || {}).size_nm3) || 0;
  return nm3 / 1e9;
}
/** The player's merges and cuts on this segment, and how its size moved
 *  since the lab listed it. The size change is net: a fragment that gained
 *  10 and lost 40 shows 30 removed. Any failure leaves the numbers empty. */
async function measure(token, caveId, fragmentId, rootId) {
  const out = { merges: null, cuts: null, um3_added: null, um3_removed: null };
  if (!token || !rootId) return out;
  try {
    const log = await cg(token, `${CG}/root/${rootId}/change_log`);
    const mine = (log.user_info || {})[String(caveId)] || { n_mergers: 0, n_splits: 0 };
    out.merges = Number(mine.n_mergers) || 0;
    out.cuts = Number(mine.n_splits) || 0;
  } catch (e) { console.warn('[fragments] change log:', e && e.message); }
  try {
    const [before, after] = await Promise.all([volume(token, fragmentId), rootId === fragmentId ? null : volume(token, rootId)]);
    if (before != null) {
      const now = rootId === fragmentId ? before : after;
      if (now != null) {
        const d = Math.round((now - before) * 100) / 100;
        out.um3_added = Math.max(0, d);
        out.um3_removed = Math.max(0, -d);
      }
    }
  } catch (e) { console.warn('[fragments] volume:', e && e.message); }
  return out;
}

// ── The researchers' sheet ───────────────────────────────────────────────────
function sheetRow(row, playerName) {
  const yes = b => (b ? 'Yes' : 'No');
  const at = new Date(row.updated_at || Date.now()).toISOString().replace('T', ' ').slice(0, 16);
  const n = v => (v == null ? '' : v);
  return [at, playerName, GROUPS[row.group_key], "'" + row.fragment_id, row.root_id ? "'" + row.root_id : '', row.lab_flag, n(row.lab_um3),
    yes(row.fixed), yes(row.ends), row.point_in === 'soma' ? 'Soma' : 'Major dendrite', row.pt[0], row.pt[1], row.pt[2],
    row.nucleus_id ? "'" + row.nucleus_id : '', yes(row.no_nucleus), n(row.merges), n(row.cuts), n(row.um3_added), n(row.um3_removed), row.note];
}
/** Writes the row; returns the sheet row number it is on. */
async function writeSheet(sheets, row, playerName) {
  const values = [sheetRow(row, playerName)];
  if (row.sheet_row) {
    await sheets(`${SHEET_ID}/values/${encodeURIComponent(`${SHEET_TAB}!A${row.sheet_row}:T${row.sheet_row}`)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values }) });
    return row.sheet_row;
  }
  const r = await sheets(`${SHEET_ID}/values/${encodeURIComponent(`${SHEET_TAB}!A:T`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) });
  const m = /![A-Z]+(\d+)/.exec(String((r && r.updates && r.updates.updatedRange) || ''));
  return m ? Number(m[1]) : null;
}

// ── Actions ──────────────────────────────────────────────────────────────────
/** io: { sb, me, isAdmin, caveToken, caveId, sheets } */
async function fragmentsAction(action, args, io) {
  const { sb, me } = io;
  if (!me || !me.id) throw bad('Your Pyr profile is not ready yet. Reload the page, then try again.', 403);
  if (!io.isAdmin && !TESTERS.has(String(me.id))) throw bad('Lost Fragments is not open to you yet.', 403);
  const playerName = String(me.display_name || me.username || 'Player').slice(0, 80);

  if (action === 'fragments.list') {
    const mine = await sb(`ew_lost_fragments?user_id=${eq(me.id)}&select=fragment_id,group_key,root_id,point_in,pt,nucleus_id,no_nucleus,note,cave_annotation_id,submitted_at,updated_at&limit=2000`);
    const all = await sb('ew_lost_fragments?select=fragment_id&limit=20000');
    const others = [...new Set(all.map(r => r.fragment_id))].filter(id => !mine.some(m => m.fragment_id === id));
    return { mine, others };
  }

  if (action === 'fragments.caveId') {
    const fragmentId = String(args && args.fragmentId || '');
    const cave = Number(args && args.caveAnnotationId);
    if (!ID.test(fragmentId) || !(Number.isSafeInteger(cave) && cave > 0)) throw bad('Bad CAVE row.');
    await sb(`ew_lost_fragments?user_id=${eq(me.id)}&fragment_id=${eq(fragmentId)}&cave_annotation_id=is.null`,
      { method: 'PATCH', body: JSON.stringify({ cave_annotation_id: cave }) });
    return { saved: true };
  }

  if (action === 'fragments.submit') {
    const answer = cleanAnswer(args);
    const had = (await sb(`ew_lost_fragments?user_id=${eq(me.id)}&fragment_id=${eq(answer.fragment_id)}&select=id,sheet_row,cave_annotation_id&limit=1`))[0];
    const counts = await measure(io.caveToken, io.caveId, answer.fragment_id, answer.root_id || answer.fragment_id);
    const now = new Date().toISOString();
    const fields = { ...answer, ...counts, updated_at: now,
      cave_annotation_id: answer.cave_annotation_id ?? (had ? had.cave_annotation_id : null) };
    let row;
    if (had) row = (await sb(`ew_lost_fragments?id=eq.${had.id}`, { method: 'PATCH', body: JSON.stringify(fields) }))[0];
    else row = (await sb('ew_lost_fragments', { method: 'POST', body: JSON.stringify({ user_id: me.id, ...fields, submitted_at: now }) }))[0];
    let sheet = 'saved';
    try {
      const at = await writeSheet(io.sheets, row, playerName);
      if (at && at !== row.sheet_row) await sb(`ew_lost_fragments?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ sheet_row: at }) });
    } catch (e) {
      console.warn('[fragments] sheet:', e && e.message);
      sheet = 'failed';
    }
    return { saved: true, first: !had, sheet, merges: counts.merges, cuts: counts.cuts, um3Added: counts.um3_added, um3Removed: counts.um3_removed };
  }

  throw bad(`unknown action ${action}`);
}

module.exports = { fragmentsAction, cleanAnswer, sheetRow, measure, TESTERS };
