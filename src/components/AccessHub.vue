<script setup lang="ts">
/**
 * AccessHub.vue: the Access page, "?triage=access" (Ames 2026-11-09).
 * Everyone between asking for the beta and editing, one column per step,
 * with how long each person has been in it; the team's notes on a person
 * (Celia: "a place to leave notes on requests from people we don't know");
 * where the community is; and the tutorial boxes players linger on.
 *
 * One row per person comes from the view access_hub_people
 * (supabase-access-hub.sql), read by admins only through ewCommunityData.
 * Sorting a Beta request, notes and dataset decisions go through the server
 * (functions/access-request.js), as in Admin Hub.
 */
import { ref, computed, onMounted, watch } from 'vue';
import { supabase } from '../supabase';
import { secureWrite } from '../secure_write';
import { listDatasetRequests, decideDatasetRequest, type DatasetRequestRow } from '../dataset_access_request';
import { addPilot, welcomeBell, welcomeEmail } from '../beta_let_in';
import { datasetDisplayName } from '../datasets';
import { boxLink, PRACTICE_TUTORIALS } from '../tutorial_box_jump';
import { updateUsersSheet, readCanEdit, USERS_SHEET_URL } from '../quest_review';
import { TUTORIAL_NAMES } from '../tutorial_edits';
import { outcomeWord, type TestTry, type TestTriesList } from '../proofreading-test-review';

interface Person {
  email: string; user_id: string | null; name: string | null; username: string | null;
  request_id: string | null; asked_at: string | null; from_site: boolean | null; gave_email: string | null;
  ew_name: string | null; ew_rank: string | null; found_us: string | null; their_note: string | null;
  pilot_enabled: boolean | null; let_in_at: string | null; from_list: boolean;
  joined_at: string | null; tutorial_active: number | null; tutorial_at: string | null; tutorials: number;
  first_edit_at: string | null; last_edit_at: string | null; edits: number; last_dataset: string | null;
  edits_30d: number; cells: number; cells_30d: number; chats: number; chats_30d: number;
  help_asked: number; help_answered_for: number; help_asked_30d: number; help_given: number; help_given_30d: number;
  is_admin?: boolean;
  /** Princeton team, not a Pyr admin: shown with the admins, left out of the counts. */
  is_team?: boolean;
  /** When an admin typed in their EyeWire username, if one did. */
  ew_name_set_at?: string | null;
  /** The email on their EyeWire account, from their request (Ames 2026-11-12). */
  ew_email?: string | null;
  invited_at?: string | null; invited_for?: string | null; invited_role?: string | null; invited_as?: string | null;
}
/** One of a player's 10 latest edits (access_hub_recent_edits). */
interface RecentEdit { at: string; dataset: string | null; operation: string | null; success: boolean | null }
/** One player's last 30 days on one dataset (access_hub_player_datasets). */
interface PlayerDataset { dataset: string; edits: number; cells: number; chats: number; last_edit_at: string | null }
interface Activity { dataset: string; edits: number; editors: number; cells: number; finishers: number; chats: number; chatters: number }
interface Stat { tutorial: number; step: number; last_box: string | null; n: number; players: number; median_s: number; p90_s: number; help_rate: number; closes: number }
interface Note { id: string; text: string; by: string; at: string }
type Stage = 'asked' | 'emailed' | 'later' | 'letin' | 'signedin' | 'tutorial' | 'dataset' | 'editing' | 'removed' | 'admin';
interface Card { key: string; p: Person | null; ds: DatasetRequestRow | null; stage: Stage; since: string | null; listed: boolean }

const PEOPLE_COLS = 'email,user_id,name,username,request_id,asked_at,from_site,gave_email,ew_name,ew_rank,found_us,their_note,pilot_enabled,let_in_at,from_list,joined_at,tutorial_active,tutorial_at,tutorials,first_edit_at,last_edit_at,edits,last_dataset,edits_30d,cells,cells_30d,chats,chats_30d,help_asked,help_answered_for,help_asked_30d,help_given,help_given_30d,is_admin,invited_at,invited_for,invited_role,invited_as,ew_name_set_at,ew_email';
const people = ref<Person[]>([]);
// The Princeton team who play without being Pyr admins (Ames 2026-11-12:
// Ryan Morey, "team tag"). They sit with the admins and are not counted.
const TEAM_EMAILS = new Set(['ryan.t.morey@gmail.com']);
const teamUp = (p: Person): Person => (!p.is_admin && (TEAM_EMAILS.has(p.email) || TEAM_EMAILS.has(lc(p.gave_email || ''))) ? { ...p, is_admin: true, is_team: true } : p);
const marks = ref<Record<string, { mark: string; at: string }>>({});
const dsRows = ref<DatasetRequestRow[]>([]);
const notes = ref<Record<string, Note[]>>({});
const activity = ref<Activity[]>([]);
const stats = ref<Stat[]>([]);
/** One player in one tutorial (access_hub_tutorials): the last box they left, how, and when they finished. */
interface TutRow { user_id: string; tutorial: number; last_step: number | null; last_left: string | null; last_at: string | null; done_at: string | null }
const tutRows = ref<TutRow[]>([]);
const loading = ref(false);
const error = ref('');
const search = ref('');
const showRemoved = ref(false);
const showAdmins = ref(false);
const showLists = ref(false);
const openKey = ref('');
const busy = ref('');
const actionError = ref('');
const noteDraft = ref('');
const dsNote = ref('');
const emailed = ref<Record<string, string>>({});
// Asking for their EyeWire name by email (Ames 2026-11-12): who was asked,
// and the draft open in the panel (shown first, Edit to change it).
const asked = ref<Record<string, { at: string; by: string }>>({});
const inviteCount = ref<number | null>(null);
const signedInAll = ref<number | null>(null);
const ask = ref<{ email: string; subject: string; text: string; editing: boolean } | null>(null);
const testTries = ref<TestTry[]>([]);
/** CAVE edit access by email, from the Users sheet (refreshed hourly). */
const canEdit = ref<Record<string, string> | null>(null);

async function load() {
  loading.value = true; error.value = '';
  const problems: string[] = [];
  const read = async <T>(what: string, f: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await f(); } catch (e: any) { problems.push(`${what}: ${e?.message || 'could not be read'}`); return fallback; }
  };
  const table = async <T>(name: string, cols: string, limit: number): Promise<T[]> => {
    const { data, error: err } = await supabase.from(name).select(cols).limit(limit);
    if (err) throw new Error(err.message);
    return (data ?? []) as T[];
  };
  // The gateway gives at most 500 rows a read ("Invalid limit" past that,
  // Ames's phone 2026-11-09), so everyone is read in pages, in email order
  // (one row per email, so no page skips or repeats a person).
  const PAGE = 500;
  const paged = async <T>(name: string, cols: string, orders: string[]): Promise<T[]> => {
    const all: T[] = [];
    for (let from = 0; from < 20000; from += PAGE) {
      let q = supabase.from(name).select(cols);
      for (const o of orders) q = q.order(o);
      const { data, error: err } = await q.range(from, from + PAGE - 1);
      if (err) throw new Error(err.message);
      all.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
    }
    return all;
  };
  const everyone = async (): Promise<Person[]> => {
    const all: Person[] = [];
    for (let from = 0; from < 20000; from += PAGE) {
      const { data, error: err } = await supabase.from('access_hub_people').select(PEOPLE_COLS).order('email').range(from, from + PAGE - 1);
      if (err) throw new Error(err.message);
      all.push(...((data ?? []) as Person[]));
      if (!data || data.length < PAGE) break;
    }
    return all;
  };
  // Each part shows as soon as it arrives (Ames 2026-11-09: a refresh "takes
  // a while" when the page waited for the slowest read).
  const show = <T>(p: Promise<T>, set: (v: T) => void) => p.then(set);
  await Promise.all([
    show(read('People', everyone, [] as Person[]), v => { people.value = v.map(teamUp); }),
    show(read('Beta lists', async () => (await secureWrite<Record<string, { mark: string; at: string }>>('access.betaMarks')) || {}, {} as Record<string, { mark: string; at: string }>), v => { marks.value = v; }),
    show(read('Dataset requests', () => listDatasetRequests(), [] as DatasetRequestRow[]), v => { dsRows.value = v; }),
    show(read('Asked by email', async () => (await secureWrite<Record<string, { at: string; by: string }>>('access.askSent')) || {}, {} as Record<string, { at: string; by: string }>), v => { asked.value = v; }),
    show(read('Invites', async () => (await secureWrite<{ invited: number; signedIn?: number }>('access.inviteCount')) ?? null, null as { invited: number; signedIn?: number } | null), v => { inviteCount.value = v?.invited ?? null; signedInAll.value = v?.signedIn ?? null; }),
    show(read('Notes', async () => (await secureWrite<Record<string, Note[]>>('access.notes')) || {}, {} as Record<string, Note[]>), v => { notes.value = v; }),
    show(read('Community', () => table<Activity>('access_hub_activity', 'dataset,edits,editors,cells,finishers,chats,chatters', 200), [] as Activity[]), v => { activity.value = v; }),
    show(read('Dataset access', () => readCanEdit(), null as Record<string, string> | null), v => { canEdit.value = v; }),
    show(read('Test tries', async () => (await secureWrite<TestTriesList>('test.tries', { limit: 200 }))?.tries ?? [], [] as TestTry[]), v => { testTries.value = v; }),
    show(read('Tutorial places', () => paged<TutRow>('access_hub_tutorials', 'user_id,tutorial,last_step,last_left,last_at,done_at', ['user_id', 'tutorial']), [] as TutRow[]), v => { tutRows.value = v; }),
    show(read('Tutorial times', () => table<Stat>('tutorial_step_stats', 'tutorial,step,last_box,n,players,median_s,p90_s,help_rate,closes', 500), [] as Stat[]), v => { stats.value = v; }),
  ]);
  error.value = problems.join(' · ');
  loading.value = false;
}
// Beta request bells of requests dealt with here are marked read for every
// admin (Ames 2026-11-12), on open and after each action on a request.
const readBells = () => { void secureWrite('access.readHandledBetaBells').catch(() => { /* next time */ }); };
onMounted(() => { document.title = 'Pyr · Access'; void load().then(readBells); });

// ── Where each person is ─────────────────────────────────────────────────
const later = (...t: (string | null | undefined)[]) => t.filter(Boolean).sort().pop() || null;
const lc = (s: string | null | undefined) => String(s || '').toLowerCase();

const cards = computed<Card[]>(() => {
  const out: Card[] = [];
  const waitingDs = dsRows.value.filter(r => !r.mark);
  const dsFor = (p: Person) => waitingDs.find(r => (r.userId && r.userId === p.user_id) || (r.email && lc(r.email) === p.email));
  const used = new Set<string>();
  for (const p of people.value) {
    const ds = dsFor(p) || null;
    if (ds) used.add(ds.id);
    let stage: Stage; let since: string | null; let listed = false;
    if (ds) { stage = 'dataset'; since = ds.at; }
    // Admins are their own step (Ames 2026-11-10: "show admins as Admin").
    else if (p.is_admin) { stage = 'admin'; since = p.joined_at; }
    else if (p.request_id && !p.pilot_enabled) {
      const mk = marks.value[p.email];
      const fresh = mk && String(mk.at) >= String(p.asked_at);
      if (fresh && mk.mark === 'removed') { stage = 'removed'; since = mk.at; }
      // Later: off the Asked list, kept for when we take people new to
      // EyeWire (Ames 2026-11-10: "add to queue for later").
      else if (fresh && mk.mark === 'listed') { stage = 'later'; since = mk.at; listed = true; }
      // Emailed: we asked them by email after they asked, and wait on
      // their reply (Ames 2026-11-12: "put emailed into a separate column").
      // Back to Asked once we have typed in the EyeWire name they replied with.
      else if (asked.value[p.email] && String(asked.value[p.email].at) >= String(p.asked_at) && !(p.ew_name_set_at && String(p.ew_name_set_at) >= String(asked.value[p.email].at))) { stage = 'emailed'; since = asked.value[p.email].at; }
      else { stage = 'asked'; since = p.asked_at; }
    }
    else if (p.pilot_enabled === false) { stage = 'removed'; since = p.let_in_at; }
    else if (!p.joined_at) { stage = 'letin'; since = p.let_in_at; }
    else if (p.edits > 0) { stage = 'editing'; since = p.first_edit_at; }
    else if (p.tutorial_at) { stage = 'tutorial'; since = p.tutorial_at; }
    else { stage = 'signedin'; since = later(p.joined_at, p.let_in_at); }
    out.push({ key: p.email, p, ds, stage, since, listed });
  }
  // Dataset requests from players not on Pilot testers (they joined before it).
  for (const r of waitingDs) if (!used.has(r.id)) out.push({ key: r.email ? lc(r.email) : `user:${r.userId}`, p: null, ds: r, stage: 'dataset', since: r.at, listed: false });
  return out;
});

// ── Maybe the same person (Ames 2026-11-10: "some duplicates if we could
// detect"): the same full name, the same username, or an EyeWire username
// that starts another's email or username. Same person links the emails
// (access.linkEmails); Not the same is remembered in this browser.
const NOT_SAME_KEY = 'nge_access_not_same_v1';
const notSame = ref<string[]>((() => { try { return JSON.parse(localStorage.getItem(NOT_SAME_KEY) || '[]'); } catch { return []; } })());
const pairKey = (a: string, b: string) => [a, b].sort().join('|');
const dupes = computed<Record<string, Person[]>>(() => {
  const ps = people.value.filter(p => !p.is_admin);
  const local = (e: string) => e.split('@')[0];
  const fullName = (p: Person) => { const n = lc(p.name).trim().replace(/\s+/g, ' '); return n.includes(' ') && n.length >= 5 ? n : ''; };
  const ew = (p: Person) => { const n = lc(p.ew_name).trim(); return n.length >= 4 ? n : ''; };
  const same = (a: Person, b: Person) => {
    if (fullName(a) && fullName(a) === fullName(b)) return true;
    if (a.username && lc(a.username) === lc(b.username)) return true;
    for (const [x, y] of [[a, b], [b, a]]) {
      const e = ew(x);
      if (e && (local(y.email).startsWith(e) || lc(y.username).startsWith(e) || e === ew(y))) return true;
    }
    return false;
  };
  const out: Record<string, Person[]> = {};
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (a.email === b.email || notSame.value.includes(pairKey(a.email, b.email)) || !same(a, b)) continue;
    (out[a.email] = out[a.email] || []).push(b);
    (out[b.email] = out[b.email] || []).push(a);
  }
  return out;
});
const dupesOf = (c: Card | null | undefined) => (c?.p ? dupes.value[c.p.email] ?? [] : []);
function markNotSame(a: string, b: string) {
  notSame.value = [...notSame.value, pairKey(a, b)];
  try { localStorage.setItem(NOT_SAME_KEY, JSON.stringify(notSame.value)); } catch { /* this visit only */ }
}

// ── EyeWire stats, read from eyewire.org's public player pages (open to any
// page, no sign in): points, cubes, accuracy, roles and when they joined.
interface EwStats { points: number; cubes: number; accuracy: number | null; roles: string[]; joined: number | null; country: string | null }
const ewStats = ref<Record<string, EwStats | 'none' | 'reading'>>({});
async function readEw(name: string) {
  const k = lc(name).trim();
  if (!k || ewStats.value[k]) return;
  ewStats.value = { ...ewStats.value, [k]: 'reading' };
  const get = async (what: string) => { try { const r = await fetch(`https://eyewire.org/1.0/player/${encodeURIComponent(k)}/${what}`); return r.ok ? await r.json() : null; } catch { return null; } };
  let v: EwStats | 'none' = 'none';
  // The bio page (join date, roles) sends no CORS header, so the server reads it.
  const bioOf = async () => { try { const b = await secureWrite<any>('access.ewBio', { name: k }); return b && !b.none ? b : null; } catch { return null; } };
  const [st, bio] = await Promise.all([get('stats'), bioOf()]);
  if (st || bio) {
    const f = st?.forever ?? {};
    const fs = Array.isArray(st?.fscore) && st.fscore.length ? Number(st.fscore[0].fscore) : NaN;
    v = { points: Number(f.points) || 0, cubes: Number(f.cubes) || 0, accuracy: Number.isFinite(fs) ? fs : null,
      roles: Array.isArray(bio?.roles) ? bio.roles.map(String) : [], joined: Number(bio?.joined) || null, country: bio?.country ? String(bio.country) : null };
  }
  ewStats.value = { ...ewStats.value, [k]: v };
}
const ewOf = (p: Person | null | undefined) => (p?.ew_name ? ewStats.value[lc(p.ew_name).trim()] ?? null : null);
const ewFound = (p: Person | null | undefined): EwStats | null => { const v = ewOf(p); return v && typeof v === 'object' ? v : null; };
const ewShort = (p: Person | null | undefined) => {
  const v = ewOf(p);
  if (v === 'none') return `EyeWire ${p?.ew_name}: not found`;
  const f = ewFound(p);
  if (!f) return `EyeWire ${p?.ew_name ?? ''}`;
  return `EyeWire ${p?.ew_name}: ${f.cubes ? f.cubes.toLocaleString() + ' cubes' : 'new'}`;
};
const openEw = computed(() => ewFound(open.value?.p ?? null));
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

const nameOf = (c: Card) => c.p?.name || c.ds?.name || c.p?.username || 'No name yet';
const emailOf = (c: Card) => c.p?.email || c.ds?.email || '';
const words = computed(() => search.value.toLowerCase().split(/\s+/).filter(Boolean));
const matches = (c: Card) => !words.value.length || words.value.every(w =>
  [nameOf(c), emailOf(c), c.p?.username, c.p?.ew_name, c.p?.gave_email, c.p?.ew_email, c.ds?.label].map(lc).join(' ').includes(w));
// A search that finds one person opens them, with their stats (Ames
// 2026-11-09: "shouldn't it show stats for user and recent activity?").
const found = computed(() => (words.value.length ? cards.value.filter(matches) : []));
watch(() => found.value.map(c => c.key).join('|'), () => {
  if (found.value.length === 1 && openKey.value !== found.value[0].key) pick(found.value[0]);
});

const ms = (a: string | null, b: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : NaN);
const median = (xs: number[]) => { const v = xs.filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
/** How long people take to move on from each step, from those who did. */
const typical = computed<Record<string, number>>(() => {
  const ps = people.value;
  return {
    asked: median(ps.filter(p => p.request_id).map(p => ms(p.asked_at, p.let_in_at))),
    letin: median(ps.filter(p => !p.from_list).map(p => ms(p.let_in_at, p.joined_at))),
    signedin: median(ps.map(p => ms(later(p.joined_at, p.let_in_at), p.tutorial_at))),
    tutorial: median(ps.map(p => ms(p.tutorial_at, p.first_edit_at))),
    dataset: median(dsRows.value.filter(r => r.mark && r.markedAt).map(r => ms(r.at, r.markedAt))),
    editing: NaN,
  };
});
const COLUMNS: { stage: Stage; title: string; sub: string; ours?: boolean }[] = [
  { stage: 'asked', title: 'Asked', sub: 'Beta request, waiting on us', ours: true },
  { stage: 'emailed', title: 'Emailed', sub: 'we asked them by email, waiting on their reply', ours: true },
  { stage: 'letin', title: 'Let in', sub: 'not signed in yet' },
  { stage: 'signedin', title: 'Signed in', sub: 'no tutorial finished yet' },
  { stage: 'tutorial', title: 'Tutorial done', sub: 'no edits yet' },
  { stage: 'dataset', title: 'Asked for a dataset', sub: 'waiting on us', ours: true },
  { stage: 'editing', title: 'Editing', sub: 'made an edit' },
];
const inStage = (s: Stage) => cards.value.filter(c => c.stage === s);
// Let in is mostly people who never answered (Ames 2026-11-10: "I don't
// need to see all the cards of the ppl who haven't replied"): the newest
// few, then a fold for the rest. A search still finds everyone.
const LETIN_SHOWN = 5;
const columnCards = (s: Stage) => {
  const rows = inStage(s).filter(matches);
  if (s === 'editing') return rows.sort((a, b) => String(b.p?.last_edit_at).localeCompare(String(a.p?.last_edit_at)));
  if (s === 'letin') {
    rows.sort((a, b) => String(b.since).localeCompare(String(a.since)));
    if (showLists.value || words.value.length) return rows;
    return rows.filter(c => !c.p?.from_list).slice(0, LETIN_SHOWN);
  }
  // Everything else: waiting longest first.
  return rows.sort((a, b) => String(a.since).localeCompare(String(b.since)));
};
const letinHidden = computed(() => Math.max(0, inStage('letin').length - columnCards('letin').length));

// The Editing column is off by default (Ames 2026-11-10: "we could remove
// the Editing tab by default"); the leaderboard below ranks them instead.
const EDITING_KEY = 'nge_access_editing_col_v1';
const showEditingCol = ref((() => { try { return localStorage.getItem(EDITING_KEY) === '1'; } catch { return false; } })());
function toggleEditingCol() {
  showEditingCol.value = !showEditingCol.value;
  try { localStorage.setItem(EDITING_KEY, showEditingCol.value ? '1' : '0'); } catch { /* not remembered */ }
}
const boardColumns = computed(() => COLUMNS.filter(c => c.stage !== 'editing' || showEditingCol.value));
// Requests waiting on us sit above everyone else's progress (Ames
// 2026-11-10: "pending requests above list of all users who are at
// various stages of tutorials"). No late outlines: waiting longest is
// already first, and someone who stopped playing is not on us.
// Each section folds, and the page remembers it (Ames 2026-11-12: "I want
// to be able to collapse these").
const FOLD_KEY = 'nge_access_folded_v1';
const folded = ref(new Set<string>((() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '[]') as string[]; } catch { return []; } })()));
function toggleFold(k: string) {
  const s = new Set(folded.value);
  if (s.has(k)) s.delete(k); else s.add(k);
  folded.value = s;
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...s])); } catch { /* this visit only */ }
}
const boardGroups = computed(() => [
  { title: 'Waiting on us', cols: boardColumns.value.filter(c => c.ours) },
  { title: 'Getting started', cols: boardColumns.value.filter(c => !c.ours) },
]);

// The admins' leaderboard (Ames 2026-11-10: "rank them by top, sort of like
// leaderboard ... like an admin version"): everyone who has edited, ranked
// over the last 30 days or all time, by edits, cells done or help given.
type LbSpan = '30d' | 'all';
type LbBy = 'edits' | 'cells' | 'help';
const lbSpan = ref<LbSpan>('30d');
const lbBy = ref<LbBy>('edits');
const lbAll = ref(false);
const LB_SHOWN = 10;
const lbVal = (p: Person, by: LbBy, span: LbSpan) => by === 'edits' ? (span === '30d' ? p.edits_30d : p.edits)
  : by === 'cells' ? (span === '30d' ? p.cells_30d : p.cells) : (span === '30d' ? p.help_given_30d : p.help_given);
const lbRows = computed(() => cards.value
  .filter(c => c.p && c.stage !== 'admin' && (c.p.edits > 0 || c.p.cells > 0 || c.p.help_given > 0))
  .filter(matches)
  .map(c => ({ c, p: c.p as Person, v: lbVal(c.p as Person, lbBy.value, lbSpan.value) }))
  .filter(r => r.v > 0)
  .sort((a, b) => b.v - a.v || String(b.p.last_edit_at).localeCompare(String(a.p.last_edit_at))));
const lbMax = computed(() => Math.max(1, ...lbRows.value.map(r => r.v)));
const lbShown = computed(() => (lbAll.value || words.value.length ? lbRows.value : lbRows.value.slice(0, LB_SHOWN)));
const LB_BY: { key: LbBy; label: string }[] = [{ key: 'edits', label: 'Edits' }, { key: 'cells', label: 'Cells done' }, { key: 'help', label: 'Help given' }];
const adminCards = computed(() => inStage('admin').filter(matches).sort((a, b) => nameOf(a).localeCompare(nameOf(b))));
const laterCards = computed(() => inStage('later').filter(matches).sort((a, b) => String(a.since).localeCompare(String(b.since))));
const showLater = ref(false);
// Overall numbers (Ames 2026-11-10: "# users (signed in, passed tutorial 1,
// production access)"). Admins left out. Dataset access: anyone CAVE lets
// edit a real dataset (not a public or practice one), as the Users sheet's
// Can edit column says, read from CAVE every hour (Ames: "more than 4 ppl
// have dataset access"; granted requests alone missed anyone added by hand).
const realEdit = (list: string | undefined) => (list || '').split(',').map(x => x.trim()).filter(x => x && !/ public$/i.test(x));
const totals = computed(() => {
  const ps = people.value.filter(p => !p.is_admin);
  const withAccess = ps.filter(p => realEdit(canEdit.value?.[p.email]).length);
  const byDs: Record<string, number> = {};
  for (const p of withAccess) for (const d of realEdit(canEdit.value?.[p.email])) byDs[d] = (byDs[d] || 0) + 1;
  const split = Object.entries(byDs).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', ');
  return [
    // People opens the Pyr Users sheet, the game's hourly copy of everyone (Ames 2026-11-12).
    // Everyone we emailed an invite (access_invites), and how many of them asked.
    { label: 'Invited by email', n: inviteCount.value ?? NaN, title: inviteCount.value == null ? 'Could not read the invite list' : `We emailed ${inviteCount.value} EyeWire players an invite. ${ps.filter(p => p.invited_at).length} of them asked or are in` },
    // Ames 2026-11-12: emails added to Pilot testers ahead of time do not
    // count; asked, and signed in (everyone, also those who never asked) do.
    { label: 'Total access requests', n: ps.filter(p => p.request_id).length, title: 'Sent a Beta request, from connectome.quest or in Pyr' },
    { label: 'Signed in', n: signedInAll.value ?? ps.filter(p => p.joined_at).length, title: 'Signed in to Pyr at least once, admins left out. Opens the Pyr Users sheet', href: USERS_SHEET_URL },
    { label: 'Finished a tutorial', n: ps.filter(p => p.tutorial_at).length, title: 'Finished their first tutorial' },
    { label: 'Made an edit', n: ps.filter(p => p.edits > 0).length, title: 'At least one merge or split' },
    { label: 'Dataset access', n: canEdit.value ? withAccess.length : NaN, title: canEdit.value ? `Can edit a real dataset in CAVE, as of the Users sheet's last hourly update${split ? ': ' + split : ''}` : 'Could not read the Users sheet' },
  ];
});
const removedCards = computed(() => inStage('removed').filter(matches).sort((a, b) => String(b.since).localeCompare(String(a.since))));

// ── Words ────────────────────────────────────────────────────────────────
function ago(iso: string | null): string {
  if (!iso) return '';
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h`;
  const d = Math.round(m / 1440);
  return `${d} day${d === 1 ? '' : 's'}`;
}
function span(t: number): string {
  if (!Number.isFinite(t)) return 'not enough yet';
  const m = t / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  if (m < 60 * 36) return `${Math.round(m / 60)} hours`;
  return `${Math.round(m / 1440)} days`;
}
// We invited them by email (access_invites, Ames 2026-11-12): the envelope
// on the card, and this line on hover and in the panel.
const CAMPAIGN: Record<string, string> = { mec_talk: 'the MEC talk email' };
function invitedLine(p: Person | null | undefined): string {
  if (!p?.invited_at) return '';
  if (p.invited_for === 'by_hand') return `An EyeWire player: their EyeWire username was added on this page ${day(p.invited_at)}.`;
  const what = CAMPAIGN[p.invited_for || ''] || 'an invite email';
  const role = p.invited_role ? ` as an EyeWire ${p.invited_role}` : '';
  const to = p.invited_as && p.invited_as !== p.email ? ` at ${p.invited_as}` : '';
  return `We invited them by email${role}: ${what}, ${day(p.invited_at)}${to}.`;
}
const day = (iso: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); } catch { return ''; } };
const dsName = (seg: string | null) => datasetDisplayName(seg);
const noteCount = (c: Card) => (notes.value[c.key] || []).length;

// ── One person, in the side panel ────────────────────────────────────────
const open = computed(() => cards.value.find(c => c.key === openKey.value) || null);
// A tag's link opens that person (Ames 2026-11-10, tags in notes):
// "?triage=access&person=<email or user:id>". Used once.
const wantPerson = (() => { try { return (new URLSearchParams(location.search).get('person') || '').toLowerCase(); } catch { return ''; } })();
if (wantPerson) {
  let found = false;
  const stop = watch(cards, list => {
    const c = found ? null : list.find(x => x.key.toLowerCase() === wantPerson);
    if (!c) return;
    found = true; openKey.value = c.key;
    try { const u = new URL(location.href); u.searchParams.delete('person'); history.replaceState(history.state, '', u.toString()); } catch { /* keep going */ }
    queueMicrotask(() => stop());
  }, { immediate: true });
}
// Read EyeWire for the people waiting on us, and anyone opened.
watch(() => cards.value.filter(c => c.stage === 'asked' || c.stage === 'emailed' || c.stage === 'later' || c.stage === 'dataset' || c.key === openKey.value).map(c => c.p?.ew_name).filter(Boolean).join('|'),
  names => { for (const n of names.split('|')) if (n) void readEw(n); }, { immediate: true });
/** The email without a Pyr account folds into the one with (the view keeps
 *  the account's email). Two accounts: they stay apart. */
// Type in their EyeWire username by hand (Ames 2026-11-12), often from their
// reply to the ask email; the EyeWire stats fill in from eyewire.org.
const ewDraft = ref('');
const ewEdit = ref('');
function startEwEdit(c: Card) { ewEdit.value = c.key; ewDraft.value = c.p?.ew_name || ''; actionError.value = ''; }
const saveEwName = (c: Card) => run('ewname', async () => {
  const p = c.p; const name = ewDraft.value.trim();
  if (!p || !name) return;
  const out = await secureWrite<{ ewName: string }>('access.setEwName', { email: p.email, ewName: name });
  const at = new Date().toISOString();
  const ew = out?.ewName || name.toLowerCase();
  people.value = people.value.map(x => x.email === p.email ? { ...x, ew_name: ew, ew_name_set_at: at, invited_at: x.invited_at || at, invited_for: x.invited_for || 'by_hand' } : x);
  ewDraft.value = ''; ewEdit.value = '';
  void readEw(ew);
});
const linkSame = (a: Person | null | undefined, b: Person) => run('link', async () => {
  if (!a) return;
  if (a.user_id && b.user_id) throw new Error('Both have their own Pyr account, so they stay as two people.');
  const [from, to] = a.user_id ? [b, a] : [a, b];
  await secureWrite('access.linkEmails', { email: from.email, to: to.email });
  openKey.value = to.email;
  await load();
});
function pick(c: Card) { openKey.value = openKey.value === c.key ? '' : c.key; actionError.value = ''; noteDraft.value = ''; dsNote.value = ''; ewDraft.value = ''; ewEdit.value = ''; }
// Their Proofreading Test tries, on a dataset request (Ames 2026-11-10:
// "access request test edits linked"). The tries name the player by
// username, newest first.
const triesOf = (c: Card | null | undefined) => {
  const u = lc(c?.p?.username);
  return u ? testTries.value.filter(t => lc(t.username) === u) : [];
};
const tryLine = (t: TestTry) => {
  const bits = [outcomeWord(t)];
  if (t.percent != null && (t.outcome === 'pass' || t.outcome === 'fail')) bits[0] += ` (${Math.round(Number(t.percent))}%)`;
  if (t.found != null && t.errors != null) bits.push(`${t.found} of ${t.errors} mistake${t.errors === 1 ? '' : 's'} fixed`);
  if (t.ends_total) bits.push(`${t.ends_found ?? 0} of ${t.ends_total} ends marked`);
  if (t.damaged != null && t.found != null) bits.push(t.damaged ? `${t.damaged} real branch${t.damaged === 1 ? '' : 'es'} cut off` : 'nothing damaged');
  return bits.join(' · ');
};
/** Anything to show beyond zeros (Ames 2026-11-10: "why would we have
 *  stats ... for someone who hasn't joined?"). */
const played = (p: Person) => !!(p.edits || p.tutorials || p.tutorial_active || p.chats || p.help_asked || p.help_given || p.cells);
const timeline = computed(() => {
  const p = open.value?.p; if (!p) return [];
  return [
    ['Asked', p.asked_at], ['Let in', p.let_in_at], ['Signed in', p.joined_at],
    ['First tutorial done', p.tutorial_at], ['First edit', p.first_edit_at], ['Latest edit', p.last_edit_at],
  ].filter(([, t]) => t) as [string, string][];
});
async function run(what: string, f: () => Promise<void>) {
  busy.value = what; actionError.value = '';
  try { await f(); } catch (e: any) { actionError.value = e?.message || 'That did not save. Try again.'; }
  busy.value = '';
}
const letIn = (c: Card) => run('letin', async () => {
  const p = c.p!; await addPilot(p.email);
  readBells();
  void welcomeBell(p.user_id);
  emailed.value = { ...emailed.value, [p.email]: 'Sending the email…' };
  void welcomeEmail(p.email, p.name || '').then(s => { emailed.value = { ...emailed.value, [p.email]: s }; });
  people.value = people.value.map(x => x.email === p.email ? { ...x, pilot_enabled: true, let_in_at: x.let_in_at || new Date().toISOString() } : x);
});
const markBeta = (c: Card, mark: 'listed' | 'removed' | 'waiting') => run(mark, async () => {
  marks.value = (await secureWrite<Record<string, { mark: string; at: string }>>('access.betaMark', { email: c.p!.email, mark })) || {};
  readBells();
});
const openAsk = (c: Card) => run('askdraft', async () => {
  const d = await secureWrite<{ subject: string; text: string }>('access.askDraft', { email: c.p!.email, name: nameOf(c), ewName: c.p!.ew_name || '' });
  ask.value = { email: c.p!.email, subject: d?.subject || '', text: d?.text || '', editing: false };
});
const sendAsk = (c: Card) => run('ask', async () => {
  const a = ask.value; if (!a || a.email !== c.p!.email) return;
  const r = await secureWrite<{ sent: boolean; reason?: string; at?: string }>('access.askEmail',
    { email: a.email, name: nameOf(c), subject: a.subject, text: a.text, again: !!asked.value[a.email] });
  if (!r?.sent) throw new Error(r?.reason === 'not set up' ? 'Email is not set up.' : 'Already asked. Reload the page to see when.');
  asked.value = { ...asked.value, [a.email]: { at: r.at || new Date().toISOString(), by: '' } };
  readBells();
  ask.value = null;
});
const askOpen = computed(() => !!ask.value && !!open.value?.p && ask.value.email === open.value.p.email);
const decide = (c: Card, mark: 'granted' | 'declined', byHand = false) => run(mark, async () => {
  dsRows.value = await decideDatasetRequest(c.ds!.id, mark, dsNote.value, byHand); dsNote.value = '';
});
// Send me a test (Ames 2026-11-14): the notification this dataset's grant
// sends, to my own bell, titled "Test:" so nobody else is told.
const testSent = ref('');
const testBell = (c: Card) => run('test', async () => {
  await secureWrite('access.datasetTestBell', { dataset: c.ds!.dataset, label: c.ds!.label });
  testSent.value = c.ds!.id;
});
const addNote = (c: Card) => run('note', async () => {
  const text = noteDraft.value.trim(); if (!text) throw new Error('Write a note first.');
  notes.value = (await secureWrite<Record<string, Note[]>>('access.note', { key: c.key, text, name: nameOf(c) })) || {}; noteDraft.value = '';
});
const deleteNote = (c: Card, id: string) => run('note', async () => {
  notes.value = (await secureWrite<Record<string, Note[]>>('access.noteDelete', { key: c.key, id })) || {};
});

// ── Where the community is, and the tutorial ─────────────────────────────
const places = computed(() => {
  const by = new Map<string, Activity>();
  for (const a of activity.value) {
    const name = dsName(a.dataset);
    const had = by.get(name);
    // Old training volumes share a name with their dataset: added together.
    by.set(name, had ? { ...had, edits: had.edits + a.edits, editors: Math.max(had.editors, a.editors), cells: had.cells + a.cells, finishers: Math.max(had.finishers, a.finishers), chats: had.chats + a.chats, chatters: Math.max(had.chatters, a.chatters) } : { ...a, dataset: name });
  }
  return [...by.values()].filter(a => a.edits + a.cells + a.chats > 0).sort((a, b) => b.edits - a.edits || b.chats - a.chats);
});
const maxEdits = computed(() => Math.max(1, ...places.value.map(a => a.edits)));
const slowSteps = computed(() => stats.value.filter(s => s.players >= 2).sort((a, b) => Number(b.median_s) - Number(a.median_s)).slice(0, 8));
const maxStep = computed(() => Math.max(1, ...slowSteps.value.map(s => Number(s.median_s))));
const tutPlayers = computed(() => Math.max(0, ...stats.value.map(s => s.players)));
// The tutorials as a flow (Ames 2026-11-12: "show which tutorial users are
// on like a flow chart and then when I click on a tutorial ... show what
// step users are on and like average time spent per step"). The main path
// in the order of the game's menu, then the others. Counts are players on
// this page (not admins): finished, and in it now (the tutorial the game
// says they are in, not finished). Open one for its boxes: the median time
// on each, how many reached it, and who is on it now.
const FLOW_MAIN = [1, 3, 5, 2, 11];
const FLOW_MORE = [9, 13, 14, 4, 6, 7, 8, 10];
const tutName = (t: number) => TUTORIAL_NAMES[t] ?? `Tutorial ${t}`;
const players = computed(() => new Map(people.value.filter(p => p.user_id && !p.is_admin).map(p => [p.user_id as string, p])));
const tutOf = computed(() => {
  const m = new Map<string, TutRow>();
  for (const r of tutRows.value) m.set(`${r.user_id}|${r.tutorial}`, r);
  return m;
});
const nodes = computed(() => {
  const out: Record<number, { done: number; now: number }> = {};
  for (const t of [...FLOW_MAIN, ...FLOW_MORE]) out[t] = { done: 0, now: 0 };
  for (const r of tutRows.value) if (r.done_at && out[r.tutorial] && players.value.has(r.user_id)) out[r.tutorial].done++;
  for (const p of players.value.values()) {
    const t = p.tutorial_active; if (!t || !out[t]) continue;
    if (!tutOf.value.get(`${p.user_id}|${t}`)?.done_at) out[t].now++;
  }
  return out;
});
const openTut = ref<number | null>(null);
/** The box a player is on: the one after the box they left with Next. */
function stepNow(r: TutRow | undefined): number | null {
  if (!r || r.last_step == null) return null;
  if (r.last_left === 'next' || r.last_left === 'auto') return r.last_step + 1;
  if (r.last_left === 'back') return Math.max(0, r.last_step - 1);
  return r.last_step;
}
interface StepRow { step: number; name: string; s: Stat | null; here: Person[] }
const tutOpen = computed(() => {
  const t = openTut.value; if (t == null) return null;
  const steps = stats.value.filter(s => s.tutorial === t).sort((a, b) => a.step - b.step);
  const here = new Map<number, Person[]>(); const unknown: Person[] = [];
  for (const p of players.value.values()) {
    if (p.tutorial_active !== t) continue;
    const r = tutOf.value.get(`${p.user_id}|${t}`);
    if (r?.done_at) continue;
    const s = stepNow(r);
    if (s == null) unknown.push(p); else here.set(s, [...(here.get(s) || []), p]);
  }
  const rows: StepRow[] = steps.map(s => ({ step: s.step, name: boxName(s), s, here: here.get(s.step) || [] }));
  // Someone on a box nobody has left yet (often the last one).
  for (const [step, ps] of here) if (!steps.some(s => s.step === step)) rows.push({ step, name: `Box ${step + 1}`, s: null, here: ps });
  rows.sort((a, b) => a.step - b.step);
  const first = steps[0]?.players || 0;
  const total = steps.reduce((n, s) => n + Number(s.median_s || 0), 0);
  const maxMedian = Math.max(1, ...steps.map(s => Number(s.median_s || 0)));
  return { t, rows, unknown, first, total, maxMedian };
});
function openPerson(p: Person) {
  const c = cards.value.find(x => x.key === p.email);
  if (c) { openKey.value = c.key; actionError.value = ''; }
}
const secs = (v: number) => { const s = Math.round(Number(v) || 0); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`; };
const boxName = (s: Stat) => String(s.last_box || `Box ${s.step + 1}`).replace(/\s+/g, ' ').slice(0, 70);
const triageUrl = `${window.location.origin}${window.location.pathname}?triage=board`;
const gameUrl = `${window.location.origin}${window.location.pathname}`;

// Our own Pyr Users sheet (Ames: "make our own Pyr users sheet"): the game
// rewrites it every hour; this button does it now.
const sheetBusy = ref(false);
const sheetSaid = ref('');
async function updateSheet() {
  sheetBusy.value = true; sheetSaid.value = '';
  try { const out = await updateUsersSheet(); sheetSaid.value = `Sheet updated: ${out.people} people.`; }
  catch (e: any) { sheetSaid.value = e?.message || 'The sheet did not update. Try again.'; }
  sheetBusy.value = false;
}

// ── One player's latest edits, read when their panel opens (Ames: "10
// recent edits"; no chat, that's theirs) ────────────────────────────────
const recent = ref<RecentEdit[]>([]);
const recentFor = ref('');
const recentError = ref('');
// Their 30 days, dataset by dataset (Ames: "snapshot of their activity
// across datasets for 30 days"). Old training volumes share a name with
// their dataset and are added together, as on the community board.
const theirDatasets = ref<PlayerDataset[]>([]);
const theirMax = computed(() => Math.max(1, ...theirDatasets.value.map(d => d.edits)));
// Their CAVE user id, the number on their edits in CAVE and Codex (Celia
// #528). Pyr saves it the first time they open the game.
const caveId = ref<number | null>(null);
const caveCopied = ref(false);
function copyCaveId() {
  if (caveId.value == null) return;
  void navigator.clipboard?.writeText(String(caveId.value)).then(() => { caveCopied.value = true; setTimeout(() => { caveCopied.value = false; }, 1500); });
}
watch(() => open.value?.p?.user_id || '', async (uid) => {
  recent.value = []; theirDatasets.value = []; recentError.value = ''; recentFor.value = ''; caveId.value = null;
  if (!uid) return;
  void supabase.from('users').select('cave_user_id').eq('id', uid).limit(1).then(({ data }) => {
    if ((open.value?.p?.user_id || '') === uid) caveId.value = (data?.[0] as { cave_user_id?: number | null } | undefined)?.cave_user_id ?? null;
  });
  const [r, d] = await Promise.all([
    open.value?.p?.edits ? supabase.from('access_hub_recent_edits').select('at,dataset,operation,success').eq('user_id', uid).order('at', { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null }),
    supabase.from('access_hub_player_datasets').select('dataset,edits,cells,chats,last_edit_at').eq('user_id', uid).limit(100),
  ]);
  if ((open.value?.p?.user_id || '') !== uid) return;
  recent.value = (r.data ?? []) as RecentEdit[];
  const by = new Map<string, PlayerDataset>();
  for (const x of (d.data ?? []) as PlayerDataset[]) {
    const name = dsName(x.dataset), had = by.get(name);
    by.set(name, had ? { dataset: name, edits: had.edits + x.edits, cells: had.cells + x.cells, chats: had.chats + x.chats,
      last_edit_at: [had.last_edit_at, x.last_edit_at].filter(Boolean).sort().pop() ?? null } : { ...x, dataset: name });
  }
  theirDatasets.value = [...by.values()].sort((a, b) => b.edits - a.edits || b.cells - a.cells || b.chats - a.chats);
  recentError.value = [r.error && `Edits: ${r.error.message}`, d.error && `Datasets: ${d.error.message}`].filter(Boolean).join(' · ');
  recentFor.value = uid;
});
// edit_log's operations, in the game's words.
const OP_NAMES: Record<string, string> = {
  merge: 'Merge', split: 'Cut', annotate: 'Annotation', mark_complete: 'Marked a cell done', unmark_complete: 'Unmarked a cell',
  set_cell_type: 'Set a cell type', claim_task: 'Claimed a cell', complete_task: 'Finished a cell', release_task: 'Let go of a cell',
};
const opName = (e: RecentEdit) => {
  const o = String(e.operation || '').toLowerCase();
  const word = OP_NAMES[o] || (o ? (o[0].toUpperCase() + o.slice(1)).replace(/_/g, ' ') : 'Edit');
  return e.success === false ? `${word} (did not go through)` : word;
};
</script>

<template>
  <div class="ah">
    <header class="ah-head">
      <h1>Access</h1>
      <span class="ah-sum" v-if="people.length">
        {{ inStage('asked').length }} Beta request{{ inStage('asked').length === 1 ? '' : 's' }} and {{ inStage('dataset').length }} dataset request{{ inStage('dataset').length === 1 ? '' : 's' }} waiting on us<template v-if="inStage('emailed').length">, {{ inStage('emailed').length }} emailed</template><template v-if="inStage('later').length">, {{ inStage('later').length }} for later</template>
      </span>
      <input v-model="search" class="ah-search" type="search" autocomplete="off" placeholder="Search a name, email or username" aria-label="Search people" />
      <button class="ah-btn" type="button" :disabled="loading" @click="load">{{ loading ? 'Reading…' : 'Refresh' }}</button>
      <a class="ah-link" :href="triageUrl">Triage board</a>
      <a class="ah-link" :href="USERS_SHEET_URL" target="_blank" rel="noopener">Pyr Users sheet</a>
      <button class="ah-btn" type="button" :disabled="sheetBusy" title="The game rewrites the sheet every hour. This does it now." @click="updateSheet">{{ sheetBusy ? 'Updating the sheet…' : 'Update the sheet now' }}</button>
      <span v-if="sheetSaid" class="ah-quiet ah-sheet-said" role="status">{{ sheetSaid }}</span>
    </header>
    <div v-if="people.length" class="ah-totals" aria-label="Overall">
      <component :is="t.href ? 'a' : 'div'" v-for="t in totals" :key="t.label" class="ah-total" :class="{ 'ah-total--link': t.href }" :title="t.title"
                 :href="t.href || undefined" :target="t.href ? '_blank' : undefined" :rel="t.href ? 'noopener' : undefined"><b>{{ Number.isFinite(t.n) ? t.n.toLocaleString() : '…' }}</b><span>{{ t.label }}<template v-if="t.href"> ↗</template></span></component>
    </div>
    <p v-if="error" class="ah-error" role="alert">{{ error }}</p>
    <p v-if="loading && !people.length" class="ah-quiet">Reading everyone…</p>

    <div class="ah-main" :class="{ 'ah-main--open': open }">
      <section class="ah-boards" aria-label="People by step">
       <div v-for="g in boardGroups" :key="g.title" class="ah-group">
        <h2 class="ah-group-title"><button type="button" class="ah-fold-btn" :aria-expanded="!folded.has('g:' + g.title)" @click="toggleFold('g:' + g.title)"><span class="ah-fold-mark" aria-hidden="true">{{ folded.has('g:' + g.title) ? '▸' : '▾' }}</span>{{ g.title }}</button></h2>
        <div v-if="!folded.has('g:' + g.title)" class="ah-board">
        <div v-for="col in g.cols" :key="col.stage" class="ah-col" :class="{ 'ah-col--ours': col.ours }">
          <div class="ah-col-head">
            <span class="ah-col-title">{{ col.title }}</span>
            <span class="ah-col-n">{{ inStage(col.stage).length }}</span>
          </div>
          <div class="ah-col-sub">{{ col.sub }}</div>
          <div v-if="col.stage !== 'editing' && col.stage !== 'emailed'" class="ah-col-typ" title="How long people usually take to move on from this step">usually moves on in {{ span(typical[col.stage]) }}</div>
          <div class="ah-col-list">
            <button v-for="c in columnCards(col.stage)" :key="col.stage + c.key" type="button" class="ah-card"
                    :class="{ 'ah-card--open': openKey === c.key }" @click="pick(c)">
              <span class="ah-card-name">{{ nameOf(c) }}<span v-if="c.p?.invited_at" class="ah-invited" role="img" :title="invitedLine(c.p)" :aria-label="invitedLine(c.p)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 4.5l6 4.5 6-4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span></span>
              <span class="ah-card-email">{{ emailOf(c) || 'no email' }}</span>
              <span class="ah-card-line">
                <template v-if="col.stage === 'editing'">{{ c.p?.edits.toLocaleString() }} edit{{ c.p?.edits === 1 ? '' : 's' }}<template v-if="c.p?.last_dataset">, {{ dsName(c.p.last_dataset) }}</template>, last {{ ago(c.p?.last_edit_at ?? null) }} ago</template>
                <template v-else-if="col.stage === 'dataset'">{{ c.ds?.label }}, {{ ago(c.since) }}</template>
                <template v-else>{{ ago(c.since) }}<template v-if="col.stage === 'signedin' && c.p?.tutorial_active">, in tutorial {{ c.p.tutorial_active }}</template><template v-if="col.stage === 'emailed'"> since we emailed, asked {{ day(c.p?.asked_at ?? null) }}</template><template v-if="col.stage === 'asked'">, {{ c.p?.from_site ? 'from connectome.quest' : 'in Pyr' }}</template></template>
              </span>
              <span class="ah-card-tags">
                <span v-if="col.stage === 'dataset' && triesOf(c).length" class="ah-tag">Test: {{ outcomeWord(triesOf(c)[0]).toLowerCase() }}</span>
                <span v-if="c.p?.ew_name" class="ah-tag">{{ ewShort(c.p) }}</span>
                <span v-if="c.p && asked[c.p.email] && (col.stage === 'asked' || col.stage === 'later')" class="ah-tag">Asked by email {{ day(asked[c.p.email].at) }}</span>
                <span v-if="dupesOf(c).length" class="ah-tag ah-tag--dupe">Maybe the same as {{ dupesOf(c)[0].name || dupesOf(c)[0].email }}</span>
                <span v-if="noteCount(c)" class="ah-tag ah-tag--note">{{ noteCount(c) }} note{{ noteCount(c) === 1 ? '' : 's' }}</span>
              </span>
            </button>
            <button v-if="col.stage === 'letin' && !words.length && (letinHidden || showLists)" type="button" class="ah-fold" @click="showLists = !showLists">
              {{ showLists ? 'Show only the newest' : `Show ${letinHidden} more, longest waiting` }}
            </button>
            <p v-if="!columnCards(col.stage).length && !(col.stage === 'letin' && letinHidden)" class="ah-quiet">Nobody here{{ words.length ? ' matches' : '' }}.</p>
          </div>
        </div>
        </div>
       </div>
      </section>

      <section class="ah-lb" aria-label="Leaderboard">
        <div class="ah-lb-head">
          <h2><button type="button" class="ah-fold-btn" :aria-expanded="!folded.has('lb')" @click="toggleFold('lb')"><span class="ah-fold-mark" aria-hidden="true">{{ folded.has('lb') ? '▸' : '▾' }}</span>Leaderboard</button></h2>
          <span class="ah-seg" role="radiogroup" aria-label="When">
            <button type="button" role="radio" :aria-checked="lbSpan === '30d'" :class="{ on: lbSpan === '30d' }" @click="lbSpan = '30d'">Last 30 days</button>
            <button type="button" role="radio" :aria-checked="lbSpan === 'all'" :class="{ on: lbSpan === 'all' }" @click="lbSpan = 'all'">All time</button>
          </span>
          <span class="ah-seg" role="radiogroup" aria-label="Ranked by">
            <button v-for="m in LB_BY" :key="m.key" type="button" role="radio" :aria-checked="lbBy === m.key" :class="{ on: lbBy === m.key }" @click="lbBy = m.key">{{ m.label }}</button>
          </span>
          <button type="button" class="ah-link ah-lb-col" :aria-pressed="showEditingCol" @click="toggleEditingCol">{{ showEditingCol ? 'Hide' : 'Show' }} the Editing column</button>
        </div>
        <template v-if="!folded.has('lb')">
        <p v-if="!lbRows.length" class="ah-quiet">Nobody{{ words.length ? ' matches' : ' yet' }}.</p>
        <ol v-else class="ah-lb-list">
          <li v-for="(r, i) in lbShown" :key="'lb' + r.c.key">
            <button type="button" class="ah-lb-row" :class="{ 'ah-lb-row--open': openKey === r.c.key }" @click="pick(r.c)">
              <span class="ah-lb-rank" :class="'ah-lb-rank--' + (i + 1)">{{ i + 1 }}</span>
              <span class="ah-lb-who"><b>{{ nameOf(r.c) }}</b><small v-if="r.p.username && r.p.username !== nameOf(r.c)">{{ r.p.username }}</small></span>
              <span class="ah-lb-meter"><span :style="{ width: Math.max(2, (r.v / lbMax) * 100) + '%' }"></span></span>
              <span class="ah-lb-v">{{ r.v.toLocaleString() }}</span>
              <span class="ah-lb-x">
                <template v-if="lbBy !== 'edits'">{{ lbVal(r.p, 'edits', lbSpan).toLocaleString() }} edits · </template>
                <template v-if="lbBy !== 'cells'">{{ lbVal(r.p, 'cells', lbSpan).toLocaleString() }} cells · </template>
                <template v-if="lbBy !== 'help'">helped {{ lbVal(r.p, 'help', lbSpan).toLocaleString() }} · </template>
                <template v-if="r.p.last_edit_at">last edit {{ ago(r.p.last_edit_at) }} ago<template v-if="r.p.last_dataset">, {{ dsName(r.p.last_dataset) }}</template></template>
              </span>
            </button>
          </li>
        </ol>
        <button v-if="lbRows.length > LB_SHOWN && !words.length" type="button" class="ah-fold ah-fold--wide" @click="lbAll = !lbAll">
          {{ lbAll ? `Show the top ${LB_SHOWN}` : `Show all ${lbRows.length}` }}
        </button>
        </template>
      </section>

      <aside v-if="open" class="ah-panel" aria-label="Person">
        <button class="ah-close" type="button" aria-label="Close" @click="openKey = ''">×</button>
        <h2>{{ nameOf(open) }}</h2>
        <div class="ah-panel-email">{{ emailOf(open) }}</div>
        <div v-if="open.p?.invited_at" class="ah-panel-meta ah-panel-invited">{{ invitedLine(open.p) }}</div>
        <div v-if="open.p?.gave_email && open.p.gave_email !== open.p.email" class="ah-panel-meta">Gave {{ open.p.gave_email }} on the form</div>
        <div v-if="open.p?.ew_email" class="ah-panel-meta">EyeWire email {{ open.p.ew_email }}</div>
        <div v-if="open.p?.username" class="ah-panel-meta">Pyr username {{ open.p.username }}</div>
        <div v-if="open.p?.user_id" class="ah-panel-meta">CAVE ID <template v-if="caveId != null"><b class="ah-caveid">{{ caveId }}</b>
          <button type="button" class="ah-linkbtn" title="Copy the CAVE ID" @click="copyCaveId">{{ caveCopied ? 'Copied' : 'Copy' }}</button></template>
          <template v-else>not saved yet (it is saved when they open the game)</template></div>
        <div v-if="open.p?.ew_name || open.p?.ew_rank" class="ah-panel-meta">EyeWire {{ open.p?.ew_name || '' }}<template v-if="open.p?.ew_rank">, said rank {{ open.p.ew_rank }}</template><template v-if="open.p?.ew_name_set_at">, added by hand</template>
          <button v-if="open.p?.ew_name && !open.p.is_admin && ewEdit !== open.key" type="button" class="ah-linkbtn ah-ewset-change" @click="startEwEdit(open)">Change</button></div>
        <div v-if="open.p && !open.p.is_admin && (ewEdit === open.key || !open.p.ew_name)" class="ah-ewset">
          <input v-model="ewDraft" class="ah-input ah-ewset-input" maxlength="40" placeholder="Their EyeWire username" aria-label="Their EyeWire username" @keydown.enter="saveEwName(open)">
          <button class="ah-btn" type="button" :disabled="!!busy || !ewDraft.trim()" @click="saveEwName(open)">{{ busy === 'ewname' ? 'Saving…' : 'Save' }}</button>
          <button v-if="open.p.ew_name" class="ah-btn" type="button" :disabled="!!busy" @click="ewEdit = ''">Cancel</button>
        </div>
        <div v-if="open.p?.ew_name" class="ah-stats ah-ew" aria-label="Their EyeWire stats">
          <template v-if="openEw">
            <div><span>EyeWire</span>{{ openEw.points.toLocaleString() }} points · {{ openEw.cubes.toLocaleString() }} cubes<template v-if="openEw.accuracy != null"> · {{ Math.round(openEw.accuracy * 100) }}% accuracy</template></div>
            <div v-if="openEw.roles.length || openEw.joined || openEw.country"><span>Player</span><template v-if="openEw.roles.length">{{ openEw.roles.map(cap).join(', ') }} · </template><template v-if="openEw.joined">joined EyeWire {{ new Date(openEw.joined * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</template><template v-if="openEw.country"><template v-if="openEw.roles.length || openEw.joined"> · </template>{{ openEw.country }}</template></div>
          </template>
          <template v-else-if="ewOf(open.p) === 'none'">No EyeWire player named {{ open.p.ew_name }}.</template>
          <template v-else>Reading EyeWire…</template>
        </div>
        <div v-for="d in dupesOf(open)" :key="'d' + d.email" class="ah-dupe">
          <div>Maybe the same person as <button type="button" class="ah-linkbtn" @click="openKey = d.email">{{ d.name || d.username || d.email }}</button> ({{ d.email }})</div>
          <div class="ah-actions">
            <button class="ah-btn" type="button" :disabled="!!busy" @click="linkSame(open.p, d)">{{ busy === 'link' ? 'Joining…' : 'Same person' }}</button>
            <button class="ah-btn" type="button" :disabled="!!busy" @click="markNotSame(open.p?.email ?? '', d.email)">Not the same</button>
          </div>
        </div>
        <div v-if="open.p && canEdit?.[open.p.email]" class="ah-panel-meta">Can edit: {{ canEdit[open.p.email] }}</div>
        <div v-if="open.p?.found_us" class="ah-panel-meta">Found us: {{ open.p.found_us }}</div>
        <blockquote v-if="open.p?.their_note">{{ open.p.their_note }}</blockquote>

        <div v-if="open.stage === 'asked' || open.stage === 'emailed' || open.stage === 'later' || open.stage === 'removed' && open.p?.request_id && !open.p?.pilot_enabled" class="ah-actions">
          <button class="ah-btn ah-btn--yes" type="button" :disabled="!!busy" @click="letIn(open)">{{ busy === 'letin' ? 'Letting in…' : 'Let them in' }}</button>
          <button v-if="open.stage === 'asked' || open.stage === 'emailed'" class="ah-btn" type="button" :disabled="!!busy" title="Off the Asked list, kept for when we take people new to EyeWire" @click="markBeta(open, 'listed')">Later</button>
          <button v-if="open.stage !== 'removed'" class="ah-btn" type="button" :disabled="!!busy" @click="markBeta(open, 'removed')">Remove request</button>
          <button v-if="open.stage !== 'asked' && open.stage !== 'emailed'" class="ah-btn" type="button" :disabled="!!busy" @click="markBeta(open, 'waiting')">Back to Asked</button>
        </div>
        <div v-if="open.stage === 'later'" class="ah-panel-meta">Later since {{ day(open.since) }}</div>
        <div v-if="(open.stage === 'asked' || open.stage === 'emailed' || open.stage === 'later') && open.p?.email" class="ah-ask">
          <div v-if="asked[open.p.email]" class="ah-panel-meta">Asked for their EyeWire name by email {{ day(asked[open.p.email].at) }}</div>
          <button v-if="!askOpen" class="ah-btn" type="button" :disabled="!!busy" @click="openAsk(open)">{{ busy === 'askdraft' ? 'Opening…' : asked[open.p.email] ? 'Ask again by email' : open.p.ew_name ? 'Email them to check their EyeWire name' : 'Ask for their EyeWire name' }}</button>
          <div v-else-if="ask" class="ah-ask-draft" aria-label="Email to send">
            <div class="ah-panel-meta">To {{ ask.email }}, from Amy at Pyr. Replies go to support@eyewire.org.</div>
            <template v-if="ask.editing">
              <input v-model="ask.subject" class="ah-ask-subject" maxlength="150" aria-label="Subject">
              <textarea v-model="ask.text" class="ah-ask-text" rows="10" maxlength="4000" aria-label="Email"></textarea>
            </template>
            <template v-else>
              <div class="ah-ask-subject ah-ask-subject--read">{{ ask.subject }}</div>
              <div class="ah-ask-text ah-ask-text--read">{{ ask.text }}</div>
            </template>
            <div class="ah-actions">
              <button class="ah-btn ah-btn--yes" type="button" :disabled="!!busy" @click="sendAsk(open)">{{ busy === 'ask' ? 'Sending…' : 'Send' }}</button>
              <button class="ah-btn" type="button" :disabled="!!busy" @click="ask.editing = !ask.editing">{{ ask.editing ? 'Done editing' : 'Edit' }}</button>
              <button class="ah-btn" type="button" :disabled="!!busy" @click="ask = null">Cancel</button>
            </div>
          </div>
        </div>
        <div v-if="open.p && emailed[open.p.email]" class="ah-panel-meta">{{ emailed[open.p.email] }}</div>

        <div v-if="open.ds" class="ah-ds">
          <div class="ah-panel-meta"><b>{{ open.ds.label }}</b>, asked {{ day(open.ds.at) }}<template v-if="open.ds.cave">, CAVE {{ open.ds.cave }}</template></div>
          <blockquote v-if="open.ds.note">{{ open.ds.note }}</blockquote>
          <div class="ah-tries" aria-label="Their Proofreading Test tries">
            <div class="ah-panel-meta"><b>Proofreading Test</b><template v-if="!triesOf(open).length">: no tries yet</template></div>
            <ul v-if="triesOf(open).length">
              <li v-for="t in triesOf(open).slice(0, 5)" :key="t.id" :class="'ah-try--' + (t.outcome === 'pass' ? 'pass' : t.outcome === 'fail' ? 'fail' : 'other')"><span>{{ tryLine(t) }}</span><span>{{ day(t.submitted_at || t.started_at) }}</span></li>
            </ul>
            <div v-if="triesOf(open).length" class="ah-quiet">Their cell, as they left it: Admin Hub, Test tries.</div>
          </div>
          <input v-model="dsNote" class="ah-input" maxlength="500" placeholder="A note for them (optional)" />
          <div class="ah-actions">
            <button v-if="open.ds.caveGroup" class="ah-btn ah-btn--yes" type="button" :disabled="!!busy" :title="`Adds them to ${open.ds.caveGroup} in CAVE, then sends them the unlock notification`" @click="decide(open, 'granted')">{{ busy === 'granted' ? 'Letting them in…' : 'Let them in & send notification' }}</button>
            <button class="ah-btn" :class="{ 'ah-btn--yes': !open.ds.caveGroup }" type="button" :disabled="!!busy"
                    :title="open.ds.caveGroup ? 'You already added them in CAVE yourself: just send the notification' : 'Add them to the dataset\'s group in CAVE first, then press this to send the notification'"
                    @click="decide(open, 'granted', true)">{{ open.ds.caveGroup ? 'I added them by hand, send notification' : 'Let them in & send notification' }}</button>
            <button class="ah-btn" type="button" :disabled="!!busy" @click="decide(open, 'declined')">Not now</button>
            <button v-if="open.ds.dataset" class="ah-btn ah-btn--quiet" type="button" :disabled="!!busy" title="Sends the notification they will get to your own bell, marked Test" @click="testBell(open)">{{ busy === 'test' ? 'Sending…' : testSent === open.ds.id ? 'Test sent to your bell' : 'Send me a test' }}</button>
          </div>
        </div>
        <p v-if="actionError" class="ah-error" role="alert">{{ actionError }}</p>

        <p v-if="open.p?.user_id && !played(open.p)" class="ah-quiet">Signed in to Pyr, nothing played yet.</p>
        <div v-if="open.p?.user_id && played(open.p)" class="ah-stats" aria-label="Their stats">
          <div><span>All time</span>{{ open.p.edits.toLocaleString() }} edit{{ open.p.edits === 1 ? '' : 's' }} · {{ (open.p.cells ?? 0).toLocaleString() }} cell{{ open.p.cells === 1 ? '' : 's' }} done · {{ open.p.tutorials }} tutorial{{ open.p.tutorials === 1 ? '' : 's' }} finished</div>
          <div><span>Last 30 days</span>{{ (open.p.edits_30d ?? 0).toLocaleString() }} edit{{ open.p.edits_30d === 1 ? '' : 's' }} · {{ (open.p.cells_30d ?? 0).toLocaleString() }} cell{{ open.p.cells_30d === 1 ? '' : 's' }} done</div>
          <div><span>Help</span>asked {{ open.p.help_asked }} time{{ open.p.help_asked === 1 ? '' : 's' }}<template v-if="open.p.help_asked">, {{ open.p.help_answered_for }} answered</template> · helped others {{ open.p.help_given }} time{{ open.p.help_given === 1 ? '' : 's' }}<template v-if="open.p.help_asked_30d || open.p.help_given_30d"> ({{ open.p.help_asked_30d }} asked, {{ open.p.help_given_30d }} helped in 30 days)</template></div>
          <div><span>Chat</span>{{ (open.p.chats ?? 0).toLocaleString() }} message{{ open.p.chats === 1 ? '' : 's' }}, {{ (open.p.chats_30d ?? 0).toLocaleString() }} in 30 days</div>
          <div v-if="open.p.tutorial_active"><span>Now in</span>{{ TUTORIAL_NAMES[open.p.tutorial_active] ?? `tutorial ${open.p.tutorial_active}` }}</div>
        </div>
        <template v-if="open.p?.user_id && played(open.p)">
          <h3>Their last 30 days, by dataset</h3>
          <p v-if="recentFor !== open.p.user_id" class="ah-quiet">Reading…</p>
          <p v-else-if="!theirDatasets.length" class="ah-quiet">Nothing on any dataset in the last 30 days.</p>
          <div v-else class="ah-their">
            <div v-for="d in theirDatasets" :key="d.dataset" class="ah-bar-row ah-their-row">
              <span class="ah-bar-name">{{ d.dataset }}</span>
              <span class="ah-bar"><span :style="{ width: (d.edits ? Math.max(2, (d.edits / theirMax) * 100) : 0) + '%' }"></span></span>
              <span class="ah-bar-n">{{ d.edits.toLocaleString() }} edit{{ d.edits === 1 ? '' : 's' }}</span>
              <span class="ah-bar-x">{{ d.cells.toLocaleString() }} cell{{ d.cells === 1 ? '' : 's' }} done · {{ d.chats.toLocaleString() }} chat message{{ d.chats === 1 ? '' : 's' }}<template v-if="d.last_edit_at"> · last edit {{ ago(d.last_edit_at) }} ago</template></span>
            </div>
          </div>
        </template>
        <template v-if="open.p?.user_id && open.p.edits">
          <h3>Latest 10 actions</h3>
          <p v-if="recentFor !== open.p.user_id" class="ah-quiet">Reading…</p>
          <p v-else-if="recentError" class="ah-error">{{ recentError }}</p>
          <ol v-else class="ah-time ah-edits">
            <li v-for="(e, i) in recent" :key="i"><span>{{ opName(e) }}<template v-if="e.dataset">, {{ dsName(e.dataset) }}</template></span><span>{{ ago(e.at) }} ago</span></li>
          </ol>
        </template>
        <p v-if="open.p && !open.p.user_id" class="ah-quiet">Not signed in to Pyr yet.</p>

        <ol v-if="timeline.length" class="ah-time">
          <li v-for="[label, t] in timeline" :key="label"><span>{{ label }}</span><span>{{ day(t) }}</span></li>
        </ol>

        <h3>Notes for the team</h3>
        <p v-if="!(notes[open.key] || []).length" class="ah-quiet">No notes yet.</p>
        <div v-for="n in notes[open.key] || []" :key="n.id" class="ah-note">
          <div class="ah-note-by">{{ n.by }} <span>{{ day(n.at) }}</span>
            <button type="button" class="ah-note-x" aria-label="Delete this note" title="Delete this note" :disabled="!!busy" @click="deleteNote(open, n.id)">×</button></div>
          <div class="ah-note-text">{{ n.text }}</div>
        </div>
        <textarea v-model="noteDraft" class="ah-input" rows="3" maxlength="1000" placeholder="Add a note for the team. @Celia or @Marissa tags them"></textarea>
        <button class="ah-btn" type="button" :disabled="!!busy || !noteDraft.trim()" @click="addNote(open)">{{ busy === 'note' ? 'Saving…' : 'Add note' }}</button>
      </aside>
    </div>

    <button v-if="adminCards.length || showAdmins" type="button" class="ah-fold ah-fold--wide" @click="showAdmins = !showAdmins">
      {{ showAdmins ? 'Hide' : 'Show' }} {{ inStage('admin').length }} admin{{ inStage('admin').length === 1 ? '' : 's' }}
    </button>
    <div v-if="showAdmins" class="ah-admins">
      <button v-for="c in adminCards" :key="'a' + c.key" type="button" class="ah-card" @click="pick(c)">
        <span class="ah-card-name">{{ nameOf(c) }}<span v-if="c.p?.invited_at" class="ah-invited" role="img" :title="invitedLine(c.p)" :aria-label="invitedLine(c.p)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 4.5l6 4.5 6-4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span></span><span class="ah-card-email">{{ emailOf(c) }}</span>
        <span class="ah-card-line">{{ c.p?.is_team ? 'Team' : 'Admin' }}<template v-if="c.p?.edits">, {{ c.p.edits.toLocaleString() }} edit{{ c.p.edits === 1 ? '' : 's' }}</template></span>
      </button>
    </div>
    <button v-if="laterCards.length || showLater" type="button" class="ah-fold ah-fold--wide ah-later-fold" @click="showLater = !showLater">
      {{ showLater ? 'Hide' : 'Show' }} {{ inStage('later').length }} for later
    </button>
    <div v-if="showLater" class="ah-removed ah-later">
      <button v-for="c in laterCards" :key="'l' + c.key" type="button" class="ah-card" @click="pick(c)">
        <span class="ah-card-name">{{ nameOf(c) }}<span v-if="c.p?.invited_at" class="ah-invited" role="img" :title="invitedLine(c.p)" :aria-label="invitedLine(c.p)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 4.5l6 4.5 6-4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span></span><span class="ah-card-email">{{ emailOf(c) }}</span>
        <span class="ah-card-line">Asked {{ day(c.p?.asked_at ?? null) }}<template v-if="c.p?.ew_name"> · {{ ewShort(c.p) }}</template></span>
      </button>
    </div>
    <button v-if="removedCards.length || showRemoved" type="button" class="ah-fold ah-fold--wide" @click="showRemoved = !showRemoved">
      {{ showRemoved ? 'Hide' : 'Show' }} {{ inStage('removed').length }} removed or paused
    </button>
    <div v-if="showRemoved" class="ah-removed">
      <button v-for="c in removedCards" :key="'r' + c.key" type="button" class="ah-card" @click="pick(c)">
        <span class="ah-card-name">{{ nameOf(c) }}<span v-if="c.p?.invited_at" class="ah-invited" role="img" :title="invitedLine(c.p)" :aria-label="invitedLine(c.p)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 4.5l6 4.5 6-4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span></span><span class="ah-card-email">{{ emailOf(c) }}</span>
        <span class="ah-card-line">{{ c.p?.pilot_enabled === false ? 'Access paused' : 'Request removed' }} {{ day(c.since) }}</span>
      </button>
    </div>

    <section v-if="stats.length || tutRows.length" class="ah-flowbox" aria-label="Tutorials">
      <h3><button type="button" class="ah-fold-btn" :aria-expanded="!folded.has('tut')" @click="toggleFold('tut')"><span class="ah-fold-mark" aria-hidden="true">{{ folded.has('tut') ? '▸' : '▾' }}</span>Tutorials</button></h3>
      <template v-if="!folded.has('tut')">
      <div class="ah-flow">
        <template v-for="(t, i) in FLOW_MAIN" :key="'m' + t">
          <button type="button" class="ah-node" :class="{ 'ah-node--open': openTut === t }" :aria-expanded="openTut === t" @click="openTut = openTut === t ? null : t">
            <span class="ah-node-name">{{ tutName(t) }}</span>
            <span class="ah-node-n"><b>{{ nodes[t].done }}</b> finished</span>
            <span class="ah-node-n"><b>{{ nodes[t].now }}</b> in it now</span>
          </button>
          <span v-if="i < FLOW_MAIN.length - 1" class="ah-arrow" aria-hidden="true">→</span>
        </template>
      </div>
      <div class="ah-flow ah-flow--more">
        <span class="ah-flow-label">Also</span>
        <button v-for="t in FLOW_MORE" :key="'o' + t" type="button" class="ah-node ah-node--small" :class="{ 'ah-node--open': openTut === t }" :aria-expanded="openTut === t" @click="openTut = openTut === t ? null : t">
          <span class="ah-node-name">{{ tutName(t) }}</span>
          <span class="ah-node-n"><b>{{ nodes[t].done }}</b> finished · <b>{{ nodes[t].now }}</b> in it</span>
        </button>
      </div>
      <div v-if="tutOpen" class="ah-tut-open">
        <h4>{{ tutName(tutOpen.t) }}<span class="ah-quiet"> · {{ nodes[tutOpen.t].done }} finished, {{ nodes[tutOpen.t].now }} in it now<template v-if="tutOpen.total">, about {{ secs(tutOpen.total) }} start to end</template></span></h4>
        <div v-for="r in tutOpen.rows" :key="r.step" class="ah-step">
          <a class="ah-bar-name ah-bar-link" :href="boxLink(tutOpen.t, r.step, gameUrl)" target="_blank" rel="noopener" :title="`Open this box in the game: ${r.name}`">{{ r.step + 1 }}. {{ r.name }}</a>
          <span class="ah-bar ah-bar--tut"><span v-if="r.s" :style="{ width: (Number(r.s.median_s) / tutOpen.maxMedian) * 100 + '%' }"></span></span>
          <span class="ah-bar-n"><template v-if="r.s">{{ secs(r.s.median_s) }} median</template></span>
          <span class="ah-bar-x"><template v-if="r.s">{{ r.s.players }} reached<template v-if="tutOpen.first && r.s.players < tutOpen.first"> of {{ tutOpen.first }}</template><template v-if="Number(r.s.help_rate) > 0">, {{ Math.round(Number(r.s.help_rate) * 100) }}% asked for help</template><template v-if="r.s.closes">, {{ r.s.closes }} left here</template></template></span>
          <span v-if="r.here.length" class="ah-step-here">On it now: <button v-for="p in r.here" :key="p.email" type="button" class="ah-chip" @click="openPerson(p)">{{ p.name || p.username || p.email }}</button></span>
        </div>
        <p v-if="!tutOpen.rows.length" class="ah-quiet">No box times yet for this one.</p>
        <p v-if="tutOpen.unknown.length" class="ah-step-here">In it, box not known (they started before box times were kept): <button v-for="p in tutOpen.unknown" :key="p.email" type="button" class="ah-chip" @click="openPerson(p)">{{ p.name || p.username || p.email }}</button></p>
      </div>
      </template>
    </section>

    <section class="ah-insights">
      <div class="ah-box">
        <h3><button type="button" class="ah-fold-btn" :aria-expanded="!folded.has('places')" @click="toggleFold('places')"><span class="ah-fold-mark" aria-hidden="true">{{ folded.has('places') ? '▸' : '▾' }}</span>Where the community is, last 30 days</button></h3>
        <template v-if="!folded.has('places')">
        <div v-for="a in places" :key="a.dataset" class="ah-bar-row">
          <span class="ah-bar-name">{{ a.dataset }}</span>
          <span class="ah-bar"><span :style="{ width: Math.max(1, (a.edits / maxEdits) * 100) + '%' }"></span></span>
          <span class="ah-bar-n">{{ a.edits.toLocaleString() }} edits, {{ a.editors }} player{{ a.editors === 1 ? '' : 's' }}</span>
          <span class="ah-bar-x">{{ a.cells.toLocaleString() }} cells done · {{ a.chats.toLocaleString() }} chat messages</span>
        </div>
        <p v-if="!places.length" class="ah-quiet">Nothing read yet.</p>
        </template>
      </div>
      <div class="ah-box">
        <h3><button type="button" class="ah-fold-btn" :aria-expanded="!folded.has('linger')" @click="toggleFold('linger')"><span class="ah-fold-mark" aria-hidden="true">{{ folded.has('linger') ? '▸' : '▾' }}</span>Tutorial boxes players linger on</button></h3>
        <template v-if="!folded.has('linger')">
        <div v-for="s in slowSteps" :key="s.tutorial + '-' + s.step" class="ah-bar-row">
          <a class="ah-bar-name ah-bar-link" :href="boxLink(s.tutorial, s.step, gameUrl)" target="_blank" rel="noopener" :title="PRACTICE_TUTORIALS.includes(s.tutorial) ? `Opens ${TUTORIAL_NAMES[s.tutorial] ?? 'this tutorial'} from its start (it needs its practice cell): ${boxName(s)}` : `Open this box in the game: ${boxName(s)}`">{{ TUTORIAL_NAMES[s.tutorial] ?? `Tutorial ${s.tutorial}` }}: {{ boxName(s) }}</a>
          <span class="ah-bar ah-bar--tut"><span :style="{ width: (Number(s.median_s) / maxStep) * 100 + '%' }"></span></span>
          <span class="ah-bar-n">{{ secs(s.median_s) }} median</span>
          <span class="ah-bar-x">{{ s.players }} players<template v-if="Number(s.help_rate) > 0">, {{ Math.round(Number(s.help_rate) * 100) }}% asked for help</template><template v-if="s.closes">, {{ s.closes }} left here</template></span>
        </div>
        <p class="ah-quiet">Boxes at least two players reached. Up to {{ tutPlayers }} players so far. Click a box to open it in the game. Merge, Cut and the Sandboxes open from their start, since they need their practice cell.</p>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ah { position: fixed; inset: 0; overflow-y: auto; background: #070b14; color: #dbe6f5; font-family: 'Inter', 'Roboto', system-ui, sans-serif; font-size: 14px; padding: 18px 22px 40px; box-sizing: border-box; }
.ah-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.ah-head h1 { margin: 0; font-size: 22px; font-weight: 700; color: #eef4ff; letter-spacing: .02em; }
.ah-sum { color: #a9bbd3; }
.ah-search { margin-left: auto; width: min(360px, 100%); height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(120,160,230,.35); background: rgba(14,22,40,.9); color: #eef4ff; font: inherit; }
.ah-btn { height: 32px; padding: 0 12px; border-radius: 7px; border: 1px solid rgba(120,160,230,.45); background: rgba(30,48,86,.6); color: #e6f0ff; font: inherit; font-weight: 600; cursor: pointer; }
.ah-btn:hover:not(:disabled) { background: rgba(45,70,120,.75); }
.ah-btn:disabled { opacity: .55; cursor: default; }
.ah-btn--yes { background: rgba(55,138,221,.85); border-color: rgba(140,190,255,.8); color: #fff; }
.ah-btn--quiet { background: transparent; border-style: dashed; opacity: .85; }
.ah-link { color: #9fd3ff; text-decoration: none; }
.ah-error { color: #ffb3b3; margin: 6px 0; }
.ah-quiet { color: #7f93b0; font-size: 12.5px; margin: 6px 2px; }
.ah-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.ah-main--open { grid-template-columns: minmax(0, 1fr) 360px; }
.ah-main--open .ah-panel { grid-column: 2; grid-row: 1 / span 2; align-self: start; }
.ah-boards { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.ah-tries ul { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ah-tries li { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 4px 8px; border-radius: 6px; background: rgba(40,60,100,.35); border-left: 3px solid #6f86a8; }
.ah-tries li span:last-child { color: #8ea3c2; white-space: nowrap; }
.ah-try--pass { border-left-color: #7CFFB2 !important; }
.ah-try--fail { border-left-color: #9a8cff !important; }
.ah-tag--dupe { background: rgba(154,140,255,.22) !important; color: #d9d3ff !important; }
.ah-dupe { margin: 8px 0; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(154,140,255,.45); background: rgba(154,140,255,.10); font-size: 13px; color: #dbe6f5; }
.ah-dupe .ah-actions { margin-top: 6px; }
.ah-linkbtn { background: none; border: 0; padding: 0; color: #9fd3ff; text-decoration: underline; cursor: pointer; font: inherit; }
.ah-ew { background: rgba(124,255,178,.06); border-color: rgba(124,255,178,.25); }
.ah-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 0 0 14px; }
.ah-total { background: rgba(16,26,46,.85); border: 1px solid rgba(90,130,200,.22); border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; }
.ah-total b { font-size: 22px; color: #9fd3ff; }
.ah-total span { font-size: 12px; color: #8ea3c2; }
a.ah-total--link { text-decoration: none; cursor: pointer; }
a.ah-total--link:hover, a.ah-total--link:focus-visible { border-color: rgba(127,196,255,.6); background: rgba(24,40,70,.9); }
.ah-group-title { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #cfe0ff; letter-spacing: .02em; }
.ah-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(150px, 1fr); gap: 10px; overflow-x: auto; }
.ah-col { max-height: min(560px, calc(100vh - 150px)) !important; }
/* The admins' leaderboard. */
.ah-fold-btn { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.ah-fold-btn:hover .ah-fold-mark, .ah-fold-btn:focus-visible .ah-fold-mark { color: #9fd3ff; }
.ah-fold-mark { display: inline-block; width: 1em; color: #6f8fbf; font-size: .85em; }
/* Not full width (Ames 2026-11-12: "this doesn't need to be full width"). */
.ah-lb { max-width: 900px; width: 100%; box-sizing: border-box; }
.ah-lb { background: rgba(16,26,46,.85); border: 1px solid rgba(90,130,200,.22); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.ah-lb-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.ah-lb-head h2 { margin: 0 6px 0 0; font-size: 16px; color: #eef4ff; }
.ah-seg { display: inline-flex; border: 1px solid rgba(120,160,230,.35); border-radius: 8px; overflow: hidden; }
.ah-seg button { background: none; border: 0; color: #a9c4e6; font: inherit; font-size: 12.5px; padding: 5px 10px; cursor: pointer; }
.ah-seg button + button { border-left: 1px solid rgba(120,160,230,.25); }
.ah-seg button.on { background: #2f6fd6; color: #fff; }
.ah-lb-col { margin-left: auto; background: none; border: 0; cursor: pointer; font: inherit; font-size: 12.5px; }
.ah-lb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ah-lb-row { width: 100%; display: grid; grid-template-columns: 2.2em minmax(140px, 26%) minmax(0, 1fr) 5.5em; grid-template-rows: auto auto; column-gap: 12px; align-items: center;
  background: none; border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ah-lb-row:hover { background: rgba(60,100,170,.14); }
.ah-lb-row--open { border-color: rgba(120,170,255,.6); background: rgba(60,100,170,.18); }
.ah-lb-rank { grid-row: 1 / span 2; width: 1.9em; height: 1.9em; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 13px; color: #9fb4d4; background: rgba(90,130,200,.15); }
.ah-lb-rank--1 { background: #f2c94c; color: #2a2000; }
.ah-lb-rank--2 { background: #cfd8e6; color: #1d2633; }
.ah-lb-rank--3 { background: #d9a066; color: #2a1606; }
.ah-lb-who { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #eef4ff; }
.ah-lb-who small { color: #7f93b0; font-size: 12px; }
.ah-lb-meter { height: 8px; border-radius: 4px; background: rgba(90,130,200,.15); overflow: hidden; }
.ah-lb-meter span { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #3b74e0, #7fb2ff); }
.ah-lb-v { text-align: right; font-weight: 700; color: #cfe3ff; font-variant-numeric: tabular-nums; }
.ah-lb-x { grid-column: 2 / 5; font-size: 12px; color: #7f93b0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) {
  .ah-lb-row { grid-template-columns: 2.2em minmax(0, 1fr) 4.5em; }
  .ah-lb-meter { grid-column: 2 / 4; grid-row: 2; }
  .ah-lb-x { grid-column: 2 / 4; grid-row: 3; }
  .ah-lb-col { margin-left: 0; }
}
.ah-col { background: rgba(16,26,46,.85); border: 1px solid rgba(90,130,200,.22); border-radius: 10px; padding: 10px 8px 8px; display: flex; flex-direction: column; min-width: 0; max-height: max(380px, calc(100vh - 150px)); }
.ah-col--ours { border-color: rgba(120,170,255,.5); }
.ah-col-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 4px; }
.ah-col-title { font-weight: 700; color: #eef4ff; }
.ah-col-n { font-size: 22px; font-weight: 700; color: #9fd3ff; }
.ah-col-sub, .ah-col-typ { font-size: 12px; color: #8ea3c2; padding: 0 4px; }
.ah-col-typ { color: #6f86a8; margin-bottom: 6px; }
.ah-col-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 2px; }
.ah-card { text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border-radius: 8px; border: 1px solid rgba(110,150,220,.25); background: rgba(24,38,66,.9); color: inherit; font: inherit; cursor: pointer; }
.ah-card:hover { border-color: rgba(150,190,255,.6); }
.ah-card--open { border-color: #9fd3ff; background: rgba(36,58,100,.95); }
.ah-card-name { font-weight: 700; color: #f2f7ff; overflow-wrap: anywhere; }
.ah-invited { display: inline-block; vertical-align: -2px; margin-left: 6px; color: #7fc4ff; }
.ah-panel-invited { color: #9fd3ff; }
.ah-card-email { font-size: 12px; color: #a9c4e6; overflow-wrap: anywhere; }
.ah-card-line { font-size: 12px; color: #8ea3c2; }
.ah-card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.ah-card-tags:empty { display: none; }
.ah-tag { font-size: 11.5px; padding: 1px 6px; border-radius: 5px; background: rgba(55,138,221,.22); color: #cfe4ff; }
.ah-tag--list { background: rgba(127,119,221,.25); color: #ddd9ff; }
.ah-tag--note { background: rgba(93,202,165,.18); color: #c8f1e2; }
.ah-fold { margin-top: 4px; padding: 6px 8px; border-radius: 7px; border: 1px dashed rgba(120,160,230,.4); background: none; color: #a9c4e6; font: inherit; font-size: 12.5px; cursor: pointer; }
.ah-fold--wide { margin: 12px 0 0; }
.ah-removed, .ah-admins { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; margin-top: 8px; }
.ah-panel { position: sticky; top: 0; align-self: start; max-height: calc(100vh - 80px); overflow-y: auto; background: rgba(14,22,40,.97); border: 1px solid rgba(120,170,255,.45); border-radius: 12px; padding: 14px 16px 16px; }
.ah-panel h2 { margin: 0 26px 2px 0; font-size: 18px; color: #f2f7ff; overflow-wrap: anywhere; }
.ah-panel h3 { margin: 16px 0 6px; font-size: 14px; color: #eef4ff; }
.ah-panel-email { color: #a9c4e6; margin-bottom: 6px; overflow-wrap: anywhere; }
.ah-stats { margin: 10px 0 4px; padding: 8px 10px; border-radius: 8px; background: rgba(55,138,221,.10); border: 1px solid rgba(120,170,255,.25); font-size: 13px; color: #dbe6f5; }
.ah-stats > div { margin: 3px 0; }
.ah-bar-link { color: #b9d6ff; text-decoration: none; }
/* The panel is narrow: the player's datasets always stack like phones. */
.ah-their .ah-bar-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
.ah-their .ah-bar-row > .ah-bar { grid-column: 1 / -1; grid-row: 2; }
.ah-their .ah-bar-row > .ah-bar-x { grid-column: 1 / -1; }
.ah-bar-link:hover { text-decoration: underline; }
.ah-stats span { display: inline-block; min-width: 7.5em; color: #8fa6c6; }
.ah-panel-meta { font-size: 13px; color: #a9bbd3; margin: 3px 0; overflow-wrap: anywhere; }
.ah-caveid { color: #e8f0ff; font-variant-numeric: tabular-nums; user-select: all; margin-right: 4px; }
.ah-panel blockquote { margin: 8px 0; padding: 6px 10px; border-left: 3px solid rgba(120,170,255,.5); color: #d5e3f7; white-space: pre-wrap; }
.ah-close { position: absolute; right: 10px; top: 8px; background: none; border: none; color: #a9c4e6; font-size: 22px; cursor: pointer; }
.ah-panel { position: sticky; }
.ah-ask { margin: 8px 0 4px; }
.ah-ewset { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
.ah-ewset-input { flex: 1; min-width: 0; height: 32px; box-sizing: border-box; }
.ah-ewset-change { margin-left: 6px; font-size: 12px; }
.ah-ask-draft { border: 1px solid rgba(127,196,255,.3); border-radius: 8px; padding: 8px 10px; margin-top: 6px; background: rgba(55,138,221,.08); }
.ah-ask-subject { display: block; width: 100%; box-sizing: border-box; font-weight: 700; margin: 6px 0; }
.ah-ask-text { display: block; width: 100%; box-sizing: border-box; white-space: pre-wrap; font: inherit; line-height: 1.45; }
input.ah-ask-subject, textarea.ah-ask-text { background: #0d1626; color: #e8f1ff; border: 1px solid rgba(127,196,255,.35); border-radius: 6px; padding: 6px 8px; font-weight: 400; }
.ah-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.ah-ds { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(120,160,230,.2); }
.ah-input { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 7px 9px; border-radius: 7px; border: 1px solid rgba(120,160,230,.35); background: rgba(10,16,30,.9); color: #eef4ff; font: inherit; resize: vertical; }
.ah-time { list-style: none; padding: 0; margin: 12px 0 0; border-top: 1px solid rgba(120,160,230,.2); }
.ah-time li { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; color: #c3d3ea; border-bottom: 1px solid rgba(120,160,230,.1); }
.ah-note { padding: 6px 0; border-bottom: 1px solid rgba(120,160,230,.12); }
.ah-note-by { font-size: 12.5px; font-weight: 700; color: #cfe4ff; display: flex; gap: 6px; align-items: baseline; }
.ah-note-by span { font-weight: 400; color: #7f93b0; }
.ah-note-x { margin-left: auto; background: none; border: none; color: #7f93b0; cursor: pointer; font-size: 15px; }
.ah-note-text { font-size: 13.5px; white-space: pre-wrap; color: #e4edf9; }
.ah-flowbox { margin-top: 18px; background: rgba(16,26,46,.85); border: 1px solid rgba(90,130,200,.22); border-radius: 10px; padding: 12px 14px; }
.ah-flowbox h3 { margin: 0 0 8px; font-size: 15px; color: #eef4ff; }
.ah-flow { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; }
.ah-flow--more { margin-top: 10px; align-items: center; }
.ah-flow-label { font-size: 12px; color: #8ea3c2; margin-right: 2px; }
.ah-node { display: flex; flex-direction: column; gap: 2px; text-align: left; min-width: 130px; padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(127,196,255,.3); background: rgba(24,40,70,.75); color: #dbe6f5; font: inherit; cursor: pointer; }
.ah-node:hover, .ah-node:focus-visible { border-color: rgba(127,196,255,.65); }
.ah-node--open { border-color: #7fc4ff; background: rgba(55,138,221,.25); }
.ah-node--small { min-width: 0; padding: 5px 10px; }
.ah-node-name { font-weight: 700; color: #f2f7ff; font-size: 13.5px; }
.ah-node-n { font-size: 12px; color: #9fb6d6; }
.ah-node-n b { color: #9fd3ff; }
.ah-arrow { align-self: center; color: #5f8fc8; font-size: 18px; }
.ah-tut-open { margin-top: 12px; border-top: 1px solid rgba(90,130,200,.22); padding-top: 10px; }
.ah-tut-open h4 { margin: 0 0 8px; font-size: 14px; color: #eef4ff; }
.ah-step { display: grid; grid-template-columns: minmax(140px, 34%) minmax(0, 1fr) 9em; column-gap: 10px; align-items: center; padding: 4px 0; font-size: 13px; border-bottom: 1px solid rgba(90,130,200,.08); }
.ah-step .ah-bar-x { grid-column: 1 / -1; font-size: 12px; color: #8ea3c2; }
.ah-step-here { grid-column: 1 / -1; font-size: 12px; color: #9fb6d6; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 2px; }
.ah-chip { font: inherit; font-size: 12px; padding: 1px 8px; border-radius: 10px; border: 1px solid rgba(127,196,255,.35); background: rgba(55,138,221,.15); color: #cfe4ff; cursor: pointer; }
.ah-chip:hover { background: rgba(55,138,221,.3); }
.ah-insights { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 14px; margin-top: 18px; }
.ah-box { background: rgba(16,26,46,.85); border: 1px solid rgba(90,130,200,.22); border-radius: 10px; padding: 12px 14px; }
.ah-box h3 { margin: 0 0 8px; font-size: 15px; color: #eef4ff; }
/* Every row's bar track is the same length (fixed numbers column), so bars
   compare across rows; on phones the bar gets its own full width line. */
.ah-bar-row { display: grid; grid-template-columns: minmax(120px, 34%) minmax(0, 1fr) 13.5em; column-gap: 10px; align-items: center; padding: 4px 0; font-size: 13px; }
@media (max-width: 640px) {
  .ah-bar-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; padding: 6px 0; }
  .ah-bar-row > .ah-bar { grid-column: 1 / -1; grid-row: 2; }
  .ah-bar-row > .ah-bar-x { grid-column: 1 / -1; }
}
.ah-bar-name { color: #dbe6f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-bar { height: 8px; border-radius: 4px; background: rgba(120,160,230,.12); overflow: hidden; }
.ah-bar > span { display: block; height: 100%; background: #378ADD; border-radius: 4px; }
.ah-bar--tut > span { background: #7F77DD; }
.ah-bar-n { color: #c3d3ea; white-space: nowrap; text-align: right; }
.ah-bar-x { grid-column: 2 / 4; font-size: 12px; color: #7f93b0; }
@media (max-width: 900px) {
  .ah { padding: 12px 16px 30px; }
  .ah-main--open { grid-template-columns: minmax(0, 1fr); }
  .ah-board { grid-auto-columns: minmax(170px, 1fr); }
  .ah-main--open .ah-panel { grid-column: 1; grid-row: auto; }
  .ah-insights { grid-template-columns: minmax(0, 1fr); }
}
</style>
