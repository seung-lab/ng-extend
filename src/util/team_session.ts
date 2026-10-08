/**
 * Mentor mode and Team mode: players in one live session on one cell
 * (Ames 2026-10-07: "there is Mentor mode, where one player helps another,
 * and Team mode, where players work together to complete a typically large
 * cell. Let's do both.").
 *
 *   Mentor  A helper offers to join from a help request; the player who asked
 *           accepts. The helper's view follows theirs until they switch that
 *           off. The player who asked leads.
 *   Team    Two or more players share one cell. Each keeps their own camera.
 *
 * What a session shares, live:
 *   - the cell: the segments showing. When anyone edits, the cell's ID
 *     changes and everyone's view moves to the new one.
 *   - marks: every annotation layer (highlights are annotation layers), so
 *     people can show where they are working.
 *   - where everyone is: a point per teammate, Jump to, and Follow.
 *   - completion: when one member completes the cell, the others are
 *     credited in the game too. CAVE keeps each edit under whoever made it.
 *
 * The team lives in the game, not in CAVE. It rides on the realtime service
 * the chat already uses: a room is a channel with a random name, and each
 * signed in player listens on an inbox channel for invitations. Nothing is
 * stored: a session exists while its members are in it.
 *
 * ALPHA. The realtime service takes a sender's word for who they are, so an
 * invitation's name is as trustworthy as a chat name, no more.
 */
import { reactive } from 'vue';
import { supabase } from '../supabase';
import { useProofreadingBackendStore } from '../store';
import { currentSegLayer, currentDatasetTag, canonicalDataset, findDatasetByCanonical, switchToDataset, DATASETS } from '../datasets';
import { editsAny } from './dataset_access';
import { Uint64 } from 'neuroglancer/util/uint64';
import { makeLayer } from 'neuroglancer/layer';
import { StatusMessage } from 'neuroglancer/status';

export type TeamMode = 'mentor' | 'team';
export interface TeamMember { id: string; name: string; color: string; pos?: number[]; }
export interface TeamInvite { from: { id: string; name: string }; room: string; mode: TeamMode; leader: string; dataset: string; note?: string; at: number; }

export const team = reactive({
  room: '',
  mode: 'team' as TeamMode,
  /** Whose view is the truth when someone joins, and who a mentor follows. */
  leader: '',
  members: [] as TeamMember[],
  invites: [] as TeamInvite[],
  /** People invited who have not answered yet. */
  waiting: [] as { id: string; name: string }[],
  /** The teammate whose camera this player's view is following, or ''. */
  following: '',
  note: '',
});

const POS_LAYER = 'Teammates';
const SKIP_LAYERS = new Set([POS_LAYER, 'Highlight start']);
const ROOM_KEY = 'nge_team_room';
const COLORS = ['#4ad6ff', '#ffb347', '#b58cff', '#5dffa0', '#ff7aa8', '#ffe45c', '#7ab8ff', '#ff8a5c'];
const VIEW_KEYS = ['crossSectionScale', 'projectionScale', 'projectionOrientation', 'crossSectionOrientation'];

const viewerOf = (): any => (window as any)['viewer'];
const backend = () => useProofreadingBackendStore();
function me(): { id: string; name: string } {
  const b: any = backend();
  return { id: String(b.userId || ''), name: String(b.chatHandle || b.username || b.userName || 'Player') };
}
function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
/**
 * Sessions are for players with production access (Ames 2026-10-07: "this
 * would be open to anyone with production access"): the same test the chat
 * uses for its Eyewirer rank. true or false once CAVE has answered, null
 * while it is not known. Admins always may.
 */
export function teamAccess(): boolean | null {
  try { if ((backend() as any).isAdmin) return true; } catch { /* store not ready */ }
  try { return editsAny(DATASETS.filter(d => d.section === 'production').map(d => d.caveDataset)); } catch { return null; }
}
/** Stops a player who is known not to have production access, and says why. */
function mayTeam(): boolean {
  if (teamAccess() !== false) return true;
  say('Mentor and Team sessions are for players with production access. Finish the Sandbox to get it.', 8000);
  return false;
}
function say(text: string, ms = 6000) { try { StatusMessage.showTemporaryMessage(text, ms); } catch { /* no viewer */ } }
const here = () => canonicalDataset(currentDatasetTag());

// ── Invitations: each player's inbox ────────────────────────────────────
let inbox: any = null;
let inboxFor = '';

/** Call once a player is signed in: listens for invitations, and rejoins a
 *  session that a page reload interrupted. */
export function startTeamInbox() {
  const { id } = me();
  if (!id || inboxFor === id) return;
  inboxFor = id;
  try { if (inbox) supabase.removeChannel(inbox); } catch { /* */ }
  inbox = supabase.channel('ew-team-inbox-' + id, { config: { broadcast: { self: false }, presence: { key: 'owner' } } });
  inbox.on('broadcast', { event: 'msg' }, (m: any) => { try { onInbox(m.payload || {}); } catch (e) { console.warn('[team] inbox:', e); } });
  // Being present here is how someone inviting this player knows they are in the game.
  const mine = inbox;
  inbox.subscribe((s: string) => { if (s === 'SUBSCRIBED') { try { void mine.track({ id }); } catch { /* shows as offline */ } } });
  installWatchers();
  resume();
}

/** Sends to a player's inbox. Returns whether they looked to be in the game
 *  at that moment (the message is sent either way: an older page that is
 *  open still receives it without showing as present). */
async function sendTo(userId: string, payload: Record<string, unknown>): Promise<boolean> {
  const ch = supabase.channel('ew-team-inbox-' + userId, { config: { broadcast: { self: false } } });
  let online = false, synced = () => { /* set below */ };
  const seen = new Promise<void>(resolve => { synced = resolve; });
  ch.on('presence', { event: 'sync' }, () => { try { online = Object.keys(ch.presenceState()).length > 0; } catch { /* unknown */ } synced(); });
  await new Promise<void>(resolve => {
    const t = setTimeout(resolve, 4000);
    ch.subscribe((s: string) => { if (s === 'SUBSCRIBED') { clearTimeout(t); resolve(); } });
  });
  await Promise.race([seen, new Promise(r => setTimeout(r, 1500))]);
  try { online = online || Object.keys(ch.presenceState()).length > 0; } catch { /* unknown */ }
  try { await ch.send({ type: 'broadcast', event: 'msg', payload }); } catch (e) { console.warn('[team] send failed:', e); }
  setTimeout(() => { try { supabase.removeChannel(ch); } catch { /* */ } }, 1500);
  return online;
}

function onInbox(p: any) {
  const from = p.from && p.from.id ? { id: String(p.from.id), name: String(p.from.name || 'A player').slice(0, 40) } : null;
  if (!from || from.id === me().id) return;
  if (p.t === 'invite' && p.room) {
    if (team.invites.some(i => i.room === p.room && i.from.id === from.id)) return;
    team.invites.push({ from, room: String(p.room), mode: p.mode === 'mentor' ? 'mentor' : 'team', leader: String(p.leader || from.id),
      dataset: String(p.dataset || ''), note: p.note ? String(p.note).slice(0, 140) : undefined, at: Date.now() });
  } else if (p.t === 'accept' || p.t === 'decline') {
    const at = team.waiting.findIndex(w => w.id === from.id);
    if (at >= 0) team.waiting.splice(at, 1);
    if (p.t === 'decline' && p.room === team.room) say(`${from.name} declined.`);
  } else if (p.t === 'cancel') {
    const at = team.invites.findIndex(i => i.room === p.room && i.from.id === from.id);
    if (at >= 0) team.invites.splice(at, 1);
  }
}

/** Start a Team session on the cell in view. Others are invited from the strip. */
export async function startTeam(): Promise<boolean> {
  const { id } = me();
  if (!id) { say('Sign in to start a team.'); return false; }
  if (!mayTeam()) return false;
  if (team.room) return true;
  await joinRoom(newRoom(), 'team', id);
  return true;
}

/** Invite a player into the session, starting one if there is none.
 *  mentor: the helper offers to join `user`, who then leads. */
export async function invite(user: { id: string; name: string }, mode: TeamMode, note?: string): Promise<boolean> {
  const self = me();
  if (!self.id) { say('Sign in first.'); return false; }
  if (!mayTeam()) return false;
  if (!user.id || user.id === self.id) return false;
  if (!team.room) await joinRoom(newRoom(), mode, mode === 'mentor' ? user.id : self.id);
  if (!team.waiting.some(w => w.id === user.id) && !team.members.some(m => m.id === user.id)) team.waiting.push({ id: user.id, name: user.name });
  const online = await sendTo(user.id, { t: 'invite', from: self, room: team.room, mode: team.mode, leader: team.leader, dataset: here(), note });
  if (!online) say(`${user.name} does not seem to be in the game right now. They will see your invitation only if they have it open.`, 9000);
  return true;
}

export async function acceptInvite(inv: TeamInvite) {
  if (!mayTeam()) return;
  team.invites.splice(team.invites.indexOf(inv), 1);
  if (team.room && team.room !== inv.room) await leaveTeam();
  void sendTo(inv.from.id, { t: 'accept', from: me(), room: inv.room });
  if (inv.dataset && inv.dataset !== here()) {
    // Switching datasets reloads the page: leave a note and join on the other side.
    const target = findDatasetByCanonical(inv.dataset);
    if (!target) { say('That session is on a dataset this game does not list.'); return; }
    remember(inv.room, inv.mode, inv.leader, inv.dataset);
    const ok = await switchToDataset(target);
    if (!ok) { forget(); say('Could not switch to that dataset.'); return; }
    // No reload happened: carry on here.
    setTimeout(() => { if (!team.room) void joinRoom(inv.room, inv.mode, inv.leader); }, 1500);
    return;
  }
  await joinRoom(inv.room, inv.mode, inv.leader);
}

export function declineInvite(inv: TeamInvite) {
  team.invites.splice(team.invites.indexOf(inv), 1);
  void sendTo(inv.from.id, { t: 'decline', from: me(), room: inv.room });
}

const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
function remember(room: string, mode: TeamMode, leader: string, dataset: string) {
  try { sessionStorage.setItem(ROOM_KEY, JSON.stringify({ room, mode, leader, dataset, at: Date.now() })); } catch { /* private window */ }
}
function forget() { try { sessionStorage.removeItem(ROOM_KEY); } catch { /* */ } }
function resume() {
  let saved: any = null;
  try { saved = JSON.parse(sessionStorage.getItem(ROOM_KEY) || 'null'); } catch { saved = null; }
  if (!saved?.room || Date.now() - (saved.at || 0) > 6 * 3600_000) { forget(); return; }
  // Wait for the dataset the session is on to be showing.
  let tries = 0;
  const wait = setInterval(() => {
    if (team.room) { clearInterval(wait); return; }
    if (++tries > 80) { clearInterval(wait); forget(); return; }
    if (currentSegLayer()?.layer && (!saved.dataset || saved.dataset === here())) {
      clearInterval(wait);
      void joinRoom(saved.room, saved.mode === 'mentor' ? 'mentor' : 'team', String(saved.leader || ''));
    }
  }, 500);
}

// ── The room ────────────────────────────────────────────────────────────
let room: any = null;
/** False until this player has taken on the team's cell and marks (or is the
 *  one whose view the others take on). Nothing is sent before that, so a
 *  newcomer's own view never overwrites the team's. */
let synced = false;
/** True once this player has taken on someone's whole state (or is the leader). */
let adopted = false;

function send(event: string, payload: Record<string, unknown>) {
  if (!room) return;
  try { void room.send({ type: 'broadcast', event, payload: { ...payload, by: me().id } }); } catch { /* dropped */ }
}

async function joinRoom(id: string, mode: TeamMode, leader: string) {
  const self = me();
  if (!self.id || !id) return;
  team.room = id; team.mode = mode; team.leader = leader || self.id;
  team.members = [{ id: self.id, name: self.name, color: colorOf(self.id) }];
  team.following = '';
  synced = false;
  adopted = false;
  credited.clear();
  remember(id, mode, team.leader, here());
  snapshotKnown();

  room = supabase.channel('ew-team-' + id, { config: { broadcast: { self: false }, presence: { key: self.id } } });
  room.on('presence', { event: 'sync' }, onPresence);
  room.on('presence', { event: 'join' }, (e: any) => {
    // Someone arrived: whoever is already in step tells them where things stand.
    const arrived = (e?.newPresences || []).some((p: any) => String(p.id) !== self.id);
    if (arrived && synced) setTimeout(sendState, 400 + Math.random() * 400);
    // And everyone says again where they are, so Jump works for the newcomer at once.
    if (arrived) lastSent = '';
  });
  for (const ev of ['state', 'cell', 'marks', 'pos', 'complete', 'bye']) {
    room.on('broadcast', { event: ev }, (m: any) => { try { onRoom(ev, m.payload || {}); } catch (e) { console.warn('[team]', ev, e); } });
  }
  await new Promise<void>(resolve => {
    const t = setTimeout(resolve, 6000);
    room.subscribe((s: string) => { if (s === 'SUBSCRIBED') { clearTimeout(t); resolve(); } });
  });
  try { await room.track({ id: self.id, name: self.name, color: colorOf(self.id) }); } catch { /* shows up on the next sync */ }

  if (team.leader === self.id) {
    // This player's view is the one the team takes on.
    synced = true;
    adopted = true;
    sendState();
  } else {
    // Take on the team's view when it arrives. Alone in the room (the others
    // left): carry on with what is here.
    setTimeout(() => { if (team.room === id && !synced) { synced = true; } }, 5000);
  }
  startTicker();
}

export async function leaveTeam() {
  if (!room && !team.room) return;
  stopTicker();
  send('bye', {});
  try { await room?.untrack(); } catch { /* */ }
  try { if (room) await supabase.removeChannel(room); } catch { /* */ }
  room = null;
  for (const w of team.waiting) void sendTo(w.id, { t: 'cancel', from: me(), room: team.room });
  team.room = ''; team.members = []; team.waiting = []; team.following = ''; team.leader = '';
  synced = false;
  forget();
  removePosLayer();
}

function onPresence() {
  if (!room) return;
  const state = room.presenceState() as Record<string, any[]>;
  const self = me();
  const before = new Map(team.members.map(m => [m.id, m]));
  const next: TeamMember[] = [];
  for (const list of Object.values(state)) {
    const p = list?.[0];
    if (!p?.id) continue;
    const id = String(p.id);
    if (next.some(m => m.id === id)) continue;
    next.push({ id, name: String(p.name || 'Player').slice(0, 40), color: String(p.color || colorOf(id)), pos: before.get(id)?.pos });
  }
  if (!next.some(m => m.id === self.id)) next.unshift({ id: self.id, name: self.name, color: colorOf(self.id) });
  next.sort((a, b) => (a.id === self.id ? -1 : b.id === self.id ? 1 : a.name.localeCompare(b.name)));
  for (const m of next) if (!before.has(m.id) && m.id !== self.id) say(`${m.name} joined.`, 4000);
  for (const m of before.values()) if (!next.some(n => n.id === m.id)) say(`${m.name} left.`, 4000);
  // With nobody left to draw, the teammate points go too.
  team.members = next;
  team.waiting = team.waiting.filter(w => !next.some(m => m.id === w.id));
  // A mentor follows the player they are helping from the moment that player arrives.
  const leaderArrived = team.leader !== self.id && !before.has(team.leader) && next.some(m => m.id === team.leader);
  if (team.mode === 'mentor' && leaderArrived) team.following = team.leader;
  // Someone who was being followed and has left: the view is this player's own again.
  if (team.following && before.has(team.following) && !next.some(m => m.id === team.following)) team.following = '';
  drawTeammates();
}

function onRoom(event: string, p: any) {
  const by = String(p.by || '');
  if (!by || by === me().id) return;
  if (event === 'state') {
    // A whole state is taken on once: on arriving, or when the leader arrives
    // after this player (a mentor opens the room before the player they help).
    if (adopted) return;
    if (Array.isArray(p.segs)) applySegs(p.segs);
    for (const l of Array.isArray(p.layers) ? p.layers : []) applyMarks(l.name, l.spec, l.anns || [], [], true);
    synced = true;
    adopted = true;
  } else if (event === 'cell') {
    if (synced && Array.isArray(p.segs)) applySegs(p.segs);
  } else if (event === 'marks') {
    if (synced) applyMarks(String(p.layer || ''), p.spec, p.up || [], p.del || [], false);
  } else if (event === 'pos') {
    const m = team.members.find(x => x.id === by);
    if (m && Array.isArray(p.p)) { m.pos = p.p.slice(0, 3).map(Number); drawTeammates(); }
    if (team.following === by) applyView(p);
  } else if (event === 'complete') {
    creditCompletion(p);
  } else if (event === 'bye') {
    // Said on the way out, so nobody waits for the service to notice.
    const gone = team.members.find(x => x.id === by);
    if (gone) { say(`${gone.name} left.`, 4000); team.members = team.members.filter(x => x.id !== by); }
    if (team.following === by) team.following = '';
    drawTeammates();
  }
}

// ── The cell: the segments showing ──────────────────────────────────────
let knownSegs = '';
const segSet = (): any => currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
function readSegs(): string[] {
  const out: string[] = [];
  try { for (const id of segSet() ?? []) out.push(new Uint64(id.low, id.high).toString()); } catch { /* layer not ready */ }
  return out.sort();
}
function applySegs(list: string[]) {
  const set = segSet();
  if (!set) return;
  const want = list.map(String).filter(s => /^\d+$/.test(s)).sort();
  knownSegs = want.join(',');
  if (readSegs().join(',') === knownSegs) return;
  set.clear();
  for (const s of want) { try { set.add(Uint64.parseString(s)); } catch { /* not an id */ } }
}
let segTimer: any = null;
function onSegsChanged() {
  if (!team.room) return;
  clearTimeout(segTimer);
  segTimer = setTimeout(() => {
    if (!team.room || !synced) return;
    const segs = readSegs();
    const key = segs.join(',');
    if (key === knownSegs) return;   // the team's own change, just applied here
    knownSegs = key;
    send('cell', { segs });
  }, 200);
}

// ── Marks: every annotation layer ───────────────────────────────────────
/** What the team is known to have, per layer: annotation id -> its JSON text. */
const known = new Map<string, Map<string, string>>();
/** Marks that arrived for a layer still being created here. */
const pendingMarks = new Map<string, { up: any[]; del: string[] }>();

function markLayers(): { name: string; managed: any; src: any }[] {
  const out: { name: string; managed: any; src: any }[] = [];
  for (const managed of viewerOf()?.layerManager?.managedLayers ?? []) {
    if (managed.archived || SKIP_LAYERS.has(managed.name)) continue;
    const src = managed.layer?.localAnnotations;
    if (src) out.push({ name: managed.name, managed, src });
  }
  return out;
}
function layerSpec(managed: any): any {
  try {
    const spec = { ...(managed.layer.toJSON() || {}) };
    delete spec.annotations; delete spec.name; delete spec.tab; delete spec.panels; delete spec.pick; delete spec.tool; delete spec.toolBindings;
    return spec;
  } catch { return { type: 'annotation', source: 'local://annotations' }; }
}
const annMap = (src: any): Map<string, string> => {
  const m = new Map<string, string>();
  try { for (const a of src.toJSON() as any[]) if (a?.id != null) m.set(String(a.id), JSON.stringify(a)); } catch { /* not ready */ }
  return m;
};
/** At the moment of joining: what is already here is not news to send. */
function snapshotKnown() {
  known.clear();
  for (const l of markLayers()) known.set(l.name, annMap(l.src));
  knownSegs = readSegs().join(',');
}

let marksTimer: any = null;
function onMarksChanged() {
  if (!team.room) return;
  clearTimeout(marksTimer);
  marksTimer = setTimeout(() => {
    if (!team.room || !synced) return;
    for (const l of markLayers()) {
      // A mark still being placed is not sent until it is finished.
      if (l.src.pending && l.src.pending.size > 0) continue;
      const now = annMap(l.src);
      const was = known.get(l.name) ?? new Map<string, string>();
      const up: any[] = [], del: string[] = [];
      for (const [id, text] of now) if (was.get(id) !== text) up.push(JSON.parse(text));
      for (const id of was.keys()) if (!now.has(id)) del.push(id);
      if (!up.length && !del.length) continue;
      known.set(l.name, now);
      send('marks', { layer: l.name, spec: layerSpec(l.managed), up, del });
    }
  }, 300);
}

function applyMarks(name: string, spec: any, up: any[], del: string[], whole: boolean) {
  if (!name || SKIP_LAYERS.has(name)) return;
  const viewer = viewerOf();
  if (!viewer) return;
  let managed = viewer.layerManager.managedLayers.find((l: any) => l.name === name && !l.archived);
  if (!managed) {
    const base = spec && typeof spec === 'object' && spec.type === 'annotation' ? spec : { type: 'annotation', source: 'local://annotations' };
    managed = makeLayer(viewer.layerSpecification, name, { ...base, source: 'local://annotations', annotations: [] });
    viewer.layerSpecification.add(managed);
  }
  const src = managed.layer?.localAnnotations;
  if (!src) {
    // The layer's own store appears a moment after the layer: hold the marks.
    const held = pendingMarks.get(name) ?? { up: [], del: [] };
    held.up.push(...up); held.del.push(...del);
    const first = !pendingMarks.has(name);
    pendingMarks.set(name, held);
    if (first) {
      let tries = 0;
      const wait = setInterval(() => {
        const m = viewerOf()?.layerManager?.managedLayers?.find((l: any) => l.name === name && !l.archived);
        if (m?.layer?.localAnnotations || ++tries > 80) {
          clearInterval(wait);
          const h = pendingMarks.get(name); pendingMarks.delete(name);
          if (h && m?.layer?.localAnnotations) applyMarks(name, spec, h.up, h.del, whole);
        }
      }, 100);
    }
    return;
  }
  const merged = annMap(src);
  for (const id of del) merged.delete(String(id));
  for (const a of up) if (a?.id != null) merged.set(String(a.id), JSON.stringify(a));
  const was = annMap(src);
  let same = was.size === merged.size;
  if (same) for (const [id, text] of merged) if (was.get(id) !== text) { same = false; break; }
  // What the team has is now also what is known here, so it is not sent back.
  known.set(name, new Map(merged));
  if (same) return;
  // Replacing a layer's marks empties it first, so a single mark this layer
  // cannot read would leave it empty, and the next send would then tell the
  // whole team those marks were deleted. If the new set cannot be read, put
  // back what was here and forget nothing.
  const before = [...was.values()].map(t => JSON.parse(t));
  try { src.restoreState([...merged.values()].map(t => JSON.parse(t))); } catch (e) {
    console.warn('[team] marks not applied (this layer cannot read one of them):', e);
    try { src.restoreState(before); } catch { /* it could not read its own marks either */ }
    known.set(name, was);
  }
}

function sendState() {
  if (!team.room || !synced) return;
  send('state', {
    segs: readSegs(),
    layers: markLayers().map(l => ({ name: l.name, spec: layerSpec(l.managed), anns: [...annMap(l.src).values()].map(t => JSON.parse(t)) })),
  });
}

// ── Where everyone is ───────────────────────────────────────────────────
let ticker: any = null;
let lastSent = '';
function myPos(): number[] | null {
  try { const p = viewerOf()?.navigationState?.position?.value; return p ? Array.from(p as Float32Array).slice(0, 3).map(n => Math.round(n)) : null; } catch { return null; }
}
function myView(): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  const children: Map<string, any> | undefined = viewerOf()?.state?.children;
  for (const k of VIEW_KEYS) { try { const j = children?.get(k)?.toJSON(); if (j !== undefined) v[k] = j; } catch { /* not in this layout */ } }
  return v;
}
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!team.room) return;
    const p = myPos();
    if (!p) return;
    const v = myView();
    const key = JSON.stringify([p, v]);
    if (key === lastSent) return;
    lastSent = key;
    send('pos', { p, v });
  }, 250);
}
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; lastSent = ''; }

function applyView(p: any) {
  const viewer = viewerOf();
  if (!viewer) return;
  try { if (Array.isArray(p.p) && p.p.length >= 3) viewer.navigationState.position.value = Float32Array.from(p.p); } catch { /* */ }
  const children: Map<string, any> | undefined = viewer.state?.children;
  for (const k of VIEW_KEYS) {
    if (p.v && p.v[k] !== undefined) { try { children?.get(k)?.restoreState(p.v[k]); } catch { /* not in this layout */ } }
  }
}

export function jumpTo(id: string) {
  const m = team.members.find(x => x.id === id);
  if (!m?.pos) { say(`${m?.name || 'That player'} has not moved yet.`); return; }
  try { viewerOf().navigationState.position.value = Float32Array.from(m.pos); } catch { /* */ }
}
/** Follow a teammate's camera, or stop following (same id again, or ''). */
export function follow(id: string) {
  team.following = team.following === id ? '' : id;
  if (team.following) jumpTo(team.following);
}

/** A point per teammate, in a layer of its own that is never shared. */
function drawTeammates() {
  const viewer = viewerOf();
  if (!viewer || !team.room) return;
  const self = me().id;
  const points = team.members.filter(m => m.id !== self && m.pos).map(m => ({ type: 'point', id: 'tm_' + m.id, point: m.pos, description: m.name }));
  if (!points.length) { removePosLayer(); return; }
  let managed = viewer.layerManager.managedLayers.find((l: any) => l.name === POS_LAYER && !l.archived);
  if (!managed) {
    if (!points.length) return;
    managed = makeLayer(viewer.layerSpecification, POS_LAYER, { type: 'annotation', source: 'local://annotations', annotations: [], annotationColor: '#ffffff' });
    viewer.layerSpecification.add(managed);
  }
  const src = managed.layer?.localAnnotations;
  if (!src) { setTimeout(drawTeammates, 200); return; }
  try {
    const now = JSON.stringify(points);
    if ((managed as any).__teamDrawn === now) return;
    (managed as any).__teamDrawn = now;
    src.restoreState(points);
  } catch { /* drawn on the next move */ }
}
function removePosLayer() {
  try {
    const viewer = viewerOf();
    const managed = viewer?.layerManager?.managedLayers?.find((l: any) => l.name === POS_LAYER);
    if (managed) viewer.layerManager.removeManagedLayer(managed);
  } catch { /* nothing to remove */ }
}

// ── Completion: the team finishes the cell together ─────────────────────
const credited = new Set<string>();
function creditCompletion(p: any) {
  const root = String(p.root || '');
  if (!/^\d+$/.test(root) || credited.has(root)) return;
  credited.add(root);
  const who = team.members.find(m => m.id === String(p.by))?.name || 'A teammate';
  void backend().logEdit({
    operation: 'mark_complete', segment_after: root,
    metadata: { root_id: root, team_room: team.room, team_with: who },
    dataset: p.dataset || undefined,
  } as any);
  say(`${who} marked the cell complete. You are credited for it too.`, 9000);
}

// ── Listening to this player's own view ─────────────────────────────────
let watchersOn = false;
const hooked = new WeakSet<object>();
function installWatchers() {
  if (watchersOn) return;
  const viewer = viewerOf();
  if (!viewer?.layerManager) { setTimeout(installWatchers, 500); return; }
  watchersOn = true;
  const scan = () => {
    const set = segSet();
    if (set?.changed?.add && !hooked.has(set)) { hooked.add(set); set.changed.add(onSegsChanged); }
    for (const l of markLayers()) {
      if (l.src?.changed?.add && !hooked.has(l.src)) { hooked.add(l.src); l.src.changed.add(onMarksChanged); }
    }
    // A layer that arrived or left: its marks may be news, and the cell's layer may be new.
    onMarksChanged();
    onSegsChanged();
  };
  viewer.layerManager.layersChanged.add(scan);
  scan();
  // One member completing the cell tells the others.
  try {
    (backend() as any).$onAction(({ name, args, after }: any) => {
      if (name !== 'logEdit') return;
      const e = args?.[0] || {};
      if (!team.room || (e.operation !== 'mark_complete' && e.operation !== 'complete_task') || e.metadata?.team_room) return;
      after(() => {
        const root = String(e.segment_after ?? e.metadata?.final_segment_id ?? e.metadata?.root_id ?? '');
        if (/^\d+$/.test(root)) { credited.add(root); send('complete', { root, dataset: e.dataset || currentDatasetTag() }); }
      });
    });
  } catch { /* completion is simply not shared */ }
  window.addEventListener('beforeunload', () => { try { room?.untrack(); } catch { /* */ } });
}

// For player scripts and for testing two players side by side.
try { (window as any).ngeTeam = { team, teamAccess, startTeam, invite, acceptInvite, declineInvite, leaveTeam, jumpTo, follow }; } catch { /* no window */ }
