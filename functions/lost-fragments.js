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
 *     columns A to P only (the lab's Q to U are never touched). Merges,
 *     cuts and volume stay in Supabase only, for points (Ames 2026-11-20).
 *
 *   fragments.submit   the answer; returns {first} so the game counts a
 *                      completed cell only once
 *   fragments.list     this player's answers, and which fragments anyone has
 *   fragments.caveId   the CAVE row for an answer saved while CAVE was down
 *   fragments.claim    Play landed on a fragment: it is this player's until
 *                      they Skip it or Submit it (Ames 2026-11-20). One claim
 *                      per player; a claim left alone for CLAIM_DAYS lapses.
 *   fragments.release  Skip: the fragment goes back to everyone.
 *   fragments.keep     the player edited the fragment: it stays theirs when
 *                      Play hands them the next one (Ames 2026-11-21: her
 *                      edited fragment went back to the pool). At most
 *                      KEEP_LIMIT at once; with that many, no new claims
 *                      until one is completed or skipped.
 *   fragments.stash    part of a fragment belonged to another cell that is
 *                      not proofread yet: that cell goes into the Stashed
 *                      group for anyone to proofread, or the player keeps it
 *                      to proofread next (Ames 2026-11-20: "stash the other
 *                      cell for proofreading somehow - or let the player
 *                      choose to proofread it too"). Stashed cells are played
 *                      and answered like any fragment, group 'stashed'.
 *
 * Claims live only in ew_lost_fragment_claims, never in the sheet: players
 * skip through many fragments before settling on one, and the lab only
 * wants answers.
 */

const SHEET_ID = '1Ut0-X4ilf65enHs0SaLJf7CvZCs5wqVIZ5rmhgNGNi8';
const SHEET_TAB = 'Results';
const CG = 'https://minnie.microns-daf.com/segmentation/api/v1/table/stroeh_mouse_retina';
const L2 = 'https://minnie.microns-daf.com/l2cache/api/v1/table/stroeh_mouse_retina/attributes';
/** Players in the preview on live, beside admins (src/util/play.ts FRAGMENT_TESTERS). */
const TESTERS = new Set(['5bb0310a-b42d-4d13-937f-eab620794949']);  // Jan Lause
/** Open to every signed in player (Ames 2026-11-20: "let's get the Lost
 *  Fragments deployed!"). Play still asks for edit access on Retina. */
const OPEN = true;
const GROUPS = { large: 'Large', smaller: 'Small', glia: 'Glia-like', soma: 'Soma-like', stashed: 'Stashed' };
/** What became of the other cell a fragment was attached to. */
const OTHER = { done: 'already proofread', stashed: 'stashed for later', proofread: 'proofreading it too' };
const FLAGS = ['no flag', 'soma', 'glia', 'soma, glia'];
const ID = /^\d{15,20}$/;
const MAX_L2 = 6000;
const CLAIM_DAYS = 14;
/** Started fragments a player may hold at once (Ames 2026-11-21: "it should force me to complete or skip them after say 5 fragments"). */
const KEEP_LIMIT = 5;
const claimCutoff = () => new Date(Date.now() - CLAIM_DAYS * 864e5).toISOString();  // a fragment past this is not sized (a whole cell merged in)

// ── Points, a beta (Ames 2026-11-20: "we want players to start with larger
// segs even though small ones would be easier"). Size pays more than in
// proportion; edits and what you grow it by add to that. Kept in step with
// src/util/fragment_points.ts, the estimate players see before they pick.
// Saved with the answer only: not in stats, the leaderboard or the sheet.
const POINTS = { sizeScale: 2, sizePower: 0.75, maxUm3: 3000, merge: 10, cut: 5, maxEdits: 50, perUm3Grown: 1, maxGrown: 500, nucleus: 50 };
function sizePoints(um3) {
  const v = Math.min(Math.max(Number(um3) || 0, 0), POINTS.maxUm3);
  return Math.round(POINTS.sizeScale * Math.pow(v, POINTS.sizePower));
}
function fragmentPoints({ um3, merges, cuts, um3Added, nucleus }) {
  const size = sizePoints(um3);
  const m = Math.min(Math.max(Number(merges) || 0, 0), POINTS.maxEdits);
  const c = Math.min(Math.max(Number(cuts) || 0, 0), POINTS.maxEdits - m);
  const edits = m * POINTS.merge + c * POINTS.cut;
  const grown = Math.round(Math.min(Math.max(Number(um3Added) || 0, 0), POINTS.maxGrown) * POINTS.perUm3Grown);
  const nuc = nucleus ? POINTS.nucleus : 0;
  return { size, edits, grown, nucleus: nuc, total: size + edits + grown + nuc };
}

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
  // The nucleus step is gone from the game (Ames 2026-11-20: "get rid of
  // this!"); an ID sent by an older page is still kept.
  const note = String(a.note || '').trim();
  if (note.length > 2000) throw bad('The note is too long (2,000 characters at most).');
  const labFlag = FLAGS.includes(a.labFlag) ? a.labFlag : '';
  const labUm3 = Number.isFinite(Number(a.labUm3)) ? Math.round(Number(a.labUm3) * 100) / 100 : null;
  const cave = a.caveAnnotationId == null ? null : Number(a.caveAnnotationId);
  if (cave !== null && !(Number.isSafeInteger(cave) && cave > 0)) throw bad('Bad CAVE row.');
  const otherRoot = a.otherRoot == null || a.otherRoot === '' ? null : String(a.otherRoot);
  if (otherRoot !== null && !ID.test(otherRoot)) throw bad('Not a segment ID for the other cell.');
  const otherStatus = otherRoot && OTHER[a.otherStatus] ? a.otherStatus : null;
  return { fragment_id: fragmentId, group_key: a.group, root_id: rootId, lab_flag: labFlag, lab_um3: labUm3,
    fixed: true, ends: true, point_in: a.pointIn, pt, nucleus_id: nucleusId, no_nucleus: noNucleus, note, cave_annotation_id: cave,
    other_root: otherStatus ? otherRoot : null, other_status: otherStatus };
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
  const out = { merges: null, cuts: null, um3_added: null, um3_removed: null, _before: null };
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
      out._before = before;
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
    row.nucleus_id ? "'" + row.nucleus_id : '', yes(row.no_nucleus),
    [row.note, row.other_root && OTHER[row.other_status] ? `Part belonged to cell ${row.other_root}, ${OTHER[row.other_status]}.` : ''].filter(Boolean).join(' ')];
}
/** Writes the row; returns the sheet row number it is on. */
// OVERWRITE: a new line goes into the next empty row, which keeps the sheet's
// own look; inserting a row copied the header's white text (Ames 2026-11-20).
async function writeSheet(sheets, row, playerName) {
  const values = [sheetRow(row, playerName)];
  if (row.sheet_row) {
    await sheets(`${SHEET_ID}/values/${encodeURIComponent(`${SHEET_TAB}!A${row.sheet_row}:P${row.sheet_row}`)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values }) });
    return row.sheet_row;
  }
  const r = await sheets(`${SHEET_ID}/values/${encodeURIComponent(`${SHEET_TAB}!A:P`)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`,
    { method: 'POST', body: JSON.stringify({ values }) });
  const m = /![A-Z]+(\d+)/.exec(String((r && r.updates && r.updates.updatedRange) || ''));
  return m ? Number(m[1]) : null;
}

// ── Actions ──────────────────────────────────────────────────────────────────
/** io: { sb, me, isAdmin, caveToken, caveId, sheets } */
async function fragmentsAction(action, args, io) {
  const { sb, me } = io;
  if (!me || !me.id) throw bad('Your Pyr profile is not ready yet. Reload the page, then try again.', 403);
  if (!OPEN && !io.isAdmin && !TESTERS.has(String(me.id))) throw bad('Lost Fragments is not open to you yet.', 403);
  const playerName = String(me.display_name || me.username || 'Player').slice(0, 80);

  if (action === 'fragments.list') {
    const mine = await sb(`ew_lost_fragments?user_id=${eq(me.id)}&select=fragment_id,group_key,root_id,point_in,pt,nucleus_id,no_nucleus,note,cave_annotation_id,submitted_at,updated_at,points&limit=2000`);
    const all = await sb('ew_lost_fragments?select=fragment_id&limit=20000');
    const others = [...new Set(all.map(r => r.fragment_id))].filter(id => !mine.some(m => m.fragment_id === id));
    const claims = await sb(`ew_lost_fragment_claims?claimed_at=gt.${encodeURIComponent(claimCutoff())}&select=fragment_id,user_id,kept,claimed_at&order=claimed_at.desc&limit=20000`);
    const mineClaims = claims.filter(c => String(c.user_id) === String(me.id));
    const myClaim = (mineClaims[0] || {}).fragment_id || null;
    const myClaims = mineClaims.map(c => ({ fragment_id: c.fragment_id, kept: !!c.kept, claimed_at: c.claimed_at }));
    const held = claims.filter(c => String(c.user_id) !== String(me.id)).map(c => c.fragment_id);
    const stash = await sb('ew_lost_fragment_stash?select=root_id,pt,from_fragment_id,player_name,choice,created_at&order=created_at.asc&limit=2000');
    return { mine, others, held, myClaim, myClaims, keepLimit: KEEP_LIMIT, stash };
  }

  if (action === 'fragments.keep') {
    const fragmentId = String(args && args.fragmentId || '');
    if (!ID.test(fragmentId)) throw bad('Not a fragment ID.');
    const mineNow = await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&claimed_at=gt.${encodeURIComponent(claimCutoff())}&select=fragment_id,kept`);
    if (mineNow.some(c => c.fragment_id === fragmentId && c.kept)) return { kept: true };
    const kept = mineNow.filter(c => c.kept).map(c => c.fragment_id);
    if (kept.length >= KEEP_LIMIT) return { kept: false, reason: 'full', keptIds: kept };
    if (mineNow.some(c => c.fragment_id === fragmentId)) {
      await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&fragment_id=${eq(fragmentId)}`, { method: 'PATCH', body: JSON.stringify({ kept: true }) });
      return { kept: true };
    }
    const c = await fragmentsAction('fragments.claim', { fragmentId }, io);
    if (!c.claimed) return { kept: false, reason: c.reason };
    await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&fragment_id=${eq(fragmentId)}`, { method: 'PATCH', body: JSON.stringify({ kept: true }) });
    return { kept: true };
  }

  if (action === 'fragments.claim' || action === 'fragments.release') {
    const fragmentId = String(args && args.fragmentId || '');
    if (!ID.test(fragmentId)) throw bad('Not a fragment ID.');
    if (action === 'fragments.release') {
      await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&fragment_id=${eq(fragmentId)}`, { method: 'DELETE' });
      return { released: true };
    }
    const done = await sb(`ew_lost_fragments?fragment_id=${eq(fragmentId)}&user_id=neq.${encodeURIComponent(me.id)}&select=id&limit=1`);
    if (done.length) return { claimed: false, reason: 'done' };
    const holder = (await sb(`ew_lost_fragment_claims?fragment_id=${eq(fragmentId)}&select=user_id,claimed_at&limit=1`))[0];
    if (holder && String(holder.user_id) !== String(me.id) && holder.claimed_at > claimCutoff()) return { claimed: false, reason: 'held' };
    // Landing on a new one lets go of the last, unless that one was edited
    // (kept). With KEEP_LIMIT kept, finish or skip one first.
    const keptIds = (await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&kept=eq.true&claimed_at=gt.${encodeURIComponent(claimCutoff())}&select=fragment_id`))
      .map(c => c.fragment_id).filter(id => id !== fragmentId);
    const mineAlready = holder && String(holder.user_id) === String(me.id);
    if (!mineAlready && keptIds.length >= KEEP_LIMIT) return { claimed: false, reason: 'full', keptIds };
    await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&kept=eq.false&fragment_id=neq.${encodeURIComponent(fragmentId)}`, { method: 'DELETE' });
    if (mineAlready) return { claimed: true };
    if (holder && String(holder.user_id) !== String(me.id)) await sb(`ew_lost_fragment_claims?fragment_id=${eq(fragmentId)}&claimed_at=lte.${encodeURIComponent(claimCutoff())}`, { method: 'DELETE' });
    try {
      await sb('ew_lost_fragment_claims', { method: 'POST', body: JSON.stringify({ fragment_id: fragmentId, user_id: me.id }) });
    } catch (e) {
      return { claimed: false, reason: 'held' };  // someone landed on it a moment before
    }
    return { claimed: true };
  }

  if (action === 'fragments.stash') {
    const rootId = String(args && args.rootId || '');
    if (!ID.test(rootId)) throw bad('Not a segment ID.');
    const from = String(args && args.fromFragmentId || '');
    if (!ID.test(from)) throw bad('Not a fragment ID.');
    const choice = args && args.choice === 'proofread' ? 'proofread' : 'stash';
    const p = args && args.pt;
    const pt = Array.isArray(p) && p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) < 1e7) ? p.map(n => Math.round(n)) : null;
    if (!pt) throw bad('Put the crosshairs in the other cell first.');
    // Once per cell: a second player finding the same cell changes nothing.
    await sb('ew_lost_fragment_stash?on_conflict=root_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ root_id: rootId, pt, from_fragment_id: from, user_id: me.id, player_name: playerName, choice }) });
    // Proofread it too: it is this player's, as Play's claim would make it.
    if (choice === 'proofread') {
      const c = await fragmentsAction('fragments.claim', { fragmentId: rootId }, io);
      return { stashed: true, claimed: !!c.claimed, reason: c.reason };
    }
    return { stashed: true };
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
    const { _before, ...counts } = await measure(io.caveToken, io.caveId, answer.fragment_id, answer.root_id || answer.fragment_id);
    // Size from the server's own measure of the fragment as the lab listed it;
    // the lab's number only when the L2 cache can't say (capped either way).
    const points = fragmentPoints({ um3: _before ?? answer.lab_um3, merges: counts.merges, cuts: counts.cuts, um3Added: counts.um3_added,
      nucleus: answer.point_in === 'soma' && !answer.no_nucleus && !!answer.nucleus_id });
    const now = new Date().toISOString();
    // The sheet line is written by ewLostFragmentsSheet (syncSheet below),
    // which runs as the sheet identity; this function can't (Ames 2026-11-20:
    // "I don't see my lost fragment completions" in the sheet, a 403).
    const fields = { ...answer, ...counts, updated_at: now, player_name: playerName, sheet_dirty: true, points: points.total, points_detail: points,
      cave_annotation_id: answer.cave_annotation_id ?? (had ? had.cave_annotation_id : null) };
    let row;
    if (had) row = (await sb(`ew_lost_fragments?id=eq.${had.id}`, { method: 'PATCH', body: JSON.stringify(fields) }))[0];
    else row = (await sb('ew_lost_fragments', { method: 'POST', body: JSON.stringify({ user_id: me.id, ...fields, submitted_at: now }) }))[0];
    await sb(`ew_lost_fragment_claims?user_id=${eq(me.id)}&fragment_id=${eq(answer.fragment_id)}`, { method: 'DELETE' }).catch(() => undefined);
    return { saved: true, first: !had, points, sheet: row ? 'queued' : 'failed', merges: counts.merges, cuts: counts.cuts, um3Added: counts.um3_added, um3Removed: counts.um3_removed };
  }

  throw bad(`unknown action ${action}`);
}

/** Writes every answer waiting for the sheet (new, or sent again), oldest
 *  first. Runs every few minutes as the sheet identity. An answer sent again
 *  while it writes stays waiting, so the next run writes the newer one. */
async function syncSheet({ sb, sheets }) {
  const rows = await sb('ew_lost_fragments?sheet_dirty=eq.true&select=*&order=submitted_at.asc&limit=200');
  let written = 0, failed = 0;
  for (const row of rows) {
    try {
      const at = await writeSheet(sheets, row, row.player_name || 'Player');
      if (at && at !== row.sheet_row) await sb(`ew_lost_fragments?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ sheet_row: at }) });
      await sb(`ew_lost_fragments?id=eq.${row.id}&updated_at=${eq(row.updated_at)}`, { method: 'PATCH', body: JSON.stringify({ sheet_dirty: false }) });
      written++;
    } catch (e) {
      console.warn('[fragments] sheet:', e && e.message);
      failed++;
    }
  }
  return { waiting: rows.length, written, failed };
}

module.exports = { fragmentPoints, sizePoints, POINTS, syncSheet, fragmentsAction, cleanAnswer, sheetRow, measure, TESTERS, OPEN, CLAIM_DAYS, OTHER, KEEP_LIMIT };
