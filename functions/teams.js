'use strict';
/**
 * Saved teams (supabase-teams.sql): two to four players on one cell, whenever
 * each of them can. Every rule about who may see or do what is here, on the
 * server; the browser only asks.
 *
 * teamAction(action, args, {db, me, credit}) is the whole surface. `db` is a
 * small set of reads and writes (restDb below, over the service key; the
 * tests pass one that lives in memory). `credit(userId, row)` records a
 * completion for a member the way the game records any completion.
 *
 * What a player is ever handed: the teams they are on, the invitations sent
 * to them, and active teams that are open to join. An invitation is between
 * the two people it concerns: a decline simply removes it.
 */
const TEAM_MAX = 4;
const MSG_MAX = 240;
const MAX_LAYERS = 24;
const MAX_ANNS_PER_LAYER = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const nameOf = u => String((u && (u.username || u.display_name)) || 'Player').slice(0, 40);
const uuid = (v, what) => { const s = String(v || ''); if (!UUID.test(s)) fail(400, `Bad ${what}.`); return s.toLowerCase(); };

/** What a member row looks like to the browser. */
const memberOut = m => ({id: m.user_id, name: m.user_name, state: m.state, partDone: !!m.part_done});
function teamOut(team, members, meId) {
  const mine = members.find(m => m.user_id === meId);
  const joined = mine && mine.state === 'joined';
  return {
    id: team.id, dataset: team.dataset, taskId: team.task_id ?? null, segmentId: team.segment_id || '', anchor: team.anchor || null,
    title: team.title || '', ownerId: team.owner_id, open: !!team.is_open, status: team.status,
    completedBy: team.completed_by || null, completedAt: team.completed_at || null, completedRoot: team.completed_root || null, createdAt: team.created_at,
    mine: mine ? mine.state : null, celebrate: !!(mine && mine.celebrate),
    // Someone who is not on the team yet sees who is on it, not who else was asked.
    members: members.filter(m => joined || m.state === 'joined' || m.user_id === meId).map(memberOut),
  };
}

async function load(db, id, meId, {mustBeJoined = true} = {}) {
  const team = await db.getTeam(uuid(id, 'team'));
  if (!team) fail(404, 'That team no longer exists.');
  const members = await db.membersOf(team.id);
  const mine = members.find(m => m.user_id === meId) || null;
  if (mustBeJoined && (!mine || mine.state !== 'joined')) fail(403, 'You are not on that team.');
  return {team, members, mine};
}
const active = team => { if (team.status !== 'active') fail(409, 'That team has finished.'); };
const spaceLeft = members => TEAM_MAX - members.length;

async function teamAction(action, args, {db, me, credit}) {
  if (!me || !me.id) fail(403, 'No EyeWire II profile.');
  const meId = String(me.id).toLowerCase();
  switch (action) {
    case 'team.list': {
      const rows = await db.memberRowsOf(meId);
      const mineTeams = await db.getTeams(rows.map(r => r.team_id));
      const all = await db.membersOfMany(mineTeams.map(t => t.id));
      const teams = mineTeams
        // A finished team stays in the list until its celebration has been seen.
        .filter(t => t.status === 'active' || (t.status === 'completed' && rows.some(r => r.team_id === t.id && r.celebrate)))
        .map(t => teamOut(t, all.filter(m => m.team_id === t.id), meId));
      const openTeams = (await db.openTeams()).filter(t => !rows.some(r => r.team_id === t.id));
      const openMembers = await db.membersOfMany(openTeams.map(t => t.id));
      const open = openTeams.map(t => ({t, m: openMembers.filter(x => x.team_id === t.id)}))
        .filter(x => spaceLeft(x.m) > 0).map(x => teamOut(x.t, x.m, meId));
      return {teams, open, max: TEAM_MAX};
    }
    case 'team.create': {
      const dataset = String(args.dataset || '').slice(0, 80);
      if (!dataset) fail(400, 'Which dataset is the cell in?');
      const taskId = args.taskId == null || args.taskId === '' ? null : Number(args.taskId);
      if (taskId != null && !Number.isSafeInteger(taskId)) fail(400, 'Bad claim.');
      const segmentId = /^\d{1,24}$/.test(String(args.segmentId || '')) ? String(args.segmentId) : '';
      const anchor = Array.isArray(args.anchor) && args.anchor.length === 3 && args.anchor.every(n => Number.isFinite(Number(n))) ? args.anchor.map(Number) : null;
      if (!segmentId && !anchor) fail(400, 'Open the cell first, so the team knows which one it is.');
      if (taskId != null) {
        // One team per claimed cell.
        const there = (await db.teamsOnTask(taskId, dataset)).find(t => t.status === 'active');
        if (there) {
          const m = await db.membersOf(there.id);
          if (m.some(x => x.user_id === meId && x.state === 'joined')) return teamOut(there, m, meId);
          fail(409, 'That cell already has a team.');
        }
      }
      const team = await db.insertTeam({dataset, task_id: taskId, segment_id: segmentId || null, anchor, title: String(args.title || '').slice(0, 80), owner_id: meId});
      await db.putMember({team_id: team.id, user_id: meId, user_name: nameOf(me), state: 'joined', invited_by: null});
      return teamOut(team, await db.membersOf(team.id), meId);
    }
    case 'team.invite': {
      const {team, members} = await load(db, args.teamId, meId);
      active(team);
      const target = uuid(args.userId, 'player');
      if (target === meId) fail(400, 'You are already on the team.');
      const there = members.find(m => m.user_id === target);
      if (there && there.state === 'joined') return teamOut(team, members, meId);
      if (!there && spaceLeft(members) <= 0) fail(409, `A team is at most ${TEAM_MAX} players, counting the people already asked.`);
      const user = await db.findUser(target);
      if (!user) fail(404, 'No player by that name.');
      // Someone who asked to join an open team and is then invited is simply in.
      const state = there && there.state === 'requested' ? 'joined' : 'invited';
      await db.putMember({team_id: team.id, user_id: target, user_name: nameOf(user), state, invited_by: meId});
      await db.notify(target, '🤝 Team invitation', `${nameOf(me)} invites you to work on a cell together${team.title ? ': ' + team.title : ''}. Open Cell Library, Teams.`, meId);
      return teamOut(team, await db.membersOf(team.id), meId);
    }
    case 'team.respond': {
      const {team, mine} = await load(db, args.teamId, meId, {mustBeJoined: false});
      if (!mine || mine.state !== 'invited') fail(409, 'That invitation is no longer there.');
      if (args.accept) { active(team); await db.putMember({...mine, state: 'joined'}); }
      else await db.dropMember(team.id, meId);     // quietly: the inviter is not told
      return {ok: true};
    }
    case 'team.setOpen': {
      const {team, members} = await load(db, args.teamId, meId);
      active(team);
      const t = await db.patchTeam(team.id, {is_open: !!args.open});
      return teamOut(t, members, meId);
    }
    case 'team.request': {
      const {team, members, mine} = await load(db, args.teamId, meId, {mustBeJoined: false});
      active(team);
      if (mine) return teamOut(team, members, meId);
      if (!team.is_open) fail(403, 'That team is not looking for teammates.');
      if (spaceLeft(members) <= 0) fail(409, 'That team is full.');
      await db.putMember({team_id: team.id, user_id: meId, user_name: nameOf(me), state: 'requested', invited_by: null});
      await db.notify(team.owner_id, '🤝 Someone would like to join your team', `${nameOf(me)} asked to join${team.title ? ' ' + team.title : ' your team'}. Open Cell Library, Teams.`, meId);
      return teamOut(team, await db.membersOf(team.id), meId);
    }
    case 'team.approve': {
      const {team, members} = await load(db, args.teamId, meId);
      active(team);
      const target = uuid(args.userId, 'player');
      const asked = members.find(m => m.user_id === target && m.state === 'requested');
      if (!asked) fail(409, 'That request is no longer there.');
      if (args.accept) {
        await db.putMember({...asked, state: 'joined'});
        await db.notify(target, '🤝 You are on the team', `${nameOf(me)} added you${team.title ? ' to ' + team.title : ' to the team'}. Open Cell Library, Teams.`, meId);
      } else await db.dropMember(team.id, target);
      return teamOut(team, await db.membersOf(team.id), meId);
    }
    case 'team.leave': {
      const {team, members} = await load(db, args.teamId, meId, {mustBeJoined: false});
      if (!members.some(m => m.user_id === meId)) return {ok: true};
      await db.dropMember(team.id, meId);
      const left = members.filter(m => m.user_id !== meId && m.state === 'joined');
      if (team.status === 'active') {
        if (!left.length) await db.patchTeam(team.id, {status: 'closed', is_open: false});
        else if (team.owner_id === meId) await db.patchTeam(team.id, {owner_id: left[0].user_id});
      }
      return {ok: true};
    }
    case 'team.partDone': {
      const {team, mine} = await load(db, args.teamId, meId);
      active(team);
      await db.putMember({...mine, part_done: !!args.done});
      return teamOut(team, await db.membersOf(team.id), meId);
    }
    case 'team.marks': {
      const {team} = await load(db, args.teamId, meId);
      return (await db.getMarks(team.id)) || {layers: {}};
    }
    case 'team.saveMarks': {
      const {team} = await load(db, args.teamId, meId);
      active(team);
      const name = String(args.layer || '').slice(0, 80);
      if (!name) fail(400, 'Which layer?');
      const doc = (await db.getMarks(team.id)) || {layers: {}};
      if (!doc.layers || typeof doc.layers !== 'object') doc.layers = {};
      let layer = doc.layers[name];
      if (!layer) {
        if (Object.keys(doc.layers).length >= MAX_LAYERS) fail(409, 'This team has as many annotation layers as it can save.');
        layer = doc.layers[name] = {spec: null, anns: {}};
      }
      if (args.spec && typeof args.spec === 'object' && !Array.isArray(args.spec)) layer.spec = args.spec;
      for (const id of Array.isArray(args.del) ? args.del : []) delete layer.anns[String(id)];
      for (const a of Array.isArray(args.up) ? args.up : []) {
        if (!a || typeof a !== 'object' || a.id == null) continue;
        const id = String(a.id).slice(0, 80);
        if (!(id in layer.anns) && Object.keys(layer.anns).length >= MAX_ANNS_PER_LAYER) continue;
        layer.anns[id] = a;
      }
      await db.putMarks(team.id, doc, meId);
      return {ok: true};
    }
    case 'team.messages': {
      const {team} = await load(db, args.teamId, meId);
      return (await db.messagesOf(team.id, 100)).map(m => ({by: m.user_id, name: m.user_name, text: m.body, at: m.created_at}));
    }
    case 'team.say': {
      const {team} = await load(db, args.teamId, meId);
      const text = String(args.text || '').replace(/\s+/g, ' ').trim().slice(0, MSG_MAX);
      if (!text) fail(400, 'Say something.');
      await db.addMessage({team_id: team.id, user_id: meId, user_name: nameOf(me), body: text});
      return {ok: true};
    }
    case 'team.complete': {
      const {team, members} = await load(db, args.teamId, meId);
      const root = String(args.root || '');
      if (!/^\d{1,24}$/.test(root)) fail(400, 'Which cell was completed?');
      // Only the first to finish it completes the team: a second call changes nothing.
      const won = await db.completeTeam(team.id, {completed_by: meId, completed_root: root});
      if (!won) return {ok: true, already: true};
      const joined = members.filter(m => m.state === 'joined');
      const names = joined.map(m => m.user_name);
      for (const m of joined) {
        await db.putMember({...m, celebrate: true, part_done: true});
        if (m.user_id === meId) continue;     // the one who completed it was counted when they did
        try {
          await credit(m.user_id, {operation: 'mark_complete', dataset: team.dataset,
            metadata: {root_id: root, team_id: team.id, team_with: names.filter(n => n !== m.user_name).join(', ').slice(0, 160)}});
        } catch (e) { console.error('[teams] could not credit a member', e && e.message); }
        await db.notify(m.user_id, '🎉 Team cell complete', `${nameOf(me)} completed the cell your team was working on${team.title ? ' (' + team.title + ')' : ''}. It counts for you too.`, meId);
      }
      // Requests and invitations nobody answered go with the team.
      for (const m of members.filter(x => x.state !== 'joined')) await db.dropMember(team.id, m.user_id);
      return {ok: true, members: names};
    }
    case 'team.seen': {
      const {mine} = await load(db, args.teamId, meId, {mustBeJoined: false});
      if (mine && mine.celebrate) await db.putMember({...mine, celebrate: false});
      return {ok: true};
    }
    default:
      fail(400, `unknown action ${action}`);
  }
}

/** The reads and writes, over the database's REST interface with the service key. */
function restDb(sb) {
  const now = () => new Date().toISOString();
  const inList = ids => `in.(${ids.map(encodeURIComponent).join(',')})`;
  const post = (path, row, prefer) => sb(path, {method: 'POST', body: JSON.stringify(row), ...(prefer ? {headers: {Prefer: prefer}} : {})});
  return {
    getTeam: async id => (await sb(`ew_teams?id=eq.${id}&limit=1`))[0] || null,
    getTeams: async ids => ids.length ? sb(`ew_teams?id=${inList(ids)}&order=created_at.desc`) : [],
    teamsOnTask: (taskId, dataset) => sb(`ew_teams?task_id=eq.${taskId}&dataset=eq.${encodeURIComponent(dataset)}`),
    openTeams: () => sb('ew_teams?is_open=eq.true&status=eq.active&order=created_at.desc&limit=50'),
    insertTeam: async row => (await post('ew_teams', row))[0],
    patchTeam: async (id, patch) => (await sb(`ew_teams?id=eq.${id}`, {method: 'PATCH', body: JSON.stringify(patch)}))[0],
    // True only for the call that moved the team from active to completed.
    completeTeam: async (id, patch) => (await sb(`ew_teams?id=eq.${id}&status=eq.active`, {method: 'PATCH', body: JSON.stringify({...patch, status: 'completed', is_open: false, completed_at: now()})})).length > 0,
    memberRowsOf: userId => sb(`ew_team_members?user_id=eq.${userId}`),
    membersOf: teamId => sb(`ew_team_members?team_id=eq.${teamId}&order=created_at.asc`),
    membersOfMany: async ids => ids.length ? sb(`ew_team_members?team_id=${inList(ids)}&order=created_at.asc`) : [],
    putMember: row => sb('ew_team_members?on_conflict=team_id,user_id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=representation'},
      body: JSON.stringify({team_id: row.team_id, user_id: row.user_id, user_name: row.user_name, state: row.state, part_done: !!row.part_done, celebrate: !!row.celebrate, invited_by: row.invited_by ?? null, updated_at: now()})}),
    dropMember: (teamId, userId) => sb(`ew_team_members?team_id=eq.${teamId}&user_id=eq.${userId}`, {method: 'DELETE'}),
    getMarks: async teamId => ((await sb(`ew_team_marks?team_id=eq.${teamId}&select=doc&limit=1`))[0] || {}).doc || null,
    putMarks: (teamId, doc, userId) => sb('ew_team_marks?on_conflict=team_id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
      body: JSON.stringify({team_id: teamId, doc, updated_by: userId, updated_at: now()})}),
    messagesOf: async (teamId, limit) => (await sb(`ew_team_messages?team_id=eq.${teamId}&order=id.desc&limit=${limit}`)).reverse(),
    addMessage: row => post('ew_team_messages', row),
    findUser: async id => (await sb(`users?id=eq.${id}&select=id,username,display_name&limit=1`))[0] || null,
    notify: (userId, title, body, by) => post('notifications', {title, body, target_type: 'user', target_id: userId, send_at: now(), created_by: by || null}).catch(e => console.error('[teams] notification not sent', e && e.message)),
  };
}

/** The same reads and writes held in memory: for the tests and for trying the
 *  game against a stand-in server. */
function memDb(users = []) {
  const s = {teams: [], members: [], marks: new Map(), messages: [], notes: [], n: 0};
  const copy = x => JSON.parse(JSON.stringify(x));
  const id = () => `00000000-0000-4000-8000-${String(++s.n).padStart(12, '0')}`;
  return {
    _state: s,
    getTeam: async tid => copy(s.teams.find(t => t.id === tid) || null),
    getTeams: async ids => copy(s.teams.filter(t => ids.includes(t.id))),
    teamsOnTask: async (taskId, dataset) => copy(s.teams.filter(t => t.task_id === taskId && t.dataset === dataset)),
    openTeams: async () => copy(s.teams.filter(t => t.is_open && t.status === 'active')),
    insertTeam: async row => { const t = {id: id(), is_open: false, status: 'active', completed_by: null, completed_at: null, completed_root: null, created_at: new Date().toISOString(), ...row}; s.teams.push(t); return copy(t); },
    patchTeam: async (tid, patch) => { const t = s.teams.find(x => x.id === tid); Object.assign(t, patch); return copy(t); },
    completeTeam: async (tid, patch) => { const t = s.teams.find(x => x.id === tid); if (!t || t.status !== 'active') return false; Object.assign(t, patch, {status: 'completed', is_open: false, completed_at: new Date().toISOString()}); return true; },
    memberRowsOf: async uid => copy(s.members.filter(m => m.user_id === uid)),
    membersOf: async tid => copy(s.members.filter(m => m.team_id === tid)),
    membersOfMany: async ids => copy(s.members.filter(m => ids.includes(m.team_id))),
    putMember: async row => { const at = s.members.findIndex(m => m.team_id === row.team_id && m.user_id === row.user_id);
      const r = {part_done: false, celebrate: false, invited_by: null, ...(at >= 0 ? s.members[at] : {}), ...row}; if (at >= 0) s.members[at] = r; else s.members.push(r); },
    dropMember: async (tid, uid) => { s.members = s.members.filter(m => !(m.team_id === tid && m.user_id === uid)); },
    getMarks: async tid => copy(s.marks.get(tid) || null),
    putMarks: async (tid, doc) => { s.marks.set(tid, copy(doc)); },
    messagesOf: async (tid, limit) => copy(s.messages.filter(m => m.team_id === tid).slice(-limit)),
    addMessage: async row => { s.messages.push({...row, created_at: new Date().toISOString()}); },
    findUser: async uid => copy(users.find(u => u.id === uid) || null),
    notify: async (uid, title, body) => { s.notes.push({to: uid, title, body}); },
  };
}

module.exports = {teamAction, restDb, memDb, TEAM_MAX};
