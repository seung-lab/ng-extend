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

async function list(args, io) {
  const {sb, isAdmin} = io;
  needAdmin(isAdmin);
  // Request bells of players who have the retina now go read (Ames 2026-11-06).
  try { await readRequestBells(io); } catch (e) { console.warn('[access] request bells not swept:', e && e.message); }
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
  // The reviewers' bells for this player's tries are answered now (Ames 2026-11-06).
  if (outcome === 'invited') {
    try { await readRequestBells({sb}, {players: [request.user_id], granted: [request.user_id]}); }
    catch (e) { console.warn('[access] request bells not marked read:', e && e.message); }
  }
  return {...done[0], redos, pilot_added: pilotAdded, cave_granted: caveGranted};
}

// ── Request bells read once the player has the retina (Ames 2026-11-06) ──
// "If that player has ALREADY been granted Retina access, that notification
// should be marked read for admins." Every reviewer's bell for every try
// (try 1, try 2) is marked read on the server, in notification_reads, so
// every admin and every device agrees. A player has the retina when their
// request was granted here, or when CAVE says they edit it (a request
// deleted with Start over, or access given in CAVE by hand). Run on Grant,
// when the Access requests list opens, and from an admin's bell while it
// holds an unread request bell (access.readGrantedBells).
const REQUEST_BELL = '🔬 Retina access request from ';
const RETINA_CAVE = 'stroeh-mouse-retina';
const RETINA_CHECK_MS = 10 * 60 * 1000;
const RETINA_CHECK_MAX = 20;
const retinaSeen = new Map();
const isUuid = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const bellsQuery = extra => 'notifications?target_type=eq.user&title=like.' + encodeURIComponent(REQUEST_BELL + '*')
  + extra + '&select=id,target_id,created_by&order=id.desc&limit=1000';

/** The players among these who can edit the retina. */
async function retinaGranted(io, players) {
  const yes = new Set();
  if (!players.length) return yes;
  const invited = await io.sb(`access_requests?user_id=in.(${players.join(',')})&status=eq.invited&select=user_id`);
  for (const r of invited) yes.add(String(r.user_id));
  const ask = players.filter(p => !yes.has(p));
  if (!ask.length || !io.caveAccessOf) return yes;
  const now = Date.now();
  const unknown = [];
  for (const p of ask) {
    const hit = retinaSeen.get(p);
    if (hit && now - hit.at < RETINA_CHECK_MS) { if (hit.edit) yes.add(p); }
    else unknown.push(p);
  }
  if (!unknown.length) return yes;
  const users = await io.sb(`users?id=in.(${unknown.slice(0, RETINA_CHECK_MAX).join(',')})&select=id,cave_user_id`);
  for (const u of users) {
    const caveId = Number(u.cave_user_id);
    if (!Number.isSafeInteger(caveId) || caveId <= 0) continue;
    const cave = await io.caveAccessOf(caveId);
    if (!cave) continue; // CAVE could not say: ask again next time
    const edit = (cave.edit || []).includes(RETINA_CAVE);
    retinaSeen.set(String(u.id), {at: now, edit});
    if (edit) yes.add(String(u.id));
  }
  return yes;
}

/** Mark read every unread request bell of a player who has the retina.
 *  players: only these players' bells; granted: known to have it already. */
async function readRequestBells(io, {players = null, granted = null} = {}) {
  const ids = players ? players.filter(isUuid) : null;
  if (ids && !ids.length) return {marked: 0, bells: []};
  const bells = (await io.sb(bellsQuery(ids ? `&created_by=in.(${ids.join(',')})` : '')))
    .filter(b => isUuid(b.target_id) && isUuid(b.created_by));
  if (!bells.length) return {marked: 0, bells: []};
  const read = new Set();
  for (let i = 0; i < bells.length; i += 100) {
    const chunk = bells.slice(i, i + 100).map(b => b.id).join(',');
    for (const r of await io.sb(`notification_reads?notification_id=in.(${chunk})&select=notification_id,user_id`)) read.add(`${r.notification_id}:${r.user_id}`);
  }
  const unread = bells.filter(b => !read.has(`${b.id}:${b.target_id}`));
  if (!unread.length) return {marked: 0, bells: []};
  const who = [...new Set(unread.map(b => String(b.created_by)))];
  const yes = granted ? new Set(granted.map(String)) : await retinaGranted(io, who);
  const mark = unread.filter(b => yes.has(String(b.created_by)));
  if (mark.length) {
    await io.sb('notification_reads?on_conflict=notification_id,user_id', {method: 'POST',
      headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'},
      body: JSON.stringify(mark.map(b => ({notification_id: b.id, user_id: b.target_id})))});
  }
  return {marked: mark.length, bells: mark.map(b => ({id: b.id, user_id: b.target_id}))};
}

/** access.readGrantedBells: an admin, or a reviewer who gets the bells. */
async function readGrantedBells(args, io) {
  needMe(io.me);
  if (!io.isAdmin) {
    const mineToo = await io.sb(bellsQuery(`&target_id=eq.${io.me.id}`).replace('limit=1000', 'limit=1'));
    if (!mineToo.length) fail(403, 'Admins only');
  }
  const r = await readRequestBells(io);
  // The caller's own, so their bell can drop them without a reload.
  return {marked: r.marked, ids: r.bells.filter(b => b.user_id === io.me.id).map(b => b.id)};
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
  // The sign in email is the one Pilot testers needs; it comes from the
  // server's own check of their sign in, never from the form.
  const signIn = String((io.who && io.who.email) || '').toLowerCase().slice(0, BETA_EMAIL_MAX);
  // The game form asks for their EyeWire email instead of a second email
  // (Ames 2026-11-12), so the email is their sign in unless they give one.
  const email = betaEmail(a.email || signIn);
  const note = cleanText(a.note, BETA_NOTE_MAX, 'Your note') || '';
  const ew = eyewireOf(a);
  if (ew.email === signIn || ew.email === email) ew.email = null;
  if (a.agree === false) fail(400, 'Please tick the box to say you agree to the Eyewire II Principles and the Terms of Use.');
  if (await betaRequested(io.sb, io.me, io)) return {invited: false, requested: true, already: true};
  // One email when the two match (Ames 2026-10-26: "we don't need the email twice").
  const same = email === signIn;
  // Invited under another address (Ames 2026-11-04: invites went to the
  // emails on the EyeWire form, many not Google accounts, and Pyr signs in
  // with Google). The admin still lets them in by hand: anyone could type an
  // invited address, so the row says to check it is them first.
  const invitedAs = (!same && await invitedEmail(io.sb, email)) ? email
    : (ew.email && await invitedEmail(io.sb, ew.email)) ? ew.email : '';
  const message = [
    `${name} asks to join the Pyr beta.`,
    same ? '' : `Email they gave: ${email}`,
    invitedAs ? `Invited as: ${invitedAs}, already on Pilot testers. They sign in with another Google account.` : '',
    `${same ? 'Email' : 'Sign in email'}: ${signIn}. To let them in, add this one under Admin Hub, Pilot testers.`,
    a.agree === true ? 'They agreed to the community principles.' : '',
    ...ewLines(ew),
    note ? `Their note: ${note}` : '',
  ].filter(Boolean).join('\n');
  const title = (invitedAs ? `Invited tester on another Google account: ${name}` : `Beta access request from ${name}`).slice(0, 120);
  await io.sb('site_issues', {method: 'POST', body: JSON.stringify([{category: BETA_CATEGORY, title, message, user_id: io.me.id, user_name: name}])});
  // The report is the record; the bell and the post only tell people.
  const bell = `${mdText(name)} asks to join the Pyr beta.\n\n`
    + (invitedAs ? `Already invited as ${mdText(invitedAs)}, and signs in with another Google account.\n\n` : '')
    + (same ? `Email: ${mdText(signIn)}` : `Email they gave: ${mdText(email)}\n\nSign in email: ${mdText(signIn)}`)
    + ewForBell(ew)
    + `\n\n${LET_IN}`
    + noteForBell(note);
  // Every admin's Admin tab (Ames 2026-10-24: "yes to all admins").
  try { await (io.notifyAdmins || io.notifyReviewers)({title: `${BETA_BELL} from ${name}`, body: bell}); } catch (e) { console.warn('[beta] bell failed', e && e.message); }
  try { if (io.postIssue) await io.postIssue({title, message, category: BETA_CATEGORY, user: name}); } catch (e) { console.warn('[beta] slack failed', e && e.message); }
  await wakeBoard(io);
  return invitedAs ? {invited: false, requested: true, invitedAs: true} : {invited: false, requested: true};
}
// ── Use my invite (Ames 2026-11-04) ──────────────────────────────────────
// Invites go to the email a player gave on the EyeWire form, which often is
// not a Google account, and Pyr signs in with Google. "I don't want them
// replying with a gmail to me, I want them to use the site": the blocked
// screen asks for the email the invite reached, and if it is on Pilot
// testers the Google account they signed in with is added at once. An
// invite email is not a secret, so each invite brings in one account, only
// while nobody has joined under the invite itself, and every admin is told.
// Anything else becomes a Beta request for an admin to look at.
//   access.linkInvite  a player not on the list: {email} the invite reached.
const LINKED_PREFIX = 'Linked to invite: ';
// Its own category, so no triage card: the player is already in and nothing
// needs doing (Ames 2026-11-04: "How about no triage card for those"). The
// record stays, as it is how a second use is caught (earlier ones were filed
// as Beta access). scripts/slack-triage-bridge.mjs leaves this category out.
const INVITE_CATEGORY = 'Invite used';
async function linkInvite(a, io) {
  if (io.isAdmin || io.isPilot) return {invited: true};
  if (!io.me) fail(400, 'Your Pyr profile is not ready yet. Reload the page, then try again.');
  const email = betaEmail(a.email);
  const signIn = String((io.who && io.who.email) || '').toLowerCase().slice(0, BETA_EMAIL_MAX);
  if (!signIn) fail(401, 'Sign in to Pyr again, then retry.');
  if (email === signIn) fail(400, "That is the account you are signed in with, and it isn't on the invite list. Enter the email address your invite was sent to.");
  if (!(await invitedEmail(io.sb, email))) fail(404, "We couldn't find an invite for that email. Check the spelling, or ask to join below.");
  const name = String(io.me.display_name || io.me.username || 'A player').replace(/[\r\n]+/g, ' ').slice(0, BETA_NAME_MAX);
  // Someone already plays under the invite, or it already brought in an account.
  let joined = false, linkedBefore = false;
  try { joined = (await io.sb('users?middleauth_email=eq.' + encodeURIComponent(email) + '&select=id&limit=1')).length > 0; } catch (e) { joined = true; }
  try {
    linkedBefore = (await io.sb('site_issues?category=in.' + encodeURIComponent(`("${BETA_CATEGORY}","${INVITE_CATEGORY}")`)
      + '&message=like.' + encodeURIComponent('*' + LINKED_PREFIX + email + '.*') + '&select=id&limit=1')).length > 0;
  } catch (e) { linkedBefore = true; }
  if (joined || linkedBefore) {
    const why = joined ? 'Someone already plays Pyr with that invite email.' : 'That invite already brought in another Google account.';
    const message = [
      `${name} asks to join the Pyr beta.`,
      `Email they gave: ${email}`,
      `Invited as: ${email}, already on Pilot testers. They sign in with another Google account. ${why}`,
      `Sign in email: ${signIn}. To let them in, add this one under Admin Hub, Pilot testers.`,
    ].join('\n');
    const title = `Invited tester on another Google account: ${name}`.slice(0, 120);
    await io.sb('site_issues', {method: 'POST', body: JSON.stringify([{category: BETA_CATEGORY, title, message, user_id: io.me.id, user_name: name}])});
    const bell = `${mdText(name)} used the invite for ${mdText(email)} from another Google account, ${mdText(signIn)}. ${mdText(why)}\n\n${LET_IN}`;
    try { await io.notifyAdmins({title: `${BETA_BELL} from ${name}`, body: bell}); } catch (e) { console.warn('[beta] bell failed', e && e.message); }
    await wakeBoard(io);
    return {invited: false, requested: true, review: true};
  }
  await io.sb('pilot_members?on_conflict=email', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify({email: signIn, enabled: true})});
  // The record: it is how a second use of this invite is caught.
  const message = `${name} was invited as ${email} and joined as ${signIn}.\n${LINKED_PREFIX}${email}.\nSign in email: ${signIn}. If this isn't them, turn ${signIn} off under Admin Hub, Pilot testers.`;
  await io.sb('site_issues', {method: 'POST', body: JSON.stringify([{category: INVITE_CATEGORY,
    title: `Invite used: ${name}`.slice(0, 120), message, user_id: io.me.id, user_name: name}])});
  // Nothing to do (Ames 2026-11-04: "asks to join" read as a request).
  const bell = `${mdText(name)} is in. They were invited as ${mdText(email)} and signed in as ${mdText(signIn)}. Nothing to do.\n\nIf this isn't them, turn ${mdText(signIn)} off under Admin Hub, Pilot testers.`;
  try { await io.notifyAdmins({title: `🔑 Invite used by ${name}`.slice(0, 120), body: bell}); } catch (e) { console.warn('[beta] bell failed', e && e.message); }
  return {invited: true, linked: true};
}

/** Is this address on Pilot testers? A failed look up counts as no: the
 *  request still goes in, only without the Invited line. */
async function invitedEmail(sb, email) {
  try {
    const rows = await sb('pilot_members?email=eq.' + encodeURIComponent(email) + '&enabled=eq.true&select=email&limit=1');
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
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
  // How did you find us? (Ames 2026-11-06), optional plain text, one line.
  const found = cleanText(a.foundUs, FOUND_US_MAX, 'How you found us');
  // The email on their EyeWire account (Ames 2026-11-12: "we for sure need
  // eyewire email"), optional: it is where our invites went, so it matches
  // them to an invite and to their EyeWire stats.
  let ewEmail = null;
  if (a.eyewireEmail) {
    try { ewEmail = betaEmail(a.eyewireEmail); } catch (e) { fail(400, 'That EyeWire email does not look right.'); }
  }
  return {username: username ? username.replace(/\s+/g, ' ') : null, rank: rank ? rank.replace(/\s+/g, ' ') : null,
    email: ewEmail,
    found: found ? found.replace(/\s+/g, ' ') : null,
    // Email me Pyr news (Ames 2026-11-12): a box on the request form, unticked
    // to start. Only said when the form sends it, as yes or no.
    news: a.emailOptIn === true ? 'yes' : a.emailOptIn === false ? 'no' : null};
}
const FOUND_US_MAX = 200;
const ewLines = ew => [ew.email ? `EyeWire email: ${ew.email}` : '', ew.username ? `EyeWire username: ${ew.username}` : '', ew.rank ? `EyeWire rank: ${ew.rank}` : '',
  ew.found ? `How they found us: ${ew.found}` : '', ew.news ? `Pyr news by email: ${ew.news}` : ''];
const ewForBell = ew => (ew.email ? `\n\nEyeWire email: ${mdText(ew.email)}` : '') + (ew.username ? `\n\nEyeWire username: ${mdText(ew.username)}` : '') + (ew.rank ? `\n\nEyeWire rank: ${mdText(ew.rank)}` : '')
  + (ew.found ? `\n\nHow they found us: ${mdText(ew.found)}` : '') + (ew.news ? `\n\nPyr news by email: ${ew.news}` : '');
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
//   (On the Access page, listed shows as Later: off the Asked list, kept
//   for later, Ames 2026-11-10.)
const BETA_MARKS = ['listed', 'removed', 'waiting'];
// ── "You're in" by email (Ames 2026-11-05: "let's do resend and we can set up
// connectome.quest"). Letting someone in sends them this, from
// welcome@connectome.quest, replies to support@eyewire.org (Ames 2026-11-12). Once per address:
// a second Let in sends nothing (io.welcomeSent, Firestore in index.js).
// Support gets a blind copy of every welcome (Ames 2026-11-06: "copy
// support@eyewire.org"), and Ames's Gmail (2026-11-10: "add my Gmail"), so
// the player never sees it.
const WELCOME_FROM = 'Pyr <welcome@connectome.quest>';
const WELCOME_REPLY_TO = 'support@eyewire.org';
const WELCOME_COPY_TO = ['support@eyewire.org', 'amyleerobinson@gmail.com', 'amysterling@princeton.edu'];
function welcomeMessage(name, email) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const text = `Hi ${first},\n\nYou're in! Thanks for asking to map the brain with us. Sign in to Pyr with this email address (${email}) here:\n\nhttps://connectome.quest/play/\n\nThe Pyr (pronounced "peer") team at Princeton University`;
  const copies = WELCOME_COPY_TO.filter(c => c !== email);
  const bcc = copies.length ? { bcc: copies } : {};
  return { from: WELCOME_FROM, to: [email], reply_to: WELCOME_REPLY_TO, ...bcc, subject: "You're in: Pyr early access", text };
}
async function welcomeEmail(a, io) {
  needAdmin(io.isAdmin);
  const email = betaEmail(a.email);
  const name = cleanText(a.name, BETA_NAME_MAX, 'The name') || '';
  if (!io.sendEmail) return {sent: false, reason: 'not set up'};
  if (io.welcomeSent && await io.welcomeSent.get(email)) return {sent: false, reason: 'already sent'};
  const r = await io.sendEmail(welcomeMessage(name, email));
  if (!r || !r.ok) fail(502, `The email did not go${r && r.error ? `: ${r.error}` : ''}. They are still let in.`);
  if (io.welcomeSent) await io.welcomeSent.set(email, {at: new Date().toISOString(), by: (io.who && io.who.email) || '', id: r.id || ''});
  return {sent: true};
}
// ── Asking for their EyeWire name (Ames 2026-11-12: "an email that we can
// send automatically via a button on this page (that also has an edit
// button)"). The beta takes EyeWire players first, so a request with no
// EyeWire username gets this. The page shows the draft; an admin may edit it
// and sends it. Replies go to support. Each send is kept (io.askSent,
// Firestore in index.js) so the card reads "Asked" and nobody gets it twice
// unless an admin presses Ask again.
//   access.askDraft  admins: {email, name} the draft, {subject, text}.
//   access.askEmail  admins: {email, name, subject, text, again} sends it.
//   access.askSent   admins: every send, {email: {at, by}}.
const ASK_FROM = 'Amy at Pyr <welcome@connectome.quest>';
// Replies go to support@eyewire.org (Ames 2026-11-12).
const ASK_REPLY_TO = 'support@eyewire.org';
const ASK_SUBJECT_MAX = 150;
const ASK_TEXT_MAX = 4000;
// A request that gave an EyeWire username with no play under it (Ames
// 2026-11-12: "this username was not found") asks them to check it.
function askDraft(name, ewName) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const ew = String(ewName || '').trim();
  const ask = ew
    ? `We couldn't find any EyeWire play under the username "${ew}". Could you reply with the EyeWire username you played under? If you haven't played EyeWire, we'd love to hear how you found Pyr.`
    : `Could you reply with your EyeWire username? If you haven't played EyeWire, we'd love to hear how you found Pyr.`;
  return {
    subject: 'Your Pyr beta request',
    text: `Hi ${first},\n\nThanks for asking to join Pyr! For this beta testing period, we're inviting existing EyeWire players first.\n\n${ask}\n\nAmy Sterling and the Pyr Team at Princeton`,
  };
}
async function askDraftAction(a, io) {
  needAdmin(io.isAdmin);
  betaEmail(a.email);
  return askDraft(cleanText(a.name, BETA_NAME_MAX, 'The name') || '', cleanEwName(a.ewName));
}
async function askEmail(a, io) {
  needAdmin(io.isAdmin);
  const email = betaEmail(a.email);
  const name = cleanText(a.name, BETA_NAME_MAX, 'The name') || '';
  const draft = askDraft(name);
  const subject = String(a.subject == null ? draft.subject : a.subject).replace(/\s+/g, ' ').trim();
  const text = String(a.text == null ? draft.text : a.text).replace(/\r\n/g, '\n').trim();
  if (!subject) fail(400, 'The email needs a subject.');
  if (subject.length > ASK_SUBJECT_MAX) fail(400, `Keep the subject under ${ASK_SUBJECT_MAX} characters.`);
  if (!text) fail(400, 'The email is empty.');
  if (text.length > ASK_TEXT_MAX) fail(400, `Keep the email under ${ASK_TEXT_MAX} characters.`);
  if (!io.sendEmail) return {sent: false, reason: 'not set up'};
  const before = io.askSent && await io.askSent.get(email);
  if (before && !a.again) return {sent: false, reason: 'already sent', at: before.at};
  const copies = WELCOME_COPY_TO.filter(c => c !== email);
  const r = await io.sendEmail({from: ASK_FROM, to: [email], reply_to: ASK_REPLY_TO, ...(copies.length ? {bcc: copies} : {}), subject, text});
  if (!r || !r.ok) fail(502, `The email did not go${r && r.error ? `: ${r.error}` : ''}.`);
  const at = new Date().toISOString();
  if (io.askSent) await io.askSent.set(email, {at, by: (io.who && io.who.email) || '', id: r.id || ''});
  return {sent: true, at};
}
// How many we emailed an invite (Ames 2026-11-12: "how many ppl we have
// invited via email ... in stats up top"): rows in access_invites, one per
// email per campaign, counted once per email.
//   access.inviteCount  admins: {invited}.
// And everyone who has signed in to Pyr, admins left out (Ames 2026-11-12:
// "I want to see all the people we've invited, all the people who have
// signed in"), including those who signed in and never asked.
// ── An EyeWire username typed in on the Access page (Ames 2026-11-12: "add
// eyewire username manually to invite"). Goes in access_ew_names, which the
// view access_hub_people reads (supabase-access-hub.sql). Admins only.
//   access.setEwName  admins: {email, ewName}.
async function setEwName(a, io) {
  needAdmin(io.isAdmin);
  const email = betaEmail(a.email);
  const ewName = cleanEwName(a.ewName);
  if (!ewName) fail(400, 'Type their EyeWire username.');
  const by = String((io.who && io.who.email) || '').slice(0, 200) || null;
  await io.sb('access_ew_names?on_conflict=email', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify({email, ew_name: ewName.toLowerCase(), set_by: by, set_at: new Date().toISOString()})});
  return {ewName: ewName.toLowerCase()};
}

// ── An EyeWire player's public profile: when they joined, roles, country
// (Ames 2026-11-13: "add eyewire join date here"). eyewire.org's bio page
// sends no CORS header, so the Access page can't read it itself; the
// stats page it reads directly. Admins only.
//   access.ewBio  admins: {name} -> {joined, roles, country} or {none: true}.
async function ewBio(a, io) {
  needAdmin(io.isAdmin);
  const name = cleanEwName(a.name);
  if (!name) fail(400, 'Which EyeWire username?');
  const get = io.fetch || fetch;
  let bio = null;
  try {
    const r = await get(`https://eyewire.org/1.0/player/${encodeURIComponent(name.toLowerCase())}/bio`);
    bio = r.ok ? await r.json() : null;
  } catch (e) { bio = null; }
  if (!bio || typeof bio !== 'object') return {none: true};
  return {joined: Number(bio.joined) || null, roles: Array.isArray(bio.roles) ? bio.roles.map(String).slice(0, 20) : [],
    country: bio.country_name ? String(bio.country_name).slice(0, 80) : null};
}

// ── A Beta request bell is read once the request is dealt with on the
// Access page (Ames 2026-11-12: "notif feed is supposed to mark these as
// read if I've dealt with them in Access"): let in (on Pilot testers),
// put on Later, removed, or emailed for their EyeWire name. Marked read for
// every admin, so every admin and device agrees. The bell names the
// person's emails in its body (escaped for markdown).
//   access.readHandledBetaBells  admins: {marked, ids} (ids: the caller's).
const BETA_BELL_LIKE = 'notifications?target_type=eq.user&title=like.' + encodeURIComponent(BETA_BELL + '*')
  + '&select=id,target_id,body&order=id.desc&limit=2000';
const EMAIL_IN = /[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}/gi;
function bellEmails(body) {
  const plain = String(body || '').replace(/\\(.)/g, '$1');
  return [...new Set((plain.match(EMAIL_IN) || []).map(e => e.toLowerCase().replace(/\.$/, '')))];
}
async function readHandledBetaBells(a, io) {
  needAdmin(io.isAdmin);
  const bells = (await io.sb(BETA_BELL_LIKE)).filter(b => isUuid(b.target_id));
  if (!bells.length) return {marked: 0, ids: []};
  const read = new Set();
  for (let i = 0; i < bells.length; i += 100) {
    const chunk = bells.slice(i, i + 100).map(b => b.id).join(',');
    for (const r of await io.sb(`notification_reads?notification_id=in.(${chunk})&select=notification_id,user_id`)) read.add(`${r.notification_id}:${r.user_id}`);
  }
  const unread = bells.filter(b => !read.has(`${b.id}:${b.target_id}`));
  if (!unread.length) return {marked: 0, ids: []};
  const [pilots, marks, asked, links] = await Promise.all([
    io.sb('pilot_members?enabled=eq.true&select=email&limit=20000').catch(() => []),
    io.marks ? io.marks.all().catch(() => ({})) : {},
    io.askSent ? io.askSent.all().catch(() => ({})) : {},
    io.sb('access_email_links?select=email,linked_to&limit=5000').catch(() => []),
  ]);
  const done = new Set();
  for (const p of pilots || []) done.add(String(p.email || '').toLowerCase());
  for (const [e, m] of Object.entries(marks || {})) if (m && (m.mark === 'removed' || m.mark === 'listed')) done.add(e.toLowerCase());
  for (const e of Object.keys(asked || {})) done.add(e.toLowerCase());
  // One person, two emails: dealt with under either.
  for (const l of links || []) {
    const x = String(l.email || '').toLowerCase(), y = String(l.linked_to || '').toLowerCase();
    if (done.has(x)) done.add(y); else if (done.has(y)) done.add(x);
  }
  const mark = unread.filter(b => bellEmails(b.body).some(e => done.has(e)));
  if (mark.length) {
    await io.sb('notification_reads?on_conflict=notification_id,user_id', {method: 'POST',
      headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'},
      body: JSON.stringify(mark.map(b => ({notification_id: b.id, user_id: b.target_id})))});
  }
  const mine = io.me && io.me.id;
  return {marked: mark.length, ids: mark.filter(b => b.target_id === mine).map(b => b.id)};
}

const TEAM_EMAILS = ['ryan.t.morey@gmail.com'];
async function inviteCount(a, io) {
  needAdmin(io.isAdmin);
  const [rows, users, admins] = await Promise.all([
    io.sb('access_invites?select=email&limit=20000'),
    io.sb('users?select=id,middleauth_email&limit=20000'),
    io.sb('admins?select=user_id,email&limit=1000'),
  ]);
  const adminIds = new Set((admins || []).map(r => r.user_id).filter(Boolean));
  const adminEmails = new Set((admins || []).map(r => String(r.email || '').toLowerCase()).filter(Boolean));
  // The Princeton team who are not Pyr admins (Ames 2026-11-12, Ryan Morey)
  // are left out too, as on the Access page.
  for (const e of TEAM_EMAILS) adminEmails.add(e);
  const signedIn = (users || []).filter(u => !adminIds.has(u.id) && !adminEmails.has(String(u.middleauth_email || '').toLowerCase())).length;
  return {invited: new Set((rows || []).map(r => r.email)).size, signedIn};
}
async function askSentAll(a, io) {
  needAdmin(io.isAdmin);
  return io.askSent ? io.askSent.all() : {};
}
// ── One person, two emails, joined by hand (Ames 2026-11-10: "some
// duplicates ... same person"). The Access page suggests pairs; an admin
// presses Same person. The row goes in access_email_links, which the view
// access_hub_people folds (supabase-access-hub.sql): the email folds into
// \`to\`. Admins only.
//   access.linkEmails  admins: {email, to}.
async function linkEmails(a, io) {
  needAdmin(io.isAdmin);
  const email = betaEmail(a.email), to = betaEmail(a.to);
  if (email === to) fail(400, 'Those are the same email.');
  const by = String((io.who && io.who.email) || '').slice(0, 200);
  await io.sb('access_email_links?on_conflict=email', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify({email, linked_to: to, note: `Same person, on the Access page${by ? ' by ' + by : ''}`})});
  return {linked: true};
}
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

// ── The team's notes on a person (Celia 2026-11-09: "a place to leave notes
// on requests from people we don't know, or ones still being discussed").
// Shown on the Access page (triage hub). Keyed by the person's email, or
// "user:<id>" when there is none. Admins only; in io.notes (Firestore in
// index.js), so this needs no new table.
//   access.notes       admins: every note, {key: [{id, text, by, at}]}.
//   access.note        admins: {key, text} adds one.
//   access.noteDelete  admins: {key, id} takes one away.
const ACCESS_NOTE_MAX = 1000;
const { tagIdsIn } = require('./todo-connector');
const NOTE_KEY = /^(?:[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+|user:[0-9a-f-]{36})$/i;
function noteKey(k) {
  const key = String(k || '').trim().toLowerCase();
  if (!NOTE_KEY.test(key) || key.length > BETA_EMAIL_MAX) fail(400, 'Unknown person.');
  return key;
}
async function accessNotes(a, io) {
  needAdmin(io.isAdmin);
  return io.notes.all();
}
async function accessNote(a, io) {
  needAdmin(io.isAdmin);
  const key = noteKey(a.key);
  const text = cleanText(a.text, ACCESS_NOTE_MAX, 'The note', true);
  if (!text) fail(400, 'Write a note first.');
  const by = (io.me && (io.me.display_name || io.me.username)) || (io.who && io.who.email) || 'An admin';
  await io.notes.add(key, {text, by, byEmail: (io.who && io.who.email) || '', at: new Date().toISOString()});
  // The note is saved whatever happens to the tags.
  try { await tagFromNote(key, text, by, a.name, io); } catch (e) { console.warn('[access note] tag failed', e && e.message); }
  return io.notes.all();
}
// "@Celia" or "@Marissa" in a note tags that admin (Ames 2026-11-10: "if I
// leave a note here can it tag celia / Marissa?"), as notes on the triage
// board do (triage-notes.js): a bell in Pyr and a ping in Slack, each with a
// link that opens this person on the Access page.
const ACCESS_PAGE = 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/?triage=access';
async function tagFromNote(key, text, by, name, io) {
  if (!io.people || !io.notifyPeople) return 0;
  const people = await io.people();
  const ids = tagIdsIn(text, people).filter(id => id !== (io.me && io.me.id));
  if (!ids.length) return 0;
  const who = people.filter(p => ids.includes(p.id));
  const label = String(name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, BETA_NAME_MAX);
  const about = label ? `${label}${key.startsWith('user:') ? '' : ` (${key})`}` : (key.startsWith('user:') ? 'a player' : key);
  const link = `${ACCESS_PAGE}&person=${encodeURIComponent(key)}`;
  await io.notifyPeople({ids, title: `💬 ${by} tagged you on the Access page`.slice(0, 120),
    body: `About ${mdText(about)}:\n\n${mdText(text.slice(0, 600))}\n\n${link}`});
  if (io.slackPing) {
    const quote = text.replace(/\s+/g, ' ').slice(0, 300);
    await io.slackPing(who, `left a note on the Access page about ${about}:\n> ${quote}\n<${link}|Open it on the Access page>`, by);
  }
  return ids.length;
}
async function accessNoteDelete(a, io) {
  needAdmin(io.isAdmin);
  const key = noteKey(a.key);
  const id = String(a.id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail(400, 'Unknown note.');
  await io.notes.remove(key, id);
  return io.notes.all();
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
/** A dataset's own unlock bell (Ames 2026-11-14: "custom notifs that are sent
 *  to players when they unlock access (especially to MEC)"). The title keeps
 *  the "🔓 You have access to " start and the body keeps the Explore link:
 *  grantLines finds grants by both. Others get the plain bell. */
const DATASET_UNLOCK = {
  pni_mec: {
    title: '🔓 You have access to MEC, the brain\'s map of space',
    image: 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/images/datasets/mec-welcome.jpg',
    body: 'Congratulations, you\'re in! **You can now edit MEC, the medial entorhinal cortex.**\n\n'
      + 'This is one of the regions where the mouse brain keeps its map of space. Its **grid cells** fire in a hexagonal pattern as an animal explores, '
      + 'and their discovery won the 2014 Nobel Prize. Every cell you proofread here helps show how that map is wired.\n\n'
      + 'The first time you open MEC, a short tour introduces its seven kinds of cell, from the star shaped stellate cells to the microglia. '
      + '**In MEC, we prioritize proofreading axons first. Feel free to cut the axon as you proofread, as long as you join it back to the cell before completion.** '
      + 'Once the axon is mapped fully, you can mark the cell complete.\n\n'
      + 'Please edit with care: this is a real dataset, and your edits directly change the connectome. '
      + 'Stuck on a cell? Ask in chat or drop us an email at support@eyewire.org.',
  },
};
/** The bell a player gets when a dataset is unlocked: its own, or the plain one. */
function unlockBell(dataset, label, said) {
  const short = DATASET_SHORT[dataset] || label;
  const own = DATASET_UNLOCK[dataset];
  return {title: (own ? own.title : `🔓 You have access to ${label}`).slice(0, 120), image: own ? own.image : DATASET_GRANTED,
    body: (own ? own.body : `Congratulations, you're in!\n\n**Your access to ${mdText(short)} has been granted!**\n\n`
      + 'Please use your new power with care: this is a real dataset, and your edits directly change the connectome.')
      // The way there (Ames 2026-10-28: "an explore the N button that lets them jump to that dataset").
      + `\n\n[Explore ${mdText(short)} ›](#nge-open-dataset=${dataset})` + said};
}
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
        await io.notifyPlayer({userId: row.user_id, ...unlockBell(row.dataset, label, said)});
      } else {
        await io.notifyPlayer({userId: row.user_id, title: `About your ${label} access request`.slice(0, 120),
          body: `Not yet, sorry: your request for ${mdText(label)} was looked at, and access was not given this time.` + said});
      }
    } catch (e) { console.warn('[dataset access] player bell failed', e && e.message); }
  }
  return datasetList(a, io);
}

// ── Send me a test (Ames 2026-11-14: "send me a test as well"): the
// unlock bell for a dataset, to the admin who asks. The title starts
// "Test: " so grantLines never takes it for a real grant and says so in chat.
//   access.datasetTestBell  admins: {dataset, label} -> {sent: true}.
async function datasetTestBell(a, io) {
  needAdmin(io.isAdmin);
  if (!io.me) fail(401, 'Sign in first.');
  const dataset = String(a.dataset || '');
  if (!DS_ID.test(dataset)) fail(400, 'Unknown dataset.');
  const label = cleanText(a.label, 60, 'The dataset name') || DATASET_SHORT[dataset] || dataset;
  const bell = unlockBell(dataset, label, '');
  await io.notifyPlayer({userId: io.me.id, ...bell, title: ('Test: ' + bell.title).slice(0, 120)});
  return {sent: true};
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

// ── Edit access on a profile (Ames 2026-11-02: "should we show accesses
// unlocked in profile?" and "I don't see this on Nik's") ── Which of the
// earned datasets a player can edit, read from CAVE with the admin token, so
// it is right for grants of any date. Only these three are told, and only
// "can edit": nothing else about their account. Kept 10 minutes per player.
const PROFILE_ACCESS = {'stroeh-mouse-retina': 'stroeh_mouse_retina', HiMC: 'pni_mec', BANC: 'banc'};
const PROFILE_ACCESS_MS = 10 * 60 * 1000;
const profileAccessSeen = new Map();
async function profileAccess(a, io) {
  if (!io.me) fail(401, 'Sign in to see this.');
  const userId = String(a.userId || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) fail(400, 'Invalid player');
  const hit = profileAccessSeen.get(userId);
  if (hit && Date.now() - hit.at < PROFILE_ACCESS_MS) return hit.value;
  const users = await io.sb('users?id=eq.' + encodeURIComponent(userId) + '&select=cave_user_id&limit=1');
  const caveId = Number(Array.isArray(users) && users[0] ? users[0].cave_user_id : NaN);
  if (!io.caveAccessOf || !Number.isSafeInteger(caveId) || caveId <= 0) return {edit: null};
  const cave = await io.caveAccessOf(caveId);
  if (!cave) return {edit: null};
  const value = {edit: (cave.edit || []).map(ds => PROFILE_ACCESS[ds]).filter(Boolean)};
  profileAccessSeen.set(userId, {at: Date.now(), value});
  return value;
}

async function handle(action, args, io) {
  const a = args || {};
  if (action === 'access.profileAccess') return profileAccess(a, io);
  if (action === 'access.grantLines') return grantLines(a, io);
  if (action === 'access.datasetStatus') return datasetStatus(a, io);
  if (action === 'access.dataset') return datasetRequest(a, io);
  if (action === 'access.datasetList') return datasetList(a, io);
  if (action === 'access.datasetDecide') return datasetDecide(a, io);
  if (action === 'access.datasetTestBell') return datasetTestBell(a, io);
  if (action === 'access.betaStatus') return betaStatus(a, io);
  if (action === 'access.beta') return beta(a, io);
  if (action === 'access.linkInvite') return linkInvite(a, io);
  if (action === 'access.betaMarks') return betaMarks(a, io);
  if (action === 'access.betaMark') return betaMark(a, io);
  if (action === 'access.linkEmails') return linkEmails(a, io);
  if (action === 'access.welcomeEmail') return welcomeEmail(a, io);
  if (action === 'access.askDraft') return askDraftAction(a, io);
  if (action === 'access.askEmail') return askEmail(a, io);
  if (action === 'access.askSent') return askSentAll(a, io);
  if (action === 'access.inviteCount') return inviteCount(a, io);
  if (action === 'access.setEwName') return setEwName(a, io);
  if (action === 'access.ewBio') return ewBio(a, io);
  if (action === 'access.readHandledBetaBells') return readHandledBetaBells(a, io);
  if (action === 'access.notes') return accessNotes(a, io);
  if (action === 'access.note') return accessNote(a, io);
  if (action === 'access.noteDelete') return accessNoteDelete(a, io);
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
  if (action === 'access.readGrantedBells') return readGrantedBells(a, io);
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
