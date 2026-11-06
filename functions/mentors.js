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
 * most MAX_APPRENTICES at a time. Anything left 24 hours shows as overdue to
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
 *
 * Practice (Ames 2026-11-05: testers mark themselves as a new player): a
 * player who joins by themself (mentor.join) is a practice apprentice. Their
 * cells go through the whole loop, bells and notes included, but a mentor's
 * Complete records nothing: no CAVE mark, no completion, no sheet row, no
 * Achievement. The claim is let go instead, so the cell is as it was.
 */
const CELLS_NEEDED = 5;
// Ames 2026-11-04: 5, not 2. New players take a while over each cell, and
// meanwhile a mentor can be helping others.
const MAX_APPRENTICES = 5;
// Ames 2026-11-05: "if mentor doesn't answer in 24h it is open".
const OVERDUE_MS = 24 * 3600 * 1000;
const NOTE_MAX = 300;
const CELL_NOTE_MAX = 2000;
const NOTES_MAX = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ['waiting', 'looking', 'suggestions'];

// The two Achievements. Art is a stand in until Ames picks some.
const ART = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/nurro/';
// Ames's art (2026-11-05), pinned to the commits that added it. Names and
// pictures can be changed in Special Badges; the server never writes over them.
const RAW = 'https://raw.githubusercontent.com/seung-lab/ng-extend/';
const APPRENTICE_ART = RAW + 'f4cdbc1d8d2662e8f1b7316ab7e49e8a1c9b6d57/static/mentor/achievement-apprentice.png';
const APPRENTICE_BADGE = {slug: 'mentor-program-apprentice', name: 'Myelinated',
  description: 'Five cells wrapped up with a mentor. Your signals travel on their own now.',
  image_url: APPRENTICE_ART, thumbnail_url: APPRENTICE_ART};
/** The Mentor row (Ames 2026-11-05: a tier at 1, 5, 10, 25 and 50 apprentices
 *  graduated). Same list as src/util/mentor_tiers.ts. */
const tierArt = n => RAW + `4e2fa0fc71d7997feea1ef2e44d8e5011a4ecb23/static/mentor/tiers/mentor-${n}.png`;
const MENTOR_TIERS = [
  {n: 1, name: 'First Wrap', description: 'Saw your first apprentice through the mentor program.'},
  {n: 5, name: 'Myelin Maker', description: 'Five apprentices graduated with you.'},
  {n: 10, name: 'Sheath Shaper', description: 'Ten apprentices graduated with you.'},
  {n: 25, name: 'Saltatory Sensei', description: 'Twenty five apprentices graduated with you. Their signals leap.'},
  {n: 50, name: 'Grand Oligodendrocyte', description: 'Fifty apprentices graduated with you.'},
].map(t => ({...t, slug: `mentor-program-mentor-${t.n}`, image_url: tierArt(t.n), thumbnail_url: tierArt(t.n)}));

/**
 * Every bell the program sends, as a template (Ames 2026-11-05: an Edit
 * button on the bell "so Celia can change it"). {name} is filled in when the
 * bell is sent; `vars` lists the names a text may use. An admin's change is
 * kept in `texts` (Firestore, mentor_texts) and used for every bell after it.
 */
// The program's picture (Ames 2026-11-05: "we need an image"), pinned to the commit that added it.
const MENTOR_PICTURE = 'https://raw.githubusercontent.com/seung-lab/ng-extend/553d8af8606204d3270e8fbb441926866927c049/static/mentor/mentor-bell.jpg';
// The mentor's bells wear the first Mentor tier (Ames's "mentor 1" art).
const MENTOR_ICON = RAW + '4e2fa0fc71d7997feea1ef2e44d8e5011a4ecb23/static/mentor/tiers/mentor-1.png';
const TEXTS = {
  welcome: {label: 'Welcome (added by an admin)', to: 'apprentice', vars: ['needed'], image: MENTOR_PICTURE,
    title: 'Welcome to the mentor program',
    body: 'Your next {needed} cells get a second look from an experienced player. When you complete a cell from the Cell Library, it goes to a mentor, who completes it with you or sends you suggestions. Each one counts for you once your mentor completes it.'},
  practiceWelcome: {label: 'Welcome (practice)', to: 'apprentice', vars: ['needed'], image: MENTOR_PICTURE,
    title: 'Welcome to the mentor program (practice)',
    body: 'Your next {needed} cells go to a mentor when you complete them. This is practice: nothing you complete is recorded, and each cell is let go when your mentor completes it.'},
  newApprentice: {label: 'A new apprentice is waiting', to: 'mentors', vars: ['apprentice'], image: MENTOR_ICON,
    title: 'A new apprentice is waiting for a mentor',
    body: '{apprentice} sent their first cell for a second look. Mentored cells are available in Cell Library → Mentoring.'},
  sent: {label: 'A cell sent to the mentor', to: 'mentor', vars: ['apprentice', 'cell'], image: MENTOR_ICON,
    title: '{apprentice} sent you a cell',
    body: '{apprentice} sent cell {cell} for a second look. Mentored cells are available in Cell Library → Mentoring.'},
  sentAgain: {label: 'A cell sent back after suggestions', to: 'mentor', vars: ['apprentice', 'cell'], image: MENTOR_ICON,
    title: '{apprentice} sent a cell back to you',
    body: '{apprentice} sent cell {cell} for a second look. Mentored cells are available in Cell Library → Mentoring.'},
  haveMentor: {label: 'You have a mentor', to: 'apprentice', vars: ['mentor', 'needed'], image: MENTOR_PICTURE,
    title: 'You have a mentor',
    body: '{mentor} is your mentor. They will look at your first {needed} cells and give you feedback before each one counts.'},
  suggestions: {label: 'Suggestions', to: 'apprentice', vars: ['mentor', 'cell'], image: MENTOR_ICON,
    title: 'Your mentor has suggestions',
    body: '{mentor} left suggestions on cell {cell}. See them in the view. When you are done, send it again. Mentored cells are available in Cell Library → Mentoring.'},
  complete: {label: 'Cell complete', to: 'apprentice', vars: ['mentor', 'cell', 'done', 'needed'], image: MENTOR_ICON,
    title: '🎉 Your cell is complete',
    body: '{mentor} completed cell {cell} with you. It counts for you. {done} of {needed} mentor cells done.'},
  practiceComplete: {label: 'Cell complete (practice)', to: 'apprentice', vars: ['mentor', 'cell', 'done', 'needed'], image: MENTOR_ICON,
    title: '🎉 Your cell is complete (practice)',
    body: '{mentor} completed cell {cell} with you. This was practice, so nothing was recorded and the cell is free again. {done} of {needed} mentor cells done.'},
  // The two Achievement bells keep the form the game celebrates (src/util/award_title.ts): a title
  // starting "New Achievement:" and a text starting 'You earned the "<name>" Achievement!'.
  apprenticeAchievement: {label: 'Apprentice graduate Achievement (keep "New Achievement:" so it celebrates)', to: 'apprentice', vars: ['mentor', 'achievement'],
    title: 'New Achievement: {achievement}',
    body: 'You earned the "{achievement}" Achievement! You finished the mentor program with {mentor}. From now on your cells count the moment you complete them.'},
  practiceFinished: {label: 'Practice finished', to: 'apprentice', vars: ['mentor'], image: MENTOR_ICON,
    title: '🏆 Practice finished',
    body: 'You finished the practice mentor program with {mentor}. In the real program this is when the Apprentice Achievement comes.'},
  mentorAchievement: {label: 'Mentor Achievement tier (keep "New Achievement:" so it celebrates)', to: 'mentor', vars: ['apprentice', 'achievement', 'graduates'],
    title: 'New Achievement: {achievement}',
    body: 'You earned the "{achievement}" Achievement! {apprentice} finished the mentor program with you.\nApprentices that graduated with you: {graduates}'},
  mentorFinishedAgain: {label: 'Another apprentice finished', to: 'mentor', vars: ['apprentice', 'graduates'], image: MENTOR_ICON,
    title: '{apprentice} finished the mentor program',
    body: '{apprentice} finished the mentor program with you. Thank you for mentoring.\nApprentices that graduated with you: {graduates}'},
};
const TITLE_MAX = 120;
const BODY_MAX = 1500;
const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const nameOf = u => String((u && (u.username || u.display_name)) || 'Player').slice(0, 40);
const uuid = (v, what) => { const s = String(v || ''); if (!UUID.test(s)) fail(400, `Bad ${what}.`); return s.toLowerCase(); };
const posInt = (v, what) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) fail(400, `Bad ${what}.`); return n; };
const segId = v => (/^\d{1,24}$/.test(String(v || '')) ? String(v) : '');
const short = id => (id ? `...${String(id).slice(-4)}` : 'a cell');
const point = v => (Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(Number(n))) ? v.map(Number) : null);
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
// The whole cell ID in a bell (Ames 2026-11-05: "can you put the whole cell ID?").
const cellName = r => String(r.root_id || r.segment_id || 'a cell');

/** A cell's conversation (Ames 2026-11-06, after Marissa answered a pin in
 *  her own annotation layer and it never reached the mentor): replies under
 *  a mentor's pins (noteId) and messages on the whole cell. A reply is the
 *  writer's own until they hand the cell over (Send to Mentor, Send
 *  suggestions, Complete); then it is sent and the other side sees it. */
const REPLY_MAX = 1000;
const THREAD_MAX = 200;
const threadOf = r => (Array.isArray(r.thread) ? r.thread : []);
/** Which side a player writes on now: the apprentice while the cell is back
 *  with them, the mentor while they are looking at it. */
function sideOf(r, meId) {
  if (r.state === 'suggestions' && r.apprentice_id === meId) return 'apprentice';
  if (r.state === 'looking' && r.mentor_id === meId) return 'mentor';
  return null;
}
/** One side hands the cell over: its replies are sent, and a note for the
 *  whole cell (the Complete form's, or the mentor's) joins the thread. */
function handOver(r, by, name, round, text, stamp) {
  const t = threadOf(r).map(m => (m.by === by && !m.sent ? {...m, sent: true, round} : m));
  if (text) t.push({id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, by, name, text, at: stamp, round, noteId: null, sent: true});
  return t.slice(-THREAD_MAX);
}

/** What a review looks like to a browser. The viewer sees what was sent,
 *  and their own replies not sent yet. */
function reviewOut(r, viewerId) {
  const own = m => (m.by === 'apprentice' ? r.apprentice_id : r.mentor_id) === viewerId;
  return {
    id: r.id, state: r.state, rounds: r.rounds || 1,
    apprenticeId: r.apprentice_id, apprenticeName: r.apprentice_name, mentorId: r.mentor_id || null, mentorName: r.mentor_name || null,
    dataset: r.dataset, logDataset: r.log_dataset || r.dataset, taskId: r.task_id, segmentId: r.segment_id || '', rootId: r.root_id || '',
    position: r.position || null, link: r.link || '', done: r.done || {},
    notes: Array.isArray(r.notes) ? r.notes : [], cellNote: r.cell_note || '',
    thread: threadOf(r).filter(m => m.sent || own(m)),
    sentAt: r.sent_at, claimedAt: r.claimed_at || null, decidedAt: r.decided_at || null, touchedAt: r.touched_at || r.sent_at,
    sheetDone: !!r.sheet_done,
  };
}
/** Joined by themself (mentor.join): a practice apprentice. mentor.join is
 *  the only way in with no added_by; an admin always leaves their id. */
const isPractice = a => !!a && !a.added_by;
const apprenticeOut = a => a && ({
  id: a.user_id, name: a.user_name, status: a.status, practice: isPractice(a), mentorId: a.mentor_id || null, mentorName: a.mentor_name || null,
  cellsDone: a.cells_done || 0, cellsNeeded: a.cells_needed || CELLS_NEEDED, startedAt: a.started_at, finishedAt: a.finished_at || null,
});

/** Left alone too long: (ms since it was last touched) > 48 h. */
const idleFor = (r, now) => now - Date.parse(r.touched_at || r.sent_at || 0);

async function mentorAction(action, args, {db, me, isAdmin = false, credit, now = new Date(), texts = null}) {
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
  // Admins' changes to the texts, read once per request and only if a bell is sent.
  let edited = null;
  const textOf = async key => {
    if (edited === null) { try { edited = (texts && (await texts.all())) || {}; } catch (e) { edited = {}; } }
    const t = edited[key] || {};
    return {title: t.title || TEXTS[key].title, body: t.body || TEXTS[key].body};
  };
  const bell = async (to, key, vars, image) => { const t = await textOf(key); await db.notify(to, fill(t.title, vars), fill(t.body, vars), meId, image || TEXTS[key].image); };

  /** A mentor's cell left 24 hours (taken and not answered, or theirs and
   *  never opened) goes back to the queue,
   *  and so does the apprentice, so another mentor can take them. Done on
   *  read, so nothing has to run on a timer. */
  async function returnIdle(reviews) {
    for (const r of reviews) {
      if (!r.mentor_id || (r.state !== 'looking' && r.state !== 'waiting') || idleFor(r, t) <= OVERDUE_MS) continue;
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
  /** Cells nobody has taken, as this mentor may take them: a cell from an
   *  apprentice who has a mentor shows only to that mentor (and admins). */
  const waitingForMe = async open => {
    const mentorOf = new Map((await db.allApprentices()).filter(a => a.status === 'active').map(a => [a.user_id, a.mentor_id]));
    return open.filter(r => r.state === 'waiting' && !r.mentor_id && (isAdmin || !mentorOf.get(r.apprentice_id) || mentorOf.get(r.apprentice_id) === meId));
  };
  const slotsUsed = async () => (await db.apprenticesOf(meId)).filter(a => a.status === 'active').length;

  switch (action) {
    case 'mentor.status': {
      const a = await db.getApprentice(meId);
      const out = {installed: true, admin: !!isAdmin, mentor: isMentor, apprentice: apprenticeOut(a), cellsNeeded: CELLS_NEEDED, maxApprentices: MAX_APPRENTICES};
      // The apprentice's own cells, every state, for the Mentoring tab and My Cells.
      out.mine = a ? (await db.reviewsOfApprentice(meId)).map(r => reviewOut(r, meId)) : [];
      if (mayReview) {
        const open = await returnIdle(await db.openReviews());
        out.waiting = (await waitingForMe(open)).length;
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
      const done = {status: clean(d.status, 80), notes: clean(d.notes, 2000), cellType: clean(d.cellType, 120), coords: clean(d.coords, 200),
        ...(isPractice(a) ? {practice: true} : {})};
      const fields = {dataset, log_dataset: logDataset, segment_id: segId(args.segmentId) || null, root_id: rootId,
        position: point(args.position), link: /^https:\/\/\S{1,2000}$/.test(String(args.link || '')) ? String(args.link) : null, done, touched_at: stamp};
      const mine = await db.reviewsOfApprentice(meId);
      const again = mine.find(r => r.task_id === taskId && OPEN.includes(r.state));
      if (again && again.state !== 'suggestions') fail(409, 'This cell is already with a mentor.');
      const openCount = mine.filter(r => OPEN.includes(r.state) && r !== again).length;
      if (!again && (a.cells_done || 0) + openCount >= (a.cells_needed || CELLS_NEEDED))
        fail(409, `All of your ${a.cells_needed || CELLS_NEEDED} mentor cells are sent. Complete this one as usual: it counts right away.`);
      // Keep the claim while it waits: an ordinary claim lapses after 30 minutes.
      await db.holdClaim(taskId, meId);
      let r;
      if (again) {
        // Sent again after suggestions: straight back to the same mentor.
        const round = (again.rounds || 1) + 1;
        r = await db.patchReview(again.id, {...fields, state: again.mentor_id ? 'looking' : 'waiting', rounds: round, sent_at: stamp, decided_at: null,
          thread: handOver(again, 'apprentice', nameOf(me), round, done.notes, stamp)});
      } else {
        r = await db.insertReview({...fields, apprentice_id: meId, apprentice_name: nameOf(me), task_id: taskId,
          mentor_id: a.mentor_id || null, mentor_name: a.mentor_name || null, state: a.mentor_id ? 'looking' : 'waiting', rounds: 1, notes: [], sent_at: stamp,
          thread: handOver({}, 'apprentice', nameOf(me), 1, done.notes, stamp),
          claimed_at: a.mentor_id ? stamp : null});
      }
      const who = nameOf(me);
      if (r.mentor_id) {
        await bell(r.mentor_id, again ? 'sentAgain' : 'sent', {apprentice: who, cell: cellName(r)});
      } else if (!mine.length && !isAdmin) {
        // A new apprentice's first cell: one bell to each mentor with room. Never one per cell.
        // An admin apprentice is a test (Ames 2026-11-04: no test players yet): nobody is rung.
        for (const m of await db.activeMentors()) {
          if (m.user_id === meId) continue;
          if ((await db.apprenticesOf(m.user_id)).filter(x => x.status === 'active').length >= MAX_APPRENTICES) continue;
          await bell(m.user_id, 'newApprentice', {apprentice: who});
        }
      }
      return {review: reviewOut(r, meId), apprentice: apprenticeOut(await db.getApprentice(meId))};
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
        waiting: (await waitingForMe(open)).map(r => reviewOut(r, meId)),
        yours: open.filter(r => r.mentor_id === meId).map(r => reviewOut(r, meId)),
        apprentices: mineA.map(apprenticeOut),
        slots: {used: mineA.length, max: MAX_APPRENTICES},
        mentor: isMentor, admin: !!isAdmin,
        cellsReviewed: await db.countMentorCompletes(meId),
      };
    }
    // A mentor's numbers for their Trophy Case (Ames 2026-11-05: "cells reviewed
    // count"): cells they completed for apprentices, and apprentices graduated.
    // Anyone signed in may ask, as anyone may see a Trophy Case.
    case 'mentor.stats': {
      const target = uuid(args.userId, 'player');
      const graduates = (await db.apprenticesOf(target)).filter(a => a.status === 'finished' && a.user_id !== target).length;
      return {cellsReviewed: await db.countMentorCompletes(target), graduates};
    }
    // Every cell of one apprentice, for the admins' read only view (Ames
    // 2026-11-05: admins may read mentor and apprentice notes).
    case 'mentor.cellsOf': {
      needAdmin();
      const target = uuid(args.apprenticeId, 'player');
      return (await db.reviewsOfApprentice(target)).map(r => reviewOut(r, meId));
    }
    case 'mentor.review': {
      const r = await loadReview(args.reviewId);
      if (r.apprentice_id !== meId && r.mentor_id !== meId && !mayReview) fail(403, 'Not your cell.');
      return reviewOut(r, meId);
    }
    case 'mentor.byCell': {
      // The cell a program bell is about, found by the last digits of its id
      // (Ames 2026-11-05: "needs jump button", a completed cell too). Only the
      // player's own cells, as apprentice or as mentor, or any for an admin.
      const tail = String(args.tail || '');
      if (!/^\d{4}$/.test(tail)) fail(400, 'Which cell?');
      const hit = r => [r.root_id, r.segment_id].some(id => !!id && String(id).endsWith(tail));
      const mine = [...(await db.reviewsOfApprentice(meId)), ...(await db.reviewsOfMentor(meId))];
      const r = mine.find(hit) || (isAdmin ? (await db.openReviews()).find(hit) : null);
      if (!r) return null;
      return {review: reviewOut(r, meId), role: r.mentor_id === meId ? 'mentor' : r.apprentice_id === meId ? 'apprentice' : 'mentor'};
    }
    case 'mentor.claim': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      // An admin may take their own cell, to try both sides alone (Ames 2026-11-04).
      if (r.apprentice_id === meId && !isAdmin) fail(409, 'A mentor looks at your cell, not you.');
      if (r.state === 'complete') fail(409, 'That cell is complete already.');
      if (r.state === 'suggestions') fail(409, 'That cell is back with the apprentice.');
      if (r.mentor_id && r.mentor_id !== meId) {
        if (!isAdmin) fail(409, `${r.mentor_name || 'Another mentor'} is looking at this cell.`);
      }
      const a = await db.getApprentice(r.apprentice_id);
      // One mentor per apprentice (Ames 2026-11-05: "it let multiple ppl be my
      // mentor"): a cell sent before they had one is theirs too. An admin may still step in.
      if (a && a.status === 'active' && a.mentor_id && a.mentor_id !== meId && !isAdmin)
        fail(409, `${a.mentor_name || 'Another mentor'} is this player's mentor.`);
      if (isMentor && a && a.status === 'active' && !a.mentor_id) {
        if ((await slotsUsed()) >= MAX_APPRENTICES) fail(409, `You are mentoring ${MAX_APPRENTICES} players already. Finish with one first, or hand one back.`);
        await db.patchApprentice(a.user_id, {mentor_id: meId, mentor_name: nameOf(me)});
        // Their other cells still waiting come with them.
        for (const o of await db.reviewsOfApprentice(a.user_id))
          if (o.id !== r.id && o.state === 'waiting' && !o.mentor_id) await db.patchReview(o.id, {mentor_id: meId, mentor_name: nameOf(me)});
        await bell(a.user_id, 'haveMentor', {mentor: nameOf(me), needed: a.cells_needed || CELLS_NEEDED});
      }
      const out = await db.patchReview(r.id, {mentor_id: meId, mentor_name: nameOf(me), state: 'looking', claimed_at: r.claimed_at || stamp, touched_at: stamp});
      return reviewOut(out, meId);
    }
    case 'mentor.reply': {
      const r = await loadReview(args.reviewId);
      const by = sideOf(r, meId);
      if (!by) fail(409, r.state === 'complete' ? 'That cell is complete already.' : 'It is the other side\'s turn on this cell.');
      const text = clean(args.text, REPLY_MAX);
      if (!text) fail(400, 'Write a reply first.');
      const noteId = args.noteId ? clean(args.noteId, 40) : null;
      if (noteId && !(Array.isArray(r.notes) ? r.notes : []).some(n => n.id === noteId)) fail(404, 'That note is gone.');
      const t = threadOf(r);
      if (t.length >= THREAD_MAX) fail(409, 'This cell has as many replies as it can hold.');
      const m = {id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, by, name: nameOf(me), text, at: stamp, round: r.rounds || 1, noteId, sent: false};
      return reviewOut(await db.patchReview(r.id, {thread: [...t, m], touched_at: stamp}), meId);
    }
    case 'mentor.unreply': {
      const r = await loadReview(args.reviewId);
      const by = sideOf(r, meId);
      const id = clean(args.id, 40);
      const t = threadOf(r);
      if (!by || !t.some(m => m.id === id && m.by === by && !m.sent)) fail(409, 'Only a reply not sent yet can be taken back.');
      return reviewOut(await db.patchReview(r.id, {thread: t.filter(m => m.id !== id)}), meId);
    }
    case 'mentor.saveNotes': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.mentor_id !== meId) fail(403, 'Take a look at this cell first.');
      if (r.state !== 'looking') fail(409, r.state === 'complete' ? 'That cell is complete already.' : 'That cell is back with the apprentice.');
      const out = await db.patchReview(r.id, {...notesFrom(args), touched_at: stamp});
      return reviewOut(out, meId);
    }
    case 'mentor.suggest': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.mentor_id !== meId) fail(403, 'Take a look at this cell first.');
      if (r.state !== 'looking') fail(409, 'That cell is not waiting for you.');
      const n = notesFrom(args, r);
      const replies = threadOf(r).some(m => m.by === 'mentor' && !m.sent);
      if (!n.notes.length && !n.cell_note && !replies) fail(400, 'Leave at least one suggestion, as a note in the view or for the whole cell.');
      const thread = handOver(r, 'mentor', nameOf(me), r.rounds || 1, n.cell_note, stamp);
      const out = await db.patchReview(r.id, {...n, cell_note: null, thread, state: 'suggestions', decided_at: stamp, touched_at: stamp});
      await bell(r.apprentice_id, 'suggestions', {mentor: nameOf(me), cell: cellName(r)});
      return reviewOut(out, meId);
    }
    case 'mentor.complete': {
      needReviewer();
      const r = await loadReview(args.reviewId);
      if (r.mentor_id !== meId) fail(403, 'Take a look at this cell first.');
      const n0 = args.notes !== undefined || args.cellNote !== undefined ? notesFrom(args, r) : {};
      const n = {...n0, cell_note: null, thread: handOver(r, 'mentor', nameOf(me), r.rounds || 1, n0.cell_note !== undefined ? n0.cell_note : r.cell_note, stamp)};
      // Only the call that moves it from looking to complete goes on: a
      // second press changes nothing and credits nothing.
      const won = await db.decideReview(r.id, meId, {...n, state: 'complete', decided_at: stamp, touched_at: stamp});
      if (!won) fail(409, 'That cell is not waiting for you.');
      const finalSeg = segId(args.root) || r.root_id;
      const practice = !!(r.done && r.done.practice);
      if (practice) {
        // Practice: nothing is recorded. The claim is let go, so the cell is
        // as it was before the test; the count moves so the loop can end.
        await db.releaseClaim(r.apprentice_id, r.task_id).catch(e => console.warn('[mentors] practice claim not let go', e && e.message));
        const a = await db.getApprentice(r.apprentice_id);
        const doneCount = ((a && a.cells_done) || 0) + 1;
        const needed = (a && a.cells_needed) || CELLS_NEEDED;
        const finished = !!a && a.status === 'active' && doneCount >= needed;
        if (a) await db.patchApprentice(a.user_id, {cells_done: doneCount, ...(finished ? {status: 'finished', finished_at: stamp} : {})});
        await bell(r.apprentice_id, 'practiceComplete', {mentor: nameOf(me), cell: cellName(r), done: Math.min(doneCount, needed), needed});
        if (finished) await bell(r.apprentice_id, 'practiceFinished', {mentor: nameOf(me)});
        return {review: reviewOut(await db.getReview(r.id), meId), finished, practice: true};
      }
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
      await bell(r.apprentice_id, 'complete', {mentor: nameOf(me), cell: cellName(r), done: Math.min(doneCount, needed), needed});
      if (finished) {
        // The picture is the Achievement's own (an admin may change it in Special Badges).
        const won = await db.award(APPRENTICE_BADGE, r.apprentice_id, `Finished the mentor program with ${nameOf(me)}`);
        // In the form the game celebrates: the unlock card and confetti (Ames 2026-11-05).
        await bell(r.apprentice_id, 'apprenticeAchievement', {mentor: nameOf(me), achievement: won.name}, won.image);
        if (a.mentor_id && a.mentor_id !== a.user_id) {
          // The Mentor row (Ames 2026-11-05): a tier at 1, 5, 10, 25 and 50
          // graduates. Every tier reached and not yet held is awarded; the
          // highest new one is celebrated, and a graduate that reaches no new
          // tier gets a plain bell.
          const graduates = (await db.apprenticesOf(a.mentor_id)).filter(x => x.status === 'finished').length;
          let top = null;
          for (const t of MENTOR_TIERS.filter(x => x.n <= graduates)) {
            const got = await db.award(t, a.mentor_id, `${t.n} apprentice${t.n === 1 ? '' : 's'} graduated`);
            if (got.first) top = got;
          }
          if (top) await bell(a.mentor_id, 'mentorAchievement', {apprentice: a.user_name, achievement: top.name, graduates}, top.image);
          else await bell(a.mentor_id, 'mentorFinishedAgain', {apprentice: a.user_name, graduates});
        }
      }
      return {review: reviewOut(await db.getReview(r.id), meId), finished};
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

    // ── Practice: a player marks themself as a new player ───────────────
    case 'mentor.join': {
      if (isMentor && !isAdmin) fail(409, 'You are a mentor. An admin can take you off the mentor list first.');
      const was = await db.getApprentice(meId);
      if (was && was.status === 'active') fail(409, 'You are in the mentor program already.');
      await db.putApprentice({user_id: meId, user_name: nameOf(me), mentor_id: null, mentor_name: null, status: 'active',
        cells_needed: CELLS_NEEDED, cells_done: 0, started_at: stamp, finished_at: null, added_by: null});
      await bell(meId, 'practiceWelcome', {needed: CELLS_NEEDED});
      return {ok: true, apprentice: apprenticeOut(await db.getApprentice(meId))};
    }
    case 'mentor.leave': {
      const a = await db.getApprentice(meId);
      if (!a || a.status !== 'active') fail(409, 'You are not in the mentor program.');
      if (!isPractice(a)) fail(403, 'An admin added you. Ask an admin to take you out.');
      await db.patchApprentice(meId, {status: 'left', finished_at: stamp});
      return {ok: true};
    }

    // ── The texts of the bells (admins) ─────────────────────────────────
    case 'mentor.texts': {
      needAdmin();
      const saved = (texts && (await texts.all())) || {};
      return Object.entries(TEXTS).map(([key, d]) => ({key, label: d.label, to: d.to, vars: d.vars,
        title: (saved[key] && saved[key].title) || d.title, body: (saved[key] && saved[key].body) || d.body,
        defaultTitle: d.title, defaultBody: d.body, edited: !!saved[key], editedBy: (saved[key] && saved[key].by) || null}));
    }
    case 'mentor.setText': {
      needAdmin();
      if (!texts) fail(503, 'The texts cannot be saved here.');
      const key = String(args.key || '');
      const d = TEXTS[key];
      if (!d) fail(400, 'Unknown message.');
      const title = clean(args.title, TITLE_MAX + 1), body = clean(args.body, BODY_MAX + 1);
      // Both back to the original: the change is forgotten.
      if ((!title || title === d.title) && (!body || body === d.body)) { await texts.set(key, null); return {key, title: d.title, body: d.body, edited: false}; }
      if (!title) fail(400, 'The title cannot be empty.');
      if (!body) fail(400, 'The text cannot be empty.');
      if (title.length > TITLE_MAX) fail(400, `The title can be at most ${TITLE_MAX} characters.`);
      if (body.length > BODY_MAX) fail(400, `The text can be at most ${BODY_MAX} characters.`);
      const unknown = [...new Set([...`${title} ${body}`.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].filter(k => !d.vars.includes(k));
      if (unknown.length) fail(400, `This message cannot use {${unknown[0]}}. It can use ${d.vars.map(v => `{${v}}`).join(', ')}.`);
      await texts.set(key, {title, body, by: nameOf(me), at: stamp});
      return {key, title, body, edited: true};
    }

    // ── Admins ──────────────────────────────────────────────────────────
    case 'mentor.admin': {
      needAdmin();
      const open = await returnIdle(await db.openReviews());
      return {
        mentors: (await db.activeMentors()).map(m => ({id: m.user_id, name: m.user_name})),
        apprentices: (await db.allApprentices()).map(apprenticeOut),
        overdue: open.filter(r => r.state !== 'suggestions' && idleFor(r, t) > OVERDUE_MS).map(r => reviewOut(r, meId)),
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
      await bell(u.id, 'welcome', {needed: CELLS_NEEDED});
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
    reviewsOfMentor: id => sb(`ew_mentor_reviews?mentor_id=eq.${id}&order=sent_at.desc&limit=100`),
    // Cells this mentor completed (each review row is one cell).
    countMentorCompletes: async id => (await sb(`ew_mentor_reviews?mentor_id=eq.${id}&state=eq.complete&select=id&limit=100000`)).length,
    openReviews: () => sb('ew_mentor_reviews?state=in.(waiting,looking,suggestions)&order=sent_at.asc&limit=200'),
    insertReview: row => one(post('ew_mentor_reviews', row)),
    patchReview: (id, p) => one(patch(`ew_mentor_reviews?id=eq.${id}`, p)),
    // True only for the call that moved it from looking (with this mentor) to its new state.
    decideReview: async (id, mentorId, p) => (await patch(`ew_mentor_reviews?id=eq.${id}&state=eq.looking&mentor_id=eq.${mentorId}`, p)).length > 0,
    // An ordinary claim lapses after 30 minutes; one waiting for a mentor must not.
    holdClaim: (taskId, userId) => sb(`task_assignments?task_id=eq.${taskId}&user_id=eq.${userId}&status=eq.active`,
      {method: 'PATCH', body: JSON.stringify({expires_at: 'infinity'}), headers: {Prefer: 'return=minimal'}}),
    // A practice cell: the apprentice's claim let go, as Release does.
    releaseClaim: (userId, taskId) => sb('rpc/pilot_task_action', {method: 'POST',
      body: JSON.stringify({p_user: userId, p_action: 'release', p_args: {id: taskId}})}),
    // The apprentice's own claim, completed as the game completes any claim.
    completeTask: (userId, taskId, finalSeg, coords) => sb('rpc/pilot_task_action', {method: 'POST',
      body: JSON.stringify({p_user: userId, p_action: 'complete', p_args: {id: taskId, final_segment_id: finalSeg || undefined, soma_coords: coords || undefined}})}),
    findUser: id => one(sb(`users?id=eq.${id}&select=id,username,display_name&limit=1`)),
    // Case is ignored, nothing else: "_" is kept (it was stripped, so m_sorek
    // was looked for as msorek, Ames 2026-11-05), and as "_" also matches any
    // one letter in ilike, only an exact name is taken from what comes back.
    findUserByName: async name => {
      const want = String(name).trim().toLowerCase();
      if (!want || /[%*,()"\\]/.test(want)) return null;
      const rows = await sb(`users?username=ilike.${enc(want)}&select=id,username,display_name&limit=10`);
      return (rows || []).find(u => String(u.username || '').toLowerCase() === want) || null;
    },
    // {first, image}: whether this player had it before, and the Achievement's
    // picture. The Achievement is made only if it is missing, so a name or
    // picture an admin set in Special Badges is never written over.
    award: async (badge, userId, reason) => {
      const bySlug = () => one(sb(`special_badges?slug=eq.${enc(badge.slug)}&select=id,name,image_url,thumbnail_url&limit=1`));
      let b = await bySlug();
      const row = {slug: badge.slug, name: badge.name, description: badge.description, image_url: badge.image_url, thumbnail_url: badge.thumbnail_url};
      if (!b) { await post('special_badges?on_conflict=slug', row, 'resolution=ignore-duplicates,return=minimal'); b = await bySlug(); }
      if (!b) return {first: false, image: badge.image_url, name: badge.name};
      // Only a row that was not there before comes back.
      const rows = await post('special_badge_awards?on_conflict=badge_id,user_id', {badge_id: b.id, user_id: userId, reason: String(reason).slice(0, 200)}, 'resolution=ignore-duplicates,return=representation');
      return {first: Array.isArray(rows) && rows.length > 0, image: b.image_url || b.thumbnail_url || badge.image_url, name: b.name || badge.name};
    },
    setAwardReason: async (badge, userId, reason) => {
      const b = await one(sb(`special_badges?slug=eq.${enc(badge.slug)}&select=id&limit=1`));
      if (b) await sb(`special_badge_awards?badge_id=eq.${b.id}&user_id=eq.${userId}`, {method: 'PATCH', body: JSON.stringify({reason: String(reason).slice(0, 200)}), headers: {Prefer: 'return=minimal'}});
    },
    notify: (userId, title, body, by, image) => post('notifications', {title, body, target_type: 'user', target_id: userId, send_at: new Date().toISOString(), created_by: by || null,
      ...(image ? {image_url: image, thumbnail_url: image} : {})}, 'return=minimal')
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
    reviewsOfMentor: async id => copy(s.reviews.filter(r => r.mentor_id === id).reverse()),
    countMentorCompletes: async id => s.reviews.filter(r => r.mentor_id === id && r.state === 'complete').length,
    openReviews: async () => copy(s.reviews.filter(r => OPEN.includes(r.state))),
    insertReview: async row => { const r = {id: ++s.n, sheet_done: false, decided_at: null, cell_note: null, thread: [], ...row}; s.reviews.push(r); return copy(r); },
    patchReview: async (id, p) => { const r = rev(id); if (r) Object.assign(r, p); return copy(r || null); },
    decideReview: async (id, mentorId, p) => { const r = rev(id); if (!r || r.state !== 'looking' || r.mentor_id !== mentorId) return false; Object.assign(r, p); return true; },
    holdClaim: async (taskId, userId) => { s.held.push({taskId, userId}); },
    releaseClaim: async (userId, taskId) => { s.released = (s.released || []).concat({taskId, userId}); },
    completeTask: async (userId, taskId, finalSeg) => {
      const task = s.tasks.get(taskId);
      if (task && task.assigned_to !== userId) throw Object.assign(new Error('Only the current owner can change this claim'), {status: 409});
      s.tasks.set(taskId, {assigned_to: userId, status: 'completed', final_segment_id: finalSeg});
    },
    findUser: async id => copy(users.find(u => u.id === id) || null),
    findUserByName: async name => copy(users.find(u => String(u.username).toLowerCase() === name.toLowerCase()) || null),
    award: async (badge, userId, reason) => {
      const image = (s.badgeArt && s.badgeArt[badge.slug]) || badge.image_url;
      if (s.awards.some(a => a.slug === badge.slug && a.userId === userId)) return {first: false, image, name: badge.name};
      s.awards.push({slug: badge.slug, name: badge.name, userId, reason}); return {first: true, image, name: badge.name};
    },
    setAwardReason: async (badge, userId, reason) => { const a = s.awards.find(x => x.slug === badge.slug && x.userId === userId); if (a) a.reason = reason; },
    notify: async (userId, title, body, by, image) => { s.notes.push({to: userId, title, body, ...(image ? {image} : {})}); },
  };
}

/** The texts held in memory: for the tests and the stand-in server. */
function memTexts() {
  const m = {};
  return {_m: m, all: async () => JSON.parse(JSON.stringify(m)), set: async (k, v) => { if (v) m[k] = v; else delete m[k]; }};
}

module.exports = {mentorAction, restDb, memDb, memTexts, TEXTS, MENTOR_TIERS, CELLS_NEEDED, MAX_APPRENTICES, OVERDUE_MS, APPRENTICE_BADGE};
