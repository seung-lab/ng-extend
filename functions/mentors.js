'use strict';
/**
 * The mentor program (supabase-mentors.sql), a proof of concept. Nseraf's
 * idea (triage report 317, 2026-10-30), asked for by Ames 2026-11-04: a new
 * player's first cells get a second look before they count. The apprentice
 * presses Complete and the cell goes to a mentor; the mentor leaves notes in
 * the view and either sends suggestions back or completes it, and then it
 * counts for the APPRENTICE.
 *
 * Mentors are the players an admin lists, and the admins themselves.
 *
 * Low overhead (Ames's worry): nobody matches people. Mentors take cells from
 * a queue; the first mentor to take an apprentice's cell stays with them, at
 * most MAX_APPRENTICES at a time. Anything left 48 hours shows as overdue to
 * the admins, and a cell taken and then left alone that long goes back to the
 * queue.
 *
 * Credit: an apprentice's send writes nothing that counts, so suggestions
 * never take anything away. Complete finishes the apprentice's claim and
 * records their completion through `credit` (the way saved teams credit a
 * member), at that moment. Nobody's existing totals change.
 *
 * mentorAction(action, args, {db, me, isAdmin, credit, now}) is the whole
 * surface. `db` is restDb (the service key) or memDb (tests, stand-in server).
 * Every bell goes to one named person: a branch test site shares the live
 * data, so nothing here writes to chat or to everyone.
 */
const CELLS_NEEDED = 5;
// Ames 2026-11-04: 5, not 2. New players take a while over each cell, and
// meanwhile a mentor can be helping others.
const MAX_APPRENTICES = 5;
const OVERDUE_MS = 48 * 3600 * 1000;
const NOTE_MAX = 300;
const CELL_NOTE_MAX = 2000;
const NOTES_MAX = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ['waiting', 'looking', 'suggestions'];

// The two Achievements. Art is a stand in until Ames picks some.
const ART = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/';
const APPRENTICE_BADGE = {slug: 'mentor-program-apprentice', name: 'Apprentice',
  description: 'Finished the mentor program: five cells completed with a mentor.',
  image_url: ART + 'nurro-experiment.png', thumbnail_url: ART + 'nurro-experiment.png'};
const MENTOR_BADGE = {slug: 'mentor-program-mentor', name: 'Mentor',
  description: 'Saw an apprentice through the mentor program.',
  image_url: ART + 'nurro-trophy.png', thumbnail_url: ART + 'nurro-trophy.png'};

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const nameOf = u => String((u && (u.username || u.display_name)) || 'Player').slice(0, 40);
const uuid = (v, what) => { const s = String(v || ''); if (!UUID.test(s)) fail(400, `Bad ${what}.`); return s.toLowerCase(); };
const posInt = (v, what) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) fail(400, `Bad ${what}.`); return n; };
const segId = v => (/^\d{1,24}$/.test(String(v || '')) ? String(v) : '');
const short = id => (id ? `...${String(id).slice(-4)}` : 'a cell');
const point = v => (Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(Number(n))) ? v.map(Number) : null);
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const cellName = r => short(r.root_id || r.segment_id);

/** What a review looks like to a browser. */
function reviewOut(r) {
  return {
    id: r.id, state: r.state, rounds: r.rounds || 1,
    apprenticeId: r.apprentice_id, apprenticeName: r.apprentice_name, mentorId: r.mentor_id || null, mentorName: r.mentor_name || null,
    dataset: r.dataset, logDataset: r.log_dataset || r.dataset, taskId: r.task_id, segmentId: r.segment_id || '', rootId: r.root_id || '',
    position: r.position || null, link: r.link || '', done: r.done || {},
    notes: Array.isArray(r.notes) ? r.notes : [], cellNote: r.cell_note || '',
    sentAt: r.sent_at, claimedAt: r.claimed_at || null, decidedAt: r.decided_at || null, touchedAt: r.touched_at || r.sent_at,
    sheetDone: !!r.sheet_done,
  };
}
const apprenticeOut = a => a && ({
  id: a.user_id, name: a.user_name, status: a.status, mentorId: a.mentor_id || null, mentorName: a.mentor_name || null,
  cellsDone: a.cells_done || 0, cellsNeeded: a.cells_needed || CELLS_NEEDED, startedAt: a.started_at, finishedAt: a.finished_at || null,
});

/** Left alone too long: (ms since it was last touched) > 48 h. */
const idleFor = (r, now) => now - Date.parse(r.touched_at || r.sent_at || 0);

async function mentorAction(action, args, {db, me, isAdmin = false, credit, now = new Date()}) {
  if (!me || !me.id) fail(403, 'No Pyr profile.');
  const meId = String(me.id).toLowerCase();
  const t = now.getTime();
  const stamp = now.toISOString();
  const mentorRow = await db.getMentor(meId);
  // Admins can mentor too (Ames 2026-11-04), as any mentor does.
  const isMentor = !!(mentorRow && mentorRow.active) || !!isAdmin;
  const mayReview = isMentor;
  const needReviewer = () => { if (!mayReview) fail(403, 'Mentors only.'); };
  const needAdmin = () => { if (!isAdmin) fail(403, 'Admins only.'); };

  /** A cell taken by a mentor and then left 48 hours goes back to the queue,
   *  and so does the apprentice, so another mentor can take them. Done on
   *  read, so nothing has to run on a timer. */
  async function returnIdle(reviews) {
    for (const r of reviews) {
      if (r.state !== 'looking' || idleFor(r, t) <= OVERDUE_MS) continue;
      await db.patchReview(r.id, {state: 'waiting', mentor_id: null, mentor_name: null, claimed_at: null});
      const a = await db.getApprentice(r.apprentice_id);
      if (a && a.mentor_id === r.mentor_id) await db.patchApprentice(a.user_id, {mentor_id: null, mentor_name: null});
      Object.assign(r, {state: 'waiting', mentor_id: null, mentor_name: null, claimed_at: null});
    }
    return reviews;
  }
  async function loadReview(id) {
    const r = await db.getReview(posInt(id, 'cell'));
    if (!r) fail(404, 'That cell is no longer waiting for a mentor.');
    return r;
  }
  const slotsUsed = async () => (await db.apprenticesOf(meId)).filter(a => a.status === 'active').length;

  switch (action) {
    case 'mentor.status': {
      const a = await db.getApprentice(meId);
      const out = {installed: true, admin: !!isAdmin, mentor: isMentor, apprentice: apprenticeOut(a), cellsNeeded: CELLS_NEEDED, maxApprentices: MAX_APPRENTICES};
      // The apprentice's own cells, every state, for the Mentoring tab and My Cells.
      out.mine = a ? (await db.reviewsOfApprentice(meId)).map(reviewOut) : [];
      if (mayReview) {
        const open = await returnIdle(await db.openReviews());
        out.waiting = open.filter(r => r.state === 'waiting' && !r.mentor_id).length;
        out.yours = open.filter(r => r.mentor_id === meId && r.state !== 'suggestions').length;
      }
      return out;
    }

    // ── The apprentice ──────────────────────────────────────────────────
    case 'mentor.send': {
      const a = await db.getApprentice(meId);
      if (!a || a.status !== 'active') fail(403, 'You are not in the mentor program.');
      const taskId = posInt(args.taskId, 'claim');
      const dataset = clean(args.dataset, 80);
      if (!dataset) fail(400, 'Which dataset is the cell in?');
      const logDataset = /^[A-Za-z0-9_.-]{1,100}$/.test(String(args.logDataset || '')) ? String(args.logDataset) : dataset;
      const rootId = segId(args.rootId);
      if (!rootId) fail(400, 'Put the crosshairs in the cell first.');
      const d = args.done && typeof args.done === 'object' ? args.done : {};
      const done = {status: clean(d.status, 80), notes: clean(d.notes, 2000), cellType: clean(d.cellType, 120), coords: clean(d.coords, 200)};
      const fields = {dataset, log_dataset: logDataset, segment_id: segId(args.segmentId) || null, root_id: rootId,
        position: point(args.position), link: /^https:\/\/\S{1,2000}$/.test(String(args.link || '')) ? String(args.link) : null, done, touched_at: stamp};
      const mine = await db.reviewsOfApprentice(meId);
      const again = mine.find(r => r.task_id === taskId && OPEN.includes(r.state));
      if (again && again.state !== 'suggestions') fail(409, 'This cell is already with a mentor.');
      const openCount = mine.filter(r => OPEN.includes(r.state) && r !== again).length;
      if (!again && (a.cells_done || 0) + openCount >= (a.cells_needed || CELLS_NEEDED))
        fail(409, `All of your ${a.cells_needed || CELLS_NEEDED} mentor cells are sent. Wait for your mentor before sending another.`);
      // Keep the claim while it waits: an ordinary claim lapses after 30 minutes.
      await db.holdClaim(taskId, meId);
      let r;
      if (again) {
        // Sent again after suggestions: straight back to the same mentor.
        r = await db.patchReview(again.id, {...fields, state: again.mentor_id ? 'looking' : 'waiting', rounds: (again.rounds || 1) + 1, sent_at: stamp, decided_at: null});
      } else {
        r = await db.insertReview({...fields, apprentice_id: meId, apprentice_name: nameOf(me), task_id: taskId,
          mentor_id: a.mentor_id || null, mentor_name: a.mentor_name || null, state: a.mentor_id ? 'looking' : 'waiting', rounds: 1, notes: [], sent_at: stamp,
          claimed_at: a.mentor_id ? stamp : null});
      }
      const who = nameOf(me);
      if (r.mentor_id) {
        await db.notify(r.mentor_id, again ? `🧭 ${who} sent a cell back to you` : `🧭 ${who} sent you a cell`,
          `${who} sent cell ${cellName(r)} for a second look. Open Cell Library, Mentoring.`, meId);
      } else if (!mine.length) {
        // A new apprentice's first cell: one bell to each mentor with room. Never one per cell.
        for (const m of await db.activeMentors()) {
          if (m.user_id === meId) continue;
          if ((await db.apprenticesOf(m.user_id)).filter(x => x.status === 'active').length >= MAX_APPRENTICES) continue;
          await db.notify(m.user_id, '🧭 A new apprentice is waiting for a mentor',
            `${who} sent their first cell for a second look. Open Cell Library, Mentoring, to take it.`, meId);
        }
      }
      return {review: reviewOut(r), apprentice: apprenticeOut(await db.getApprentice(meId))};
    }
    case 'mentor.sheetDone': {
      const r = await loadReview(args.reviewId);
      if (r.apprentice_id !== meId) fail(403, 'Not your cell.');
      if (r.state === 'complete' && !r.sheet_done) await db.patchReview(r.id, {sheet_done: true});
      return {ok: true};
    }

    // ── Mentors (and admins) ────────────────────────────────────────────
    case 'mentor.queue': {
      needReviewer();
      const open = await returnIdle(await db.openReviews());
      const mineA = isMentor ? (await db.apprenticesOf(meId)).filter(a => a.status === 'active') : [];
      return {
        waiting: open.filter(r => r.state === 'waiting' && !r.mentor_id).map(reviewOut),
        yours: open.filter(r => r.mentor_id === meId).map(reviewOut),
        apprentices: mineA.map(apprenticeOut),
        slots: {used: mineA.length, max: MAX_APPRENTICES},
        mentor: isMentor, admin: !!isAdmin,
      };
    }
    case 'mentor.review': {
      const r = await loadReview(args.reviewId);
      if (r.apprentice_id !== meId && r.mentor_id !== meId && !mayReview) fail(403, 'Not your cell.');
      return reviewOut(r);
    }
    case 'mentor.claim': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.apprentice_id === meId) fail(409, 'A mentor looks at your cell, not you.');
      if (r.state === 'complete') fail(409, 'That cell is complete already.');
      if (r.state === 'suggestions') fail(409, 'That cell is back with the apprentice.');
      if (r.mentor_id && r.mentor_id !== meId) {
        if (!isAdmin) fail(409, `${r.mentor_name || 'Another mentor'} is looking at this cell.`);
      }
      const a = await db.getApprentice(r.apprentice_id);
      if (isMentor && a && a.status === 'active' && !a.mentor_id) {
        if ((await slotsUsed()) >= MAX_APPRENTICES) fail(409, `You are mentoring ${MAX_APPRENTICES} players already. Finish with one first, or hand one back.`);
        await db.patchApprentice(a.user_id, {mentor_id: meId, mentor_name: nameOf(me)});
        await db.notify(a.user_id, '🧭 You have a mentor', `${nameOf(me)} is your mentor for your first cells. They will look at each one you send.`, meId);
      }
      const out = await db.patchReview(r.id, {mentor_id: meId, mentor_name: nameOf(me), state: 'looking', claimed_at: r.claimed_at || stamp, touched_at: stamp});
      return reviewOut(out);
    }
    case 'mentor.saveNotes': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.mentor_id !== meId) fail(403, 'Take a look at this cell first.');
      if (r.state !== 'looking') fail(409, r.state === 'complete' ? 'That cell is complete already.' : 'That cell is back with the apprentice.');
      const out = await db.patchReview(r.id, {...notesFrom(args), touched_at: stamp});
      return reviewOut(out);
    }
    case 'mentor.suggest': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.mentor_id !== meId) fail(403, 'Take a look at this cell first.');
      if (r.state !== 'looking') fail(409, 'That cell is not waiting for you.');
      const n = notesFrom(args, r);
      if (!n.notes.length && !n.cell_note) fail(400, 'Leave at least one suggestion, as a note in the view or for the whole cell.');
      const out = await db.patchReview(r.id, {...n, state: 'suggestions', decided_at: stamp, touched_at: stamp});
      await db.notify(r.apprentice_id, '🧭 Your mentor has suggestions',
        `${nameOf(me)} left suggestions on cell ${cellName(r)}. Open Cell Library, Mentoring, to see them in the view. When you are done, send it again.`, meId);
      return reviewOut(out);
    }
    case 'mentor.complete': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.mentor_id !== meId) fail(403, 'Take a look at this cell first.');
      const n = args.notes !== undefined || args.cellNote !== undefined ? notesFrom(args, r) : {};
      // Only the call that moves it from looking to complete goes on: a
      // second press changes nothing and credits nothing.
      const won = await db.decideReview(r.id, meId, {...n, state: 'complete', decided_at: stamp, touched_at: stamp});
      if (!won) fail(409, 'That cell is not waiting for you.');
      const finalSeg = segId(args.root) || r.root_id;
      try {
        await db.completeTask(r.apprentice_id, r.task_id, finalSeg, (r.done && r.done.coords) || '');
        await credit(r.apprentice_id, {operation: 'complete_task', task_id: r.task_id, dataset: r.log_dataset || r.dataset,
          metadata: {final_segment_id: finalSeg, soma_coords: (r.done && r.done.coords) || undefined, mentor_id: meId, mentor_review: r.id}});
      } catch (e) {
        // Nothing counted: back to the mentor, so it can be tried again.
        await db.patchReview(r.id, {state: 'looking', decided_at: null});
        throw e;
      }
      const a = await db.getApprentice(r.apprentice_id);
      const doneCount = ((a && a.cells_done) || 0) + 1;
      const needed = (a && a.cells_needed) || CELLS_NEEDED;
      const finished = !!a && a.status === 'active' && doneCount >= needed;
      if (a) await db.patchApprentice(a.user_id, {cells_done: doneCount, ...(finished ? {status: 'finished', finished_at: stamp} : {})});
      await db.notify(r.apprentice_id, '🎉 Your cell is complete',
        `${nameOf(me)} completed cell ${cellName(r)} with you. It counts for you. ${Math.min(doneCount, needed)} of ${needed} mentor cells done.`, meId);
      if (finished) {
        await db.award(APPRENTICE_BADGE, r.apprentice_id, `Finished the mentor program with ${nameOf(me)}`);
        await db.notify(r.apprentice_id, '🏆 Apprentice Achievement',
          `You finished the mentor program. From now on your cells count the moment you complete them. Thank you, ${nameOf(me)}, too.`, meId);
        if (a.mentor_id) {
          await db.award(MENTOR_BADGE, a.mentor_id, `Mentored ${a.user_name}`);
          await db.notify(a.mentor_id, '🏆 Mentor Achievement', `${a.user_name} finished the mentor program with you.`, meId);
        }
      }
      return {review: reviewOut(await db.getReview(r.id)), finished};
    }
    case 'mentor.handBack': {
      needReviewer();
      const target = uuid(args.apprenticeId, 'player');
      const a = await db.getApprentice(target);
      if (!a || a.mentor_id !== meId) fail(409, 'You are not this player\'s mentor.');
      await db.patchApprentice(target, {mentor_id: null, mentor_name: null});
      for (const r of await db.reviewsOfApprentice(target)) {
        if (r.mentor_id === meId && r.state !== 'complete') await db.patchReview(r.id, {mentor_id: null, mentor_name: null, claimed_at: null, ...(r.state === 'looking' ? {state: 'waiting'} : {})});
      }
      return {ok: true};
    }

    // ── Admins ──────────────────────────────────────────────────────────
    case 'mentor.admin': {
      needAdmin();
      const open = await returnIdle(await db.openReviews());
      return {
        mentors: (await db.activeMentors()).map(m => ({id: m.user_id, name: m.user_name})),
        apprentices: (await db.allApprentices()).map(apprenticeOut),
        overdue: open.filter(r => r.state !== 'suggestions' && idleFor(r, t) > OVERDUE_MS).map(reviewOut),
        cellsNeeded: CELLS_NEEDED, maxApprentices: MAX_APPRENTICES,
      };
    }
    case 'mentor.addMentor': {
      needAdmin();
      const u = await findPlayer(db, args);
      if ((await db.getApprentice(u.id))?.status === 'active') fail(409, `${nameOf(u)} is an apprentice right now.`);
      await db.putMentor({user_id: u.id, user_name: nameOf(u), added_by: meId, active: true});
      return {ok: true, name: nameOf(u)};
    }
    case 'mentor.removeMentor': {
      needAdmin();
      const target = uuid(args.userId, 'player');
      const m = await db.getMentor(target);
      if (m) await db.putMentor({...m, active: false});
      // Their apprentices go back to the queue.
      for (const a of await db.apprenticesOf(target)) {
        await db.patchApprentice(a.user_id, {mentor_id: null, mentor_name: null});
        for (const r of await db.reviewsOfApprentice(a.user_id)) if (r.mentor_id === target && r.state !== 'complete')
          await db.patchReview(r.id, {mentor_id: null, mentor_name: null, claimed_at: null, ...(r.state === 'looking' ? {state: 'waiting'} : {})});
      }
      return {ok: true};
    }
    case 'mentor.addApprentice': {
      needAdmin();
      const u = await findPlayer(db, args);
      if ((await db.getMentor(u.id))?.active) fail(409, `${nameOf(u)} is a mentor.`);
      const was = await db.getApprentice(u.id);
      if (was && was.status === 'active') fail(409, `${nameOf(u)} is an apprentice already.`);
      // Only cells from now on: nothing they completed before changes.
      await db.putApprentice({user_id: u.id, user_name: nameOf(u), mentor_id: null, mentor_name: null, status: 'active',
        cells_needed: CELLS_NEEDED, cells_done: 0, started_at: stamp, finished_at: null, added_by: meId});
      await db.notify(u.id, '🧭 Welcome to the mentor program',
        `Your next ${CELLS_NEEDED} cells get a second look from an experienced player. When you complete a cell from the Cell Library, it goes to a mentor, who completes it with you or sends you suggestions. Each one counts for you once your mentor completes it.`, meId);
      return {ok: true, name: nameOf(u)};
    }
    case 'mentor.removeApprentice': {
      needAdmin();
      const target = uuid(args.userId, 'player');
      const a = await db.getApprentice(target);
      if (a && a.status === 'active') await db.patchApprentice(target, {status: 'left', finished_at: stamp});
      return {ok: true};
    }
    default:
      fail(400, `unknown action ${action}`);
  }
}

/** The mentor's notes from a request: points in the view, each with a few
 *  words, and one note for the whole cell. Missing ones keep what was saved. */
function notesFrom(args, before) {
  const out = {};
  if (args.notes !== undefined || !before) {
    const list = Array.isArray(args.notes) ? args.notes : [];
    out.notes = list.slice(0, NOTES_MAX).map((n, i) => ({
      id: clean(n && n.id, 40) || `n${i + 1}`, position: point(n && n.position), text: clean(n && n.text, NOTE_MAX),
    })).filter(n => n.position && n.text);
  } else out.notes = Array.isArray(before.notes) ? before.notes : [];
  out.cell_note = args.cellNote !== undefined ? clean(args.cellNote, CELL_NOTE_MAX) || null : (before ? before.cell_note || null : null);
  return out;
}

async function findPlayer(db, args) {
  if (args.userId) {
    const u = await db.findUser(uuid(args.userId, 'player'));
    if (!u) fail(404, 'No player by that name.');
    return u;
  }
  const name = clean(args.username, 60);
  if (!name) fail(400, 'Which player?');
  const u = await db.findUserByName(name);
  if (!u) fail(404, `No player called ${name}.`);
  return u;
}

/** The reads and writes, over the database's REST interface with the service key. */
function restDb(sb) {
  const enc = encodeURIComponent;
  const one = async p => (await p)[0] || null;
  const post = (path, row, prefer) => sb(path, {method: 'POST', body: JSON.stringify(row), headers: {Prefer: prefer || 'return=representation'}});
  const patch = (path, body) => sb(path, {method: 'PATCH', body: JSON.stringify(body), headers: {Prefer: 'return=representation'}});
  const upsert = (table, conflict, row) => post(`${table}?on_conflict=${conflict}`, row, 'resolution=merge-duplicates,return=representation');
  return {
    getMentor: id => one(sb(`ew_mentors?user_id=eq.${id}&limit=1`)),
    activeMentors: () => sb('ew_mentors?active=eq.true&order=created_at.asc&limit=200'),
    putMentor: row => upsert('ew_mentors', 'user_id', {user_id: row.user_id, user_name: row.user_name, added_by: row.added_by ?? null, active: !!row.active}),
    getApprentice: id => one(sb(`ew_apprentices?user_id=eq.${id}&limit=1`)),
    allApprentices: () => sb('ew_apprentices?order=started_at.desc&limit=200'),
    apprenticesOf: id => sb(`ew_apprentices?mentor_id=eq.${id}`),
    putApprentice: row => upsert('ew_apprentices', 'user_id', row),
    patchApprentice: (id, p) => one(patch(`ew_apprentices?user_id=eq.${id}`, {...p, updated_at: new Date().toISOString()})),
    getReview: id => one(sb(`ew_mentor_reviews?id=eq.${id}&limit=1`)),
    reviewsOfApprentice: id => sb(`ew_mentor_reviews?apprentice_id=eq.${id}&order=sent_at.desc&limit=100`),
    openReviews: () => sb('ew_mentor_reviews?state=in.(waiting,looking,suggestions)&order=sent_at.asc&limit=200'),
    insertReview: row => one(post('ew_mentor_reviews', row)),
    patchReview: (id, p) => one(patch(`ew_mentor_reviews?id=eq.${id}`, p)),
    // True only for the call that moved it from looking (with this mentor) to its new state.
    decideReview: async (id, mentorId, p) => (await patch(`ew_mentor_reviews?id=eq.${id}&state=eq.looking&mentor_id=eq.${mentorId}`, p)).length > 0,
    // An ordinary claim lapses after 30 minutes; one waiting for a mentor must not.
    holdClaim: (taskId, userId) => sb(`task_assignments?task_id=eq.${taskId}&user_id=eq.${userId}&status=eq.active`,
      {method: 'PATCH', body: JSON.stringify({expires_at: 'infinity'}), headers: {Prefer: 'return=minimal'}}),
    // The apprentice's own claim, completed as the game completes any claim.
    completeTask: (userId, taskId, finalSeg, coords) => sb('rpc/pilot_task_action', {method: 'POST',
      body: JSON.stringify({p_user: userId, p_action: 'complete', p_args: {id: taskId, final_segment_id: finalSeg || undefined, soma_coords: coords || undefined}})}),
    findUser: id => one(sb(`users?id=eq.${id}&select=id,username,display_name&limit=1`)),
    findUserByName: name => one(sb(`users?username=ilike.${enc(name.replace(/[%_*,()]/g, ''))}&select=id,username,display_name&limit=1`)),
    award: async (badge, userId, reason) => {
      const b = await one(upsert('special_badges', 'slug', badge));
      if (b) await post('special_badge_awards?on_conflict=badge_id,user_id', {badge_id: b.id, user_id: userId, reason: String(reason).slice(0, 200)}, 'resolution=ignore-duplicates,return=minimal');
    },
    notify: (userId, title, body, by) => post('notifications', {title, body, target_type: 'user', target_id: userId, send_at: new Date().toISOString(), created_by: by || null}, 'return=minimal')
      .catch(e => console.error('[mentors] notification not sent', e && e.message)),
  };
}

/** The same reads and writes held in memory: for the tests and for trying the
 *  game against a stand-in server. */
function memDb(users = []) {
  const s = {mentors: [], apprentices: [], reviews: [], notes: [], awards: [], tasks: new Map(), held: [], n: 0};
  const copy = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const rev = id => s.reviews.find(r => r.id === id);
  const appr = id => s.apprentices.find(a => a.user_id === id);
  return {
    _state: s,
    getMentor: async id => copy(s.mentors.find(m => m.user_id === id) || null),
    activeMentors: async () => copy(s.mentors.filter(m => m.active)),
    putMentor: async row => { const i = s.mentors.findIndex(m => m.user_id === row.user_id); const r = {created_at: new Date().toISOString(), ...(i >= 0 ? s.mentors[i] : {}), ...row}; if (i >= 0) s.mentors[i] = r; else s.mentors.push(r); return copy(r); },
    getApprentice: async id => copy(appr(id) || null),
    allApprentices: async () => copy(s.apprentices),
    apprenticesOf: async id => copy(s.apprentices.filter(a => a.mentor_id === id)),
    putApprentice: async row => { const i = s.apprentices.findIndex(a => a.user_id === row.user_id); if (i >= 0) s.apprentices[i] = {...s.apprentices[i], ...row}; else s.apprentices.push({...row}); return copy(appr(row.user_id)); },
    patchApprentice: async (id, p) => { const a = appr(id); if (a) Object.assign(a, p); return copy(a || null); },
    getReview: async id => copy(rev(id) || null),
    reviewsOfApprentice: async id => copy(s.reviews.filter(r => r.apprentice_id === id).reverse()),
    openReviews: async () => copy(s.reviews.filter(r => OPEN.includes(r.state))),
    insertReview: async row => { const r = {id: ++s.n, sheet_done: false, decided_at: null, cell_note: null, ...row}; s.reviews.push(r); return copy(r); },
    patchReview: async (id, p) => { const r = rev(id); if (r) Object.assign(r, p); return copy(r || null); },
    decideReview: async (id, mentorId, p) => { const r = rev(id); if (!r || r.state !== 'looking' || r.mentor_id !== mentorId) return false; Object.assign(r, p); return true; },
    holdClaim: async (taskId, userId) => { s.held.push({taskId, userId}); },
    completeTask: async (userId, taskId, finalSeg) => {
      const task = s.tasks.get(taskId);
      if (task && task.assigned_to !== userId) throw Object.assign(new Error('Only the current owner can change this claim'), {status: 409});
      s.tasks.set(taskId, {assigned_to: userId, status: 'completed', final_segment_id: finalSeg});
    },
    findUser: async id => copy(users.find(u => u.id === id) || null),
    findUserByName: async name => copy(users.find(u => String(u.username).toLowerCase() === name.toLowerCase()) || null),
    award: async (badge, userId, reason) => { if (!s.awards.some(a => a.slug === badge.slug && a.userId === userId)) s.awards.push({slug: badge.slug, name: badge.name, userId, reason}); },
    notify: async (userId, title, body) => { s.notes.push({to: userId, title, body}); },
  };
}

module.exports = {mentorAction, restDb, memDb, CELLS_NEEDED, MAX_APPRENTICES, OVERDUE_MS, APPRENTICE_BADGE, MENTOR_BADGE};
