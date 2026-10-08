/**
 * Saved teams: two to four players on one cell, whenever each of them can
 * (Ames 2026-10-07: "Does team have to be in real time? What if players are
 * in different time zones."). The team, its invitations, its marks and its
 * chat are kept on the server (functions/teams.js, supabase-teams.sql), so a
 * teammate who is not in the game finds them when they next open it.
 *
 * When teammates do happen to be in the game together, opening the team's
 * cell puts them in one live session (util/team_session.ts) and they see
 * each other's work as it happens.
 *
 * Everything here goes through the server, which decides who may see or do
 * what. This file only asks, and holds what it was told.
 */
import { reactive, watch } from 'vue';
import { secureWrite } from '../secure_write';
import { useProofreadingBackendStore, useCellHistoryStore } from '../store';
import { canonicalDataset, currentDatasetTag, currentSegLayer, findDatasetByCanonical } from '../datasets';
import { team, openSavedRoom, attachSaved, savedRoom, leaveTeam, type SavedSink, type TeamChatLine } from './team_session';

export interface SavedTeamMember { id: string; name: string; state: 'invited' | 'requested' | 'joined'; partDone: boolean; }
export interface SavedTeam {
  id: string; dataset: string; taskId: number | null; segmentId: string; anchor: number[] | null; title: string;
  ownerId: string; open: boolean; status: 'active' | 'completed' | 'closed';
  completedBy: string | null; completedAt: string | null; completedRoot: string | null; createdAt: string;
  mine: 'invited' | 'requested' | 'joined' | null; celebrate: boolean; members: SavedTeamMember[];
}

/**
 * Team play is being tried on one dataset first (Ames 2026-10-08: "it should
 * only show on MEC while we are testing"). Everywhere else the Team up
 * buttons and the Teams tab do not appear. Null opens it on every dataset.
 */
export const TEAMS_TESTING_ON: string | null = 'pni_mec';
export function teamsOnDataset(raw: string | null | undefined): boolean {
  return TEAMS_TESTING_ON == null || canonicalDataset(raw || currentDatasetTag()) === TEAMS_TESTING_ON;
}

export const teamsState = reactive({
  /** False until supabase-teams.sql has been run: the tab then says so. */
  installed: true,
  loaded: false,
  loading: false,
  error: '',
  teams: [] as SavedTeam[],
  open: [] as SavedTeam[],
  max: 4,
});

async function call<T = any>(action: string, args: Record<string, any> = {}): Promise<T> {
  const out = await secureWrite<any>(action as any, args);
  if (out && out.installed === false) {
    teamsState.installed = false;
    throw new Error('Teams are not switched on yet.');
  }
  teamsState.installed = true;
  return out as T;
}

let inflight: Promise<void> | null = null;
export function loadTeams(): Promise<void> {
  if (inflight) return inflight;
  teamsState.loading = true;
  inflight = (async () => {
    try {
      const out = await call<{ teams: SavedTeam[]; open: SavedTeam[]; max: number }>('team.list');
      teamsState.teams = out.teams || [];
      teamsState.open = out.open || [];
      teamsState.max = out.max || 4;
      teamsState.error = '';
    } catch (e: any) {
      if (teamsState.installed) teamsState.error = e?.message || 'Could not load your teams.';
    } finally {
      teamsState.loaded = true;
      teamsState.loading = false;
      inflight = null;
    }
  })();
  return inflight;
}

/** Runs an action and reads the list again, so the screen shows what the server holds. */
async function act<T = any>(action: string, args: Record<string, any>): Promise<T> {
  const out = await call<T>(action, args);
  await loadTeams();
  return out;
}

const me = () => String(useProofreadingBackendStore().userId || '');
const here = () => canonicalDataset(currentDatasetTag());
export const myId = me;

export function createTeam(cell: { dataset?: string | null; taskId?: number | null; segmentId?: string | null; anchor?: number[] | null; title?: string }) {
  return act<SavedTeam>('team.create', {
    dataset: canonicalDataset(cell.dataset || currentDatasetTag()), taskId: cell.taskId ?? null,
    segmentId: cell.segmentId || '', anchor: cell.anchor || null, title: cell.title || '',
  });
}
/** A team on whatever cell is in the viewer right now (no claim needed). */
export function createTeamFromView(title = '') {
  const viewer: any = (window as any)['viewer'];
  let segmentId = '';
  try {
    const vis = (currentSegLayer() as any)?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (vis && vis.size === 1) segmentId = [...vis][0].toString();
  } catch { /* none showing */ }
  let anchor: number[] | null = null;
  try { anchor = Array.from(viewer.navigationState.position.value as Float32Array).slice(0, 3).map(Math.round); } catch { /* no viewer */ }
  if (!segmentId) throw new Error('Show just the one cell you want to team up on, then try again.');
  return createTeam({ dataset: currentDatasetTag(), segmentId, anchor, title });
}
export const inviteToTeam = (teamId: string, userId: string) => act('team.invite', { teamId, userId });
export const answerInvite = (teamId: string, accept: boolean) => act('team.respond', { teamId, accept });
export const setTeamOpen = (teamId: string, open: boolean) => act('team.setOpen', { teamId, open });
export const askToJoin = (teamId: string) => act('team.request', { teamId });
export const answerRequest = (teamId: string, userId: string, accept: boolean) => act('team.approve', { teamId, userId, accept });
export const setPartDone = (teamId: string, done: boolean) => act('team.partDone', { teamId, done });
export const teamSeen = (teamId: string) => act('team.seen', { teamId });
export async function leaveSavedTeam(teamId: string) {
  if (team.saved === teamId) await leaveTeam();
  return act('team.leave', { teamId });
}

// ── The team's cell, in the viewer ──────────────────────────────────────
function sinkFor(teamId: string): SavedSink {
  // Changes are sent one after another, so two saves to one layer cannot cross.
  let chain: Promise<unknown> = Promise.resolve();
  const later = (fn: () => Promise<unknown>) => { chain = chain.then(fn).catch(e => console.warn('[teams] not saved:', e?.message || e)); };
  // Marks are gathered for a few seconds and sent as one change per layer:
  // someone drawing quickly makes many small changes, and the server allows
  // each player only so many requests a minute.
  const waiting = new Map<string, { spec: any; up: Map<string, any>; del: Set<string> }>();
  let flushTimer: any = null;
  const flush = () => {
    flushTimer = null;
    for (const [layer, w] of waiting) {
      const up = [...w.up.values()], del = [...w.del];
      later(() => call('team.saveMarks', { teamId, layer, spec: w.spec, up, del }));
    }
    waiting.clear();
  };
  window.addEventListener('pagehide', () => { if (waiting.size) flush(); });
  return {
    teamId,
    saveMarks: (layer, spec, up, del) => {
      const w = waiting.get(layer) ?? { spec, up: new Map<string, any>(), del: new Set<string>() };
      w.spec = spec;
      for (const a of up) { if (a?.id != null) { w.up.set(String(a.id), a); w.del.delete(String(a.id)); } }
      for (const id of del) { w.del.add(String(id)); w.up.delete(String(id)); }
      waiting.set(layer, w);
      if (!flushTimer) flushTimer = setTimeout(flush, 3000);
    },
    say: text => later(() => call('team.say', { teamId, text })),
    complete: root => later(async () => { await call('team.complete', { teamId, root }); await loadTeams(); }),
  };
}

/** Why this team's cell cannot be opened here and now, or ''. */
export function cannotOpen(t: SavedTeam): string {
  if (canonicalDataset(t.dataset) !== here()) {
    const d = findDatasetByCanonical(canonicalDataset(t.dataset));
    return `Switch to ${d ? (d.shortLabel || d.label) : t.dataset} first.`;
  }
  return '';
}

/** Goes to the team's cell, brings in the team's saved marks and chat, and
 *  joins the team's live session (teammates who are in the game share live). */
export async function openTeam(t: SavedTeam): Promise<void> {
  const why = cannotOpen(t);
  if (why) throw new Error(why);
  if (t.mine !== 'joined') throw new Error('Join the team first.');
  const anchor = Array.isArray(t.anchor) && t.anchor.length === 3 ? (t.anchor as [number, number, number]) : undefined;
  // A claim keeps the cell's current ID; the team's own is the one from when it was made.
  let seg = t.segmentId;
  if (t.taskId != null) {
    const task = useProofreadingBackendStore().tasks.find((x: any) => x.id === t.taskId);
    if (task?.segment_id) seg = String(task.segment_id);
  }
  if (seg || anchor) useCellHistoryStore().jumpToCell(seg, anchor, { keep: false });
  const [marks, messages] = await Promise.all([
    call<any>('team.marks', { teamId: t.id }).catch(() => ({ layers: {} })),
    call<{ by: string; name: string; text: string; at: string }[]>('team.messages', { teamId: t.id }).catch(() => []),
  ]);
  const lines: TeamChatLine[] = messages.map(m => ({ by: m.by, name: m.name, color: '#9cc8ff', text: m.text, at: Date.parse(m.at) || Date.now() }));
  // The jump needs a moment to put the cell in the view before the session reads it.
  await new Promise(r => setTimeout(r, 900));
  await openSavedRoom(sinkFor(t.id), marks, lines);
}

// ── Keeping in step ─────────────────────────────────────────────────────
let started = false;
/** Call once a player is signed in. */
export function startTeams() {
  if (started || !me()) return;
  started = true;
  void loadTeams();
  // The list is read when the game opens, every quarter of an hour while it
  // is in front, whenever the Teams tab is open, and when a team notification
  // arrives. Not more often: every read is a request to the server, which
  // shares one daily allowance among all players.
  setInterval(() => { if (!document.hidden) void loadTeams(); }, 900_000);
  document.addEventListener('nge:teams-refresh', () => { void loadTeams(); });
  try {
    const b: any = useProofreadingBackendStore();
    watch(() => (b.notifications || []).length, (n: number, was: number) => {
      if (n > was && /^(🤝|🎉 Team)/.test(String(b.notifications?.[0]?.title || ''))) void loadTeams();
    });
  } catch { /* the quarter hour read still happens */ }
  // Completing the cell finishes the team, wherever in the game it is done
  // (the Delta menu, the claim's Complete button), with the session open or
  // not. The server completes a team once, so a second report changes nothing.
  try {
    (useProofreadingBackendStore() as any).$onAction(({ name, args, after }: any) => {
      if (name !== 'logEdit') return;
      const e = args?.[0] || {};
      if ((e.operation !== 'mark_complete' && e.operation !== 'complete_task') || e.metadata?.team_id || e.metadata?.team_room) return;
      after(() => {
        const root = String(e.segment_after ?? e.metadata?.final_segment_id ?? e.metadata?.root_id ?? '');
        if (!/^\d+$/.test(root)) return;
        const taskId = e.task_id ?? e.taskId ?? null;
        const mineActive = teamsState.teams.filter(t => t.mine === 'joined' && t.status === 'active');
        const hit = mineActive.find(t => (taskId != null && t.taskId === Number(taskId)) || t.segmentId === root || team.saved === t.id);
        if (!hit) return;
        void call('team.complete', { teamId: hit.id, root }).then(() => loadTeams()).catch(err => console.warn('[teams] completion not shared:', err?.message || err));
      });
    });
  } catch { /* completion is then shared only from an open session */ }
  // A session that came back by itself after a reload gets its sink again.
  watch(() => team.room, room => {
    if (room.startsWith(savedRoom('')) && !team.saved) attachSaved(sinkFor(room.slice(savedRoom('').length)));
  }, { immediate: true });
}
