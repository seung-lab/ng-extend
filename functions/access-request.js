'use strict';

// Retina access requests (Ames 2026-10-16): the EyeWire II Dataset Access
// form (blog.eyewire.org/how-to-access-the-eyewire-ii-dataset) in the game.
// Every rule is here, with the database passed in, so it is tested without
// credentials (access-request.test.js). Served by ewAccessRequest in index.js.
// Tables: supabase-access-requests.sql.
//
//   access.mine     the player: their request, its examples and, once a
//                   reviewer has answered, the notes on each one.
//   access.save     the player: one example into a slot (cut 1 to 7, merge
//                   1 to 3), while collecting or redoing.
//   access.remove   the player: empty a slot.
//   access.withdraw the player: take sent examples back to change them,
//                   before or during the review. Any example can be changed
//                   while collecting or redoing, as often as they like
//                   (Ames 2026-10-16: players modify and try again).
//   access.submit   the player: all ten in, send for review. Celia and
//                   Marissa get a bell, and Slack gets a post.
//   access.list     admins: the requests, newest first, with their examples.
//   access.review   admins: good or redo on one example, good or off on each
//                   of its points, a note. Not sent until access.decide.
//   access.reset    admins: delete a request and its examples, so the
//                   player (or the admin, testing) starts over. Ames
//                   2026-10-16: "I need to be able to send a test demo".
//   access.decide   admins: "redo" (the player redoes the examples marked
//                   redo) or "invited": Grant edit access (Ames 2026-10-16)
//                   adds the player to Eyewire_2_Edit in CAVE first, with the
//                   server's CAVE token, then to pilot_members, then tells
//                   them. If CAVE says no, nothing else happens. A request
//                   with no CAVE id (sent before ids were kept) is granted
//                   only with byHand: the reviewer added them in CAVE.
//
// No pilot gate: asking for access is how a player joins.

const KINDS = {cut: 7, merge: 3};
// The pictures on the notifications (Ames 2026-10-16), from static/nurro (its
// README is the catalog), set here and never taken from the browser.
const NURRO = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/';
// Brax's slice on a new request (Ames 2026-10-16), pinned to the commit that
// added it, so the address works before and after the branch is merged.
const BRAX = 'https://raw.githubusercontent.com/seung-lab/ng-extend/ee4677eeb1a5a95267f8cb28f41ba38714a97d84/static/access/brax-slice.png';
// Fly neurons by neurotransmitter on access granted (Ames 2026-10-16), pinned the same way.
const GRANTED = 'https://raw.githubusercontent.com/seung-lab/ng-extend/18309c4c1fc327d83e7dfff540f83485f8bf52b9/static/access/fly-neurons-by-neurotransmitter.jpg';
const GRANTED_TITLE = '🎉 Congratulations! Your edit access has been granted!';
// The open padlock on a dataset grant (Ames 2026-10-28).
const DATASET_GRANTED = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/access/access-granted.png';
// The closed padlock on a dataset request, in the admins' bell (Ames 2026-10-28).
const DATASET_REQUESTED = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/access/access-locked.png';
const IMAGE = {request: BRAX, notes: NURRO + 'nurro-experiment-recap.png', invited: GRANTED};
const EW_NAME_MAX = 60;
const LINK_MAX = 2000, NOTE_MAX = 1000, FEEDBACK_MAX = 2000, DECIDE_MAX = 4000, AFFIL_MAX = 200;
const POINTS_MAX = 200, SEGMENTS_MAX = 50;
const ID = /^\d{1,20}$/;
const NOT_INSTALLED = 'Access requests are not switched on yet: run supabase-access-requests.sql in the Supabase SQL editor.';
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const missingTable = e => !e.status && /supabase (400|404)/.test(String(e && e.message));

/** The player's EyeWire username, or null. */
function cleanEwName(value) {
  const name = cleanText(value, EW_NAME_MAX, 'Your EyeWire username');
  if (name && !/^[A-Za-z0-9_.\- ]+$/.test(name)) fail(400, 'An EyeWire username has letters, numbers, dots, dashes and underscores only.');
  return name;
}

/** A PATCH of the request that drops the 2026-10-16 columns when their SQL
 *  has not been run yet, so saving and sending never break on it. */
async function patchRequest(sb, filter, body) {
  try { return await sb(`access_requests?${filter}`, {method: 'PATCH', body: JSON.stringify(body)}); }
  catch (e) {
    if (!missingTable(e) || !['eyewire_username', 'player_note', 'cave_user_id', 'cave_granted'].some(k => k in body)) throw e;
    const {eyewire_username, player_note, cave_user_id, cave_granted, ...rest} = body;
    return sb(`access_requests?${filter}`, {method: 'PATCH', body: JSON.stringify(rest)});
  }
}

/** Plain text, trimmed, or null when empty and allowed to be. */
function cleanText(value, max, what, required = false) {
  if (value == null || value === '') { if (required) fail(400, `${what} is empty.`); return null; }
  if (typeof value !== 'string') fail(400, `${what} must be text.`);
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) { if (required) fail(400, `${what} is empty.`); return null; }
  if (text.length > max) fail(400, `${what} is too long: ${max} characters at most.`);
  return text;
}

function cleanSlot(args) {
  const kind = String(args.kind || '');
  if (!(kind in KINDS)) fail(400, 'Unknown kind of example.');
  const slot = Number(args.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > KINDS[kind]) fail(400, 'Unknown slot.');
  return {kind, slot};
}

function cleanPoint(p) {
  if (!p || typeof p !== 'object') fail(400, 'A point is not readable.');
  const pos = p.position;
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(n => typeof n === 'number' && Number.isFinite(n))) fail(400, 'A point has no position.');
  const out = {position: pos.map(n => Math.round(n * 100) / 100)};
  if (p.segmentId != null && ID.test(String(p.segmentId))) out.segmentId = String(p.segmentId);
  if (p.rootId != null && ID.test(String(p.rootId))) out.rootId = String(p.rootId);
  return out;
}

/** The example as the server keeps it. Throws with a sentence a player can act on. */
function cleanExample(kind, args) {
  const link = args.link;
  // https, or a local dev server's own address (http://localhost:port).
  if (typeof link !== 'string' || !/^(https:\/\/|http:\/\/localhost(:\d+)?\/)[^\s"'<>]+$/.test(link) || link.length > LINK_MAX) fail(400, 'The view link could not be made. Try again.');
  const dataset = typeof args.dataset === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(args.dataset) ? args.dataset : null;
  const note = cleanText(args.note, NOTE_MAX, 'Your note');
  const raw = args.points && typeof args.points === 'object' ? args.points : {};
  const list = k => (Array.isArray(raw[k]) ? raw[k] : []);
  const red = list('red'), blue = list('blue'), merge = list('merge');
  if (red.length + blue.length + merge.length > POINTS_MAX) fail(400, `Use ${POINTS_MAX} points at most.`);
  // Merge points come in twos: the two ends of each merge, in order.
  if (merge.length % 2) fail(400, 'A merge needs both of its points.');
  const points = kind === 'cut' ? {red: red.map(cleanPoint), blue: blue.map(cleanPoint)} : {merge: merge.map(cleanPoint)};
  const segs = Array.isArray(args.segments) ? args.segments.map(String) : [];
  if (segs.length > SEGMENTS_MAX || !segs.every(s => ID.test(s))) fail(400, 'The pieces shown could not be read.');
  const segments = [...new Set(segs)];
  if (kind === 'cut' && (!points.red.length || !points.blue.length)) fail(400, 'Place red and blue Multicut points on each side of the cut first.');
  if (kind === 'merge' && !points.merge.length) fail(400, 'Place the merge points on the two pieces first, without submitting the merge.');
  const pos = args.position;
  const position = Array.isArray(pos) && pos.length === 3 && pos.every(n => typeof n === 'number' && Number.isFinite(n)) ? pos.map(n => Math.round(n)) : null;
  return {link, dataset, note, points, segments, position};
}

async function requestOf(sb, userId) {
  try { return (await sb(`access_requests?user_id=eq.${userId}&select=*&limit=1`))[0] || null; }
  catch (e) { if (missingTable(e)) fail(409, NOT_INSTALLED); throw e; }
}
const itemsOf = (sb, requestId) => sb(`access_request_items?request_id=eq.${requestId}&select=*&order=kind.asc,slot.asc`);

function needMe(me) { if (!me || !me.id) fail(403, 'Sign in and create your profile first.'); }
function nameOf(me) { return String((me && (me.display_name || me.username)) || 'A player').slice(0, 80); }

/** What a player sees: the reviewer's marks only once the review was sent. */
function forPlayer(request, items) {
  if (!request) return {request: null, items: []};
  const answered = request.status === 'redo' || request.status === 'invited';
  return {
    request: {id: request.id, status: request.status, tries: request.tries, affiliation: request.affiliation,
      eyewire_username: request.eyewire_username ?? null, player_note: request.player_note ?? null,
      submitted_at: request.submitted_at, reviewed_at: answered ? request.reviewed_at : null,
      reviewer_note: answered ? request.reviewer_note : null},
    items: items.map(i => ({kind: i.kind, slot: i.slot, link: i.link, dataset: i.dataset, note: i.note,
      points: i.points, segments: i.segments, position: i.position, saved_at: i.saved_at,
      ...(answered ? {verdict: i.verdict, point_marks: i.point_marks, feedback: i.feedback} : {})})),
  };
}

async function mine(args, {sb, me}) {
  needMe(me);
  const request = await requestOf(sb, me.id);
  return forPlayer(request, request ? await itemsOf(sb, request.id) : []);
}

/** The request a player may change now, made on first use. */
async function editable(sb, me, who) {
  let request = await requestOf(sb, me.id);
  if (!request) {
    request = (await sb('access_requests', {method: 'POST', body: JSON.stringify({user_id: me.id,
      email: String(who.email || '').toLowerCase(), player_name: nameOf(me)})}))[0];
  }
  if (request.status === 'submitted') fail(409, 'Your examples are with a reviewer. To change them, take them back first.');
  if (request.status === 'invited') fail(409, 'Your edit access was already granted.');
  return request;
}


/** Keep an example a reviewer may have seen before it is replaced or
 *  removed (Ames 2026-10-16): once a request was sent, nothing is lost.
 *  Quietly skipped until its SQL is run. */
async function keepEarlier(sb, request, kind, slot) {
  if (!(request.tries > 0)) return;
  const old = (await sb(`access_request_items?request_id=eq.${request.id}&kind=eq.${kind}&slot=eq.${slot}&select=*&limit=1`))[0];
  if (!old) return;
  const {id, request_id, ...rest} = old;
  try {
    await sb('access_request_item_history', {method: 'POST', headers: {Prefer: 'return=minimal'},
      body: JSON.stringify({request_id: request.id, try: request.tries, ...pick(rest)})});
  } catch (e) { if (!missingTable(e)) throw e; }
}
const KEPT = ['kind', 'slot', 'link', 'dataset', 'note', 'points', 'segments', 'position', 'verdict', 'point_marks', 'feedback', 'saved_at'];
const pick = o => Object.fromEntries(KEPT.filter(k => k in o).map(k => [k, o[k]]));

async function save(args, {sb, me, who}) {
  needMe(me);
  const {kind, slot} = cleanSlot(args);
  const ex = cleanExample(kind, args);
  const request = await editable(sb, me, who);
  await keepEarlier(sb, request, kind, slot);
  const row = {request_id: request.id, kind, slot, ...ex, saved_at: new Date().toISOString(),
    // A new example: the old marks were about the old one.
    verdict: null, point_marks: {}, feedback: null};
  await sb('access_request_items?on_conflict=request_id,kind,slot', {method: 'POST',
    headers: {Prefer: 'resolution=merge-duplicates,return=representation'}, body: JSON.stringify(row)});
  const ewName = cleanEwName(args.eyewireUsername);
  await patchRequest(sb, `id=eq.${request.id}`, {updated_at: row.saved_at,
    player_name: nameOf(me), ...(ewName ? {eyewire_username: ewName} : {}), ...caveIdOf(who)});
  return mine({}, {sb, me});
}

async function remove(args, {sb, me, who}) {
  needMe(me);
  const {kind, slot} = cleanSlot(args);
  const request = await editable(sb, me, who);
  const item = (await sb(`access_request_items?request_id=eq.${request.id}&kind=eq.${kind}&slot=eq.${slot}&select=*&limit=1`))[0];
  if (item) await keepEarlier(sb, request, kind, slot);
  if (item) await sb(`access_request_items?id=eq.${item.id}`, {method: 'DELETE'});
  return mine({}, {sb, me});
}

/** Take sent examples back to change them. Back to the redo notes if there
 *  were some, else back to collecting. The next send counts as a new try. */
async function withdraw(args, {sb, me}) {
  needMe(me);
  const request = await requestOf(sb, me.id);
  if (!request || request.status !== 'submitted') fail(409, 'There is nothing waiting for a review to take back.');
  const back = request.reviewed_at ? 'redo' : 'draft';
  // Marks a reviewer made on this try were never sent: they go, so they can
  // not block the next send unseen (Ames 2026-10-16).
  if (back === 'draft') await clearMarks(sb, request.id);
  const done = await sb(`access_requests?id=eq.${request.id}&status=eq.submitted`, {method: 'PATCH',
    body: JSON.stringify({status: back, updated_at: new Date().toISOString()})});
  if (!done.length) fail(409, 'A reviewer answered just now. Look at their notes first.');
  return mine({}, {sb, me});
}

/** The player's CAVE user id from their verified sign in, never the browser. */
function caveIdOf(who) {
  const id = Number(who && who.caveId);
  return Number.isSafeInteger(id) && id > 0 ? {cave_user_id: id} : {};
}

function clearMarks(sb, requestId) {
  return sb(`access_request_items?request_id=eq.${requestId}`, {method: 'PATCH', body: JSON.stringify({verdict: null, point_marks: {}, feedback: null})});
}

async function submit(args, {sb, me, who, notifyReviewers, postSlack}) {
  needMe(me);
  const request = await editable(sb, me, who);
  const items = await itemsOf(sb, request.id);
  const count = k => items.filter(i => i.kind === k).length;
  if (count('cut') < KINDS.cut || count('merge') < KINDS.merge) fail(400, `Save all ten first: ${count('cut')} of 7 cuts and ${count('merge')} of 3 merges so far.`);
  // Only marks the player can see count: those of an answered review.
  if (request.status === 'redo' && items.some(i => i.verdict === 'redo')) fail(400, 'Redo every example marked redo first.');
  if (request.status === 'draft' && items.some(i => i.verdict || Object.keys(i.point_marks || {}).length || i.feedback)) await clearMarks(sb, request.id);
  const ewName = cleanEwName(args.eyewireUsername);
  const playerNote = cleanText(args.note, NOTE_MAX, 'Your note');
  const at = new Date().toISOString();
  const tries = (request.tries || 0) + 1;
  // Only from the state it was read in, so a double click sends once.
  const done = await patchRequest(sb, `id=eq.${request.id}&status=eq.${request.status}`, {status: 'submitted', tries,
    submitted_at: at, updated_at: at, player_name: nameOf(me), ...(ewName ? {eyewire_username: ewName} : {}),
    player_note: playerNote, ...caveIdOf(who)});
  if (!done.length) fail(409, 'Your examples are with a reviewer already.');
  const name = nameOf(me);
  const again = tries > 1 ? ` (try ${tries})` : '';
  if (notifyReviewers) {
    try { await notifyReviewers({image: IMAGE.request, title: `🔬 Retina access request from ${name}${again}`,
      body: `${name} sent 7 cut and 3 merge examples for retina access${again}. Click here to review them in the Admin Hub, Access requests.`}); }
    catch (e) { console.warn('[access] reviewers were not told:', e && e.message); }
  }
  if (postSlack) {
    try { await postSlack({name, email: request.email, tries, eyewireUsername: ewName || request.eyewire_username || null}); }
    catch (e) { console.warn('[access] slack post failed:', e && e.message); }
  }
  return mine({}, {sb, me});
}

// ── Reviewers ───────────────────────────────────────────────────────────
function needAdmin(isAdmin) { if (!isAdmin) fail(403, 'Admins only'); }

async function list(args, {sb, isAdmin}) {
  needAdmin(isAdmin);
  const status = String(args.status || 'open');
  const filter = status === 'all' ? '' : status === 'open' ? '&status=in.(submitted,redo)' : status === 'invited' ? '&status=eq.invited' : '&status=eq.submitted';
  let requests;
  try { requests = await sb(`access_requests?select=*${filter}&status=neq.draft&order=submitted_at.desc.nullslast&limit=100`); }
  catch (e) { if (missingTable(e)) fail(409, NOT_INSTALLED); throw e; }
  if (!requests.length) return {requests: []};
  const ids = requests.map(r => r.id).join(',');
  const items = await sb(`access_request_items?request_id=in.(${ids})&select=*&order=kind.asc,slot.asc`);
  let history = [];
  try { history = await sb(`access_request_item_history?request_id=in.(${ids})&select=*&order=replaced_at.asc`); }
  catch (e) { if (!missingTable(e)) throw e; }
  const earlierOf = (r, k, s) => history.filter(h => h.request_id === r.id && h.kind === k && h.slot === s);
  return {requests: requests.map(r => ({...r,
    items: items.filter(i => i.request_id === r.id).map(i => ({...i, earlier: earlierOf(r, i.kind, i.slot)})),
    // Examples removed and not saved again: kept too, with no current one.
    removed: history.filter(h => h.request_id === r.id && !items.some(i => i.request_id === r.id && i.kind === h.kind && i.slot === h.slot))}))};
}

async function review(args, {sb, isAdmin}) {
  needAdmin(isAdmin);
  const id = Number(args.itemId);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Unknown example.');
  const item = (await sb(`access_request_items?id=eq.${id}&select=id,request_id,points&limit=1`))[0];
  if (!item) fail(404, 'That example is gone.');
  const patch = {};
  if ('verdict' in args) {
    if (args.verdict != null && !['good', 'redo'].includes(args.verdict)) fail(400, 'Mark it good or redo.');
    patch.verdict = args.verdict || null;
  }
  if ('feedback' in args) patch.feedback = cleanText(args.feedback, FEEDBACK_MAX, 'The note');
  if ('pointMarks' in args) {
    const marks = args.pointMarks && typeof args.pointMarks === 'object' ? args.pointMarks : {};
    const pts = item.points || {};
    const out = {};
    for (const [key, v] of Object.entries(marks)) {
      const m = /^(red|blue|merge):(\d{1,2})$/.exec(key);
      if (!m || !Array.isArray(pts[m[1]]) || Number(m[2]) >= pts[m[1]].length) fail(400, 'Unknown point.');
      if (v === 'good' || v === 'off') out[key] = v;
      else if (v != null) fail(400, 'Mark a point good or off.');
    }
    patch.point_marks = out;
  }
  if (!Object.keys(patch).length) fail(400, 'Nothing to save.');
  return (await sb(`access_request_items?id=eq.${id}`, {method: 'PATCH', body: JSON.stringify(patch)}))[0];
}

async function reset(args, {sb, me, isAdmin}) {
  needAdmin(isAdmin);
  let request;
  if (args.requestId != null) {
    const id = Number(args.requestId);
    if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Unknown request.');
    request = (await sb(`access_requests?id=eq.${id}&select=id,user_id&limit=1`))[0];
  } else {
    needMe(me);
    request = await requestOf(sb, me.id);
  }
  if (!request) fail(404, 'There is no request to delete.');
  await sb(`access_request_items?request_id=eq.${request.id}`, {method: 'DELETE'});
  await sb(`access_requests?id=eq.${request.id}`, {method: 'DELETE'});
  return {deleted: request.id};
}

async function decide(args, {sb, me, isAdmin, notifyPlayer, grantCave}) {
  needAdmin(isAdmin);
  const id = Number(args.requestId);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Unknown request.');
  const outcome = String(args.outcome || '');
  if (!['redo', 'invited'].includes(outcome)) fail(400, 'Ask for redos or invite.');
  const note = cleanText(args.note, DECIDE_MAX, 'The note');
  const request = (await sb(`access_requests?id=eq.${id}&select=*&limit=1`))[0];
  if (!request) fail(404, 'That request is gone.');
  if (request.status !== 'submitted') fail(409, request.status === 'invited' ? 'This player was already granted access.' : 'This request is not waiting for a review.');
  const items = await itemsOf(sb, id);
  const redos = items.filter(i => i.verdict === 'redo').length;
  if (outcome === 'redo' && !redos) fail(400, 'Mark at least one example redo first, so the player knows what to change.');
  const at = new Date().toISOString();
  let pilotAdded = false;
  let caveGranted = false;
  if (outcome === 'invited') {
    // CAVE first: the player is told only once the retina really is open.
    if (args.byHand === true) {
      caveGranted = false;
    } else {
      const caveId = Number(request.cave_user_id);
      if (!Number.isSafeInteger(caveId) || caveId <= 0) {
        fail(409, `This request has no CAVE id (it was sent before Pyr kept them). Add ${request.email} to Eyewire_2_Edit in CAVE by hand, then use "I added them by hand". Nothing was sent.`);
      }
      if (!grantCave) fail(503, 'Granting in CAVE is not set up on the server. Nothing was sent.');
      const r = await grantCave(caveId);
      if (!r || !r.ok) fail(502, `CAVE did not add them to Eyewire_2_Edit${r && r.status ? ` (${r.status})` : ''}${r && r.error ? `: ${r.error}` : ''}. Nothing was sent to the player.`);
      caveGranted = true;
    }
    await sb('pilot_members?on_conflict=email', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
      body: JSON.stringify({email: String(request.email).toLowerCase().trim(), enabled: true, added_by: (me && me.id) || null})});
    pilotAdded = true;
  }
  const done = await sb(`access_requests?id=eq.${id}&status=eq.submitted`, {method: 'PATCH', body: JSON.stringify({
    status: outcome, reviewed_at: at, reviewed_by: (me && me.id) || null, reviewer_note: note, updated_at: at,
    ...(pilotAdded ? {pilot_added: true} : {})})});
  if (caveGranted) await patchRequest(sb, `id=eq.${id}`, {cave_granted: true}).catch(() => {});
  if (!done.length) fail(409, 'Someone else answered this request just now.');
  if (notifyPlayer) {
    const title = outcome === 'invited' ? GRANTED_TITLE : '🔬 Notes on your retina access request';
    const body = outcome === 'invited'
      ? `Your ten examples looked great. The EyeWire II retina is now open to you for editing, and every cell you proofread there becomes part of a real map of the retina.${note ? `\n\n${note}` : ''}\n\nIf the retina still says View only, sign out of Pyr and back in. Thank you for doing science with us!`
      : `A reviewer looked at your ten examples and would like ${redos === 1 ? 'one' : redos} again.${note ? `\n\n${note}` : ''}\n\nClick here, or open the menu and Ask for Edit Access, to see the notes on each one.`;
    try { await notifyPlayer({userId: request.user_id, title, body, image: outcome === 'invited' ? IMAGE.invited : IMAGE.notes}); }
    catch (e) { console.warn('[access] the player was not told:', e && e.message); }
  }
  return {...done[0], redos, pilot_added: pilotAdded, cave_granted: caveGranted};
}

// ── Beta access (Ames 2026-10-24) ────────────────────────────────────────
// Pyr is invite only for now: "If they are not on the pilot tester list they
// should receive a popup". The popup offers Request beta access, once per
// account. A request becomes a report on the triage board (site_issues,
// category Beta access, so the Slack bridge files its card), a bell in the
// Admin tab of every admin and a Slack post. An admin lets the player in by
// adding their email under Admin Hub, Pilot testers.
//   access.betaStatus  anyone signed in: {invited, requested}.
//   access.beta        a player not on the list: send the request.
const BETA_CATEGORY = 'Beta access';
const BETA_BELL = '🔑 Beta access request';
// Clicking the bell opens Admin Hub, Pilot testers, Beta requests (Ames 2026-10-26).
const LET_IN = 'Click this note, then Let them in.';
/**
 * Has this player a Beta request still open? Their newest one counts. A
 * request an admin removed (Admin Hub, Beta requests) or dismissed on the
 * triage board is not open: the player may ask again (Ames 2026-10-28: "I
 * dismissed the request but there is no way for me to request it again").
 */
async function betaRequested(sb, me, io = {}) {
  if (!me) return false;
  const rows = await sb('site_issues?category=eq.' + encodeURIComponent(BETA_CATEGORY) + '&user_id=eq.' + encodeURIComponent(me.id)
    + '&select=id,created_at&order=created_at.desc&limit=1');
  const last = Array.isArray(rows) ? rows[0] : null;
  if (!last) return false;
  try {
    const email = String((io.who && io.who.email) || '').toLowerCase();
    const mark = email && io.marks ? (await io.marks.all())[email] : null;
    if (mark && mark.mark === 'removed' && String(mark.at || '') >= String(last.created_at || '')) return false;
  } catch (e) { /* no marks: the request stands */ }
  try {
    const t = await sb('feedback_triage?source=eq.site_issue&source_id=eq.' + encodeURIComponent(last.id) + '&select=status&limit=1');
    if (Array.isArray(t) && t[0] && t[0].status === 'dismissed') return false;
  } catch (e) { /* no triage row: the request stands */ }
  return true;
}
async function betaStatus(a, io) {
  if (io.isAdmin || io.isPilot) return {invited: true, requested: false};
  return {invited: false, requested: await betaRequested(io.sb, io.me, io)};
}
// What a player types is checked hard (Ames 2026-10-24: "Make sure it's
// secure like players can't inject anything"): a name is letters, spaces and
// . ' and hyphens only; an email is one plain address; the note is plain text and goes
// only on the triage card, which shows text as text. The bell, which draws
// markdown, gets the name and emails only, with markdown characters escaped.
// Slack escapes every report's text itself (postIssueToSlack).
const BETA_NAME_MAX = 80, BETA_EMAIL_MAX = 254, BETA_NOTE_MAX = 500;
function betaName(value) {
  const name = cleanText(value, BETA_NAME_MAX, 'Your name', true).replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name)) fail(400, 'Your name can have letters, spaces, periods, apostrophes and hyphens only.');
  return name;
}
function betaEmail(value) {
  const email = cleanText(value, BETA_EMAIL_MAX, 'Your email', true).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email)) fail(400, 'That email does not look right.');
  return email;
}
/** The player's note for the bell (Ames 2026-10-26: "Note from beta request
 *  should appear here"), every line escaped so it shows as plain text. */
const noteForBell = note => note ? '\n\nTheir note:\n\n' + note.split('\n').map(l => mdText(l)).join('\n\n') : '';
/** Text for a markdown note: every markdown character escaped. */
const mdText = s => String(s).replace(/[\\`*_{}\[\]()#+\-.!|<>~&:@]/g, c => '\\' + c);
async function beta(a, io) {
  if (io.isAdmin || io.isPilot) return {invited: true, requested: false};
  if (!io.me) fail(400, 'Your Pyr profile is not ready yet. Reload the page, then try again.');
  const name = betaName(a.name);
  const email = betaEmail(a.email);
  const note = cleanText(a.note, BETA_NOTE_MAX, 'Your note') || '';
  const ew = eyewireOf(a);
  if (await betaRequested(io.sb, io.me, io)) return {invited: false, requested: true, already: true};
  // The sign in email is the one Pilot testers needs; it comes from the
  // server's own check of their sign in, never from the form.
  const signIn = String((io.who && io.who.email) || '').toLowerCase().slice(0, BETA_EMAIL_MAX);
  // One email when the two match (Ames 2026-10-26: "we don't need the email twice").
  const same = email === signIn;
  const message = [
    `${name} asks to join the Pyr beta.`,
    same ? '' : `Email they gave: ${email}`,
    `${same ? 'Email' : 'Sign in email'}: ${signIn}. To let them in, add this one under Admin Hub, Pilot testers.`,
    ...ewLines(ew),
    note ? `Their note: ${note}` : '',
  ].filter(Boolean).join('\n');
  const title = `Beta access request from ${name}`.slice(0, 120);
  await io.sb('site_issues', {method: 'POST', body: JSON.stringify([{category: BETA_CATEGORY, title, message, user_id: io.me.id, user_name: name}])});
  // The report is the record; the bell and the post only tell people.
  const bell = `${mdText(name)} asks to join the Pyr beta.\n\n`
    + (same ? `Email: ${mdText(signIn)}` : `Email they gave: ${mdText(email)}\n\nSign in email: ${mdText(signIn)}`)
    + ewForBell(ew)
    + `\n\n${LET_IN}`
    + noteForBell(note);
  // Every admin's Admin tab (Ames 2026-10-24: "yes to all admins").
  try { await (io.notifyAdmins || io.notifyReviewers)({title: `${BETA_BELL} from ${name}`, body: bell}); } catch (e) { console.warn('[beta] bell failed', e && e.message); }
  try { if (io.postIssue) await io.postIssue({title, message, category: BETA_CATEGORY, user: name}); } catch (e) { console.warn('[beta] slack failed', e && e.message); }
  await wakeBoard(io);
  return {invited: false, requested: true};
}

// ── Beta access from connectome.quest (Ames 2026-10-26) ─────────────────
// "update connectome.quest with a request early access thing". A visitor to
// the site's Access page has no Pyr sign in yet, only a name and an email,
// so this is access.beta without the sign in: the same report on the triage
// board, bell to every admin and Slack post, marked as from the site. The
// email they gave is the one an admin adds under Pilot testers, so they must
// sign in to Pyr with it. Served by ewAccessRequest as action
// "access.visitorBeta", before its sign in check; the body size and a per
// address rate limit are there. Here: the same hard checks as access.beta, a
// hidden field (website) that only a bot fills, and one request per email.
const SITE = 'connectome.quest';
async function visitorBetaRequested(sb, email) {
  // Any Beta access report already naming this email, from the site or the game.
  const rows = await sb('site_issues?category=eq.' + encodeURIComponent(BETA_CATEGORY)
    + '&message=ilike.' + encodeURIComponent('*' + email.replace(/[*%,()]/g, '') + '*') + '&select=id&limit=1');
  return Array.isArray(rows) && rows.length > 0;
}
async function visitorBeta(args, io) {
  const a = args && typeof args === 'object' ? args : {};
  // A bot that filled the hidden field is told it worked, and nothing happens.
  if (a.website) return {requested: true};
  const name = betaName(a.name);
  const email = betaEmail(a.email);
  const note = cleanText(a.note, BETA_NOTE_MAX, 'Your note') || '';
  const ew = eyewireOf(a);
  if (a.agree !== true) fail(400, 'Please tick the box to say you agree to the community principles.');
  if (await visitorBetaRequested(io.sb, email)) return {requested: true, already: true};
  const message = [
    `${name} asks to join the Pyr beta, from ${SITE}.`,
    `Email they gave: ${email}. They have not signed in to Pyr yet. To let them in, add this email under Admin Hub, Pilot testers, and tell them to sign in with it.`,
    'They agreed to the community principles.',
    ...ewLines(ew),
    note ? `Their note: ${note}` : '',
  ].filter(Boolean).join('\n');
  const title = `Beta access request from ${name} (${SITE})`.slice(0, 120);
  const url = `https://${SITE}/access.html`;
  await io.sb('site_issues', {method: 'POST', body: JSON.stringify([{category: BETA_CATEGORY, title, message, url, user_id: null, user_name: name}])});
  const bell = `${mdText(name)} asks to join the Pyr beta, from ${mdText(SITE)}.\n\nEmail they gave: ${mdText(email)}\n\nThey have not signed in to Pyr yet. ${LET_IN} Then email them to sign in with this address.`
    + ewForBell(ew)
    + noteForBell(note);
  try { await io.notifyAdmins({title: `${BETA_BELL} from ${name}`, body: bell}); } catch (e) { console.warn('[beta] bell failed', e && e.message); }
  try { if (io.postIssue) await io.postIssue({title, message, category: BETA_CATEGORY, user: name, url}); } catch (e) { console.warn('[beta] slack failed', e && e.message); }
  await wakeBoard(io);
  return {requested: true};
}

// ── EyeWire username and rank, both optional (Ames 2026-10-26) ──────────
// One line each on the report, before the note, so Beta requests in the
// Admin Hub reads them back from the server's own lines.
const EW_RANK_MAX = 40;
function eyewireOf(a) {
  const username = cleanEwName(a.eyewireUsername);
  const rank = cleanText(a.eyewireRank, EW_RANK_MAX, 'Your EyeWire rank');
  if (rank && !/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(rank)) fail(400, 'An EyeWire rank has letters, numbers and spaces only.');
  return {username: username ? username.replace(/\s+/g, ' ') : null, rank: rank ? rank.replace(/\s+/g, ' ') : null};
}
const ewLines = ew => [ew.username ? `EyeWire username: ${ew.username}` : '', ew.rank ? `EyeWire rank: ${ew.rank}` : ''];
const ewForBell = ew => (ew.username ? `\n\nEyeWire username: ${mdText(ew.username)}` : '') + (ew.rank ? `\n\nEyeWire rank: ${mdText(ew.rank)}` : '');
/** A new request goes on the triage board now, not at the next (often late)
 *  timed run of the Slack bridge (Ames 2026-10-26: "fix the slack triage robot"). */
async function wakeBoard(io) {
  try { if (io.wake) await io.wake(); } catch (e) { console.warn('[beta] board not woken', e && e.message); }
}

// ── Sorting Beta requests (Ames 2026-10-26: "move them from the page and
// put them in a db list", and "remove request") ─────────────────────────
// A mark per email: listed (kept on the list for later) or removed (taken
// off). Waiting clears it. A request newer than its mark shows again. The
// store is passed in (Firestore in index.js), so this needs no new table.
//   access.betaMarks  admins: every mark, by email.
//   access.betaMark   admins: {email, mark: 'listed' | 'removed' | 'waiting'}.
const BETA_MARKS = ['listed', 'removed', 'waiting'];
async function betaMarks(a, io) {
  needAdmin(io.isAdmin);
  return io.marks.all();
}
async function betaMark(a, io) {
  needAdmin(io.isAdmin);
  const email = betaEmail(a.email);
  if (!BETA_MARKS.includes(a.mark)) fail(400, 'Unknown mark.');
  await io.marks.set(email, a.mark === 'waiting' ? null : {mark: a.mark, at: new Date().toISOString(), by: (io.who && io.who.email) || ''});
  return io.marks.all();
}

// ── Access to one dataset (Ames 2026-10-28) ──────────────────────────────
// "You don't have access to MEC yet. Can we make this have a button to
// request access?" A player asks from the note on a view they can't load, or
// from a locked card in the dataset switcher. The request is a report on the
// triage board (category Dataset access, as Beta requests are), a bell to
// every admin and a Slack post. An admin adds the player to that dataset's
// group in CAVE by hand, then presses Granted (or Not now) in the Admin Hub,
// and the player gets a bell. The decision is a mark per request, kept in
// io.datasetMarks (Firestore in index.js), so this needs no new table.
// Retina has its own request with examples (above) and does not come here.
//   access.datasetStatus  a player: their requests, by dataset id.
//   access.dataset        a player: {datasetId, label, caveDataset, note}.
//   access.datasetList    admins: every request, newest first, with its mark.
//   access.datasetDecide  admins: {id, mark: 'granted' | 'declined' | 'waiting', note}.
const DATASET_CATEGORY = 'Dataset access';
/** The CAVE group Granted adds a player to, by dataset id. A dataset not
 *  here is still granted by hand in CAVE (Ames 2026-10-28: "can we make a way
 *  for me to grant access?"). MEC_Edit, group 217, made by Marissa. */
const DATASET_CAVE_GROUPS = {pni_mec: {id: 217, name: 'MEC_Edit'}};
/** The short name a player knows a dataset by, for the bell. */
const DATASET_SHORT = {pni_mec: 'MEC'};
const DATASET_BELL = '🔓 Dataset access request';
const DATASET_MARKS = ['granted', 'declined', 'waiting'];
const DS_ID = /^[a-z0-9_]{2,40}$/;
const UUID = /^[0-9a-f-]{36}$/i;
function datasetOf(a) {
  const id = String(a.datasetId || '');
  if (!DS_ID.test(id) || id === 'stroeh_mouse_retina') fail(400, 'Unknown dataset.');
  const label = cleanText(a.label, 60, 'The dataset name', true);
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'()&,:-]*$/u.test(label)) fail(400, 'Unknown dataset.');
  const cave = cleanText(a.caveDataset, 60, 'The CAVE dataset') || '';
  if (cave && !/^[A-Za-z0-9_.-]+$/.test(cave)) fail(400, 'Unknown dataset.');
  return {id, label, cave};
}
const labelOf = title => String(title || '').split(' access request from ')[0];
const lineOf = (message, lead) => (String(message || '').split('\n').find(l => l.startsWith(lead)) || '').slice(lead.length).trim();
/** The datasets a player edits in on Pyr, by edit_log tag. */
const EDIT_DATASETS = ['stroeh_mouse_retina', 'pni_mec', 'pinky_nf_v2'];
/** A player's first and latest split or merge in each of those, where they
 *  have any: [{dataset, first, last}]. */
async function editHistory(sb, userId) {
  const one = async (ds, dir) => {
    try {
      const r = await sb('edit_log?user_id=eq.' + encodeURIComponent(userId) + '&dataset=eq.' + ds
        + '&operation=in.(split,merge)&select=timestamp&order=timestamp.' + dir + '&limit=1');
      return Array.isArray(r) && r[0] ? r[0].timestamp : null;
    } catch (e) { return null; }
  };
  const out = await Promise.all(EDIT_DATASETS.map(async ds => {
    const [first, last] = await Promise.all([one(ds, 'asc'), one(ds, 'desc')]);
    return first ? {dataset: ds, first, last} : null;
  }));
  return out.filter(Boolean);
}
async function datasetRows(sb, filter) {
  const rows = await sb('site_issues?category=eq.' + encodeURIComponent(DATASET_CATEGORY) + filter
    + '&select=id,user_id,user_name,dataset,title,message,created_at&order=created_at.desc&limit=300');
  return Array.isArray(rows) ? rows : [];
}
async function datasetStatus(a, io) {
  if (!io.me) return {requests: {}};
  const marks = await io.datasetMarks.all();
  const out = {};
  // Newest first: a dataset's latest request is the one that counts.
  for (const r of await datasetRows(io.sb, '&user_id=eq.' + encodeURIComponent(io.me.id))) {
    if (!r.dataset || out[r.dataset]) continue;
    out[r.dataset] = {at: r.created_at, mark: (marks[r.id] && marks[r.id].mark) || null};
  }
  return {requests: out};
}
async function datasetRequest(a, io) {
  if (!io.me) fail(400, 'Your Pyr profile is not ready yet. Reload the page, then try again.');
  const ds = datasetOf(a);
  const note = cleanText(a.note, BETA_NOTE_MAX, 'Your note') || '';
  // Tiers (Ames 2026-10-28): edit access on the retina comes first. Asked of
  // CAVE with the player's own sign in; when CAVE can't be asked, nobody is
  // held back (an admin still decides).
  if (!io.isAdmin && io.canEditRetina && (await io.canEditRetina()) === false) {
    fail(403, 'Every dataset starts with the retina: first send your edits for retina edit access (menu, Ask for Edit Access). Then you can ask for this one.');
  }
  const now = await datasetStatus(a, io);
  const open = now.requests[ds.id];
  // One open request per dataset; asking again after Not now is fine.
  if (open && !open.mark) return {...now, already: true};
  const name = String(io.me.username || io.me.display_name || 'A player').slice(0, 80);
  const signIn = String((io.who && io.who.email) || '').toLowerCase().slice(0, BETA_EMAIL_MAX);
  const message = [
    `${name} asks for access to ${ds.label}.`,
    `Dataset id: ${ds.id}`,
    ds.cave ? `CAVE dataset: ${ds.cave}` : '',
    `Sign in email: ${signIn}`,
    'To answer, open Admin Hub, Access requests, Dataset requests: Grant adds them to the CAVE group.',
    note ? `Their note: ${note}` : '',
  ].filter(Boolean).join('\n');
  const title = `${ds.label} access request from ${name}`.slice(0, 120);
  await io.sb('site_issues', {method: 'POST', body: JSON.stringify([{category: DATASET_CATEGORY, title, message, dataset: ds.id, user_id: io.me.id, user_name: name}])});
  const bell = `${mdText(name)} asks for access to ${mdText(ds.label)}${ds.cave ? ` (CAVE dataset ${mdText(ds.cave)})` : ''}.\n\n`
    + `Sign in email: ${mdText(signIn)}\n\n`
    + 'Open Admin Hub, Access requests, Dataset requests: Grant adds them to the CAVE group.'
    + noteForBell(note);
  try { await io.notifyAdmins({title: `${DATASET_BELL}: ${ds.label}, from ${name}`, body: bell, image: DATASET_REQUESTED}); } catch (e) { console.warn('[dataset access] bell failed', e && e.message); }
  try { if (io.postIssue) await io.postIssue({title, message, category: DATASET_CATEGORY, user: name}); } catch (e) { console.warn('[dataset access] slack failed', e && e.message); }
  await wakeBoard(io);
  return {...(await datasetStatus(a, io)), requested: true};
}
async function datasetList(a, io) {
  needAdmin(io.isAdmin);
  const marks = await io.datasetMarks.all();
  const rows = await datasetRows(io.sb, '');
  // What each player waiting for an answer can already do in CAVE, and how
  // long they have been at it here (Ames 2026-10-29: "how long they have been
  // in the other datasets").
  const access = {};
  const history = {};
  const waiting = [...new Set(rows.filter(r => r.user_id && !(marks[r.id] && marks[r.id].mark)).map(r => r.user_id))].slice(0, 25);
  if (waiting.length) {
    const users = await io.sb('users?id=in.(' + waiting.map(encodeURIComponent).join(',') + ')&select=id,cave_user_id,created_at');
    await Promise.all((Array.isArray(users) ? users : []).map(async u => {
      const caveId = Number(u.cave_user_id);
      const [cave, days] = await Promise.all([
        io.caveAccessOf && Number.isSafeInteger(caveId) && caveId > 0 ? io.caveAccessOf(caveId) : null,
        editHistory(io.sb, u.id),
      ]);
      access[u.id] = cave;
      history[u.id] = {joined: u.created_at || null, datasets: days};
    }));
  }
  return rows.map(r => ({
    access: access[r.user_id] || null,
    history: history[r.user_id] || null,
    caveGroup: (DATASET_CAVE_GROUPS[r.dataset] && DATASET_CAVE_GROUPS[r.dataset].name) || '',
    id: r.id, userId: r.user_id, name: r.user_name, dataset: r.dataset, label: labelOf(r.title),
    cave: lineOf(r.message, 'CAVE dataset:'), email: lineOf(r.message, 'Sign in email:'), note: lineOf(r.message, 'Their note:'),
    at: r.created_at, mark: (marks[r.id] && marks[r.id].mark) || null, markedAt: (marks[r.id] && marks[r.id].at) || null,
    markedBy: (marks[r.id] && marks[r.id].by) || '',
  }));
}
async function datasetDecide(a, io) {
  needAdmin(io.isAdmin);
  const id = String(a.id || '');
  if (!UUID.test(id)) fail(400, 'Unknown request.');
  if (!DATASET_MARKS.includes(a.mark)) fail(400, 'Unknown mark.');
  const row = (await datasetRows(io.sb, '&id=eq.' + encodeURIComponent(id)))[0];
  if (!row) fail(404, 'That request is gone.');
  const note = cleanText(a.note, BETA_NOTE_MAX, 'Your note') || '';
  const label = labelOf(row.title);
  // Granted adds them in CAVE first, where Pyr knows the dataset's group; the
  // player is told only once CAVE has them. "I added them by hand" skips it.
  const group = DATASET_CAVE_GROUPS[row.dataset];
  if (a.mark === 'granted' && group && a.byHand !== true) {
    const u = row.user_id ? (await io.sb('users?id=eq.' + encodeURIComponent(row.user_id) + '&select=cave_user_id&limit=1'))[0] : null;
    const caveId = Number(u && u.cave_user_id);
    if (!Number.isSafeInteger(caveId) || caveId <= 0) {
      fail(409, `Pyr doesn't know this player's CAVE id. Add them to ${group.name} in CAVE by hand, then press "I added them by hand". Nothing was sent.`);
    }
    if (!io.grantCave) fail(503, 'Granting in CAVE is not set up on the server. Nothing was sent.');
    const r = await io.grantCave(caveId, group.id);
    if (!r || !r.ok) fail(502, `CAVE did not add them to ${group.name}${r && r.status ? ` (${r.status})` : ''}${r && r.error ? `: ${r.error}` : ''}. Nothing was sent to the player.`);
  }
  await io.datasetMarks.set(id, a.mark === 'waiting' ? null : {mark: a.mark, at: new Date().toISOString(), by: (io.who && io.who.email) || ''});
  if (row.user_id && a.mark !== 'waiting') {
    const said = note ? '\n\n' + note.split('\n').map(l => mdText(l)).join('\n\n') : '';
    try {
      if (a.mark === 'granted') {
        const short = DATASET_SHORT[row.dataset] || label;
        await io.notifyPlayer({userId: row.user_id, title: `🔓 You have access to ${label}`.slice(0, 120), image: DATASET_GRANTED,
          body: `Congratulations, you're in!\n\n**Your access to ${mdText(short)} has been granted!**\n\n`
            + 'Please use your new power with care: this is a real dataset, and your edits directly change the connectome.'
            // The way there (Ames 2026-10-28: "an explore the N button that lets them jump to that dataset").
            + `\n\n[Explore ${mdText(short)} ›](#nge-open-dataset=${row.dataset})` + said});
      } else {
        await io.notifyPlayer({userId: row.user_id, title: `About your ${label} access request`.slice(0, 120),
          body: `Not yet, sorry: your request for ${mdText(label)} was looked at, and access was not given this time.` + said});
      }
    } catch (e) { console.warn('[dataset access] player bell failed', e && e.message); }
  }
  return datasetList(a, io);
}

// ── The chat line for a grant (Ames 2026-10-30) ──────────────────────────
// "when the player next logs in, not when the admin approves it". The bell
// note a grant sends is the record: on a player's first load of a visit the
// app asks here, and each grant not yet told gets one line. A chat row keyed
// access:<dataset> is the guard, so it is said once. Grants from before this
// began stay quiet.
const GRANT_LINES_SINCE = '2026-10-30T00:00:00Z';
const RETINA_ID = 'stroeh_mouse_retina';
const DATASET_GRANT_TITLE = '🔓 You have access to ';
function grantsIn(notes) {
  const out = new Map();
  for (const n of notes || []) {
    const title = String((n && n.title) || '');
    if (title === GRANTED_TITLE) out.set(RETINA_ID, 'the Retina');
    else if (title.startsWith(DATASET_GRANT_TITLE)) {
      const id = String(n.body || '').match(/#nge-open-dataset=([a-z0-9_]{2,40})/);
      if (id) out.set(id[1], DATASET_SHORT[id[1]] || title.slice(DATASET_GRANT_TITLE.length));
    }
  }
  return [...out].map(([dataset, label]) => ({dataset, label}));
}
async function grantLines(a, io) {
  if (!io.me) return {announced: 0};
  const notes = await io.sb('notifications?target_type=eq.user&target_id=eq.' + encodeURIComponent(io.me.id)
    + '&send_at=gte.' + encodeURIComponent(GRANT_LINES_SINCE)
    + '&or=' + encodeURIComponent(`(title.eq."${GRANTED_TITLE}",title.like."${DATASET_GRANT_TITLE}*")`)
    + '&select=title,body&limit=40');
  let announced = 0;
  for (const g of grantsIn(notes)) {
    const key = 'access:' + g.dataset;
    const said = await io.sb('chat_messages?user_id=eq.' + encodeURIComponent(io.me.id) + '&dataset=eq.' + encodeURIComponent(key) + '&select=id&limit=1');
    if (said.length) continue;
    await io.sb('chat_messages', {method: 'POST', body: JSON.stringify({user_id: io.me.id, name: io.me.username || io.me.display_name || 'Player',
      rank: 'achievement', text: `now has edit access to ${g.label}`, dataset: key})});
    announced++;
  }
  return {announced};
}

async function handle(action, args, io) {
  const a = args || {};
  if (action === 'access.grantLines') return grantLines(a, io);
  if (action === 'access.datasetStatus') return datasetStatus(a, io);
  if (action === 'access.dataset') return datasetRequest(a, io);
  if (action === 'access.datasetList') return datasetList(a, io);
  if (action === 'access.datasetDecide') return datasetDecide(a, io);
  if (action === 'access.betaStatus') return betaStatus(a, io);
  if (action === 'access.beta') return beta(a, io);
  if (action === 'access.betaMarks') return betaMarks(a, io);
  if (action === 'access.betaMark') return betaMark(a, io);
  if (action === 'access.principlesStatus') return principlesStatus(a, io);
  if (action === 'access.principlesAgree') return principlesAgree(a, io);
  if (action === 'access.mine') return mine(a, io);
  if (action === 'access.save') return save(a, io);
  if (action === 'access.remove') return remove(a, io);
  if (action === 'access.submit') return submit(a, io);
  if (action === 'access.withdraw') return withdraw(a, io);
  if (action === 'access.list') return list(a, io);
  if (action === 'access.review') return review(a, io);
  if (action === 'access.decide') return decide(a, io);
  if (action === 'access.reset') return reset(a, io);
  fail(400, `unknown action ${action}`);
}

// ── The Eyewire II Principles (Ames 2026-10-27: "ask players to agree to
// community principles when they go to Retina dataset",
// https://eyewire.ai/principles). Asked only ever once per account, even if
// PRINCIPLES_VERSION changes later. The record (who, when, which version)
// is kept by the server, in the store passed in (Firestore in
// index.js, principles_agreements), never taken from the browser.
//   access.principlesStatus  anyone signed in: {version, agreed, at}.
//   access.principlesAgree   anyone signed in: {version} they saw; agrees.
const PRINCIPLES_VERSION = '2026-10-27';
function principlesKey(io) {
  if (io.me && io.me.id) return `user:${io.me.id}`;
  const email = String((io.who && io.who.email) || '').toLowerCase();
  if (!email) fail(400, 'Your Pyr profile is not ready yet. Reload the page, then try again.');
  return `email:${email}`;
}
async function principlesStatus(a, io) {
  const rec = await io.principles.get(principlesKey(io));
  // Asked only ever once (Ames 2026-10-27: "it should only ever ask them
  // this once"): any agreement counts, whatever version it was.
  const agreed = !!(rec && rec.at);
  return {version: PRINCIPLES_VERSION, agreed, at: agreed ? rec.at : null};
}
async function principlesAgree(a, io) {
  // Agreeing to an older text than the one the server asks for is not agreeing.
  if (a.version !== PRINCIPLES_VERSION) fail(409, 'The principles were updated. Reload the page to read the new version.');
  const key = principlesKey(io);
  // Already agreed: the first agreement stands, never written over.
  const had = await io.principles.get(key);
  if (had && had.at) return {version: PRINCIPLES_VERSION, agreed: true, at: had.at};
  const at = new Date().toISOString();
  await io.principles.set(key, {version: PRINCIPLES_VERSION, at,
    userId: (io.me && io.me.id) || null, email: String((io.who && io.who.email) || '').toLowerCase(),
    name: (io.me && (io.me.username || io.me.display_name)) || ''});
  return {version: PRINCIPLES_VERSION, agreed: true, at};
}

module.exports = {handle, visitorBeta, cleanExample, PRINCIPLES_VERSION, KINDS, IMAGE, GRANTED_TITLE, BETA_CATEGORY, BETA_BELL};
