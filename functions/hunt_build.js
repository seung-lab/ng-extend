'use strict';
/**
 * The Hunt Builder (Ames 2026-10-27, design https://claude.ai/artifact/NyoWvAkoj6u8NQmipF1vta):
 * players help make a Hunt on the Sandbox.
 *
 * 1. Admins pick candidate cells. Each is an ordinary proofreading task, claimed and proofread as any other;
 *    Done makes the candidate "proofread".
 * 2. Invited helpers merge and cut the proofread cell with the normal tools. Pyr stops each edit just before
 *    it goes to the graph and keeps it here as a suggestion: exactly what would have been sent. Two merges
 *    and two cuts each per cell (Ames: "2 merge suggestions and 2 cut suggestions per cell").
 * 3. Admins go through the suggestions, oldest first, and plant the ones they like (the real edit, sent from
 *    the admin's browser, recorded here by its operation) or skip them.
 * 4. Building: the planted edits, reversed, are the Hunt's key. 5. The Hunt. 6. Put it back (a button, Ames)
 *    undoes every planting.
 *
 * From suggestions on, the cell and everything a planting touched are protected: out of the Cell Library,
 * no claims, player edits refused (a helper's kept as a suggestion), no Watch it grow, no "update to the
 * current ID". From planting on they are also veiled: Pyr shows them to admins only (Ames: "we need some way
 * to stop them from being able to see the changes"). At the Hunt's start the veil lifts for the cell alone;
 * pieces a planted cut made stay hidden (Ames: "planted cuts should only show the original segment").
 *
 * Every rule is here and tested (hunt_build.test.js). Tables: supabase-hunt-build.sql (server only).
 */

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const posInt = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

const DATASET = 'pinky_nf_v2';
/** The candidate's life, in order. */
const STATUSES = ['proofreading', 'proofread', 'suggesting', 'planting', 'building', 'in_hunt', 'put_back', 'dropped'];
/** Protected: out of the Library and claims, edits refused or kept. */
const PROTECTED = new Set(['suggesting', 'planting', 'building', 'in_hunt']);
/** Veiled: Pyr shows them to admins only. */
const VEILED = new Set(['planting', 'building', 'in_hunt']);
const MAX_EACH = 10;
const MAX_POINTS_PER_SIDE = 40;
const ROOT_RE = /^\d{15,20}$/;
const TASK_NOTE = 'Hunt candidate: proofread this one fully. It may become a Hunt.';

const isRoot = (s) => ROOT_RE.test(String(s || ''));
const uniq = (a) => [...new Set(a)];
const roots = (list) => uniq((Array.isArray(list) ? list : []).map(String).filter(isRoot));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/** One point of an edit: [supervoxel, x, y, z] in nm, the supervoxel a decimal string. */
function cleanPoint(p) {
  if (!Array.isArray(p) || p.length < 4) return null;
  const sv = String(p[0]);
  const xyz = p.slice(1, 4).map(num);
  if (!/^\d{1,20}$/.test(sv) || sv === '0' || !xyz.every(Number.isFinite)) return null;
  return [sv, ...xyz.map((v) => Math.round(v * 10) / 10)];
}

/**
 * An edit as the graph would have been sent it (third_party graphene frontend.ts): a merge is two points, a cut
 * is {sources, sinks}. Returns the clean edit and one spot for Go there, or fails with what is wrong.
 */
function cleanEdit(kind, edit) {
  if (kind === 'merge') {
    const pts = Array.isArray(edit) ? edit.map(cleanPoint) : [];
    if (pts.length !== 2 || pts.some((p) => !p)) fail(400, 'A merge needs its two points.');
    if (pts[0][0] === pts[1][0]) fail(400, 'Those two points are on the same piece.');
    return { edit: pts, at_nm: middle(pts) };
  }
  if (kind === 'cut') {
    const side = (a) => (Array.isArray(a) ? a.map(cleanPoint) : []);
    const sources = side(edit && edit.sources), sinks = side(edit && edit.sinks);
    if (!sources.length || !sinks.length || sources.some((p) => !p) || sinks.some((p) => !p)) fail(400, 'A cut needs red and blue points.');
    if (sources.length > MAX_POINTS_PER_SIDE || sinks.length > MAX_POINTS_PER_SIDE) fail(400, `At most ${MAX_POINTS_PER_SIDE} points of each color.`);
    return { edit: { sources, sinks }, at_nm: middle([...sources, ...sinks]) };
  }
  fail(400, 'A suggestion is a merge or a cut.');
}

/** The middle of an edit's points, nm: where the Hunt place goes (as hunt_history_steps.ts does for a proofreader's edit). */
function middle(pts) {
  const n = pts.length;
  return [1, 2, 3].map((i) => Math.round(pts.reduce((s, p) => s + p[i], 0) / n));
}
const editPoints = (kind, edit) => (kind === 'merge' ? edit : [...(edit.sources || []), ...(edit.sinks || [])]);

/**
 * A planted edit as a Hunt place, reversed: an admin's merge plants a merger, which hunters Cut ('cut'); an
 * admin's cut takes a piece off, which hunters Extend ('merge').
 */
function placeOf(s) {
  return { kind: s.kind === 'merge' ? 'cut' : 'merge', nm: middle(editPoints(s.kind, s.edit)) };
}

/** What a helper has used of their two and two: everything sent and not taken back. */
function usedCounts(mine) {
  const live = mine.filter((s) => s.status !== 'taken_back');
  return { merge: live.filter((s) => s.kind === 'merge').length, cut: live.filter((s) => s.kind === 'cut').length };
}

/** Suggestions are open: the cell is taking them and its closing time (Ames 2026-10-27: "a set time") has not come. */
const openNow = (c, now) => c.status === 'suggesting' && !(Number.isFinite(msOf(c.suggest_until)) && now.getTime() >= msOf(c.suggest_until));
/** A time as players read it, Eastern (the Hunts tab's zone). */
const etWords = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
/** The bell note's button: opens the Help build box on the cell (src/components/NotificationFeedPanel.vue). */
const HELP_LINK = '[Help build](#nge-help-build)';
/** The bell note that opens suggestions, in Ames's words and layout (2026-10-27). */
function helpNoteBody(merges, cuts, until) {
  const kinds = [merges ? `* ${many(merges, 'merge', 'merges')}` : '', cuts ? `* ${many(cuts, 'cut', 'cuts')}` : ''].filter(Boolean).join('\n');
  return [
    'Help build a Hunt on the Sandbox!',
    'Open "Help build", then merge or cut the cell as you normally would: Pyr keeps each one as a suggestion and the cell stays as it is.',
    `You may submit:\n\n${kinds}`,
    `${until ? `Submissions close: ${etWords(until)}.\n` : ''}Where they go stays a secret until the Hunt.`,
    HELP_LINK,
  ].join('\n\n');
}
/**
 * The pictures on the Hunt Builder's bell notes (Ames 2026-10-27, her scythe: "I will make a couple options we can
 * use at different stages"): one per kind of note, served by the game at /hunt/<name>.png and -128.png.
 */
// Planted: Nurro watering the sprouts (EyeWire art, Ames 2026-10-27: "your submission has been planted shhh").
const NOTE_ART = { open: 'scythe', admins: 'scythe', planted: 'planted.jpg', released: 'scythe', sentBack: 'scythe' };
const noteArt = (ctx, kind, small = false) => {
  if (!ctx || !ctx.site) return undefined;
  const name = NOTE_ART[kind] || 'scythe', dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '.png'];
  return `${ctx.site}/hunt/${base}${small ? '-128' : ''}${ext}`;
};
const helpersOf = (c) => (Array.isArray(c.helpers) ? c.helpers.map(String) : []);
const isHelper = (c, uid) => helpersOf(c).includes(String(uid));
/** Who may suggest: every player with production access (Ames 2026-10-27: "open to all users with Production
 *  access"), and anyone an admin invited by name. prod is true, false, or null when CAVE could not be asked. */
const canSuggest = (c, uid, prod) => prod === true || isHelper(c, uid);
const msOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };

/**
 * Which IDs Pyr hides from players for one candidate now. Planting and building: everything protected. In a
 * Hunt: everything until its start, then everything but the cell players hunt (hunt_root): planted cuts show only
 * the original segment, and a Hunt made from the proofreaders' own edits keeps the proofread cell (the answers)
 * hidden throughout. huntInfo: { start_at } of the linked Hunt, or null.
 */
function veilOf(c, huntInfo, now) {
  if (!VEILED.has(c.status)) return [];
  const all = roots([c.root, ...(c.protected_roots || [])]);
  if (c.status !== 'in_hunt') return all;
  const start = msOf(huntInfo && huntInfo.start_at);
  if (!Number.isFinite(start) || now.getTime() < start) return all;
  const hunted = isRoot(c.hunt_root) ? String(c.hunt_root) : String(c.root);
  return all.filter((r) => r !== hunted);
}

/** The guard for one viewer: protected and veiled IDs, and whether they help with each. Never anyone's suggestions. */
function guardView(cands, hunts, me, now, prod = false) {
  const huntOf = new Map((hunts || []).map((h) => [Number(h.id), h]));
  return cands.filter((c) => PROTECTED.has(c.status)).map((c) => ({
    id: c.id, status: c.status, dataset: c.dataset || DATASET, root: String(c.root),
    protected: roots([c.root, ...(c.protected_roots || [])]),
    veil: veilOf(c, huntOf.get(Number(c.hunt_id)) || null, now),
    helper: openNow(c, now) && canSuggest(c, me.id, prod),
    merges_each: c.merges_each, cuts_each: c.cuts_each, anchor_sv: c.anchor_sv || null,
  }));
}

/** May a claim go ahead? A sentence when not (a protected cell), else null. */
function claimRefusal(cands, segmentId) {
  const id = String(segmentId || '');
  if (!isRoot(id)) return null;
  for (const c of cands) {
    if (!PROTECTED.has(c.status)) continue;
    if (roots([c.root, ...(c.protected_roots || [])]).includes(id)) return 'This cell is being made into a Hunt, so it cannot be claimed for now.';
  }
  return null;
}

/** The admin's settings for a candidate, clamped. */
function cleanSettings(f) {
  const out = {};
  if (!f || typeof f !== 'object') return out;
  for (const k of ['merges_each', 'cuts_each']) {
    if (k in f) { const n = Math.floor(Number(f[k])); if (!Number.isFinite(n) || n < 0 || n > MAX_EACH) fail(400, `Between 0 and ${MAX_EACH}.`); out[k] = n; }
  }
  if ('admin_note' in f) out.admin_note = String(f.admin_note || '').slice(0, 1000);
  if ('suggest_until' in f) {
    if (f.suggest_until == null || f.suggest_until === '') out.suggest_until = null;
    else { const t = Date.parse(f.suggest_until); if (!Number.isFinite(t)) fail(400, 'That closing time is not a date.'); out.suggest_until = new Date(t).toISOString(); }
  }
  return out;
}

/** Which moves an admin can make from each status (the list's buttons). */
const MOVES = {
  // Straight to building: a Hunt from the proofreaders' own edits, no suggestions.
  proofread: ['suggesting', 'building', 'proofreading', 'dropped'],
  suggesting: ['planting', 'proofread', 'dropped'],
  planting: ['building', 'suggesting'],
  building: ['planting', 'proofread'],
  proofreading: ['dropped'],
  dropped: ['proofreading'],
  // Proofread again (Ames 2026-10-27: "I want to reset the one I marked complete, bc I didn't actually check it").
  put_back: ['proofreading'],
};

// ── Actions ─────────────────────────────────────────────────────────────────

/**
 * ctx: { db, me, isAdmin, now, notify(rows) }
 */
async function buildAction(action, args, ctx) {
  const { me, isAdmin } = ctx;
  if (!me) fail(403, 'Sign in and create your Pyr profile first.');
  const needAdmin = () => { if (!isAdmin) fail(403, 'Admins only.'); };
  args = args || {};
  if (['build.guard', 'build.mine', 'build.suggest'].includes(action)) {
    ctx = { ...ctx, prod: isAdmin ? true : ctx.production ? await ctx.production().catch(() => null) : false };
  }
  switch (action) {
    case 'build.guard': return guard(ctx);
    case 'build.mine': return mine(ctx);
    case 'build.suggest': return suggest(args, ctx);
    case 'build.take_back': return takeBack(args, ctx);
    case 'build.send': return send(args, ctx);
    case 'build.my_note': return myNote(args, ctx);
    case 'build.list': needAdmin(); return list(ctx);
    case 'build.add': needAdmin(); return add(args, ctx);
    case 'build.set': needAdmin(); return setCandidate(args, ctx);
    case 'build.move': needAdmin(); return move(args, ctx);
    case 'build.helpers': needAdmin(); return setHelpers(args, ctx);
    case 'build.queue': needAdmin(); return queue(args, ctx);
    case 'build.plant': needAdmin(); return plant(args, ctx);
    case 'build.skip': needAdmin(); return skip(args, ctx);
    case 'build.undo': needAdmin(); return undo(args, ctx);
    case 'build.note': needAdmin(); return note(args, ctx);
    case 'build.track': needAdmin(); return track(args, ctx);
    case 'build.planted': needAdmin(); return planted(args, ctx);
    case 'build.link': needAdmin(); return link(args, ctx);
    case 'build.put_back': needAdmin(); return putBack(args, ctx);
    default: fail(400, 'Unknown Hunt Builder action.');
  }
}

async function getCandidate(db, id) {
  const c = await db.candidate(posInt(id));
  if (!c) fail(404, 'No such Hunt cell.');
  return c;
}

/**
 * A claim on a Hunt candidate is let go 24 hours after it was made (Ames 2026-10-27: "These cells release 24 hours
 * after being claimed"), so a candidate is never held up. Asked on the way through build.guard (every Sandbox player,
 * every 2 minutes) and build.list, at most once every 5 minutes per server copy. The claimer hears it in the bell.
 */
const CLAIM_HOURS = 24;
let releasedAt = 0;
function staleClaims(assignments, now, hours = CLAIM_HOURS) {
  const cut = now.getTime() - hours * 3600000;
  return assignments.filter((a) => a.status === 'active' && Number.isFinite(msOf(a.claimed_at)) && msOf(a.claimed_at) <= cut);
}
async function releaseStale(ctx, force = false) {
  const { db, now = new Date(), notify } = ctx;
  if (!db.activeAssignments || !db.releaseClaim) return 0;
  if (!force && Date.now() - releasedAt < 300000) return 0;
  releasedAt = Date.now();
  try {
    const waiting = (await db.candidatesByStatus(['proofreading'])).filter((c) => posInt(c.task_id));
    if (!waiting.length) return 0;
    const stale = staleClaims(await db.activeAssignments(waiting.map((c) => posInt(c.task_id))), now);
    let n = 0;
    for (const a of stale) {
      if (!(await db.releaseClaim(posInt(a.task_id), String(a.user_id), now))) continue;
      n++;
      if (notify) {
        await notify([{ user_id: a.user_id, title: 'Your Hunt candidate claim was let go', image: noteArt(ctx, 'released'),
          body: `A claim on a Hunt candidate lasts ${CLAIM_HOURS} hours, so yours has gone back to the Cell Library for someone else. Claim it again if you are still on it: your edits are all still in the cell.` }]);
      }
    }
    return n;
  } catch (e) { console.warn('[hunt_build] claims not let go:', e && e.message); return 0; }
}

async function guard(ctx) {
  const { db, me, now = new Date() } = ctx;
  await releaseStale(ctx);
  const cands = await db.protectedCandidates();
  const huntIds = uniq(cands.filter((c) => c.status === 'in_hunt' && posInt(c.hunt_id)).map((c) => posInt(c.hunt_id)));
  const hunts = huntIds.length ? await db.huntTimes(huntIds) : [];
  return { cells: guardView(cands, hunts, me, now, ctx.prod) };
}

/** A helper's cells (open for suggestions, they are invited) and their own suggestions on them. */
async function mine(ctx) {
  const { db, me, now = new Date() } = ctx;
  const cands = (await db.candidatesByStatus(['suggesting'])).filter((c) => canSuggest(c, me.id, ctx.prod));
  const sugs = cands.length ? await db.suggestionsBy(me.id, cands.map((c) => c.id)) : [];
  return {
    cells: cands.map((c) => ({
      id: c.id, root: String(c.root), dataset: c.dataset || DATASET, start: c.start_vox || null,
      merges_each: c.merges_each, cuts_each: c.cuts_each, used: usedCounts(sugs.filter((s) => s.candidate_id === c.id)),
      open: openNow(c, now), closes: c.suggest_until || null,
      suggestions: sugs.filter((s) => s.candidate_id === c.id && s.status !== 'taken_back')
        .map((s) => ({ id: s.id, kind: s.kind, at: s.at_nm, note: s.note || '', status: s.status, t: s.created_at, edit: s.edit })),
    })),
  };
}

async function suggest(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const c = await getCandidate(db, args.candidate_id);
  if (c.status !== 'suggesting') fail(409, 'This cell is not taking suggestions now.');
  if (!openNow(c, now)) fail(409, 'Suggestions for this cell have closed.');
  if (!canSuggest(c, me.id, ctx.prod)) fail(403, 'Suggestions are open to players with production access.');
  const kind = args.kind === 'merge' ? 'merge' : args.kind === 'cut' ? 'cut' : fail(400, 'A suggestion is a merge or a cut.');
  const { edit, at_nm } = cleanEdit(kind, args.edit);
  const mineBefore = await db.suggestionsBy(me.id, [c.id]);
  const used = usedCounts(mineBefore);
  const of = { merge: c.merges_each, cut: c.cuts_each };
  // The same edit again (a second press of Submit, or the tool sending twice: Ames 2026-10-27 "why does it show 2
  // mergers?") is the one already kept, not a new one.
  const same = mineBefore.find((s) => s.status !== 'taken_back' && s.kind === kind && JSON.stringify(s.edit) === JSON.stringify(edit));
  if (same) return { suggestion: { id: same.id, kind, at: same.at_nm, status: same.status }, used, of, again: true };
  const cap = kind === 'merge' ? c.merges_each : c.cuts_each;
  const full = () => fail(409, cap ? `You have made your ${many(cap, `${kind} suggestion`, `${kind} suggestions`)} for this cell. Take one back to try another.`
    : `This cell takes no ${kind} suggestions.`);
  if (used[kind] >= cap) full();
  // A draft until the helper presses Send (Ames 2026-10-27: "Should we have a submit?"). Before the draft status
  // is in the database (supabase-hunt-build.sql), it goes straight in, as before.
  const base = { candidate_id: c.id, user_id: me.id, kind, edit, at_nm, note: String(args.note || '').slice(0, 500), created_at: now.toISOString() };
  let row;
  try { row = await db.addSuggestion({ ...base, status: 'draft' }); }
  catch (e) { if (!/check|status|23514/i.test(String(e && e.message))) throw e; row = await db.addSuggestion({ ...base, status: 'open' }); }
  // Two at once can both pass the count: the later one goes.
  const after = usedCounts(await db.suggestionsBy(me.id, [c.id]));
  if (after[kind] > cap) { await db.patchSuggestion(row.id, { status: 'taken_back' }); full(); }
  return { suggestion: { id: row.id, kind, at: at_nm, status: row.status }, used: after, of };
}

async function ownOpen(db, id, me) {
  const s = await db.suggestion(posInt(id));
  if (!s || String(s.user_id) !== String(me.id)) fail(404, 'No such suggestion.');
  if (s.status !== 'open' && s.status !== 'draft') fail(409, s.status === 'planted' ? 'An admin has already planted this one.' : 'An admin has already looked at this one.');
  return s;
}

/** Send: a helper's drafts on a cell go to the admins, who hear once, with a link to the first. */
async function send(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const c = await getCandidate(db, args.candidate_id);
  if (c.status !== 'suggesting') fail(409, 'This cell is not taking suggestions now.');
  const drafts = (await db.suggestionsBy(me.id, [c.id])).filter((s) => s.status === 'draft');
  if (!drafts.length) return { sent: 0 };
  for (const s of drafts) await db.patchSuggestion(s.id, { status: 'open' });
  await tellAdmins(c, drafts, me.id, ctx);
  return { sent: drafts.length, at: now.toISOString() };
}
async function tellAdmins(c, sugs, userId, ctx) {
  const { db } = ctx;
  if (!ctx.notify || !db.adminUserIds || !sugs.length) return;
  try {
    const admins = await db.adminUserIds();
    if (!admins.length) return;
    const name = ((await db.names([userId])) || {})[userId] || 'A player';
    const m = sugs.filter((s) => s.kind === 'merge').length, k = sugs.length - m;
    const what = [m ? many(m, 'merge', 'merges') : '', k ? many(k, 'cut', 'cuts') : ''].filter(Boolean).join(' and ');
    const first = [...sugs].sort((a, b) => a.id - b.id)[0];
    await ctx.notify(admins.map((u) => ({ user_id: u, title: `💡 Hunt suggestion: cell …${String(c.root).slice(-6)}`, image: noteArt(ctx, 'admins'),
      body: `${name} sent ${what} for a Hunt.\n\n[Go there](#nge-build-suggestion=${first.id}) to look, then plant or skip each one.` })));
  } catch (e) { console.warn('[hunt_build] admins not told:', e && e.message); }
}
async function takeBack(args, ctx) {
  const { db, me } = ctx;
  const s = await ownOpen(db, args.id, me);
  await db.patchSuggestion(s.id, { status: 'taken_back' });
  return { id: s.id, status: 'taken_back' };
}
async function myNote(args, ctx) {
  const { db, me } = ctx;
  const s = await ownOpen(db, args.id, me);
  const n = String(args.note || '').slice(0, 500);
  await db.patchSuggestion(s.id, { note: n });
  return { id: s.id, note: n };
}

/** The candidates, newest first, each with its task's state, its counts and the next move. Proofread ones are noticed here. */
async function list(ctx) {
  const { db, now = new Date() } = ctx;
  await releaseStale(ctx);
  let cands = await db.candidates();
  // Phase 1: a candidate whose task is done is proofread (Done in the Cell Library is the player's word).
  const waiting = cands.filter((c) => c.status === 'proofreading' && posInt(c.task_id));
  if (waiting.length) {
    const tasks = new Map((await db.tasks(waiting.map((c) => posInt(c.task_id)))).map((t) => [Number(t.id), t]));
    for (const c of waiting) {
      const t = tasks.get(Number(c.task_id));
      if (!t || t.status !== 'completed') continue;
      const root = isRoot(t.final_segment_id) ? String(t.final_segment_id) : String(t.segment_id || c.root);
      const patch = { status: 'proofread', proofread_by: t.assigned_to || null, proofread_root: root, root, proofread_at: t.updated_at || now.toISOString(),
        anchor_sv: t.supervoxel_id ? String(t.supervoxel_id) : null, updated_at: now.toISOString() };
      if (t.claim_point_x != null) patch.start_vox = [t.claim_point_x, t.claim_point_y, t.claim_point_z].map(Number);
      Object.assign(c, await db.patchCandidate(c.id, patch) || patch);
    }
  }
  const ids = cands.map((c) => c.id);
  const [counts, tasks] = await Promise.all([
    ids.length ? db.suggestionCounts(ids) : {},
    db.tasks(cands.map((c) => posInt(c.task_id)).filter(Boolean)),
  ]);
  const taskOf = new Map(tasks.map((t) => [Number(t.id), t]));
  const names = await db.names(uniq([...cands.map((c) => c.proofread_by), ...tasks.map((t) => t.assigned_to), ...cands.flatMap(helpersOf)].filter(Boolean)));
  return {
    cells: cands.map((c) => {
      const t = taskOf.get(Number(c.task_id));
      return {
        id: c.id, root: String(c.root), status: c.status, dataset: c.dataset || DATASET, task_id: c.task_id || null,
        task: t ? { status: t.status, who: names[t.assigned_to] || null, since: t.updated_at } : null,
        proofread_by: names[c.proofread_by] || null, proofread_at: c.proofread_at || null,
        helpers: helpersOf(c).map((id) => ({ id, name: names[id] || 'Player' })),
        merges_each: c.merges_each, cuts_each: c.cuts_each, counts: counts[c.id] || {}, hunt_id: c.hunt_id || null,
        admin_note: c.admin_note || '', moves: MOVES[c.status] || [], start: c.start_vox || null, anchor_sv: c.anchor_sv || null,
        suggest_until: c.suggest_until || null, closed: c.status === 'suggesting' && !openNow(c, now),
        proofread_root: c.proofread_root || null, hunt_root: c.hunt_root || null,
        created_at: c.created_at,
      };
    }),
  };
}

/** New candidates from pasted IDs: a proofreading task each (one already there is reused), then the candidate. */
async function add(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const ids = roots(String(Array.isArray(args.roots) ? args.roots.join(' ') : args.roots || '').split(/[\s,;]+/));
  if (!ids.length) fail(400, 'Paste one or more cell IDs (long numbers).');
  if (ids.length > 50) fail(400, 'At most 50 at a time.');
  const settings = cleanSettings(args.settings || {});
  const open = new Set((await db.candidates()).filter((c) => c.status !== 'put_back' && c.status !== 'dropped').map((c) => String(c.root)));
  const added = [], skipped = [];
  for (const root of ids) {
    if (open.has(root)) { skipped.push(root); continue; }
    let task = await db.taskFor(DATASET, root);
    if (!task) task = await db.addTask({ segment_id: root, dataset: DATASET, notes: TASK_NOTE });
    const c = await db.addCandidate({ dataset: DATASET, root, task_id: task ? task.id : null, status: 'proofreading',
      merges_each: 2, cuts_each: 2, ...settings, created_by: me.id, created_at: now.toISOString(), updated_at: now.toISOString() });
    added.push(c.id);
  }
  return { added: added.length, skipped, ...(await list(ctx)) };
}

async function setCandidate(args, ctx) {
  const { db, now = new Date() } = ctx;
  const c = await getCandidate(db, args.id);
  const patch = cleanSettings(args.fields || {});
  if (!Object.keys(patch).length) fail(400, 'Nothing to change.');
  await db.patchCandidate(c.id, { ...patch, updated_at: now.toISOString() });
  return list(ctx);
}

/** The candidate's next step, from the list's buttons. Opening suggestions starts the guards and tells the helpers. */
async function move(args, ctx) {
  const { db, now = new Date(), notify } = ctx;
  const c = await getCandidate(db, args.id);
  const to = String(args.to || '');
  if (!STATUSES.includes(to) || !(MOVES[c.status] || []).includes(to)) fail(409, `A cell that is ${c.status} cannot go to ${to || 'that'}.`);
  const patch = { status: to, updated_at: now.toISOString() };
  if (to === 'suggesting') {
    patch.protected_roots = roots([...(c.protected_roots || []), c.root, c.proofread_root]);
    if ('suggest_until' in args) Object.assign(patch, cleanSettings({ suggest_until: args.suggest_until }));
    const until = 'suggest_until' in patch ? patch.suggest_until : c.suggest_until;
    if (until && msOf(until) <= now.getTime()) fail(400, 'Set a closing time in the future, or none.');
  }
  // Straight from proofread to building (the proofreaders' own edits): locked and veiled from now.
  if (to === 'building' && c.status === 'proofread') patch.protected_roots = roots([...(c.protected_roots || []), c.root, c.proofread_root]);
  // From put back or dropped: a fresh start. The task is Available again under the cell's ID now, and the old
  // proofreader, lock and Hunt are let go. Completions already counted stay counted.
  if (to === 'proofreading' && (c.status === 'put_back' || c.status === 'dropped')) {
    Object.assign(patch, { proofread_by: null, proofread_at: null, proofread_root: null, protected_roots: [], hunt_id: null, hunt_root: null, suggest_until: null });
    if (posInt(c.task_id)) await db.patchTask(posInt(c.task_id), { status: 'pending', assigned_to: null, segment_id: String(c.root), updated_at: now.toISOString() });
  }
  if (to === 'proofreading' && c.status === 'proofread' && posInt(c.task_id)) {
    // Sent back: the task is the proofreader's again, with the admin's note.
    await db.patchTask(posInt(c.task_id), { status: 'assigned', updated_at: now.toISOString() });
    if (notify && c.proofread_by) {
      await notify([{ user_id: c.proofread_by, title: 'A Hunt cell needs a little more proofreading', image: noteArt(ctx, 'sentBack'),
        body: `An admin looked at the Hunt cell you proofread and sent it back to you.${args.note ? ` Their note: ${String(args.note).slice(0, 500)}` : ''} It is in your claims again.` }]);
    }
  }
  const next = await db.patchCandidate(c.id, patch);
  // Planting starts: drafts a helper never sent count as sent (the admins hear, one note a helper).
  if (to === 'planting') {
    const drafts = (await db.suggestionsFor(c.id)).filter((s) => s.status === 'draft');
    for (const s of drafts) await db.patchSuggestion(s.id, { status: 'open' });
    for (const uid of uniq(drafts.map((s) => String(s.user_id)))) await tellAdmins(c, drafts.filter((s) => String(s.user_id) === uid), uid, ctx);
  }
  if (to === 'suggesting') {
    const until = next && next.suggest_until;
    const body = helpNoteBody(c.merges_each, c.cuts_each, until);
    // Everyone with production access, through the Production editors group (it keeps itself up to date), and
    // anyone invited by name.
    const group = db.productionGroupId ? await db.productionGroupId().catch(() => null) : null;
    if (group && db.insertGroupNote) await db.insertGroupNote({ title: 'Help build a Hunt', body, image_url: noteArt(ctx, 'open') || null, thumbnail_url: noteArt(ctx, 'open', true) || null, target_type: 'group', target_id: String(group), send_at: now.toISOString(), created_by: (ctx.me && ctx.me.id) || null });
    if (notify && helpersOf(c).length) await notify(helpersOf(c).map((uid) => ({ user_id: uid, title: 'Help build a Hunt', body, image: noteArt(ctx, 'open') })));
  }
  return { cell: next, ...(await list(ctx)) };
}

/** Invite helpers by name (their username or display name); the list replaces the old one. New ones hear at once when it is open. */
async function setHelpers(args, ctx) {
  const { db, now = new Date(), notify } = ctx;
  const c = await getCandidate(db, args.id);
  const names = uniq((Array.isArray(args.names) ? args.names : String(args.names || '').split(/[,\n]+/)).map((s) => String(s).trim()).filter(Boolean));
  if (names.length > 40) fail(400, 'At most 40 helpers.');
  const found = names.length ? await db.usersByName(names) : [];
  const missing = names.filter((n) => !found.some((u) => [u.username, u.display_name].some((x) => String(x || '').toLowerCase() === n.toLowerCase())));
  if (missing.length) fail(400, `No player called ${missing.join(', ')}.`);
  const ids = uniq(found.map((u) => String(u.id)));
  const fresh = ids.filter((id) => !isHelper(c, id));
  await db.patchCandidate(c.id, { helpers: ids, updated_at: now.toISOString() });
  if (c.status === 'suggesting' && fresh.length && notify) {
    await notify(fresh.map((uid) => ({ user_id: uid, title: 'Help build a Hunt', image: noteArt(ctx, 'open'),
      body: helpNoteBody(c.merges_each, c.cuts_each, c.suggest_until) })));
  }
  return list(ctx);
}

/** The suggestions on one cell, oldest first, with who sent each and what became of it. */
async function queue(args, ctx) {
  const { db } = ctx;
  let cid = args.id;
  // From an admin's bell note: the suggestion's cell.
  if (!posInt(cid) && posInt(args.suggestion_id)) { const s = await db.suggestion(posInt(args.suggestion_id)); if (!s) fail(404, 'No such suggestion.'); cid = s.candidate_id; }
  const c = await getCandidate(db, cid);
  const sugs = (await db.suggestionsFor(c.id)).filter((s) => s.status !== 'taken_back' && s.status !== 'draft')
    .sort((a, b) => msOf(a.created_at) - msOf(b.created_at) || a.id - b.id);
  const names = await db.names(uniq([...sugs.map((s) => s.user_id), ...sugs.map((s) => s.done_by)].filter(Boolean)));
  return {
    cell: { id: c.id, root: String(c.root), status: c.status, dataset: c.dataset || DATASET, start: c.start_vox || null, anchor_sv: c.anchor_sv || null,
      protected: roots([c.root, ...(c.protected_roots || [])]) },
    suggestions: sugs.map((s) => ({
      id: s.id, kind: s.kind, edit: s.edit, at: s.at_nm, note: s.note || '', status: s.status, t: s.created_at, name: names[s.user_id] || 'Player',
      admin_note: s.admin_note || '', done_by: names[s.done_by] || '', done_at: s.done_at || null, operation_id: s.operation_id || null,
      new_roots: Array.isArray(s.new_roots) ? s.new_roots.map(String) : [],
    })),
  };
}

async function sugOn(db, id) {
  const s = await db.suggestion(posInt(id));
  if (!s) fail(404, 'No such suggestion.');
  const c = await getCandidate(db, s.candidate_id);
  return { s, c };
}

/**
 * A suggestion planted: the admin's browser sent the edit and got the graph's answer. Kept: the operation, and
 * every ID it touched or made, so they are protected (and veiled) too. cell_root is the cell's ID after it.
 */
async function plant(args, ctx) {
  const { db, me, now = new Date(), notify } = ctx;
  const { s, c } = await sugOn(db, args.id);
  if (c.status !== 'planting') fail(409, 'Close the suggestions and start planting first.');
  if (s.status !== 'open') fail(409, 'This one has been dealt with already.');
  const op = posInt(args.operation_id);
  if (!op) fail(400, 'The graph did not say which edit it made.');
  const made = roots(args.new_roots), before = roots(args.before_roots);
  const cellRoot = isRoot(args.cell_root) ? String(args.cell_root) : made[0] || String(c.root);
  await db.patchSuggestion(s.id, { status: 'planted', operation_id: op, new_roots: made, admin_note: String(args.note || s.admin_note || '').slice(0, 1000),
    done_by: me.id, done_at: now.toISOString() });
  await db.patchCandidate(c.id, { root: cellRoot, protected_roots: roots([...(c.protected_roots || []), c.root, ...before, ...made, cellRoot]), updated_at: now.toISOString() });
  if (notify) {
    await notify([{ user_id: s.user_id, title: 'Your suggestion was planted', image: noteArt(ctx, 'planted'),
      body: `An admin planted one of your ${s.kind === 'merge' ? 'merges' : 'cuts'} in a Hunt cell. Keep it a secret until the Hunt!` }]);
  }
  return queue({ id: c.id }, ctx);
}

async function skip(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const { s, c } = await sugOn(db, args.id);
  if (s.status !== 'open') fail(409, 'This one has been dealt with already.');
  await db.patchSuggestion(s.id, { status: 'skipped', admin_note: String(args.note || s.admin_note || '').slice(0, 1000), done_by: me.id, done_at: now.toISOString() });
  return queue({ id: c.id }, ctx);
}

/** A planting taken back (the admin's browser undid it in the graph first). Its new IDs stay protected. */
async function undo(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const { s, c } = await sugOn(db, args.id);
  if (s.status !== 'planted') fail(409, 'Only a planted one can be undone.');
  if (!['planting', 'building'].includes(c.status)) fail(409, 'The Hunt has been made from this cell: use Put it back after it ends.');
  const made = roots(args.new_roots);
  const cellRoot = isRoot(args.cell_root) ? String(args.cell_root) : made[0] || String(c.root);
  await db.patchSuggestion(s.id, { status: 'undone', done_by: me.id, done_at: now.toISOString() });
  await db.patchCandidate(c.id, { root: cellRoot, protected_roots: roots([...(c.protected_roots || []), ...made, cellRoot]), updated_at: now.toISOString() });
  return queue({ id: c.id }, ctx);
}

async function note(args, ctx) {
  const { db } = ctx;
  const { s, c } = await sugOn(db, args.id);
  await db.patchSuggestion(s.id, { admin_note: String(args.note || '').slice(0, 1000) });
  return queue({ id: c.id }, ctx);
}

/**
 * An admin's own edit on a protected cell with the normal tools (Ames 2026-10-27: "I cut the branch smaller"): not a
 * Hunt place, but its new IDs are protected and veiled like the rest, and the cell's ID follows it.
 */
async function track(args, ctx) {
  const { db, now = new Date() } = ctx;
  const c = await getCandidate(db, args.id);
  if (!PROTECTED.has(c.status)) return { tracked: false };
  const made = roots(args.new_roots);
  const cellRoot = isRoot(args.cell_root) ? String(args.cell_root) : String(c.root);
  await db.patchCandidate(c.id, { root: cellRoot, protected_roots: roots([...(c.protected_roots || []), c.root, ...made, cellRoot]), updated_at: now.toISOString() });
  return { tracked: true, root: cellRoot };
}

/** The planted edits as Hunt places (reversed), for Make a Hunt from a proofread cell, with who suggested each. */
async function planted(args, ctx) {
  const { db } = ctx;
  const c = await getCandidate(db, args.id);
  const sugs = (await db.suggestionsFor(c.id)).filter((s) => s.status === 'planted')
    .sort((a, b) => msOf(a.done_at) - msOf(b.done_at) || a.id - b.id);
  const names = await db.names(uniq(sugs.map((s) => s.user_id)));
  return {
    cell: { id: c.id, root: String(c.root), dataset: c.dataset || DATASET, start: c.start_vox || null, status: c.status,
      proofread_root: c.proofread_root || null, anchor_sv: c.anchor_sv || null },
    places: sugs.map((s) => ({ ...placeOf(s), op: posInt(s.operation_id) || s.id, at: msOf(s.done_at) || 0, user: names[s.user_id] || 'Player', suggestion: s.id })),
  };
}

/** The Hunt made from this cell is saved: the cell goes with it (and the veil follows the Hunt's start). */
async function link(args, ctx) {
  const { db, now = new Date() } = ctx;
  const c = await getCandidate(db, args.id);
  if (!['building', 'in_hunt'].includes(c.status)) fail(409, 'Finish planting first (the cell must be in Building).');
  const hunt = posInt(args.hunt_id);
  if (!hunt || !(await db.huntTimes([hunt])).length) fail(404, 'No such Hunt.');
  // The cell players hunt: the cell after planting, or the cell before proofreading (its proofreaders' edits).
  const huntRoot = isRoot(args.hunt_root) ? { hunt_root: String(args.hunt_root) } : {};
  await db.patchCandidate(c.id, { status: 'in_hunt', hunt_id: hunt, ...huntRoot, updated_at: now.toISOString() });
  return list(ctx);
}

/**
 * Put it back (a button, Ames 2026-10-27). First call: the planted operations, newest first, for the admin's
 * browser to undo in the graph. Second call, with done: true and the cell's ID after, closes the cell.
 */
async function putBack(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const c = await getCandidate(db, args.id);
  if (c.status === 'in_hunt' && posInt(c.hunt_id)) {
    const h = (await db.huntTimes([posInt(c.hunt_id)]))[0];
    if (h && Number.isFinite(msOf(h.end_at)) && now.getTime() < msOf(h.end_at)) fail(409, 'The Hunt has not ended yet.');
  } else if (!['planting', 'building'].includes(c.status)) fail(409, 'Only a planted cell can be put back.');
  const sugs = (await db.suggestionsFor(c.id)).filter((s) => s.status === 'planted')
    .sort((a, b) => msOf(b.done_at) - msOf(a.done_at) || b.id - a.id);
  if (!args.done) return { cell: { id: c.id, root: String(c.root) }, operations: sugs.map((s) => posInt(s.operation_id)).filter(Boolean) };
  const undone = new Set((Array.isArray(args.undone) ? args.undone : []).map(posInt));
  for (const s of sugs) if (undone.has(posInt(s.operation_id))) await db.patchSuggestion(s.id, { status: 'put_back', done_by: me.id, done_at: now.toISOString() });
  const left = sugs.filter((s) => !undone.has(posInt(s.operation_id))).length;
  const cellRoot = isRoot(args.cell_root) ? String(args.cell_root) : String(c.root);
  await db.patchCandidate(c.id, { status: left ? c.status : 'put_back', root: cellRoot, updated_at: now.toISOString() });
  return { left, ...(await list(ctx)) };
}

/** Helpers with a planted suggestion in a Hunt: the maker Achievement goes to them at the end (hunts.js finalize). */
async function makersOf(db, huntId) {
  const cands = await db.candidatesForHunt(huntId);
  if (!cands.length) return [];
  const sugs = (await Promise.all(cands.map((c) => db.suggestionsFor(c.id)))).flat();
  return uniq(sugs.filter((s) => s.status === 'planted' || s.status === 'put_back').map((s) => String(s.user_id)));
}

// ── The database (Supabase REST, service role) ──────────────────────────────

function restDb(sb) {
  const enc = encodeURIComponent;
  const one = async (p) => (await p)[0] || null;
  const inList = (ids) => `(${ids.map((x) => enc(String(x))).join(',')})`;
  return {
    candidates: () => sb('hunt_candidates?select=*&order=created_at.desc&limit=500'),
    candidate: (id) => one(sb(`hunt_candidates?id=eq.${id}&select=*&limit=1`)),
    candidatesByStatus: (st) => sb(`hunt_candidates?status=in.(${st.join(',')})&select=*&limit=500`),
    protectedCandidates: () => sb(`hunt_candidates?status=in.(${[...PROTECTED].join(',')})&select=id,dataset,status,root,protected_roots,helpers,hunt_id,merges_each,cuts_each&limit=500`),
    candidatesForHunt: (id) => sb(`hunt_candidates?hunt_id=eq.${posInt(id)}&select=id&limit=50`),
    addCandidate: (row) => one(sb('hunt_candidates', { method: 'POST', body: JSON.stringify(row) })),
    patchCandidate: (id, row) => one(sb(`hunt_candidates?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) })),
    suggestion: (id) => one(sb(`hunt_suggestions?id=eq.${id}&select=*&limit=1`)),
    suggestionsFor: (cid) => sb(`hunt_suggestions?candidate_id=eq.${cid}&select=*&order=created_at.asc&limit=2000`),
    suggestionsBy: (uid, cids) => sb(`hunt_suggestions?user_id=eq.${enc(uid)}&candidate_id=in.${inList(cids)}&select=*&order=created_at.asc&limit=500`),
    suggestionCounts: async (cids) => {
      const rows = await sb(`hunt_suggestions?candidate_id=in.${inList(cids)}&select=candidate_id,status,user_id&limit=20000`);
      const out = {};
      for (const r of rows) {
        const o = out[r.candidate_id] = out[r.candidate_id] || { open: 0, planted: 0, skipped: 0, undone: 0, put_back: 0, helpers: 0, _u: new Set() };
        if (r.status in o) o[r.status]++;
        if (r.status !== 'taken_back') o._u.add(r.user_id);
      }
      for (const o of Object.values(out)) { o.helpers = o._u.size; delete o._u; }
      return out;
    },
    addSuggestion: (row) => one(sb('hunt_suggestions', { method: 'POST', body: JSON.stringify(row) })),
    patchSuggestion: (id, row) => one(sb(`hunt_suggestions?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) })),
    tasks: (ids) => (ids.length ? sb(`proofreading_tasks?id=in.${inList(ids)}&select=id,segment_id,status,assigned_to,final_segment_id,supervoxel_id,claim_point_x,claim_point_y,claim_point_z,updated_at`) : Promise.resolve([])),
    taskFor: (dataset, root) => one(sb(`proofreading_tasks?dataset=eq.${enc(dataset)}&segment_id=eq.${enc(root)}&select=id,status&order=id.desc&limit=1`)),
    addTask: (row) => one(sb('proofreading_tasks', { method: 'POST', body: JSON.stringify(row) })),
    patchTask: (id, row) => sb(`proofreading_tasks?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) }),
    productionGroupId: async () => { const g = await one(sb(`user_groups?name=eq.${enc('Production editors')}&select=id&limit=1`)); return g ? g.id : null; },
    insertGroupNote: (row) => one(sb('notifications', { method: 'POST', body: JSON.stringify(row) })),
    adminUserIds: async () => {
      const emails = (await sb('admins?select=email')).map((a) => String(a.email || '').toLowerCase()).filter(Boolean);
      if (!emails.length) return [];
      const list = emails.map((e) => '"' + e.replace(/["\\]/g, '') + '"').join(',');
      return (await sb('users?select=id&middleauth_email=in.(' + enc(list) + ')')).map((u) => u.id);
    },
    huntTimes: (ids) => sb(`hunts?id=in.${inList(ids)}&select=id,start_at,end_at,status`),
    activeAssignments: (taskIds) => sb(`task_assignments?task_id=in.${inList(taskIds)}&status=eq.active&select=task_id,user_id,claimed_at,status&limit=500`),
    /** As the pilot_task_action release does: the assignment released, the task back to pending, only if still that player's claim. */
    releaseClaim: async (taskId, userId, now) => {
      const t = await one(sb(`proofreading_tasks?id=eq.${taskId}&assigned_to=eq.${enc(userId)}&status=in.(assigned,in_progress)`,
        { method: 'PATCH', body: JSON.stringify({ status: 'pending', assigned_to: null, updated_at: now.toISOString() }) }));
      await sb(`task_assignments?task_id=eq.${taskId}&user_id=eq.${enc(userId)}&status=eq.active`,
        { method: 'PATCH', body: JSON.stringify({ status: 'released', released_at: now.toISOString() }) });
      return !!t;
    },
    names: async (ids) => {
      const list = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
      if (!list.length) return {};
      const rows = await sb(`users?id=in.(${list.map(enc).join(',')})&select=id,username,display_name`);
      return Object.fromEntries(rows.map((u) => [u.id, u.username || u.display_name || 'Player']));
    },
    usersByName: async (names) => {
      const q = names.map((n) => '"' + String(n).replace(/["\\(),]/g, '') + '"').join(',');
      const [a, b] = await Promise.all([
        sb(`users?username=in.(${enc(q)})&select=id,username,display_name&limit=100`),
        sb(`users?display_name=in.(${enc(q)})&select=id,username,display_name&limit=100`),
      ]);
      const seen = new Map();
      for (const u of [...a, ...b]) seen.set(u.id, u);
      // Case: PostgREST in() is exact, so a name typed in other case is tried once more, one by one.
      const missing = names.filter((n) => ![...seen.values()].some((u) => [u.username, u.display_name].some((x) => String(x || '').toLowerCase() === n.toLowerCase())));
      for (const n of missing.slice(0, 10)) {
        const like = enc(String(n).replace(/[%*,()"\\]/g, ''));
        for (const u of await sb(`users?or=(username.ilike.${like},display_name.ilike.${like})&select=id,username,display_name&limit=3`)) seen.set(u.id, u);
      }
      return [...seen.values()];
    },
  };
}

/** For ewSecureWrite's pilot.task: refuse a claim on a protected cell (by its ID, or a task's). Never blocks when the table is missing. */
async function claimGuard(sb, operation, args) {
  if (operation !== 'claim' && operation !== 'claim_cell') return null;
  let seg = '';
  if (operation === 'claim_cell') seg = String((args && args.segment_id) || '');
  else if (posInt(args && args.id)) {
    const t = (await sb(`proofreading_tasks?id=eq.${posInt(args.id)}&select=segment_id&limit=1`))[0];
    seg = t ? String(t.segment_id || '') : '';
  }
  if (!isRoot(seg)) return null;
  let cands;
  try { cands = await restDb(sb).protectedCandidates(); } catch (e) { return null; }
  return claimRefusal(cands, seg);
}

module.exports = {
  buildAction, restDb, claimGuard, makersOf, releaseStale, staleClaims, CLAIM_HOURS,
  cleanEdit, cleanPoint, middle, placeOf, canSuggest, helpNoteBody, track, noteArt, NOTE_ART, usedCounts, veilOf, guardView, claimRefusal, cleanSettings,
  STATUSES, PROTECTED, VEILED, MOVES, DATASET, TASK_NOTE, openNow,
};
