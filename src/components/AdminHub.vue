<script setup lang="ts">
import imgNurroBravo from '../images/bravo-nurro.png';
import { secureWrite } from '../secure_write';
import {ref, computed, watch, nextTick, onMounted, onUnmounted} from 'vue';
import {useProofreadingBackendStore} from '../store';
import GrowingNeuron from 'components/GrowingNeuron.vue';
import {etNaiveToUtcIso, utcIsoToEtNaive, formatEt} from '../util/et_time';
import {renderSafeMarkdown} from '../util/safe_markdown';
import {withVideoEmbeds} from '../util/video_embeds';
import {htmlToMarkdown, htmlHasFormatting} from '../util/html_to_markdown';
import {supabase} from '../supabase';
import RollUp from 'components/RollUp.vue';
import CellTypeCheck from 'components/CellTypeCheck.vue';
import AccessRequestsTab from 'components/AccessRequestsTab.vue';
import HuntsAdminTab from 'components/HuntsAdminTab.vue';
import TestTriesTab from 'components/TestTriesTab.vue';
import TodoBoard from 'components/TodoBoard.vue';
import nurroDance from '../../static/nurro/nurro-dance.png';
import nurroTrophy from '../../static/nurro/nurro-trophy.png';
import nurroCelebrate from '../../static/nurro/nurro-celebrate.png';
import nurroMicroscope from '../../static/nurro/nurro-microscope.png';
import nurroPopcorn from '../../static/nurro/nurro-popcorn.png';
import nurroAtHome from '../../static/nurro/nurro-at-home.png';
import nurroConfetti from '../../static/nurro/nurro-confetti.png';
import nurroInspector from '../../static/nurro/nurro-inspector.png';
import nurroExperiment from '../../static/nurro/nurro-experiment.png';
import nurroLaserTeach from '../../static/nurro/nurro-laser-teach.png';
import nurroCelebrate2 from '../../static/nurro/nurro-celebrate2.png';
import nurroSuperV2 from '../../static/nurro/nurro-super-v2.png';
import nurroWheres from '../../static/nurro/nurro-wheres.png';
import nurroOriginal from '../../static/nurro/nurro-original.png';
import nurroSuccess from '../../static/nurro/nurro-success.png';
import {loadRepoStats, type RepoStats} from '../util/repo_stats';
import {getPcgInfo} from '../widgets/pcg_service';
import {mintShortStateLink} from '../util/state_link';
import TutorialEditsTab from 'components/TutorialEditsTab.vue';
import {rootOfSupervoxel, resetPracticeExample, ensureSupervoxels, anySupervoxelOf, type PracticeExample, type PracticeKind} from '../practice';

const backend = useProofreadingBackendStore();

// standalone: the triage board on its own page (TriagePage.vue), with no
// game around it. Only the Triage tab, always as the board.
const props = defineProps<{ initialSubTab?: string; standalone?: boolean }>();

// Sub-tab: 'notifications' | 'groups' | 'badges' | 'triage'
const adminSubTab = ref<'notifications' | 'groups' | 'badges' | 'triage' | 'practice' | 'pilot' | 'celltypes' | 'access' | 'tests' | 'hunts' | 'tutorialEdits'>(
  props.initialSubTab === 'triage' || props.initialSubTab === 'groups' || props.initialSubTab === 'badges' || props.initialSubTab === 'practice' || props.initialSubTab === 'pilot' || props.initialSubTab === 'access' || props.initialSubTab === 'tests' || props.initialSubTab === 'tutorialEdits' || props.initialSubTab === 'hunts'
    ? props.initialSubTab
    : 'notifications');

// Pilot membership is an explicit admin-maintained list of verified sign-in emails.
const pilotRows = ref<{email:string;enabled:boolean}[]>([]);
const pilotEmail = ref('');
const pilotError = ref('');
const pilotBusy = ref(false);
/** The Pyr name behind each invited email, for those who have signed in
 *  (Ames 2026-10-13: "it should also show username"). By email, lower case. */
const pilotNames = ref<Record<string, string>>({});
const pilotSearch = ref('');
const pilotShown = computed(() => {
  const words = pilotSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pilotRows.value;
  return pilotRows.value.filter(m => {
    const hay = (m.email + ' ' + (pilotNames.value[m.email.toLowerCase()] || '')).toLowerCase();
    return words.every(w => hay.includes(w));
  });
});
async function loadPilotNames(emails: string[]) {
  const found: Record<string, string> = {};
  for (let i = 0; i < emails.length; i += 60) {
    const {data} = await supabase.from('users').select('username,display_name,middleauth_email').in('middleauth_email', emails.slice(i, i + 60));
    for (const u of (data || []) as any[]) {
      const name = u.username || u.display_name;
      if (u.middleauth_email && name) found[String(u.middleauth_email).toLowerCase()] = name;
    }
  }
  pilotNames.value = found;
}
async function loadPilot() {
  const {data,error} = await supabase.from('pilot_members').select('*').order('email');
  pilotError.value = error?.message || '';
  pilotRows.value = data || [];
  void loadPilotNames(pilotRows.value.map(m => m.email)).catch(() => { /* the emails still show */ });
}
const pilotNote = ref('');
/** Several emails at once, separated by commas, spaces or new lines (Ames
 *  2026-10-22). Anything that is not an email address is left in the box,
 *  and said so, and the rest are added. */
async function invitePilot() {
  pilotError.value = ''; pilotNote.value = '';
  const words = pilotEmail.value.split(/[\s,;]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
  const good = [...new Set(words.filter(w => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w)))];
  const bad = words.filter(w => !good.includes(w));
  if (!good.length) { pilotError.value = bad.length ? `Not an email address: ${bad.join(', ')}` : 'Type at least one email address.'; return; }
  pilotBusy.value = true;
  const {error} = await supabase.from('pilot_members').upsert(good.map(email => ({email, enabled: true})), {onConflict:'email'});
  if (error) pilotError.value = error.message;
  else {
    pilotEmail.value = bad.join(', ');
    pilotNote.value = `Added ${good.length} tester${good.length === 1 ? '' : 's'}.`;
    if (bad.length) pilotError.value = `Not added, not an email address: ${bad.join(', ')}`;
    await loadPilot();
  }
  pilotBusy.value = false;
}
async function setPilot(email:string,enabled:boolean) {
  const {error} = await supabase.from('pilot_members').update({enabled}).eq('email',email);
  if(error) pilotError.value=error.message; else await loadPilot();
}
// ── Beta requests (Ames 2026-10-26: "Where should I see the access request?
//    Can you grant me a button that adds their email to the pilot tester
//    list?"). Every Beta access report (functions/access-request.js, from the
//    game or connectome.quest), newest first, with Let them in. The email to
//    add is read from the server's own lines of the report, never the note.
type BetaRequest = { id: string; name: string; email: string; note: string; site: boolean; at: string; ewName: string; ewRank: string };
const betaRequests = ref<BetaRequest[]>([]);
const betaError = ref('');
const betaBusy = ref('');
// Which requests show (Ames 2026-10-26: "move them from the page and put
// them in a db list", and "remove request"). Marks are kept by the server.
type BetaView = 'waiting' | 'listed' | 'in' | 'removed';
const betaView = ref<BetaView>('waiting');
const betaMarks = ref<Record<string, { mark: string; at: string }>>({});
function parseBetaRequest(r: any): BetaRequest | null {
  const lines = String(r.message || '').split('\n');
  const noteAt = lines.findIndex(l => l.startsWith('Their note: '));
  const head = noteAt < 0 ? lines : lines.slice(0, noteAt);
  const pick = (label: string) => {
    for (const l of head) {
      const m = l.match(new RegExp('^' + label + ': ([^\\s]+@[^\\s]+?)\\.?(?:\\s|$)'));
      if (m) return m[1].toLowerCase();
    }
    return '';
  };
  // In the game, the sign in email is the one that counts; from the site, the one they gave.
  const email = pick('Sign in email') || pick('Email') || pick('Email they gave');
  if (!email) return null;
  const note = noteAt < 0 ? '' : lines.slice(noteAt).join('\n').replace(/^Their note: /, '');
  const line = (label: string) => (head.find(l => l.startsWith(label + ': ')) || '').slice(label.length + 2).trim();
  return { id: r.id, name: r.user_name || '', email, note, site: /connectome\.quest/.test(String(r.url || '') + String(r.title || '')), at: r.created_at,
    ewName: line('EyeWire username'), ewRank: line('EyeWire rank') };
}
async function loadBetaRequests() {
  betaError.value = '';
  const { data, error } = await supabase.from('site_issues').select('id,user_name,title,message,url,created_at')
    .eq('category', 'Beta access').order('created_at', { ascending: false }).limit(300);
  if (error) { betaError.value = error.message; return; }
  const seen = new Set<string>();
  betaRequests.value = ((data || []) as any[]).map(parseBetaRequest)
    .filter((r): r is BetaRequest => !!r && !seen.has(r.email) && !!seen.add(r.email));
  try { betaMarks.value = (await secureWrite<Record<string, { mark: string; at: string }>>('access.betaMarks')) || {}; }
  catch (e: any) { betaError.value = e?.message || 'The sorted lists could not be loaded.'; }
}
const pilotEnabled = computed(() => new Set(pilotRows.value.filter(m => m.enabled).map(m => m.email.toLowerCase())));
/** Let in wins; then a mark, unless they asked again after it was made. */
function betaStateOf(r: BetaRequest): BetaView {
  if (pilotEnabled.value.has(r.email)) return 'in';
  const m = betaMarks.value[r.email];
  if (m && (m.mark === 'listed' || m.mark === 'removed') && String(m.at) >= String(r.at)) return m.mark;
  return 'waiting';
}
const BETA_VIEWS: { key: BetaView; label: string }[] = [
  { key: 'waiting', label: 'Waiting' }, { key: 'listed', label: 'On the list' }, { key: 'in', label: 'Let in' }, { key: 'removed', label: 'Removed' },
];
const betaCount = computed(() => {
  const n = { waiting: 0, listed: 0, in: 0, removed: 0 } as Record<BetaView, number>;
  for (const r of betaRequests.value) n[betaStateOf(r)]++;
  return n;
});
const betaShown = computed(() => betaRequests.value.filter(r => betaStateOf(r) === betaView.value));
async function markBeta(r: BetaRequest, mark: 'listed' | 'removed' | 'waiting') {
  betaBusy.value = r.email; betaError.value = '';
  try { betaMarks.value = (await secureWrite<Record<string, { mark: string; at: string }>>('access.betaMark', { email: r.email, mark })) || {}; }
  catch (e: any) { betaError.value = e?.message || 'That did not save. Please try again.'; }
  betaBusy.value = '';
}
async function letBetaIn(r: BetaRequest) {
  betaBusy.value = r.email; betaError.value = '';
  const { error } = await supabase.from('pilot_members').upsert([{ email: r.email, enabled: true }], { onConflict: 'email' });
  if (error) betaError.value = error.message; else await loadPilot();
  betaBusy.value = '';
}
/** An email to tell them, ready to send from the admin's own mail. */
function betaMailto(r: BetaRequest) {
  const first = r.name.split(' ')[0] || 'there';
  const body = `Hi ${first},\n\nYou're in! Thanks for asking to map the brain with us. Sign in to Pyr with this email address (${r.email}) here:\n\nhttps://connectome.quest/play/\n\nThe Pyr (pronounced "peer") team at Princeton University`;
  return `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent("You're in: Pyr early access")}&body=${encodeURIComponent(body)}`;
}
const betaWhen = (at: string) => { try { return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
watch(adminSubTab,t=>{if(t==='pilot'){loadPilot();void loadBetaRequests();}},{immediate:true});

// ── Feedback triage ──────────────────────────────────────────────────────────
// A scheduled agent reads incoming feedback (site_issues, client_errors) and
// proposes an action per item into feedback_triage. This subtab is the human
// gate: Amy or Celia approve, edit, or dismiss. Approving a 'message'
// proposal sends it to the reporter as a notification; approving a spec just
// marks it accepted for the work queue.
// Console messages a player attached to "Submit an issue" (site_issues.console_log).
const issueConsole = ref<Record<string, string | null>>({});
const issueConsoleOpen = ref<Record<string, boolean>>({});
async function toggleIssueConsole(row: { id: string; source_id: string }) {
  if (issueConsole.value[row.id] === undefined) {
    const { data } = await supabase.from('site_issues').select('console_log').eq('id', row.source_id).maybeSingle();
    issueConsole.value = { ...issueConsole.value, [row.id]: (data as any)?.console_log ?? null };
  }
  issueConsoleOpen.value = { ...issueConsoleOpen.value, [row.id]: !issueConsoleOpen.value[row.id] };
}

interface TriageRow {
  id: string;
  source: string;
  source_id: string;
  source_excerpt: string | null;
  recommendation: 'nothing' | 'message' | 'bug_fix_spec' | 'new_feature';
  rationale: string | null;
  proposed_message: string | null;
  spec: string | null;
  status: 'proposed' | 'approved' | 'dismissed' | 'done';
  reviewed_by: string | null;
  created_at: string;
  // Implement-on-approval loop (supabase-triage-loop-columns.sql,
  // docs/TRIAGE-LOOP.md). Slack and this tab read and write the same row.
  approver_note?: string | null;
  impl_state?: ImplState | null;
  impl_summary?: string | null;
  impl_run_url?: string | null;
  impl_attempts?: number;
  preview_url?: string | null;
  feedback_log?: { user?: string; text: string; ts: string; role: string; by?: string; at?: string; via?: string; sent?: boolean; echoed?: boolean;
    /** reporter_update: sent with "Ask for a reply". reporter_reply: not read by an approver yet when seen is false. */
    ask?: boolean; notification_id?: number; seen?: boolean;
    /** reporter_update: an image sent with it, cleared (image_removed) after 7 days. */
    image_url?: string | null; image_removed?: boolean;
    /** What came with a reporter_reply (supabase-report-reply-parts.sql). */
    screenshot_url?: string; view_url?: string; dataset?: string; build?: string; console_lines?: number }[];
  result_note?: string | null;
  nag_count?: number;
  approver_slack_id?: string | null;
  tested_by?: string | null;
  slack_ts?: string | null;
  slack_channel?: string | null;
  /** Notes with no decision (Celia #178, supabase-triage-notes.sql). */
  admin_notes?: { by: string; text: string; at: string }[];
}
type ImplState = 'queued' | 'implementing' | 'needs_info' | 'testing' | 'changes_requested'
  | 'answer_queued' | 'answering' | 'deploy_queued' | 'deploying' | 'deployed'
  | 'live_test_queued' | 'live_testing' | 'revert_queued' | 'reverting' | 'failed';
const triageRows = ref<TriageRow[]>([]);
const triageLoading = ref(false);
const triageError = ref('');
const triageShowReviewed = ref(false);
const triageActing = ref<string | null>(null);
/** Per-row edited message text, keyed by triage row id. */
const triageEdits = ref<Record<string, string>>({});
/** Per-row reviewer comment, saved as approver_note with Approve or Dismiss
 *  on every proposal type; for a buildable spec the loop also hands it to
 *  Claude. */
const triageNotes = ref<Record<string, string>>({});

const IMPL_LABELS: Record<ImplState, string> = {
  queued: 'Waiting for Claude',
  implementing: 'Claude is building it',
  needs_info: 'Claude has a question (answer in Slack)',
  answer_queued: 'Tester asked a question',
  answering: 'Claude is answering the tester',
  live_test_queued: 'Going live for a real-data test',
  live_testing: 'Live test, waiting for the tester',
  revert_queued: 'Taking it off the live site',
  reverting: 'Reverting the live site',
  testing: 'Preview up, waiting for the tester',
  changes_requested: 'Tester sent it back',
  deploy_queued: 'Tested, deploy starting',
  deploying: 'Deploying live',
  deployed: 'Live',
  failed: 'Failed, needs a look',
};
const ROLE_LABELS: Record<string, string> = {
  tester: 'Tester', question: 'Question', answer: 'Answer',
  reporter_update: 'To submitter', reporter_draft: 'Draft', reporter_ignored: 'Comment',
  reporter_reply: 'Submitter reply',
};
const roleLabel = (role: string) => ROLE_LABELS[role] || 'Comment';
const isBuildable = (r: TriageRow) => r.recommendation === 'bug_fix_spec' || r.recommendation === 'new_feature';
const slackThreadUrl = (r: TriageRow) =>
  r.slack_ts ? `https://eyewire.slack.com/archives/${r.slack_channel || 'C0BG5CN71C3'}/p${r.slack_ts.replace('.', '')}` : null;

const TRIAGE_LABELS: Record<TriageRow['recommendation'], string> = {
  nothing: 'No action',
  message: 'Send a message',
  bug_fix_spec: 'Bug fix spec',
  new_feature: 'New feature',
};

/** Split a structured spec ("Symptom: ...\nWhere: ...") into labeled rows.
 *  Lines that don't match the Label: form render as plain rows, so older
 *  free-text specs still display. */
function parseSpec(spec: string): { label: string | null; text: string }[] {
  // Older proposals ran every field together on one line: split before each label.
  const split = spec.replace(/\s+(?=(Symptom|What|Where|Cause|Fix|Scope|Severity)\s*:)/g, '\n');
  return split.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(Symptom|What|Where|Cause|Fix|Scope|Severity)\s*:\s*(.*)$/i);
    return m ? { label: m[1], text: m[2] } : { label: null, text: line };
  });
}

// ── Who submitted each report (site_issues, admins only via the gateway) ──
const reporters = ref<Record<string, { name: string; category: string; at: string; title?: string; message?: string; url?: string; shot?: string }>>({});
/** Reports asked for by id at most this many at a time. The gateway refuses a
 *  filter over 4096 characters (functions/community-data.js), and 100 ids
 *  come to about 3700. 150 came to 5554: once more than about 110 reports
 *  were closed, the lookup was refused and every closed report lost its
 *  category (Ames 2026-10-21: bugs fixed fell from 72 to 27). */
const IDS_PER_ASK = 100;
async function loadReporters(rows: TriageRow[]) {
  const ids = [...new Set(rows.filter(r => r.source === 'site_issue' && r.source_id && !reporters.value[r.source_id]).map(r => r.source_id))];
  if (!ids.length) return;
  try {
    const { supabase } = await import('../supabase');
    // The view they were in and their screenshot, as Slack shows them (Ames
    // 2026-10-16: "triage panel now missing view"). Older tables may lack the
    // screenshot column, so ask again without it if need be.
    // A title (Celia #178) once supabase-site-issues-title.sql has run.
    const data: any[] = [];
    for (let k = 0; k < ids.length; k += IDS_PER_ASK) {
      const part = ids.slice(k, k + IDS_PER_ASK);
      let { data: got, error } = await supabase.from('site_issues').select('id,user_name,category,created_at,title,message,url,screenshot_url').in('id', part);
      if (error) ({ data: got, error } = await supabase.from('site_issues').select('id,user_name,category,created_at,message,url,screenshot_url').in('id', part));
      if (error) ({ data: got } = await supabase.from('site_issues').select('id,user_name,category,created_at,message,url').in('id', part));
      data.push(...(got ?? []));
    }
    const next = { ...reporters.value };
    // An older report saved "page @ x,y,z" when no short link could be made;
    // as a link that went to a missing page (Ames 2026-10-18). Read it as the
    // spot it names: the game, opened there (src/util/cell_link.ts, ?at=).
    const web = (u: any) => {
      if (typeof u !== 'string' || !/^https:\/\//.test(u)) return undefined;
      const m = u.match(/^(https:\/\/[^\s]+?)\s*@\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { try { const x = new URL(m[1]); x.search = ''; x.hash = ''; x.searchParams.set('at', [m[2], m[3], m[4]].map(n => Math.round(Number(n))).join(',')); return x.toString(); } catch { return undefined; } }
      return /\s/.test(u) ? undefined : u;
    };
    for (const i of data) next[i.id] = { name: i.user_name || 'Unknown player', category: i.category || '', at: i.created_at || '', title: String(i.title || '').trim() || undefined, message: String(i.message || '').trim(),
      url: web(i.url), shot: web(i.screenshot_url) };
    reporters.value = next;
  } catch (e) { console.warn('[triage] could not load who submitted:', e); }
}
const reporterOf = (r: TriageRow) => (r.source === 'site_issue' ? reporters.value[r.source_id] : undefined);

// ── Let them in from a Beta access card (Ames 2026-10-26: "so admin could
//    grant them access from here?"). The email is read the same way as in
//    Beta requests (parseBetaRequest), from the server's own lines.
const cardLetInBusy = ref('');
const cardLetInError = ref<Record<string, string>>({});
function betaEmailOfCard(r: TriageRow): string {
  const who = reporterOf(r);
  if (!who || who.category !== 'Beta access') return '';
  return parseBetaRequest({ id: r.source_id, message: who.message || '', user_name: who.name, created_at: who.at })?.email || '';
}
async function letInFromCard(r: TriageRow) {
  const email = betaEmailOfCard(r);
  if (!email || cardLetInBusy.value) return;
  cardLetInBusy.value = r.id; cardLetInError.value = { ...cardLetInError.value, [r.id]: '' };
  try {
    const { error } = await supabase.from('pilot_members').upsert([{ email, enabled: true }], { onConflict: 'email' });
    if (error) { cardLetInError.value = { ...cardLetInError.value, [r.id]: error.message }; return; }
  } finally { cardLetInBusy.value = ''; }
  await setTriageStatus(r, 'done', false, false, `Let in: ${email} added to Pilot testers.`);
  if (adminSubTab.value === 'pilot') void loadPilot();
}
/** What the player wrote, in full. The triage row only keeps an excerpt,
 *  which ends in "..." when the report was long (Ames 2026-10-10: "make it
 *  so the user's full text appears"). The excerpt stands in until the report
 *  itself has loaded, or when there is no report behind the row. */
const fullTextOf = (r: TriageRow) => reporterOf(r)?.message || r.source_excerpt || '';
/** A steady color for a name, so each reporter is easy to spot on the board. */
function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
/** "5m", "3h", "2d": how long ago, short enough for a chip. */
function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 60 * 36) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
const shortDate = (iso: string) => {
  const d = new Date(iso);
  // Date and time, in the admin's own time zone (Ames 2026-10-10: "timestamp,
  // not just date"): several reports land on the same day.
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// ── Board: open work on top, finished and dismissed folded away ───────────
// Slack and this tab write the same rows, so a dismiss, stop or "good" in a
// Slack thread moves the card here too (after Refresh).
type TriageGroupKey = 'decide' | 'progress' | 'todo' | 'later' | 'done' | 'dismissed';
const triageOpen = ref<Record<TriageGroupKey, boolean>>({ decide: true, progress: true, todo: false, later: false, done: false, dismissed: false });

// The card you are working on stays marked, and stays in view when the list
// reloads after an action (Ames 2026-10-05: sending an update reloaded the
// list and scrolled the card away, so it looked like it had vanished).
const triageSelected = ref<string | null>(null);
function keepSelectedInView() {
  const id = triageSelected.value;
  if (!id) return;
  const row = triageRows.value.find(r => r.id === id);
  // An action can move the card into a folded section: open it.
  if (row) triageOpen.value[triageGroupOf(row)] = true;
  void nextTick(() => document.querySelector(`[data-triage-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
}

// Which report to open on, if any: "?report=<id>" (the Slack links), or the
// quote a bell notification left a moment ago (NotificationFeedPanel).
function takeTriageFocus(): { id?: string; excerpt?: string } | null {
  try {
    const id = new URLSearchParams(window.location.search).get('report') || '';
    if (/^[0-9a-f-]{36}$/i.test(id)) return { id };
    const raw = window.localStorage.getItem('nge_triage_focus');
    if (raw) {
      window.localStorage.removeItem('nge_triage_focus');
      const f = JSON.parse(raw);
      if (f?.excerpt && Date.now() - Number(f.at) < 2 * 60 * 1000) return { excerpt: String(f.excerpt) };
    }
  } catch { /* nothing to open on */ }
  return null;
}
let triageFocus = takeTriageFocus();
/** Select the card the focus names. A finished report older than five days
 *  is not in the default list, so look once more with older ones shown. */
function applyTriageFocus() {
  if (!triageFocus) return;
  const flat = (t: any) => String(t || '').replace(/\s+/g, ' ').trim();
  const f = triageFocus;
  const hit = triageRows.value.find(r => (f.id ? r.id === f.id : !!f.excerpt && flat(r.source_excerpt).startsWith(f.excerpt)));
  if (hit) { triageSelected.value = hit.id; triageFocus = null; }
  else if (!triageShowReviewed.value) triageShowReviewed.value = true;   // its watcher reloads
  else triageFocus = null;
}

// Board view: the whole window, one column per section, cards compact until
// you click one. "?triage=board" in the address opens straight into it, which
// is what the "New tab" link uses.
const triageBoard = ref(!!props.standalone);
/** The To do board's mark (TodoBoard.vue has the same), apart from the
 *  clipboard that means Copy. */
const TODO_ICON = '<svg class="nge-todo-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const boardUrl = `${window.location.origin}${window.location.pathname}?triage=board`;
/** The game itself, on this same site. */
const gameUrl = `${window.location.origin}${window.location.pathname}`;
function onBoardKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && triageBoard.value && !props.standalone && !(e.target as HTMLElement)?.closest?.('textarea, input')) triageBoard.value = false;
}
onMounted(() => document.addEventListener('keydown', onBoardKey));
onUnmounted(() => document.removeEventListener('keydown', onBoardKey));
// The main categories are Needs your decision and In progress (Ames
// 2026-10-10). What "more columns" means is INSIDE them: the chips of a wide
// category sit in several columns side by side, so more fit on screen. Who
// has the next move on an in-progress report is said by the tag on its chip.
// A reply the submitter was asked for and no approver has read yet (Ames
// 2026-10-13) puts the card back under Needs your decision, wherever it was,
// Done included. Only where it is SHOWN changes: its status, its build state
// and its note are untouched, so the robot never builds or rebuilds anything
// because of a reply. "Reply read" (or writing back) lets it go home.
const hasNewReply = (r: TriageRow) => (r.feedback_log || []).some(e => e.role === 'reporter_reply' && e.seen === false);
/** You asked the submitter for a reply and it has not come yet (Ames
 *  2026-10-20: "I asked for a reply on 181 yet there is no distinction on
 *  that card"). When the newest such question was sent, or null. Same test
 *  as the card's thread (reporterThreadFor). */
function awaitingReplySince(r: TriageRow): string | null {
  const log = r.feedback_log || [];
  const asks = log.filter(e => e.role === 'reporter_update' && e.ask && e.sent !== false
    && !log.some(x => x.role === 'reporter_reply' && x.notification_id === e.notification_id));
  if (!asks.length) return null;
  const last = asks[asks.length - 1];
  return last.at || (/^\d{4}-/.test(last.ts) ? last.ts : '') || '';
}
const isAwaitingReply = (r: TriageRow) => !hasNewReply(r) && awaitingReplySince(r) !== null;
function triageGroupOf(r: TriageRow): TriageGroupKey {
  if (hasNewReply(r)) return 'decide';
  if (r.status === 'dismissed') return 'dismissed';
  if (r.status === 'done' || r.impl_state === 'deployed') return 'done';
  if (r.status === 'proposed') return 'decide';
  if (isTodo(r)) return 'todo';
  if (isLater(r)) return 'later';
  return 'progress';
}
const triageGroups = computed(() => {
  const defs: { key: TriageGroupKey; icon: string; title: string; hint: string; empty: string; closed: boolean }[] = [
    { key: 'decide', icon: '📥', title: 'Needs your decision', hint: 'Approve or dismiss', empty: 'Triage zero. Nicely done.', closed: false },
    { key: 'progress', icon: '🛠', title: 'In progress', hint: 'By hand, building, or waiting on a test', empty: 'Nothing on the bench.', closed: false },
    { key: 'todo', icon: '☑', title: 'On the To do board', hint: 'Reports planned there', empty: 'No reports on the To do board.', closed: true },
    { key: 'later', icon: '💡', title: 'Ideas for later', hint: 'Good ideas, not now', empty: 'No ideas put by.', closed: true },
    { key: 'done', icon: '✅', title: 'Done', hint: 'Shipped or handled', empty: 'Nothing closed yet.', closed: true },
    { key: 'dismissed', icon: '🗂', title: 'Dismissed', hint: 'Stopped or turned down', empty: 'Nothing turned down.', closed: true },
  ];
  return defs.map(d => {
    const rows = triageRows.value.filter(r => triageGroupOf(r) === d.key && triageMatches(r));
    // New replies first: an old card would otherwise land at the bottom.
    if (d.key === 'decide') return { ...d, rows: [...rows.filter(hasNewReply), ...rows.filter(r => !hasNewReply(r))] };
    return { ...d, rows };
  });
});

// A light page for reading (Ames 2026-10-10: "it's hard to read this much
// text on dark BG"). The triage page on its own opens light; the board inside
// the game stays dark like the game unless switched. The choice is remembered.
const TRIAGE_LIGHT_KEY = 'nge_triage_light_v1';
const triageLight = ref((() => {
  try { const v = localStorage.getItem(TRIAGE_LIGHT_KEY); if (v === '1' || v === '0') return v === '1'; } catch { /* private window */ }
  return !!props.standalone;
})());
function toggleTriageLight() {
  triageLight.value = !triageLight.value;
  try { localStorage.setItem(TRIAGE_LIGHT_KEY, triageLight.value ? '1' : '0'); } catch { /* not remembered */ }
}

// Search the board (Ames 2026-10-10: "I need search in active feedback / in
// progress"). Every word typed must be found somewhere in the report: its
// number, who sent it, what they wrote, the proposal, the notes, the state.
// "#42" finds report 42. Typing opens every section that has a match.
const triageSearch = ref('');
const triageWords = computed(() => triageSearch.value.toLowerCase().split(/\s+/).filter(Boolean));
// Bug, Idea or Other (Ames 2026-10-20: "can we have a way to filter by bug /
// idea / other?"). What the submitter picked; an old Data problem counts as a
// Bug, and a report with no category goes by its suggestion (closedKind).
type TriageKind = 'all' | 'bug' | 'feature' | 'other';
const TRIAGE_KIND_KEY = 'nge_triage_kind_v1';
const triageKind = ref<TriageKind>((() => {
  try { const v = localStorage.getItem(TRIAGE_KIND_KEY); if (v === 'bug' || v === 'feature' || v === 'other') return v; } catch { /* private window */ }
  return 'all';
})());
watch(triageKind, v => { try { localStorage.setItem(TRIAGE_KIND_KEY, v); } catch { /* not remembered */ } });
const kindOf = (r: TriageRow) => closedKind(r, reporterOf(r)?.category);
const TRIAGE_KINDS: { key: TriageKind; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'bug', label: '🐛 Bug' }, { key: 'feature', label: '💡 Idea' }, { key: 'other', label: 'Other' },
];
/** Open reports only (Ames 2026-10-21: the filter is for active reports):
 *  Needs your decision, In progress, On the To do board, Ideas for later. */
const triageKindCount = computed(() => {
  const n = { all: 0, bug: 0, feature: 0, other: 0 } as Record<TriageKind, number>;
  for (const r of triageRows.value) {
    if (['done', 'dismissed'].includes(triageGroupOf(r))) continue;
    n.all++; n[kindOf(r)]++;
  }
  return n;
});
function triageMatches(r: TriageRow): boolean {
  if (triageKind.value !== 'all' && kindOf(r) !== triageKind.value) return false;
  const words = triageWords.value;
  if (!words.length) return true;
  const n = triageNumbers.value[r.id];
  const who = reporterOf(r);
  const hay = [n ? `#${n}` : '', who?.name, who?.category, who?.title, who?.message, r.source_excerpt, r.rationale, r.spec, r.proposed_message,
    r.approver_note, r.impl_summary, r.result_note, r.reviewed_by, r.status, r.impl_state, TRIAGE_LABELS[r.recommendation],
    ...(r.admin_notes || []).map(n => n.text),
    ...(r.feedback_log || []).map(f => f.text)].filter(Boolean).join(' | ').toLowerCase();
  return words.every(w => hay.includes(w));
}
const triageMatchCount = computed(() => triageRows.value.filter(triageMatches).length);
watch(triageWords, words => {
  if (!words.length) return;
  for (const g of triageGroups.value) if (g.rows.length) triageOpen.value[g.key] = true;
});

// Every report has a number: its place in the order reports arrived, counted
// over ALL of them, so a number never changes as cards come and go from the
// board (Ames 2026-10-10: "number the requests so it's easier to keep track").
const triageNumbers = ref<Record<string, number>>({});
/** What a closed report counts as on the score panel (Ames 2026-10-15: the
 *  boxes went by the robot's suggestion, and most reports never get one, so
 *  most closes counted nowhere). The reporter's own choice decides: Bug and
 *  Data problem are bugs fixed, Idea is a feature shipped, Other is answered.
 *  A report with no category (from Slack, say) falls back to the suggestion.
 *  So the three boxes always add up to everything closed. */
type ClosedKind = 'bug' | 'feature' | 'other';
function closedKind(r: { recommendation?: string | null }, category?: string | null): ClosedKind {
  const c = (category || '').trim().toLowerCase();
  if (c === 'bug' || c === 'data problem') return 'bug';
  if (c === 'idea') return 'feature';
  if (c) return 'other';
  if (r.recommendation === 'new_feature') return 'feature';
  if (r.recommendation === 'bug_fix_spec' || r.recommendation === 'fix') return 'bug';
  return 'other';
}
async function loadTriageNumbers() {
  try {
    const { supabase } = await import('../supabase');
    const next: Record<string, number> = {};
    let bugs = 0, features = 0, other = 0, today = 0;
    const closed: any[] = [];
    const days: Record<string, number> = {};
    const todayIs = new Date().toDateString();
    // 500 at a time: the server refuses a larger page, which is why the
    // numbers did not show at first.
    for (let from = 0, n = 0; ; from += 500) {
      const { data, error } = await supabase.from('feedback_triage').select('id,status,recommendation,impl_state,reviewed_at,source,source_id').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 499);
      if (error || !data) return;
      for (const r of data as any[]) {
        next[r.id] = ++n;
        if (r.status === 'done' || r.impl_state === 'deployed') {
          closed.push(r);
          if (r.reviewed_at && new Date(r.reviewed_at).toDateString() === todayIs) today++;
          if (r.reviewed_at) { const k = dayKey(new Date(r.reviewed_at)); days[k] = (days[k] || 0) + 1; }
        }
      }
      if (data.length < 500) break;
    }
    // What each closed report was filed as, IDS_PER_ASK at a time.
    const cats: Record<string, string> = {};
    let catsFailed = false;
    const ids = [...new Set(closed.filter(r => r.source === 'site_issue' && r.source_id).map(r => String(r.source_id)))];
    for (let i = 0; i < ids.length; i += IDS_PER_ASK) {
      const { data: got, error: catErr } = await supabase.from('site_issues').select('id,category').in('id', ids.slice(i, i + IDS_PER_ASK));
      // A refused lookup must not quietly turn every bug into "answered".
      if (catErr) { console.warn('[triage] categories not loaded:', catErr.message); catsFailed = true; break; }
      for (const x of (got ?? []) as any[]) cats[String(x.id)] = x.category || '';
    }
    for (const r of closed) {
      const k = closedKind(r, r.source === 'site_issue' ? cats[String(r.source_id)] : null);
      if (k === 'bug') bugs++; else if (k === 'feature') features++; else other++;
    }
    triageNumbers.value = next;
    // Keep the last good counts rather than show wrong ones.
    if (!catsFailed) triageTally.value = { bugs, features, other, today, days };
  } catch { /* the cards simply show no number */ }
}

// ── What has been closed, and a moment of reward for closing one ──
// Counted over every report, not only the ones on the board (Ames
// 2026-10-10: "give me some visual reward for completing them").
const triageTally = ref({ bugs: 0, features: 0, other: 0, today: 0, days: {} as Record<string, number> });
/** A day on this computer's calendar, as 2026-10-10. */
function dayKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** Everything closed, and how far along to the next round number (every 25). */
const triageScore = computed(() => {
  const t = triageTally.value, total = t.bugs + t.features + t.other;
  const next = (Math.floor(total / 25) + 1) * 25;
  return { total, next, toGo: next - total, fill: Math.round(((total % 25) / 25) * 100) };
});
// ── The game on top of the board (Ames 2026-10-10: "gamify it, make the top
// bar more exciting"). Every number is counted from the reports themselves:
// a level for every 25 closed, days in a row with one closed, the best day,
// and the last two weeks. A closed report is dated by the day it was decided,
// the one date every report carries.
const TRIAGE_RANKS = ['Spine Spotter', 'Dendrite Detective', 'Axon Tracker', 'Synapse Fixer', 'Soma Guardian',
  'Circuit Mechanic', 'Network Engineer', 'Cortex Commander', 'Connectome Keeper', 'Bug Legend'];
const triageGame = computed(() => {
  const t = triageTally.value, total = t.bugs + t.features + t.other;
  const level = Math.floor(total / 25) + 1;
  const rank = TRIAGE_RANKS[Math.min(level, TRIAGE_RANKS.length) - 1];
  const at = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d; };
  const on = (back: number) => t.days[dayKey(at(back))] || 0;
  // Today not closed yet does not break a streak; it is only at risk.
  let streak = 0;
  for (let back = on(0) ? 0 : 1; on(back) > 0; back++) streak++;
  let bestBefore = 0;
  const todayKey = dayKey(new Date());
  for (const [k, n] of Object.entries(t.days)) if (k !== todayKey && n > bestBefore) bestBefore = n;
  const best = Math.max(bestBefore, on(0));
  const spark = Array.from({ length: 14 }, (_, i) => {
    const back = 13 - i, d = at(back), n = on(back);
    return { key: dayKey(d), n, today: back === 0, label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), h: 0 };
  });
  const top = Math.max(1, ...spark.map(d => d.n));
  for (const d of spark) d.h = d.n ? Math.max(14, Math.round((d.n / top) * 100)) : 6;
  const waiting = triageRows.value.filter(r => triageGroupOf(r) === 'decide').length;
  return { level, rank, streak, streakAtRisk: streak > 0 && !on(0), best, record: on(0) > 0 && bestBefore > 0 && on(0) > bestBefore, spark, waiting };
});
// One Nurro a day in the bar, the same one all day, in a fixed order.
const NURROS: string[] = [nurroDance, nurroTrophy, nurroCelebrate, nurroMicroscope, nurroPopcorn, nurroAtHome, nurroConfetti, nurroInspector, nurroExperiment, nurroLaserTeach, nurroCelebrate2, nurroSuperV2, nurroWheres, nurroOriginal, nurroSuccess];
const todaysNurro = (() => {
  const d = new Date(), day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  return NURROS[day % NURROS.length];
})();
const repoStats = ref<RepoStats | null>(null);
onMounted(() => { void loadRepoStats().then(s => { repoStats.value = s; }); });

const triageCheer = ref<{ key: number; kind: 'bug' | 'feature' | 'other'; text: string; levelUp?: boolean } | null>(null);
let cheerTimer: ReturnType<typeof setTimeout> | null = null;
function cheerFor(row: TriageRow) {
  const kind = closedKind(row, reporterOf(row)?.category);
  const n = triageNumbers.value[row.id];
  const what = kind === 'feature' ? 'Feature shipped' : kind === 'bug' ? 'Bug fixed' : 'Answered';
  // This close is the one that reaches the next level when one was left to go.
  const levelUp = triageScore.value.toGo === 1;
  triageCheer.value = { key: Date.now(), kind, levelUp, text: levelUp ? `Level ${triageGame.value.level + 1}! ${what}${n ? ` · #${n}` : ''}` : `${what}${n ? ` · #${n}` : ''}` };
  if (cheerTimer) clearTimeout(cheerTimer);
  cheerTimer = setTimeout(() => { triageCheer.value = null; }, 2600);
}

// ── Board columns that fold away ──
// Done and Dismissed start folded to a narrow rail, so the two columns that
// need attention get the width (Ames 2026-10-10). Click a column's heading
// to fold or open it; the choice is remembered.
// v4: the To do column became "On the To do board", folded (2026-10-19).
const TRIAGE_FOLD_KEY = 'nge_triage_folded_v4';
const triageFolded = ref<Record<TriageGroupKey, boolean>>((() => {
  const start = { decide: false, progress: false, todo: true, later: true, done: true, dismissed: true } as Record<TriageGroupKey, boolean>;
  try { return { ...start, ...(JSON.parse(localStorage.getItem(TRIAGE_FOLD_KEY) || '{}') || {}) }; } catch { return start; }
})());
function toggleFold(key: TriageGroupKey) {
  triageFolded.value = { ...triageFolded.value, [key]: !triageFolded.value[key] };
  try { localStorage.setItem(TRIAGE_FOLD_KEY, JSON.stringify(triageFolded.value)); } catch { /* not remembered */ }
}
/** Folded right now. While searching nothing is folded, so a match in Done
 *  or Dismissed is not hidden. */
const isFolded = (key: TriageGroupKey) => triageFolded.value[key] && !triageWords.value.length;
// Triage zero: when the last report under Needs your decision is handled,
// a party (Ames 2026-10-23: "some celebration when Triage reached zero").
// Only when it goes from some to none while you watch, never on load.
const zeroParty = ref(0);
const decideCount = computed(() => triageGroups.value.find(g => g.key === 'decide')?.rows.length ?? -1);
let hadDecisions = false;
watch(decideCount, (n, before) => {
  if (triageLoading.value) return;
  if (n > 0) { hadDecisions = true; return; }
  if (n === 0 && hadDecisions && (before ?? 0) > 0) {
    hadDecisions = false;
    zeroParty.value = Date.now();
    setTimeout(() => { if (Date.now() - zeroParty.value >= 5900) zeroParty.value = 0; }, 6000);
  }
});
const ZERO_BITS = Array.from({ length: 70 }, (_, i) => ({
  left: (i * 37) % 100, delay: (i % 14) * 0.09, dur: 2.4 + (i % 7) * 0.35, rot: (i * 53) % 360,
  color: ['#4f8cff', '#2ec4b6', '#f5c542', '#ff6fae', '#38bdf8'][i % 5], wide: i % 3 === 0,
}));
const boardColumns = computed(() => triageGroups.value.map(g => (isFolded(g.key) ? '46px' : 'minmax(0, 1fr)')).join(' '));

// ── In progress, by hand ──
// Most reports are fixed in a Claude chat, not by the robot (Ames 2026-10-10).
// This moves a card to In progress WITHOUT queueing a robot build and without
// sending anything to the reporter. The note is how the Slack bridge knows not
// to start a build (scripts/slack-triage-bridge.mjs reads the same words).
// ── A new report, no suggestion yet ──
// Every report is put on the board at once, with no Claude run (Ames
// 2026-10-10: a suggestion is only made when asked for). Such a card is an
// ordinary row whose rationale starts with these words; Suggest a fix writes
// a note the bridge reads, and the suggestion then fills the same card in.
// Same words in scripts/slack-triage-bridge.mjs and triage-loop.mjs.
const NEW_REPORT_NOTE = 'No suggestion yet';
const SUGGEST_NOTE = 'Suggest:';
const isNewReport = (r: TriageRow) => r.status === 'proposed' && (r.rationale || '').startsWith(NEW_REPORT_NOTE);
// Asked in the last 45 minutes; after that the button comes back (the bridge
// stops trying then too), so a failed run can be asked again.
const suggestAsked = (r: TriageRow) => {
  if (!isNewReport(r) || !(r.approver_note || '').startsWith(SUGGEST_NOTE)) return false;
  const at = Date.parse(((r.approver_note || '').match(/\d{4}-\d\d-\d\dT[\d:.]+Z/) || [''])[0]);
  return Number.isNaN(at) || Date.now() - at < 45 * 60 * 1000;
};
/** A card that never had a suggestion (still new, or since handled by hand). */
const hadNoSuggestion = (r: TriageRow) => (r.rationale || '').startsWith(NEW_REPORT_NOTE);
async function askForSuggestion(row: TriageRow) {
  if (triageActing.value) return;
  triageActing.value = row.id;
  try {
    const who = backend.userName || backend.userEmail || 'admin';
    await secureWrite('triage.update', { id: row.id, fields: { approver_note: `${SUGGEST_NOTE} asked on the board by ${who} at ${new Date().toISOString()}` } });
    await loadTriage();
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageActing.value = null;
  }
}

const BY_HAND_NOTE = 'By hand';
const isByHand = (r: TriageRow) => r.status === 'approved' && !r.impl_state && (r.approver_note || '').startsWith(BY_HAND_NOTE);
/** A good idea that is not being done yet (Ames 2026-10-11: "add to future
 *  ideas"). Kept the same way as a card marked by hand, so the robot leaves
 *  it alone: approved, never queued, with a note that starts with this word.
 *  scripts/slack-triage-bridge.mjs looks for the same word. */
const LATER_NOTE = 'Later';
const isLater = (r: TriageRow) => r.status === 'approved' && !r.impl_state && (r.approver_note || '').startsWith(LATER_NOTE);
/** On the To do board (Ames 2026-10-19: "I want this to live in ToDo, not in
 *  the bug report world"). A report sent there gets a card on the admins'
 *  own To do board (TodoBoard.vue, functions/todos.js) and is kept like
 *  Later: approved, never queued, a note that starts with these words, which
 *  scripts/slack-triage-bridge.mjs looks for too. */
const TODO_NOTE = 'To do';
const isTodo = (r: TriageRow) => r.status === 'approved' && !r.impl_state && (r.approver_note || '').startsWith(TODO_NOTE);
async function markInProgress(row: TriageRow, later = false) {
  if (triageActing.value) return;
  triageActing.value = row.id;
  try {
    const who = backend.userName || backend.userEmail || 'admin';
    const comment = (triageNotes.value[row.id] ?? '').trim();
    await secureWrite('triage.update', { id: row.id, fields: {
      status: 'approved',
      // A build the robot had waiting is taken off its list.
      impl_state: null,
      approver_note: later
        ? `${LATER_NOTE}: a good idea kept for later, not being built now.${comment ? ' ' + comment : ''}`
        : `${BY_HAND_NOTE}: being fixed with Claude, not by the robot.${comment ? ' ' + comment : ''}`,
      reviewed_by: who,
      reviewed_at: new Date().toISOString(),
    } });
    if (later) { await loadTriage(); return; }
    triageOpen.value.progress = true;
    await loadTriage();
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageActing.value = null;
  }
}
/** A card on the To do board for this report, at the bottom of To do. The
 *  server also puts the report on To do here, so the robot never builds it,
 *  and the bridge tells its Slack thread. A comment typed on the card goes
 *  onto the new card's notes. */
async function sendToTodoBoard(row: TriageRow) {
  if (triageActing.value) return;
  triageActing.value = row.id;
  try {
    const n = triageNumbers.value[row.id];
    const first = (fullTextOf(row) || 'Report').replace(/\s+/g, ' ').trim();
    const title = `${n ? `#${n} ` : ''}${first.length > 120 ? first.slice(0, 117) + '...' : first}`;
    const notes = (triageNotes.value[row.id] ?? '').trim();
    await secureWrite('todo.save', { fields: { title, notes, triage_id: row.id } });
    delete triageNotes.value[row.id];
    await loadTriage();
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageActing.value = null;
  }
}

// The To do board, on this same page: "?triage=board&todo" opens it, and
// "&todo=<card id>" opens it on that card (the link a tag sends).
const todoParam = new URLSearchParams(window.location.search).get('todo');
const todoView = ref(todoParam !== null);
const todoFocus = /^[0-9a-f-]{36}$/i.test(todoParam || '') ? todoParam : null;
const todoBoardUrl = `${boardUrl}&todo`;
function openTodoBoard() {
  if (props.standalone || triageBoard.value) todoView.value = true;
  else window.open(todoBoardUrl, '_blank', 'noopener');
}

// ── Notes, with no decision (Celia #178: "a way to leave notes on entries in
// the triage panel without submitting any other actions") ──
// functions/triage-notes.js: nothing else on the card changes. "@Celia" tags
// her: the bell in Pyr and a ping in the report's Slack thread.
const noteDrafts = ref<Record<string, string>>({});
const noteOpen = ref<Record<string, boolean>>({});
const noteSaving = ref<string | null>(null);
async function saveNote(row: TriageRow) {
  const text = (noteDrafts.value[row.id] || '').trim();
  if (!text || noteSaving.value) return;
  noteSaving.value = row.id;
  try {
    const r = await secureWrite<any>('triage.note', { id: row.id, text });
    row.admin_notes = r?.admin_notes || [...(row.admin_notes || []), { by: backend.userName || 'you', text, at: new Date().toISOString() }];
    noteDrafts.value[row.id] = '';
    noteOpen.value[row.id] = false;
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    noteSaving.value = null;
  }
}

async function loadTriage() {
  triageLoading.value = true;
  triageError.value = '';
  try {
    const { supabase } = await import('../supabase');
    let q = supabase.from('feedback_triage').select('*').order('created_at', { ascending: false }).limit(100);
    // Default view: everything still open (awaiting a decision, or approved
    // and not yet live) plus anything finished in the last 5 days, so recent
    // updates stay visible and then clear themselves. Open items never age
    // out. "Show older" shows every row.
    if (!triageShowReviewed.value) {
      const since = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
      q = q.or(`status.in.(proposed,approved),reviewed_at.gte.${since},tested_at.gte.${since}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    // A card with an unread reply is on the board however long ago it was closed.
    const rows = (data ?? []) as TriageRow[];
    if (!triageShowReviewed.value) {
      const { data: replied } = await supabase.from('feedback_triage').select('*')
        .contains('feedback_log', JSON.stringify([{ role: 'reporter_reply', seen: false }])).limit(50);
      for (const r of (replied ?? []) as TriageRow[]) if (hasNewReply(r) && !rows.some(x => x.id === r.id)) rows.push(r);
    }
    // Discarded reports are off the board unless you ask for older ones.
    triageRows.value = rows.filter(r => triageShowReviewed.value || !isDiscarded(r) || hasNewReply(r));
    void loadReporters(triageRows.value);
    void loadTriageNumbers();
    applyTriageFocus();
    keepSelectedInView();
    for (const r of triageRows.value) {
      if (triageEdits.value[r.id] === undefined) {
        triageEdits.value[r.id] = r.proposed_message ?? '';
      }
    }
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageLoading.value = false;
  }
}

// immediate: the triage deep-link mounts the hub already ON the triage tab,
// so a change-only watch would never fire the initial load.
watch(adminSubTab, t => { if (t === 'triage') loadTriage(); }, { immediate: true });
watch(triageShowReviewed, () => loadTriage());

/** Discarded: dismissed, and off the board for good (junk, a duplicate, a
 *  test). It stays in the table and shows again under "Show older". */
const DISCARD_NOTE = 'Discarded';
const isDiscarded = (r: TriageRow) => r.status === 'dismissed' && (r.result_note || '').startsWith(DISCARD_NOTE);
/** Too late to stop from here: it is on, or on its way to, the live site. */
const isGoingLive = (r: TriageRow) => ['deploying', 'live_test_queued', 'live_testing', 'revert_queued', 'reverting'].includes(r.impl_state || '');

async function setTriageStatus(row: TriageRow, status: 'approved' | 'dismissed' | 'done', discard = false, builtElsewhere = false, presetNote?: string | null) {
  if (triageActing.value) return;
  // Already closed, and only back under Needs your decision for a reply: Done
  // means "read it". No second Slack update, no new note.
  if (hasNewReply(row) && status === row.status && !discard) return markRepliesSeen(row);
  if (discard && !window.confirm('Discard this report? It is dismissed and taken off the board. Any build in progress is stopped. You can still find it with "Show older".')) return;
  // Shipping a change closes the loop in Slack: the bridge posts a change
  // update into the original thread and tags the approvers, carrying this
  // note. Blank is fine, the update just goes noteless.
  let resultNote: string | null = null;
  if (status === 'done' && presetNote !== undefined) {
    // "Send and mark done": what was just told to the submitter is the note.
    resultNote = presetNote;
  } else if (status === 'done') {
    const typed = window.prompt('One line for the Slack update (what was fixed?). Leave it blank to skip the note; Cancel leaves the card where it is.', '');
    if (typed === null) return;
    resultNote = typed.trim() || null;
  }
  triageActing.value = row.id;
  try {
    const { supabase } = await import('../supabase');

    // Approving a message proposal sends the (possibly edited) message to the
    // reporter as a notification, when we know who reported it.
    if (status === 'approved' && row.recommendation === 'message') {
      const text = (triageEdits.value[row.id] ?? row.proposed_message ?? '').trim();
      if (text) {
        let targetUserId: string | null = null;
        if (row.source === 'site_issue') {
          const { data } = await supabase.from('site_issues').select('user_id').eq('id', row.source_id).single();
          targetUserId = data?.user_id ?? null;
        }
        // The reply arrives "from Nurro": guide avatar icon + a random real
        // neuron render as the card image (admin-uploads/nurro-neurons).
        const storageBase = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads';
        await secureWrite('notification.insert', { row: {
          title: '💬 Nurro replied to your feedback',
          body: text,
          thumbnail_url: `${storageBase}/nurro/guide-avatar.png`,
          image_url: `${storageBase}/nurro-neurons/neuron-${1 + Math.floor(Math.random() * 24)}.jpg`,
          target_type: targetUserId ? 'user' : 'all',
          target_id: targetUserId,
          send_at: new Date().toISOString(),
        } });
      }
    }

    const note = (triageNotes.value[row.id] ?? '').trim();
    const update: Record<string, any> = {
      status,
      proposed_message: (triageEdits.value[row.id] ?? row.proposed_message) || null,
      ...(status !== 'done' && note ? { approver_note: note } : {}),
      // Approving a spec hands it straight to Claude; the bridge echoes the
      // decision into the Slack thread and tags you as the tester.
      ...(status === 'approved' && isBuildable(row) ? { impl_state: 'queued' } : {}),
      ...(status === 'done' ? { result_note: resultNote } : {}),
      ...(builtElsewhere ? { result_note: `Built independently, so the robot's work on it was dismissed by ${backend.userName || backend.userEmail || 'an admin'}.` } : {}),
      ...(discard ? { result_note: `${DISCARD_NOTE} in the Admin Hub by ${backend.userName || backend.userEmail || 'an admin'}.` } : {}),
      reviewed_by: backend.userName || backend.userEmail || 'admin',
      reviewed_at: new Date().toISOString(),
    };
    // Closing a card is reading its reply. Without this, Done on a card that
    // was already done changed nothing and the New reply kept it under Needs
    // your decision (Ames 2026-10-14).
    if (hasNewReply(row) && status !== 'approved') update.feedback_log = await logWithRepliesSeen(row);
    let noteLost = false;
    try {
      await secureWrite('triage.update', { id: row.id, fields: update });
    } catch (err: any) {
      // Until the approver_note migration runs, the column is missing
      // (PostgREST PGRST204). Never let that block the decision: save without.
      if (!('approver_note' in update) || !/PGRST204|approver_note/.test(err?.message || '')) throw err;
      delete update.approver_note;
      noteLost = true;
      await secureWrite('triage.update', { id: row.id, fields: update });
    }
    delete triageNotes.value[row.id];
    if (status === 'done') cheerFor(row);
    await loadTriage();
    if (noteLost) {
      triageError.value = `Saved as ${status}, but your comment was not stored: the approver_note column does not exist yet. Run supabase-triage-approver-note.sql in the Supabase SQL editor. Your comment was: "${note}"`;
    }
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageActing.value = null;
  }
}

/** "Work on it with Claude": a self-contained briefing for any report,
 *  copied to the clipboard and opened as a new claude.ai chat. Paste the same
 *  text into a Claude Code session to have it change the code. */
const claudeCopied = ref<string | null>(null);
function claudeBriefing(row: TriageRow): string {
  const log = (row.feedback_log || []).map(f => `- [${f.role}] ${f.text}`).join('\n');
  return [
    'You are helping with the EyeWire II community app (seung-lab/ng-extend, branch eyewire-ii-community;',
    'a Vue 3 + Pinia extension of neuroglancer). Work on this user report.',
    '',
    `Report${triageNumbers.value[row.id] ? ' #' + triageNumbers.value[row.id] : ''} (${row.source.replace('_', ' ')}, ${row.created_at.slice(0, 10)}): "${fullTextOf(row)}"`,
    `Triage proposal: ${TRIAGE_LABELS[row.recommendation]}. Status: ${row.status}${row.impl_state ? `, robot state: ${row.impl_state}` : ''}.`,
    row.rationale ? `Rationale: ${row.rationale}` : '',
    row.spec ? `Spec:\n${row.spec}` : '',
    row.approver_note ? `Approver's note (overrides the spec): ${row.approver_note}` : '',
    row.impl_summary ? `What the triage robot already built: ${row.impl_summary}` : '',
    row.impl_branch ? `Its branch: https://github.com/seung-lab/ng-extend/tree/${row.impl_branch}` : '',
    row.preview_url ? `Its preview site: ${row.preview_url}` : '',
    log ? `Replies in the Slack thread:\n${log}` : '',
    slackThreadUrl(row) ? `Slack thread: ${slackThreadUrl(row)}` : '',
    '',
    'Before changing code, read docs/TRIAGE-KNOWLEDGE.md and docs/TRIAGE-LOOP.md in the repo. Confirm the cause in the',
    'code first. Check the build with node scripts/build-prod.js. Copy has no em or en dashes. Push work branches to the',
    'amy fork; do not push eyewire-ii-community (that deploys the live site) without asking Amy.',
  ].filter(Boolean).join('\n');
}
async function openInClaude(row: TriageRow) {
  const text = claudeBriefing(row);
  try { await navigator.clipboard.writeText(text); claudeCopied.value = row.id; } catch { claudeCopied.value = null; }
  setTimeout(() => { if (claudeCopied.value === row.id) claudeCopied.value = null; }, 4000);
  window.open(`https://claude.ai/new?q=${encodeURIComponent(text.slice(0, 6000))}`, '_blank', 'noopener');
}

/** Loop actions from this tab. Each only flips impl_state; the bridge (every
 *  10 min) does the work and posts in the Slack thread, so both stay in step. */
// ── Optional update to the submitter ─────────────────────────────────────
// Amy 2026-09-25: an optional, editable note to the person who filed the
// report, about its outcome. Mirrors draftReporterUpdate / reporterUpdates in
// scripts/slack-triage-bridge.mjs; sends are logged in feedback_log (role
// 'reporter_update') and the bridge echoes Admin Hub sends into Slack.
/** Open composers, keyed by row id (absent = closed). */
const reporterDrafts = ref<Record<string, string>>({});
const reporterSending = ref<string | null>(null);
/** "Ask for a reply" ticked in an open composer, keyed by row id (Ames
 *  2026-10-13). Off unless ticked: an ordinary update is exactly as before. */
const reporterAsk = ref<Record<string, boolean>>({});
/** The open boxes themselves, so the format buttons act on the right one. */
const reporterEls: Record<string, HTMLTextAreaElement | null> = {};
function reporterComposer(row: TriageRow): Composer {
  return {
    get el() { return reporterEls[row.id] ?? null; },
    get: () => reporterDrafts.value[row.id] || '',
    set: v => { reporterDrafts.value[row.id] = v; },
  };
}

/** Draft from the card's state. Never includes the internal reviewer comment.
 *  The quote is the whole submission, as the card shows it (the report's full
 *  message once loaded, else the stored excerpt), never cut short: Ames was
 *  pasting the rest in by hand every time (2026-10-12). */
// Just the report's title (Ames 2026-10-25: "make the default text ...
// 'you reported: <TITLE>' and that is all"); the rest is hers to write.
function draftReporterUpdate(row: TriageRow): string {
  const title = String(reporterOf(row)?.title || '').replace(/\*\*/g, '').trim()
    || fullTextOf(row).split('\n')[0].replace(/\*\*/g, '').trim().slice(0, 140);
  return title ? `You reported: "${title}"\n\n` : '';
}

function closeReporterDraft(row: TriageRow) {
  delete reporterDrafts.value[row.id];
  delete reporterAsk.value[row.id];
  dropReplyImage(row);
}

// ── An image in a reply to the submitter (Ames 2026-10-20: "add a screenshot
// or upload an image in a reply? And delete them after 7 days") ──
// One per reply. It is uploaded as soon as it is added, to the reply-images
// folder (functions/upload-policy.js), shown on the player's reply card in
// place of the Nurro picture, and deleted after 7 days by
// scripts/cleanup-screenshots.mjs, which also clears the links to it.
const replyImages = ref<Record<string, { preview: string; url?: string; uploading: boolean; error?: string }>>({});
const replyFileEls: Record<string, HTMLInputElement | null> = {};
async function attachReplyImage(row: TriageRow, file: File | null | undefined) {
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { replyImages.value[row.id] = { preview: '', uploading: false, error: 'Use a PNG, JPEG, GIF or WebP image.' }; return; }
  dropReplyImage(row);
  const preview = URL.createObjectURL(file);
  replyImages.value[row.id] = { preview, uploading: true };
  try {
    const { secureUpload } = await import('../secure_upload');
    const url = await secureUpload(file, 'reply');
    if (replyImages.value[row.id]?.preview === preview) replyImages.value[row.id] = { preview, url, uploading: false };
  } catch (e: any) {
    if (replyImages.value[row.id]?.preview === preview) replyImages.value[row.id] = { preview, uploading: false, error: e?.message || 'The image did not upload.' };
  }
}
const setReplyFileEl = (row: TriageRow, el: unknown) => { replyFileEls[row.id] = el as HTMLInputElement | null; };
function onReplyFile(e: Event, row: TriageRow) {
  const input = e.target as HTMLInputElement;
  void attachReplyImage(row, input.files?.[0]);
  input.value = '';
}
function dropReplyImage(row: TriageRow) {
  const img = replyImages.value[row.id];
  if (img?.preview) URL.revokeObjectURL(img.preview);
  delete replyImages.value[row.id];
}
/** A pasted screenshot becomes the reply's image; text pastes as before. */
function onReplyPaste(e: ClipboardEvent, row: TriageRow) {
  const file = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
  if (file) { e.preventDefault(); void attachReplyImage(row, file); return; }
  onNotifPaste(e, reporterComposer(row));
}
function onReplyDrop(e: DragEvent, row: TriageRow) {
  const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
  if (file) void attachReplyImage(row, file);
}

/** Console messages that came with a reply. Kept where only the server can
 *  read them; fetched for an admin when asked for (functions/report-reply.js). */
const replyConsole = ref<Record<string, string | null>>({});
const replyConsoleOpen = ref<Record<string, boolean>>({});
async function toggleReplyConsole(notificationId: number | string | undefined) {
  const key = String(notificationId ?? '');
  if (!key) return;
  replyConsoleOpen.value = { ...replyConsoleOpen.value, [key]: !replyConsoleOpen.value[key] };
  if (!replyConsoleOpen.value[key] || replyConsole.value[key] !== undefined) return;
  try {
    const out: any = await secureWrite('reply.console', { notificationId: Number(key) });
    replyConsole.value = { ...replyConsole.value, [key]: out?.console_log ?? null };
  } catch (e: any) {
    replyConsole.value = { ...replyConsole.value, [key]: `Could not load them: ${e?.message ?? 'try again'}` };
  }
}

/** What was sent to the submitter and what they wrote back, oldest first. */
function reporterThreadFor(row: TriageRow) {
  const log = row.feedback_log || [];
  const when = (e: { at?: string; ts: string }) => Date.parse(e.at || e.ts) || 0;
  return log
    .filter(e => (e.role === 'reporter_update' && e.sent !== false) || e.role === 'reporter_reply')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (when(a.e) - when(b.e)) || (a.i - b.i))
    .map(({ e }) => ({
      ...e,
      reply: e.role === 'reporter_reply',
      // Asked, and their reply is not in yet.
      waiting: e.role === 'reporter_update' && !!e.ask && !log.some(x => x.role === 'reporter_reply' && x.notification_id === e.notification_id),
    }));
}

// Saves waiting for CAVE, for the Cell types tab (functions/cave-outbox.js).
const outboxSummary = ref<null | { installed?: boolean; error?: string; waiting?: number; players?: number; oldest?: string; byKind?: Record<string, number> }>(null);
async function loadOutboxSummary() {
  outboxSummary.value = null;
  try { outboxSummary.value = await secureWrite('outbox.summary', {}); }
  catch (e: any) { outboxSummary.value = { error: e?.message || String(e) }; }
}
watch(adminSubTab, tab => { if (tab === 'celltypes') void loadOutboxSummary(); }, { immediate: true });

/** The card's log with every unread reply marked read. Re-read right before
 *  writing, so a bridge write in between is kept. */
async function logWithRepliesSeen(row: TriageRow): Promise<any[]> {
  const { supabase } = await import('../supabase');
  const { data: fresh } = await supabase.from('feedback_triage').select('feedback_log').eq('id', row.id).single();
  return (Array.isArray(fresh?.feedback_log) ? fresh!.feedback_log : (row.feedback_log || []))
    .map((e: any) => (e.role === 'reporter_reply' && e.seen === false ? { ...e, seen: true } : e));
}

/** Which reply forms show the "What they will see" preview: none until asked. */
const replyPreviewOpen = ref<Record<string, boolean>>({});

/** Undo a dismiss (Ames 2026-10-15: "can I undismiss?"). The report goes
 *  back to Needs your decision; its log, messages and replies are kept. */
async function undismiss(row: TriageRow) {
  if (triageActing.value) return;
  triageActing.value = row.id;
  triageError.value = '';
  try {
    await secureWrite('triage.update', { id: row.id, fields: { status: 'proposed', result_note: null,
      reviewed_by: backend.userName || backend.userEmail || 'admin', reviewed_at: new Date().toISOString() } });
    await loadTriage();
  } catch (e: any) {
    triageError.value = `Could not bring it back: ${e?.message ?? String(e)}`;
  } finally {
    triageActing.value = null;
  }
}

/** "Reply read": the New reply marker comes off and the card goes back to
 *  where it was. Nothing else about the card changes. */
async function markRepliesSeen(row: TriageRow) {
  if (triageActing.value) return;
  triageActing.value = row.id;
  triageError.value = '';
  try {
    await secureWrite('triage.update', { id: row.id, fields: { feedback_log: await logWithRepliesSeen(row) } });
    await loadTriage();
  } catch (e: any) {
    triageError.value = `Could not mark the reply read: ${e?.message ?? String(e)}`;
  } finally {
    triageActing.value = null;
  }
}

/** Text in pieces, with every http(s) address as a link (Ames 2026-10-15:
 *  "can you make links clickable"). Drawn with v-for, never v-html, so what a
 *  reporter wrote can never become markup. A full stop or bracket that ends a
 *  sentence is left out of the link. */
type TextPart = { t: string; href?: string };
function linkParts(text: string | null | undefined): TextPart[] {
  const s = String(text ?? '');
  const out: TextPart[] = [];
  let at = 0;
  for (const m of s.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    let url = m[0];
    while (/[.,;:!?)\]]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1);
    const i = m.index ?? 0;
    if (i > at) out.push({ t: s.slice(at, i) });
    out.push({ t: url, href: url });
    at = i + url.length;
  }
  if (at < s.length) out.push({ t: s.slice(at) });
  return out;
}

function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

/** andDone: once the update has gone to the submitter, close the report too,
 *  with that same text as its note, so there is no second question to answer
 *  (Ames 2026-10-10: "let's add a send and mark done"). If the update could
 *  not be sent, the report is left where it is. */
// ── Duplicates ──
const DUP_MARK = /^Same as #(\d+) ([0-9a-f-]{36})/;
/** The report this one is a duplicate of, if it is one. */
const dupOf = (r: TriageRow): string | null => String(r.approver_note || '').match(DUP_MARK)?.[2] || null;
/** The duplicates closed into this report. */
const dupsOf = (r: TriageRow) => triageRows.value.filter(x => dupOf(x) === r.id);
const dupNotice = ref('');
watch(dupNotice, v => { if (v) setTimeout(() => { if (dupNotice.value === v) dupNotice.value = ''; }, 6000); });
const dupDraft = ref<Record<string, string>>({});
async function markDuplicate(row: TriageRow) {
  const n = Number(String(dupDraft.value[row.id] || '').replace(/[^0-9]/g, ''));
  const mainId = Object.entries(triageNumbers.value).find(([, num]) => num === n)?.[0];
  if (!n || !mainId) { triageError.value = `There is no report #${dupDraft.value[row.id] || ''} on the board.`; return; }
  if (mainId === row.id) { triageError.value = 'A report cannot be the same as itself.'; return; }
  if (triageActing.value) return;
  triageActing.value = row.id;
  triageError.value = '';
  try {
    const by = backend.userName || backend.userEmail || 'admin';
    await secureWrite('triage.update', { id: row.id, fields: {
      status: 'dismissed',
      approver_note: `Same as #${n} ${mainId}: grouped by ${by}. Its reporter hears when #${n} is updated.`,
      reviewed_by: by, reviewed_at: new Date().toISOString(),
      ...(hasNewReply(row) ? { feedback_log: await logWithRepliesSeen(row) } : {}),
    } });
    delete dupDraft.value[row.id];
    await loadTriage();
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageActing.value = null;
  }
}
/** Tell the reporters of this card's duplicates too: a plain note, no reply box. */
async function notifyDuplicates(row: TriageRow, text: string, art: Record<string, string>) {
  const dups = dupsOf(row).filter(d => d.source === 'site_issue' && d.source_id);
  if (!dups.length) return 0;
  const { supabase } = await import('../supabase');
  const { data } = await supabase.from('site_issues').select('id,user_id').in('id', dups.map(d => d.source_id));
  const main = reporterOf(row)?.title || '';
  let told = 0;
  const seen = new Set<string>();
  for (const issue of data || []) {
    if (!issue.user_id || seen.has(issue.user_id)) continue;
    seen.add(issue.user_id);
    try {
      await secureWrite('notification.insert', { row: {
        title: '💬 An update on your report',
        body: `${text}${main ? `\n\n(Others reported this too, as "${main}".)` : ''}`,
        ...art, target_type: 'user', target_id: issue.user_id, send_at: new Date().toISOString(),
      } });
      told++;
    } catch { /* one missed note does not stop the rest */ }
  }
  return told;
}

async function sendReporterUpdate(row: TriageRow, andDone = false, andProgress = false, andLater = false) {
  const text = (reporterDrafts.value[row.id] || '').trim();
  if (!text || reporterSending.value) return;
  const image = replyImages.value[row.id];
  if (image?.uploading) { triageError.value = 'The image is still uploading. Send again in a moment.'; return; }
  if (image?.error) { triageError.value = `${image.error} Remove the image or add another.`; return; }
  const imageUrl = image?.url || null;
  let sent = false;
  reporterSending.value = row.id;
  triageError.value = '';
  try {
    const { supabase } = await import('../supabase');
    const { data: issue } = await supabase.from('site_issues').select('user_id').eq('id', row.source_id).single();
    const userId = issue?.user_id ?? null;
    // Only ever targeted: an anonymous report gets nothing, never a broadcast.
    if (!userId) {
      triageError.value = 'This report has no signed-in submitter, so there is nobody to notify. Nothing was sent.';
      return;
    }
    const storageBase = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads';
    const art = {
      thumbnail_url: `${storageBase}/nurro/guide-avatar.png`,
      image_url: imageUrl || `${storageBase}/nurro-neurons/neuron-${1 + Math.floor(Math.random() * 24)}.jpg`,
    };
    // "Ask for a reply": the same note, sent by the server tied to this card,
    // so the submitter (and only them) gets a reply box under it. If that is
    // not switched on yet it refuses and says why, and nothing is sent. Its
    // picture is the server's: science Nurro (functions/report-reply.js).
    const ask = !!reporterAsk.value[row.id];
    let asked: { id?: number } | null = null;
    if (ask) asked = await secureWrite('reply.ask', { triageId: row.id, text, ...(imageUrl ? { imageUrl } : {}) });
    else await secureWrite('notification.insert', { row: {
      title: '💬 An update on your report',
      body: text,
      ...art,
      target_type: 'user',
      target_id: userId,
      send_at: new Date().toISOString(),
    } });
    // Everyone who reported the same thing hears too (never asked to reply).
    const toldDups = await notifyDuplicates(row, text, art).catch(() => 0);
    if (toldDups) dupNotice.value = `Also sent to ${toldDups} other ${toldDups === 1 ? 'person' : 'people'} who reported the same thing.`;
    // Re-read the log right before appending, so a bridge write in between
    // is not overwritten.
    const { data: fresh } = await supabase.from('feedback_triage').select('feedback_log').eq('id', row.id).single();
    // Writing back means their replies so far have been read.
    const log = (Array.isArray(fresh?.feedback_log) ? [...fresh!.feedback_log] : [])
      .map((e: any) => (e.role === 'reporter_reply' && e.seen === false ? { ...e, seen: true } : e));
    const at = new Date().toISOString();
    log.push({ role: 'reporter_update', via: 'admin', by: backend.userName || backend.userEmail || 'admin', text, ts: at, at, sent: true, echoed: false,
      ...(ask ? { ask: true, notification_id: asked?.id } : {}), ...(imageUrl ? { image_url: imageUrl } : {}) });
    await secureWrite('triage.update', { id: row.id, fields: { feedback_log: log } })
      .catch((lErr: any) => console.warn('[triage] reporter update sent but not logged:', lErr?.message));
    delete reporterDrafts.value[row.id];
    delete reporterAsk.value[row.id];
    dropReplyImage(row);
    sent = true;
    if (!andDone && !andProgress && !andLater) await loadTriage();
  } catch (e: any) {
    triageError.value = `Could not send the update: ${e?.message ?? String(e)}`;
  } finally {
    reporterSending.value = null;
  }
  if (sent && andDone) await setTriageStatus(row, 'done', false, false, text.replace(/\s+/g, ' ').slice(0, 300));
  // The submitter has been told it is being looked into: move it to In progress, by hand (Ames 2026-10-11).
  if (sent && andProgress) await markInProgress(row);
  if (sent && andLater) await markInProgress(row, true);
}

/** Build ID of the preview waiting to go live: the tested preview, or one
 *  whose deploy failed. Empty while nothing is ready to release. */
function releaseBuildOf(row: TriageRow): string {
  if (row.impl_state !== 'testing' && row.impl_state !== 'failed') return '';
  const preview = [...(row.feedback_log || [])].reverse().find((e: any) => e.role === 'preview');
  const sha = String((preview as any)?.sha || '');
  return /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 12) : '';
}
const copied = ref('');
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = text; setTimeout(() => { if (copied.value === text) copied.value = ''; }, 1500); }
  catch { window.prompt('Copy this:', text); }
}

/** Deploy from the card: the server checks you are an admin and signs an
 *  approval for this exact build, which the deploy workflow verifies. */
async function releaseFromHub(row: TriageRow, mode: 'final' | 'live_test') {
  if (triageActing.value) return;
  const build = releaseBuildOf(row);
  const ask = mode === 'final'
    ? `Put build ${build} on the live site for everyone?`
    : `Put build ${build} on the live site as a test? You then keep it or revert it in the Slack thread.`;
  if (!build || !window.confirm(ask)) return;
  triageActing.value = row.id;
  triageError.value = '';
  try {
    await secureWrite('triage.release', { id: row.id, shortSha: build, mode });
    await loadTriage();
  } catch (e: any) {
    triageError.value = `Could not start the deploy: ${e?.message ?? String(e)}`;
  } finally {
    triageActing.value = null;
  }
}

async function setImplState(row: TriageRow, next: ImplState) {
  if (triageActing.value) return;
  triageActing.value = row.id;
  try {
    const who = backend.userName || backend.userEmail || 'admin';
    await secureWrite('triage.update', { id: row.id, fields: {
      impl_state: next,
      ...(next === 'deploy_queued' ? { tested_by: who, tested_at: new Date().toISOString() } : {}),
    } });
    await loadTriage();
  } catch (e: any) {
    triageError.value = e?.message ?? String(e);
  } finally {
    triageActing.value = null;
  }
}

// ── Notification form state ──
const notifTitle = ref('');
const notifBody = ref('');
// ── Formatting (Ames 2026-10-01) ──────────────────────────────────────────
// The body is Markdown, which the notification feed already renders. The
// composer makes that usable: pasted formatted text keeps its bold, headings,
// lists and links; a few buttons wrap the selection; a preview shows the
// result as players will see it.
const notifBodyEl = ref<HTMLTextAreaElement | null>(null);
// Video links play in the preview as they will in the bell (util/video_embeds.ts).
const notifPreview = computed(() => withVideoEmbeds(renderSafeMarkdown(notifBody.value, true)));
/** A text box the format buttons act on: the Notifications body, or a
 *  card's "Update submitter" box (Ames 2026-10-16: her numbered list to
 *  Nseraf lost its numbers, so that box got the same buttons and preview). */
type Composer = { el: HTMLTextAreaElement | null; get: () => string; set: (v: string) => void };
const notifComposer: Composer = {
  get el() { return notifBodyEl.value; },
  get: () => notifBody.value,
  set: v => { notifBody.value = v; },
};
function replaceSelection(text: string, selectFrom?: number, selectTo?: number, c: Composer = notifComposer) {
  const el = c.el;
  if (!el) { c.set(c.get() + text); return; }
  const a = el.selectionStart, b = el.selectionEnd;
  c.set(el.value.slice(0, a) + text + el.value.slice(b));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + (selectFrom ?? text.length), a + (selectTo ?? text.length));
  });
}
function onNotifPaste(e: ClipboardEvent, c: Composer = notifComposer) {
  const html = e.clipboardData?.getData('text/html') || '';
  if (!html || !htmlHasFormatting(html)) return;   // plain paste as usual
  const md = htmlToMarkdown(html);
  if (!md) return;
  e.preventDefault();
  replaceSelection(md, undefined, undefined, c);
}
/** Wrap the selection in a marker (bold, italic), or drop in a placeholder. */
function fmtWrap(mark: string, placeholder: string, c: Composer = notifComposer) {
  const el = c.el;
  const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  const inner = sel || placeholder;
  replaceSelection(`${mark}${inner}${mark}`, mark.length, mark.length + inner.length, c);
}
/** Start each selected line with a prefix (heading, bullet, or "1. ", "2. "
 *  counted down the selection). A marker already there is swapped, not
 *  doubled, so a bulleted list can be turned into a numbered one. */
function fmtLines(prefix: string | ((i: number) => string), placeholder: string, c: Composer = notifComposer) {
  const el = c.el;
  if (!el) return;
  const v = el.value;
  const a = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
  let b = v.indexOf('\n', el.selectionEnd);
  if (b < 0) b = v.length;
  const pre = typeof prefix === 'string' ? () => prefix : prefix;
  let n = 0;
  const lines = (v.slice(a, b) || placeholder).split('\n')
    // A blank line stays blank and does not take a number.
    .map(l => (l.trim() ? pre(n++) + l.replace(/^\s*(#{1,4}\s+|[-*\u2022\u00b7]\s+|\d{1,3}[.)]\s+)/, '') : l));
  el.setSelectionRange(a, b);
  replaceSelection(lines.join('\n'), undefined, undefined, c);
}
function fmtLink(c: Composer = notifComposer) {
  const el = c.el;
  const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  const text = sel || 'link text';
  replaceSelection(`[${text}](https://)`, text.length + 3, text.length + 11, c);
}
const notifTargetType = ref<'all' | 'group' | 'user'>('all');
const notifTargetId = ref('');

// ── Specific User: find a player by name or username, not by id (Ames) ────
// notifTargetId still holds the user id; this is only how it gets chosen.
interface PickedUser { id: string; display_name: string | null; username: string | null }
const userQuery = ref('');
const userMatches = ref<PickedUser[]>([]);
const userPicked = ref<PickedUser | null>(null);
const userSearching = ref(false);
let userSearchTimer: ReturnType<typeof setTimeout> | null = null;
const userLabel = (u: PickedUser) => [u.display_name || 'Unnamed player', u.username ? `@${u.username}` : ''].filter(Boolean).join('  ');
function onUserQuery() {
  if (userSearchTimer) clearTimeout(userSearchTimer);
  // PostgREST filter syntax characters would break the query; names never need them.
  const q = userQuery.value.trim().replace(/[,()*%\\]/g, ' ').trim();
  if (q.length < 2) { userMatches.value = []; return; }
  userSearchTimer = setTimeout(async () => {
    userSearching.value = true;
    try {
      const { supabase } = await import('../supabase');
      const { data } = await supabase.from('users').select('id,display_name,username')
        .or(`display_name.ilike.*${q}*,username.ilike.*${q}*`).order('display_name').limit(8);
      userMatches.value = (data ?? []) as PickedUser[];
    } catch { userMatches.value = []; } finally { userSearching.value = false; }
  }, 220);
}
function pickUser(u: PickedUser) {
  userPicked.value = u;
  notifTargetId.value = u.id;
  userQuery.value = '';
  userMatches.value = [];
}
function clearPickedUser() { userPicked.value = null; notifTargetId.value = ''; }
// A draft or an edited notification restores only the id: look its name up.
watch(notifTargetId, async id => {
  if (!id) { userPicked.value = null; return; }
  if (userPicked.value?.id === id || notifTargetType.value !== 'user') return;
  try {
    const { supabase } = await import('../supabase');
    const { data } = await supabase.from('users').select('id,display_name,username').eq('id', id).limit(1);
    userPicked.value = ((data ?? [])[0] as PickedUser) || { id, display_name: null, username: null };
  } catch { userPicked.value = { id, display_name: null, username: null }; }
});
const notifPostToChat = ref(false);

/**
 * True when a future "Send at" was picked, i.e. this is a scheduled send that
 * the cron posts at send time rather than posting to chat now. Matches the
 * store guard in createNotification: any future pick counts (only a small
 * jitter skew), so scheduling for the next minute is treated as scheduled, not
 * as "send now".
 */
const isScheduledForLater = computed(() => {
  if (!notifSendAt.value) return false;
  const ms = new Date(etNaiveToUtcIso(notifSendAt.value)).getTime();
  return Number.isFinite(ms) && ms > Date.now() + 2_000;
});
const notifSendAt = ref('');
const notifExpiresAt = ref('');
const notifImageFile = ref<File | null>(null);
const notifIconFile = ref<File | null>(null);
const notifSending = ref(false);
// What the send is doing right now (Ames 2026-10-06: "add a loading indicator
// to sending"). The steps are the real ones, in order, fixed when Send is
// pressed: an image or icon is only listed if one was chosen.
type NotifStep = 'image' | 'icon' | 'save' | 'list';
const notifSteps = ref<{ key: NotifStep; label: string }[]>([]);
const notifSendStage = ref<NotifStep>('save');
const notifStepsDone = computed(() => Math.max(0, notifSteps.value.findIndex(x => x.key === notifSendStage.value)));
const notifSeed = ref(1);
function notifStepState(key: NotifStep): 'done' | 'now' | 'todo' {
  const order = notifSteps.value.map(x => x.key);
  const i = order.indexOf(key), now = order.indexOf(notifSendStage.value);
  return i < now ? 'done' : i === now ? 'now' : 'todo';
}
const notifSent = ref(false);
const notifError = ref('');
/** Post-send confirmation describing exactly what happened. */
const notifConfirm = ref('');
/** Pending delete awaiting confirmation, and the post-delete acknowledgement. */
const pendingDelete = ref<any | null>(null);
const deleteDone = ref('');

/** Id of the notification currently being edited (null = composing a new one). */
const editingId = ref<number | null>(null);

/**
 * Notifications split by lifecycle stage.
 *
 * Derived from the single paginated admin list rather than three queries.
 * Ordering is send_at DESC, so future-dated rows sort to the top and the
 * scheduled queue is always on the first page.
 */
function notifStage(n: any): 'scheduled' | 'active' | 'expired' {
  const now = Date.now();
  if (n.expires_at && new Date(n.expires_at).getTime() <= now) return 'expired';
  // Any future send time counts as scheduled (only a small jitter skew), so the
  // bucket matches the send/post-to-chat guard: a notification queued for even a
  // minute out is "Scheduled", not "Active".
  if (n.send_at && new Date(n.send_at).getTime() > now + 2_000) return 'scheduled';
  return 'active';
}
/**
 * Categorize a notification so the list can be filtered. Most of the admin list
 * is auto-generated noise (per-user badge awards, weekly recaps, help replies)
 * that an admin rarely wants to manage; only broadcasts and weekly champions are
 * on by default.
 */
function notifCategory(n: any): string {
  const t = n.title || '';
  if (t.includes('Weekly Champions') || t.includes('Monthly Champions') || t.includes('Year Champions')) return 'weeklyChampions';
  if (t.includes('Week in Science') || t.includes('Month in Science') || t.includes('Year in Science')) return 'weeklyRecap';
  if (t.includes('Response to your help request')) return 'helpResponse';
  if (t === '✨ New Achievement!' || t === 'New Achievement!') return 'customBadge';         // admin-awarded special badge
  if (t.includes('New Achievement')) return 'personalBadge';     // tutorial / building / exploration
  return 'announcement';
}

const NOTIF_CATEGORIES: { key: string; label: string }[] = [
  { key: 'announcement',    label: 'Announcements' },
  { key: 'weeklyChampions', label: 'Weekly, monthly and yearly champions' },
  { key: 'customBadge',     label: 'Custom badges' },
  { key: 'personalBadge',   label: 'Personal badges' },
  { key: 'weeklyRecap',     label: 'Weekly, monthly and yearly recaps' },
  { key: 'helpResponse',    label: 'Help replies' },
];
const NOTIF_FILTER_KEY = 'nge-admin-notif-filters-v1';
// Default ON: the admin's own broadcasts + the global weekly champions post.
const DEFAULT_VISIBLE = ['announcement', 'weeklyChampions'];
const visibleCategories = ref<Set<string>>(new Set(loadNotifFilters()));
function loadNotifFilters(): string[] {
  try {
    const raw = localStorage.getItem(NOTIF_FILTER_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through */ }
  return DEFAULT_VISIBLE;
}
function toggleNotifCategory(key: string) {
  const s = new Set(visibleCategories.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  visibleCategories.value = s;
  try { localStorage.setItem(NOTIF_FILTER_KEY, JSON.stringify([...s])); } catch { /* non-critical */ }
}
function isCategoryVisible(n: any): boolean {
  return visibleCategories.value.has(notifCategory(n));
}
function categoryCount(key: string): number {
  return backend.adminNotifications.filter((n: any) => notifCategory(n) === key).length;
}

/** The automatic "Was your help request answered?" a day after a reply
 *  (functions/help-reminder.js): Ames trusts them and does not need them in
 *  Scheduled (2026-10-24). They still send, and show once sent. */
const isHelpReminder = (n: any) => n?.target_type === 'user' && String(n?.body ?? '').includes('#nge-help-solved=');
const scheduledNotifs = computed(() => backend.adminNotifications.filter(n => notifStage(n) === 'scheduled' && isCategoryVisible(n) && !isHelpReminder(n)));
const activeNotifs    = computed(() => backend.adminNotifications.filter(n => notifStage(n) === 'active'   && isCategoryVisible(n)));
const expiredNotifs   = computed(() => backend.adminNotifications.filter(n => notifStage(n) === 'expired'  && isCategoryVisible(n)));

// ── Preview: the draft, in the window players will read it in ──
// (Ames 2026-10-10.) Shown by the notification panel itself, so it is the
// real layout and formatting, not a copy of them. A picture that has been
// attached but not uploaded yet is shown from this computer.
const editingImageUrl = ref('');
let previewObjectUrl: string | null = null;
function previewNotification() {
  if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
  let image = '';
  if (notifImageFile.value) image = previewObjectUrl = URL.createObjectURL(notifImageFile.value);
  else if (editingId.value != null) image = editingImageUrl.value;
  document.dispatchEvent(new CustomEvent('nge:preview-notification', {
    detail: { title: notifTitle.value.trim() || 'Untitled', body: notifBody.value, image_url: image },
  }));
}

/** View: a notification from the list, in the window players read it in
 *  (Ames 2026-10-14). Opened as a preview, so nothing is marked read and no
 *  reply can be sent from it. */
function viewNotification(n: any) {
  document.dispatchEvent(new CustomEvent('nge:preview-notification', {
    detail: { title: n.title || 'Untitled', body: n.body || '', image_url: n.image_url || '', thumbnail_url: n.thumbnail_url || '',
      send_at: n.send_at || n.created_at, target_type: n.target_type, viewing: !(n.send_at && new Date(n.send_at).getTime() > Date.now()) },
  }));
}

/** Load an existing notification into the compose form for editing. */
function startEdit(n: any) {
  editingId.value = n.id;
  editingImageUrl.value = n.image_url || n.thumbnail_url || '';
  notifTitle.value = n.title || '';
  notifBody.value = n.body || '';
  notifTargetType.value = n.target_type || 'all';
  notifTargetId.value = n.target_id || '';
  notifPostToChat.value = !!n.post_to_chat;
  notifSendAt.value = n.send_at ? utcIsoToEtNaive(n.send_at) : '';
  notifExpiresAt.value = n.expires_at ? utcIsoToEtNaive(n.expires_at) : '';
  notifConfirm.value = '';
  notifError.value = '';
  // Images aren't re-loaded into file inputs; leaving them untouched keeps the
  // existing artwork unless a new file is picked.
  notifImageFile.value = null;
  notifIconFile.value = null;
  // The form is far above the list (off screen on a phone): bring it into
  // view, so it is plain that the pencil opened this notification for
  // editing and that the button now says Save Changes (Ames 2026-10-02).
  requestAnimationFrame(() => {
    document.querySelector('.nge-admin-editing-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    notifBodyEl.value?.focus({ preventScroll: true });
  });
}

function cancelEdit() {
  editingId.value = null;
  notifTitle.value = '';
  notifBody.value = '';
  notifTargetType.value = 'all';
  notifTargetId.value = '';
  notifPostToChat.value = false;
  notifSendAt.value = '';
  notifExpiresAt.value = '';
  notifImageFile.value = null;
  notifIconFile.value = null;
  notifError.value = '';
  clearDraft();
}

// ── Draft persistence ───────────────────────────────────────────────────────
// The Admin Hub lives inside a modal, so a stray click on the backdrop used to
// throw away a half-written notification. Mirror the form to localStorage on
// every change and restore it on mount; cleared only on a successful send.
const DRAFT_KEY = 'nge-admin-notif-draft';

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: notifTitle.value,
      body: notifBody.value,
      targetType: notifTargetType.value,
      targetId: notifTargetId.value,
      postToChat: notifPostToChat.value,
      sendAt: notifSendAt.value,
      expiresAt: notifExpiresAt.value,
      // Files can't be serialised; the admin re-picks those.
    }));
  } catch { /* quota or private mode */ }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    notifTitle.value = d.title || '';
    notifBody.value = d.body || '';
    notifTargetType.value = d.targetType || 'all';
    notifTargetId.value = d.targetId || '';
    notifPostToChat.value = !!d.postToChat;
    notifSendAt.value = d.sendAt || '';
    notifExpiresAt.value = d.expiresAt || '';
  } catch { /* ignore malformed draft */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

const hasDraft = computed(() =>
  !!(notifTitle.value.trim() || notifBody.value.trim() || notifSendAt.value));

watch([notifTitle, notifBody, notifTargetType, notifTargetId,
       notifPostToChat, notifSendAt, notifExpiresAt], saveDraft);

/** A title is always needed; words only when there is no picture. A title
 *  and a picture is a note of its own, shown big (Ames 2026-10-24: the
 *  button stayed grey with no body text). */
const notifHasPicture = computed(() => !!notifImageFile.value || (editingId.value != null && !!editingImageUrl.value));
const notifReady = computed(() => !!notifTitle.value.trim() && (!!notifBody.value.trim() || notifHasPicture.value));

async function sendNotification() {
  if (!notifReady.value) return;
  const editing = editingId.value != null;
  notifSteps.value = [
    ...(notifImageFile.value ? [{ key: 'image' as NotifStep, label: 'Uploading the image' }] : []),
    ...(notifIconFile.value ? [{ key: 'icon' as NotifStep, label: 'Uploading the feed icon' }] : []),
    { key: 'save' as NotifStep, label: editing ? 'Saving your changes' : isScheduledForLater.value ? 'Scheduling the notification' : 'Sending the notification' },
    { key: 'list' as NotifStep, label: 'Refreshing the list' },
  ];
  notifSendStage.value = notifSteps.value[0].key;
  notifSeed.value = (Date.now() % 100000) + 1;
  notifSending.value = true;
  notifError.value = '';
  try {
    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    if (notifImageFile.value) {
      notifSendStage.value = 'image';
      const urls = await backend.uploadAdminImage(notifImageFile.value, 'notifications');
      imageUrl = urls.fullUrl;
      thumbnailUrl = urls.thumbUrl;
    }
    // An explicitly-supplied icon wins over the thumbnail auto-cropped from the
    // hero image — that crop often reads badly at feed size.
    if (notifIconFile.value) {
      notifSendStage.value = 'icon';
      thumbnailUrl = await backend.uploadAdminIcon(notifIconFile.value);
    }
    notifSendStage.value = 'save';

    // ── Editing an existing notification ──
    if (editingId.value != null) {
      await backend.updateNotification(editingId.value, {
        title: notifTitle.value.trim(),
        body: notifBody.value.trim(),
        target_type: notifTargetType.value,
        target_id: notifTargetType.value !== 'all' ? notifTargetId.value : null,
        post_to_chat: notifPostToChat.value,
        send_at: notifSendAt.value ? etNaiveToUtcIso(notifSendAt.value) : undefined,
        expires_at: notifExpiresAt.value ? etNaiveToUtcIso(notifExpiresAt.value) : null,
        // Only overwrite artwork when a new file was actually chosen.
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
      });
      notifConfirm.value = `Updated “${notifTitle.value.trim()}”.`;
      // Post to chat turned on for one that has already gone out: post it now,
      // not on the next round (Ames 2026-10-27: it did not seem to send).
      if (notifPostToChat.value && notifTargetType.value === 'all') await backend.postDueChatAnnouncements();
      cancelEdit();
      notifSendStage.value = 'list';
      await backend.loadAdminNotifications();
      notifSent.value = true;
      setTimeout(() => { notifSent.value = false; }, 2000);
      return;
    }

    await backend.createNotification({
      title: notifTitle.value.trim(),
      body: notifBody.value.trim(),
      target_type: notifTargetType.value,
      target_id: notifTargetType.value !== 'all' ? notifTargetId.value : undefined,
      post_to_chat: notifPostToChat.value,
      // Interpret the picker's naive value as EASTERN time, not the admin's
      // local zone — `new Date("2026-07-20T08:00")` would parse in whatever
      // zone the admin's browser is in, so a West-Coast admin scheduling 08:00
      // was really scheduling 11:00 ET. etNaiveToUtcIso pins it to ET and
      // handles EST/EDT for the specific date.
      send_at: notifSendAt.value ? etNaiveToUtcIso(notifSendAt.value) : undefined,
      expires_at: notifExpiresAt.value ? etNaiveToUtcIso(notifExpiresAt.value) : undefined,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
    });
    // Build the confirmation BEFORE clearing the form, so it can quote the
    // scheduled time back and the admin knows exactly what was queued.
    const audience = notifTargetType.value === 'all' ? 'all users'
      : notifTargetType.value === 'group' ? 'the selected group'
      : 'that user';
    notifConfirm.value = isScheduledForLater.value
      ? `Scheduled for ${formatEt(etNaiveToUtcIso(notifSendAt.value))} to ${audience}.`
        + (notifPostToChat.value ? ' It will post to chat when it sends.' : '')
      : `Sent now to ${audience}.`;

    notifTitle.value = '';
    notifBody.value = '';
    notifImageFile.value = null;
    notifIconFile.value = null;
    notifTargetType.value = 'all';
    notifTargetId.value = '';
    notifPostToChat.value = false;
    notifSendAt.value = '';
    notifExpiresAt.value = '';
    clearDraft();
    // Refresh the admin list so a newly-scheduled notification appears in it.
    notifSendStage.value = 'list';
    await backend.loadAdminNotifications();
    notifSent.value = true;
    setTimeout(() => { notifSent.value = false; }, 2000);
  } catch (e: any) {
    notifError.value = e.message || 'Failed to send notification';
    console.error('[admin] sendNotification failed:', e);
  } finally {
    notifSending.value = false;
  }
}

function onNotifImageChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // Validate up front rather than failing halfway through a send.
  const invalid = backend.validateAdminImage(file);
  if (invalid) { notifError.value = invalid; input.value = ''; return; }
  notifError.value = '';
  notifImageFile.value = file;
}

// Paste a picture straight into the notification as its feature image (Ames
// 2026-10-13): a screenshot from the clipboard, with Ctrl+V anywhere in this
// form. Pasted text is left alone. A screenshot is often a large PNG, so one
// over the size limit is saved again as WebP, smaller, before it is checked.
async function shrinkPasted(file: File): Promise<File> {
  if (!backend.validateAdminImage(file).includes('MB')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.92, 0.82, 0.7]) {
      const blob: Blob | null = await new Promise(done => canvas.toBlob(done, 'image/webp', quality));
      if (!blob) break;
      const smaller = new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
      if (!backend.validateAdminImage(smaller)) return smaller;
    }
  } catch { /* fall through to the size message */ }
  return file;
}
async function onNotifImagePaste(e: ClipboardEvent) {
  const item = [...(e.clipboardData?.items ?? [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  const raw = item?.getAsFile();
  if (!raw) return;                    // text, or nothing: the normal paste goes ahead
  e.preventDefault();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const named = new File([raw], `pasted-${stamp}.${(raw.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: raw.type });
  const file = await shrinkPasted(named);
  const invalid = backend.validateAdminImage(file);
  if (invalid) { notifError.value = invalid; return; }
  notifError.value = '';
  notifImageFile.value = file;
}
/** A small look at the image that will be sent, pasted or picked. */
const notifImagePreview = ref('');
watch(notifImageFile, file => {
  if (notifImagePreview.value) URL.revokeObjectURL(notifImagePreview.value);
  notifImagePreview.value = file ? URL.createObjectURL(file) : '';
});

function onNotifIconChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const invalid = backend.validateAdminImage(file);
  if (invalid) { notifError.value = invalid; input.value = ''; return; }
  notifError.value = '';
  notifIconFile.value = file;
}

/** Step 1 of delete: ask. Step 2 is confirmDelete(). */
function requestDelete(n: any) {
  pendingDelete.value = n;
  deleteDone.value = '';
}

async function confirmDelete() {
  const n = pendingDelete.value;
  if (!n) return;
  pendingDelete.value = null;
  try {
    await backend.deleteNotification(n.id);
    deleteDone.value = `Deleted “${n.title}”.`;
    setTimeout(() => { deleteDone.value = ''; }, 4000);
  } catch (e: any) {
    notifError.value = e?.message || 'Delete failed';
  }
}

// ── Group management ──
const newGroupName = ref('');
const newGroupColor = ref('#4a9eff');
const groupMembers = ref<any[]>([]);
const selectedGroupId = ref<number | null>(null);
const memberSearch = ref('');
const memberSearchResults = ref<any[]>([]);
let searchTimeout: any = null;

async function createGroup() {
  if (!newGroupName.value.trim()) return;
  await backend.createGroup(newGroupName.value.trim(), '', newGroupColor.value);
  newGroupName.value = '';
  await backend.loadGroups();
}

async function selectGroup(gid: number) {
  selectedGroupId.value = gid;
  groupMembers.value = await backend.loadGroupMembers(gid);
}

function onMemberSearch() {
  clearTimeout(searchTimeout);
  if (memberSearch.value.length < 2) { memberSearchResults.value = []; return; }
  searchTimeout = setTimeout(async () => {
    memberSearchResults.value = await backend.searchUsers(memberSearch.value);
  }, 300);
}

async function addMember(userId: string) {
  if (!selectedGroupId.value) return;
  await backend.addGroupMembers(selectedGroupId.value, [userId]);
  groupMembers.value = await backend.loadGroupMembers(selectedGroupId.value);
  memberSearch.value = '';
  memberSearchResults.value = [];
}

async function removeMember(userId: string) {
  if (!selectedGroupId.value) return;
  await backend.removeGroupMember(selectedGroupId.value, userId);
  groupMembers.value = await backend.loadGroupMembers(selectedGroupId.value);
}

// ── Special badge management ──
const badgeName = ref('');
const badgeDesc = ref('');
const badgeSlug = ref('');
const badgeImageFile = ref<File | null>(null);
const badgeCreating = ref(false);
const badgeError = ref('');
const badgeCreated = ref(false);
const awardBadgeId = ref<number | null>(null);
const awardUserSearch = ref('');
const awardUserResults = ref<any[]>([]);
const awardGroupId = ref<number | null>(null);
const awardSuccess = ref('');
let awardSearchTimeout: any = null;

// Replace an award's picture (Ames 2026-10-13: "I made a better icon"). The
// award itself stays, so everyone who holds it keeps it and sees the new
// picture. Making a new award in its place would leave the holders behind.
const badgeImageBusy = ref(false);
const badgeImageNote = ref('');
async function replaceBadgeImage(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  const id = awardBadgeId.value;
  input.value = '';
  if (!file || !id) return;
  const invalid = backend.validateAdminImage(file);
  if (invalid) { badgeImageNote.value = invalid; return; }
  badgeImageBusy.value = true; badgeImageNote.value = '';
  try {
    const urls = await backend.uploadAdminImage(file, 'badges');
    const { error } = await supabase.from('special_badges')
      .update({ image_url: urls.fullUrl, thumbnail_url: urls.thumbUrl || null }).eq('id', id);
    if (error) throw new Error(error.message);
    // Read the awards again and look: only say it worked if it did.
    await backend.loadSpecialBadges();
    if (backend.specialBadges.find((b: any) => b.id === id)?.image_url !== urls.fullUrl) throw new Error('the server did not accept the change');
    badgeImageNote.value = 'Picture replaced. Everyone who holds this award now sees the new one.';
  } catch (err: any) {
    badgeImageNote.value = `Could not replace the picture: ${err?.message || err}`;
  } finally {
    badgeImageBusy.value = false;
  }
}

async function createBadge() {
  if (!badgeName.value.trim()) { badgeError.value = 'Badge name is required'; return; }
  if (!badgeImageFile.value) { badgeError.value = 'Badge image is required'; return; }
  const slug = (badgeSlug.value.trim() || badgeName.value.trim())
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  badgeCreating.value = true;
  badgeError.value = '';
  badgeCreated.value = false;
  try {
    const urls = await backend.uploadAdminImage(badgeImageFile.value, 'badges');
    await backend.createSpecialBadge({
      name: badgeName.value.trim(),
      description: badgeDesc.value.trim(),
      slug,
      image_url: urls.fullUrl,
      thumbnail_url: urls.thumbUrl,
    });
    badgeName.value = '';
    badgeDesc.value = '';
    badgeSlug.value = '';
    badgeImageFile.value = null;
    badgeCreated.value = true;
    setTimeout(() => { badgeCreated.value = false; }, 2500);
    await backend.loadSpecialBadges();
  } catch (e: any) {
    badgeError.value = e.message || 'Failed to create badge';
    console.error('[admin] createBadge failed:', e);
  } finally {
    badgeCreating.value = false;
  }
}

function onBadgeImageChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) badgeImageFile.value = input.files[0];
}

function onAwardUserSearch() {
  clearTimeout(awardSearchTimeout);
  if (awardUserSearch.value.length < 2) { awardUserResults.value = []; return; }
  awardSearchTimeout = setTimeout(async () => {
    awardUserResults.value = await backend.searchUsers(awardUserSearch.value);
  }, 300);
}

async function awardToUser(uid: string, displayName: string) {
  if (!awardBadgeId.value) return;
  const badge = backend.specialBadges.find(b => b.id === awardBadgeId.value);
  await backend.awardBadge(awardBadgeId.value, [uid]);
  awardUserSearch.value = '';
  awardUserResults.value = [];
  awardSuccess.value = `✓ "${badge?.name}" awarded to ${displayName}!`;
  setTimeout(() => { awardSuccess.value = ''; }, 3500);

  if (badge) {
    try {
      await backend.createNotification({
        title: 'New Achievement!',   // no emoji in Achievement notes (Ames 2026-10-27)
        body: `You earned the "${badge.name}" Achievement!${badge.description ? ' ' + badge.description : ''}`,
        image_url: badge.image_url || '',
        thumbnail_url: badge.thumbnail_url || '',
        target_type: 'user',
        target_id: uid,
        post_to_chat: false,
      });
    } catch (e) { console.warn('[admin] badge notification failed:', e); }
  }
}

async function awardToGroup() {
  if (!awardBadgeId.value || !awardGroupId.value) return;
  const badge = backend.specialBadges.find(b => b.id === awardBadgeId.value);
  const group = backend.groups.find(g => g.id === awardGroupId.value);
  await backend.awardBadgeToGroup(awardBadgeId.value, awardGroupId.value);
  awardSuccess.value = `✓ "${badge?.name}" awarded to group "${group?.name}"!`;
  setTimeout(() => { awardSuccess.value = ''; }, 3500);
}

function selectBadgeForAward(badgeId: number) {
  awardBadgeId.value = awardBadgeId.value === badgeId ? null : badgeId;
  // The award box sits above the grid: bring it into view.
  if (awardBadgeId.value) void nextTick(() => awardSectionEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

// The award grid a page at a time, with a name search (Ames 2026-10-27: "we
// don't need to see ALL the badges ever here, you can page it").
const BADGE_PAGE = 15;
const badgePage = ref(0);
const badgeFind = ref('');
const awardSectionEl = ref<HTMLElement | null>(null);
const filteredBadges = computed(() => {
  const q = badgeFind.value.trim().toLowerCase();
  return q ? backend.specialBadges.filter(b => String(b.name || '').toLowerCase().includes(q)) : backend.specialBadges;
});
const badgePages = computed(() => Math.max(1, Math.ceil(filteredBadges.value.length / BADGE_PAGE)));
const pagedBadges = computed(() => filteredBadges.value.slice(badgePage.value * BADGE_PAGE, (badgePage.value + 1) * BADGE_PAGE));
watch(badgeFind, () => { badgePage.value = 0; });
watch(badgePages, n => { if (badgePage.value > n - 1) badgePage.value = n - 1; });
const awardBadge = computed(() => backend.specialBadges.find(b => b.id === awardBadgeId.value) ?? null);
/** Badges whose picture failed to load show a plain medal instead. */
const brokenBadgeImg = ref(new Set<number>());
function onBadgeImgError(id: number) { brokenBadgeImg.value = new Set(brokenBadgeImg.value).add(id); }

onMounted(() => {
  backend.loadGroups();
  backend.loadSpecialBadges();
  backend.loadNotifications();
  backend.loadAdminNotifications();
  restoreDraft();
});
// ── Practice cells (Cut & Merge tutorial) ───────────────────────────────────
// supabase-tutorial-practice-schema.sql, src/practice.ts. Registering one:
// open the sandbox view you want learners to start from, hover the main cell
// and press "Use hovered as A", hover the disconnected piece and press "Use
// hovered as B", give it a title, Register. The current view is saved as the
// start state and the two hovered supervoxels as the durable identity.
const practiceRows = ref<PracticeExample[]>([]);
const practiceLoading = ref(false);
const practiceError = ref('');
const practiceNotice = ref('');
const practiceTitle = ref('');
const practiceKind = ref<PracticeKind>('cut');
const practiceA = ref<{ sv: string; root: string; pos?: number[] } | null>(null);
const practiceB = ref<{ sv: string; root: string; pos?: number[] } | null>(null);
/** Typed root ids, the no-hover way in: supervoxels are looked up on first use. */
const practiceRootA = ref('');
const practiceRootB = ref('');
watch(practiceRootA, v => { const t = v.trim(); if (/^\d{10,}$/.test(t)) practiceA.value = { sv: '', root: t }; });
watch(practiceRootB, v => { const t = v.trim(); if (/^\d{10,}$/.test(t)) practiceB.value = { sv: '', root: t }; });
const practiceHover = ref<{ sv: string; root: string; pos?: number[] } | null>(null);
const practiceSaving = ref(false);
const practiceActing = ref<string | null>(null);
let hoverTimer: ReturnType<typeof setInterval> | null = null;
/** Picking mode: the profile modal is hidden (body class, unscoped style
 *  below) so the viewer can be hovered, and a small floating chip carries
 *  the A and B buttons. AdminHub stays mounted, so nothing is lost. */
const practicePicking = ref(false);
function startPicking() {
  practicePicking.value = true;
  document.body.classList.add('nge-practice-picking');
  window.addEventListener('keydown', onPickKey, true);
}
function stopPicking() {
  practicePicking.value = false;
  document.body.classList.remove('nge-practice-picking');
  window.removeEventListener('keydown', onPickKey, true);
}
/** While picking, the A and B keys take the segment under the mouse and the
 *  crosshair position (Ames, 2026-10-02: moving to a button changed what was
 *  hovered). Capture phase,
 *  so the viewer's own bindings for those keys do not fire. */
function onPickKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const which = e.code === 'KeyA' ? 'a' : e.code === 'KeyB' ? 'b' : null;
  if (!which) return;
  e.preventDefault(); e.stopPropagation();
  sampleHover();
  usePracticeHover(which);
}
/** A pick as its coordinates: on a fused cell A and B share one segment id,
 *  so the id says nothing about which side each is on. */
function pickLabel(p: { sv: string; root: string; pos?: number[] } | null): string {
  if (!p) return '…';
  const at = p.pos ? p.pos.map(v => Math.round(v)).join(', ') : 'segment ' + p.root;
  return p.sv ? at : at + ' (not exact, hover it in 2D)';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function sampleHover() {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const sel = ml.layer?.displayState?.segmentSelectionState;
      if (!sel?.hasSelectedSegment) continue;
      const sv = sel.baseSelectedSegment?.toString?.();
      const root = sel.selectedSegment?.toString?.();
      // The crosshair position, not the mouse: it becomes the merge point for
      // "place the merge points for me" in the tutorial, and the crosshair
      // can be set exactly without holding the mouse still.
      const p = viewer?.navigationState?.position?.value;
      const pos = p && p.length >= 3 ? [p[0], p[1], p[2]].map((v: number) => Math.round(v * 100) / 100) : undefined;
      // Only the 2D view gives a supervoxel. Over the 3D shape the "base"
      // value is the segment itself (ids carry their layer in the top byte,
      // supervoxels are layer 1), and a cell registered with it could never
      // be checked or reset (the "Test cell" of 2026-09-28).
      const isSv = !!sv && sv !== '0' && Math.floor(Number(sv) / 2 ** 56) === 1;
      if (root && root !== '0') { practiceHover.value = { sv: isSv ? sv : '', root, pos }; return; }
    }
  } catch { /* viewer not ready */ }
}

watch(adminSubTab, t => {
  if (t === 'practice') {
    loadPractice();
    if (!hoverTimer) hoverTimer = setInterval(sampleHover, 200);
  } else {
    stopPicking();
    if (hoverTimer) { clearInterval(hoverTimer); hoverTimer = null; }
  }
}, { immediate: true });
onUnmounted(() => { stopPicking(); if (hoverTimer) clearInterval(hoverTimer); });

async function loadPractice() {
  practiceLoading.value = true; practiceError.value = '';
  const { data, error } = await supabase.from('tutorial_practice_examples').select('*').order('created_at');
  if (error) practiceError.value = error.message;
  else practiceRows.value = (data ?? []) as PracticeExample[];
  practiceLoading.value = false;
}

/**
 * What sits under the crosshair (Celia, 2026-10-05: the segment should come
 * from the crosshair too, like the point). Reads the segmentation volume at
 * the viewer's position, which gives the exact supervoxel there, whatever
 * the mouse is over. Needs the 2D view open so that data is loaded.
 */
function crosshairPick(): { sv: string; pos: number[] } | null {
  try {
    const viewer = (window as any)['viewer'];
    const p = viewer?.navigationState?.position?.value;
    if (!p || p.length < 3) return null;
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      if (!ml.layer?.displayState?.segmentSelectionState) continue;
      for (const rl of ml.layer.renderLayers ?? []) {
        const v = rl.getValueAt?.(p);
        const sv = v == null ? '' : String(Array.isArray(v) ? v[0] : v);
        if (sv && sv !== '0' && Math.floor(Number(sv) / 2 ** 56) === 1) {
          return { sv, pos: [p[0], p[1], p[2]].map((n: number) => Math.round(n * 100) / 100) };
        }
      }
    }
  } catch { /* viewer not ready */ }
  return null;
}

async function usePracticeHover(which: 'a' | 'b') {
  let pick = practiceHover.value ? { ...practiceHover.value } : null;
  // The crosshair wins when the volume can be read there; the hovered
  // segment is the fallback.
  const cross = crosshairPick();
  const pcg = getPcgInfo();
  if (cross && pcg) {
    const root = await rootOfSupervoxel({ pcg_server: pcg.server, pcg_table: pcg.table }, cross.sv);
    if (root) pick = { sv: cross.sv, root, pos: cross.pos };
  }
  if (!pick) return;
  if (which === 'a') practiceA.value = pick;
  else practiceB.value = pick;
}

function practiceDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const url: string = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('segmentation/table/')) return ml.name;
    }
  } catch { /* */ }
  return '';
}

async function registerPractice() {
  practiceError.value = ''; practiceNotice.value = '';
  const a = practiceA.value, b = practiceB.value;
  if (!a || !b) { practiceError.value = 'Pick both pieces first.'; return; }
  if (a.sv && a.sv === b.sv) { practiceError.value = 'A and B are the same spot. Hover two different places.'; return; }
  if (a.pos && b.pos && a.pos.join() === b.pos.join()) { practiceError.value = 'A and B are the same point. Hover two different places.'; return; }
  // A cut example needs a spot on each side of the join, so both have to
  // come from the 2D view. A merge example can be completed from its roots.
  if (practiceKind.value === 'cut' && a.root === b.root && (!a.sv || !b.sv)) {
    practiceError.value = 'For a cut example, hover each side of the join in the 2D view (the black and white images), not on the 3D shape.'; return;
  }
  if (a.root === b.root && practiceKind.value === 'cut' && !a.sv) { practiceError.value = 'For a cut example typed in by id, give the two root ids as they are after the cut; the cell is then merged back and both pieces are known.'; return; }
  if (practiceKind.value === 'merge_then_cut' && a.root === b.root) { practiceError.value = 'A and B are on the same root. For a merge example, the piece must start disconnected.'; return; }
  if (practiceKind.value === 'cut' && a.root !== b.root) { practiceError.value = 'A and B are on different roots. For a cut example, hover two spots on the fused segment, one each side of the join.'; return; }
  const pcg = getPcgInfo();
  if (!pcg) { practiceError.value = 'No graphene segmentation layer in the viewer.'; return; }
  practiceSaving.value = true;
  try {
    // Pieces picked on the 3D shape or typed in by id: find a supervoxel in each.
    const where = { pcg_server: pcg.server, pcg_table: pcg.table };
    if (!a.sv) a.sv = await anySupervoxelOf(where, a.root);
    if (!b.sv) b.sv = await anySupervoxelOf(where, b.root);
    if (a.sv === b.sv) throw new Error('Could not tell the two pieces apart. Hover each one in the 2D view.');
    // Cells on one neuron reset each other unless they share a starting
    // point (2026-09-29), so say so before it is registered.
    const rootsNow = new Set([await rootOfSupervoxel(where, a.sv), await rootOfSupervoxel(where, b.sv)].filter(Boolean));
    for (const other of practiceRows.value) {
      if (!other.enabled || other.pcg_table !== pcg.table || !other.supervoxel_a) continue;
      const r = await rootOfSupervoxel(other, other.supervoxel_a);
      if (r && rootsNow.has(r) && !window.confirm(`This is on the same neuron as "${other.title}". Cells on one neuron need one shared starting point, or their resets undo each other. Register anyway? (Then ask Claude to give them a shared starting point before anyone uses them.)`)) {
        throw new Error('Not registered.');
      }
    }
    const link = await mintShortStateLink();
    if (!link) throw new Error('Could not save the current view as a state link.');
    const stateUrl = link.slice(link.indexOf('#!') + 2);
    const row = {
      title: practiceTitle.value.trim() || `Practice ${practiceRows.value.length + 1}`,
      kind: practiceKind.value,
      dataset: practiceDataset(), pcg_server: pcg.server, pcg_table: pcg.table,
      state_url: stateUrl,
      supervoxel_a: a.sv, supervoxel_b: b.sv, root_a: a.root, root_b: b.root,
      point_a: a.pos ? JSON.stringify(a.pos) : null,
      point_b: b.pos ? JSON.stringify(b.pos) : null,
      created_by: backend.userId,
    };
    const { error } = await supabase.from('tutorial_practice_examples').insert(row);
    if (error) throw new Error(error.message);
    practiceNotice.value = `Registered "${row.title}".`;
    practiceTitle.value = ''; practiceA.value = null; practiceB.value = null;
    practiceRootA.value = ''; practiceRootB.value = '';
    await loadPractice();
  } catch (e: any) {
    practiceError.value = e?.message ?? String(e);
  } finally {
    practiceSaving.value = false;
  }
}

async function patchPractice(id: string, body: Record<string, unknown>) {
  const { error } = await supabase.from('tutorial_practice_examples').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) practiceError.value = error.message;
  await loadPractice();
}

/** Undo everything since the baseline with the admin's own token, right now. */
async function resetPracticeNow(ex: PracticeExample) {
  practiceActing.value = ex.id; practiceError.value = ''; practiceNotice.value = '';
  try {
    const r = await resetPracticeExample(ex.id);
    practiceNotice.value = `${ex.title}: undid ${r.undone} operation(s), ready.`;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    practiceError.value = `${ex.title}: ${msg}`;
  } finally {
    practiceActing.value = null;
  }
}

async function deletePractice(ex: PracticeExample) {
  if (!window.confirm(`Delete "${ex.title}"? Its cell is left as it is now.`)) return;
  const { error } = await supabase.from('tutorial_practice_examples').delete().eq('id', ex.id);
  if (error) practiceError.value = error.message;
  await loadPractice();
}

async function checkPractice(ex: PracticeExample) {
  practiceActing.value = ex.id; practiceError.value = ''; practiceNotice.value = '';
  try {
    await ensureSupervoxels(ex);
    const [a, b] = await Promise.all([rootOfSupervoxel(ex, ex.supervoxel_a), rootOfSupervoxel(ex, ex.supervoxel_b)]);
    practiceNotice.value = a === b ? `${ex.title}: the pieces are MERGED right now (root ${a}).`
      : `${ex.title}: the pieces are separate (roots ${a}, ${b}).`;
  } catch (e: any) {
    practiceError.value = e?.message ?? String(e);
  } finally {
    practiceActing.value = null;
  }
}

function practiceWhen(iso: string | null) {
  return iso ? formatEt(iso) : '';
}
</script>

<template>
  <div class="nge-admin-hub">
    <!-- Delete is irreversible and removes the notification for EVERYONE, so
         it takes a deliberate confirm, then acknowledges that it happened. -->
    <div v-if="pendingDelete" class="nge-admin-modal-backdrop" @click.self="pendingDelete = null">
      <div class="nge-admin-modal">
        <div class="nge-admin-modal-title">Delete this notification?</div>
        <div class="nge-admin-modal-body">
          “{{ pendingDelete.title }}”<br />
          <span class="nge-admin-modal-sub">
            This removes it for every user and can't be undone.
          </span>
        </div>
        <div class="nge-admin-modal-actions">
          <button class="nge-admin-modal-danger" @click="confirmDelete">Delete</button>
          <button class="nge-admin-modal-cancel" @click="pendingDelete = null">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="deleteDone" class="nge-admin-toast">
      ✓ {{ deleteDone }}
      <button class="nge-admin-confirm-x" @click="deleteDone = ''">×</button>
    </div>
    <!-- Sub-tabs -->
    <div v-if="!standalone" class="nge-admin-subtabs">
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'notifications' }" @click="adminSubTab = 'notifications'">Notifications</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'groups' }" @click="adminSubTab = 'groups'">Groups</button>
      <button class="nge-admin-subtab nge-admin-subtab--badges" :class="{ 'nge-admin-subtab--active': adminSubTab === 'badges' }" @click="adminSubTab = 'badges'">Special Badges</button>
      <!-- Triage lives on its own page: the full board, in a new tab (Ames 2026-10-05). -->
      <a class="nge-admin-subtab nge-admin-subtab--triage" :href="boardUrl" target="_blank" rel="noopener" title="Opens the triage board in a new tab">Triage ↗</a>
      <a class="nge-admin-subtab nge-admin-subtab--triage" :href="todoBoardUrl" target="_blank" rel="noopener" title="Opens the admins' own To do board in a new tab">To do ↗</a>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'practice' }" @click="adminSubTab = 'practice'">Practice cells</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'pilot' }" @click="adminSubTab = 'pilot'">Pilot testers</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'access' }" @click="adminSubTab = 'access'" title="Players' ten examples for retina access">Access requests</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'tests' }" @click="adminSubTab = 'tests'" title="Every Proofreading Test try: the score, what was missed, and the player's cell">Test tries</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'celltypes' }" @click="adminSubTab = 'celltypes'" title="Are the cell types the game logged really in CAVE?">Cell types</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'hunts' }" @click="adminSubTab = 'hunts'" title="Timed merger hunts, with gold, silver and bronze Achievements">Hunts</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'tutorialEdits' }" @click="adminSubTab = 'tutorialEdits'" title="Tutorial boxes admins reworded, and suggestions waiting for approval">Tutorial edits</button>
    </div>

    <!-- ── Tutorial edits (Ames 2026-10-25): the pencil on a tutorial box ── -->
    <TutorialEditsTab v-if="adminSubTab === 'tutorialEdits'" />

    <!-- ── Access requests (Ames 2026-10-16): the Dataset Access form, in the game ── -->
    <AccessRequestsTab v-if="adminSubTab === 'access'" />
    <HuntsAdminTab v-if="adminSubTab === 'hunts'" />

    <!-- ── Proofreading Test tries (Ames 2026-10-21): every try, and the player's cell ── -->
    <TestTriesTab v-if="adminSubTab === 'tests'" />

    <!-- ── Cell types: the game's log against CAVE ── -->
    <div v-if="adminSubTab === 'celltypes'" class="nge-admin-section">
      <!-- Saves waiting for CAVE (cave_outbox.ts): every player, every dataset. -->
      <div class="nge-outbox-line" role="status">
        <b>Waiting for CAVE:</b>&#32;
        <template v-if="outboxSummary === null">checking…</template>
        <template v-else-if="outboxSummary.installed === false">not switched on yet (run supabase-cave-outbox.sql).</template>
        <template v-else-if="outboxSummary.error">could not be read ({{ outboxSummary.error }}).</template>
        <template v-else-if="!outboxSummary.waiting">nothing. Every save reached CAVE.</template>
        <template v-else>
          {{ outboxSummary.waiting }} save{{ outboxSummary.waiting === 1 ? '' : 's' }}
          ({{ outboxSummary.byKind?.complete || 0 }} completion{{ outboxSummary.byKind?.complete === 1 ? '' : 's' }},
          {{ outboxSummary.byKind?.cell_type || 0 }} cell type{{ outboxSummary.byKind?.cell_type === 1 ? '' : 's' }})
          from {{ outboxSummary.players }} player{{ outboxSummary.players === 1 ? '' : 's' }}, the oldest {{ relTime(outboxSummary.oldest) }}.
          Each goes out from the player's own browser when CAVE is back and they have Pyr open.
        </template>
      </div>
      <CellTypeCheck />
    </div>

    <!-- ── Notifications ── -->
    <section v-if="adminSubTab === 'pilot'" class="nge-pilot-admin">
      <h2>Beta requests</h2>
      <p>People who asked to join, in the game or on connectome.quest. Let them in adds their email to Pilot testers below; then email them so they know. Add to list keeps them on the list for later, and Remove request takes them off this page.</p>
      <div class="nge-beta-views" role="tablist" aria-label="Beta requests">
        <button v-for="v in BETA_VIEWS" :key="v.key" role="tab" :aria-selected="betaView === v.key"
                :class="{ 'nge-beta-view--on': betaView === v.key }" @click="betaView = v.key">{{ v.label }} <span>{{ betaCount[v.key] }}</span></button>
      </div>
      <p v-if="betaError" role="alert">{{ betaError }}</p>
      <p v-if="!betaShown.length" class="nge-beta-req-empty">{{ betaView === 'waiting' ? (betaRequests.length ? 'Nobody is waiting.' : 'No requests yet.') : 'Nobody here.' }}</p>
      <ul v-else class="nge-beta-req">
        <li v-for="r in betaShown" :key="r.id">
          <span>
            <b class="nge-pilot-name">{{ r.name || 'No name' }}</b> · {{ r.email }}
            <i class="nge-beta-req-meta">{{ betaWhen(r.at) }}{{ r.site ? ', from connectome.quest' : ', in the game' }}</i>
            <span v-if="r.ewName || r.ewRank" class="nge-beta-req-ew">EyeWire: {{ [r.ewName, r.ewRank].filter(Boolean).join(', ') }}</span>
            <span v-if="r.note" class="nge-beta-req-note">{{ r.note }}</span>
          </span>
          <span class="nge-beta-req-acts">
            <template v-if="betaStateOf(r) === 'in'">
              <em class="nge-beta-req-in">In</em>
              <a class="nge-beta-req-mail" :href="betaMailto(r)">Email them</a>
            </template>
            <template v-else>
              <button :disabled="betaBusy === r.email" @click="letBetaIn(r)">{{ betaBusy === r.email ? 'Saving…' : 'Let them in' }}</button>
              <button v-if="betaStateOf(r) !== 'listed'" :disabled="betaBusy === r.email" @click="markBeta(r, 'listed')">Add to list</button>
              <button v-if="betaStateOf(r) !== 'removed'" :disabled="betaBusy === r.email" @click="markBeta(r, 'removed')">Remove request</button>
              <button v-if="betaStateOf(r) !== 'waiting'" :disabled="betaBusy === r.email" @click="markBeta(r, 'waiting')">Back to waiting</button>
            </template>
          </span>
        </li>
      </ul>

      <h2>Pilot testers</h2>
      <p>Invited testers can claim cells, use practice cells, sync Sheets, and contribute to the site. Existing administrators already have access.</p>
      <form @submit.prevent="invitePilot">
        <label for="nge-pilot-email">Testers’ sign-in emails, separated by commas</label>
        <input id="nge-pilot-email" v-model="pilotEmail" type="text" required autocomplete="off" spellcheck="false" placeholder="tester@example.com, another@example.com" />
        <button type="submit" :disabled="pilotBusy">{{ pilotBusy ? 'Saving…' : 'Add testers' }}</button>
      </form>
      <p v-if="pilotNote" role="status">{{ pilotNote }}</p>
      <p v-if="pilotError" role="alert">{{ pilotError }}</p>
      <p v-if="!pilotRows.length">No additional testers invited yet.</p>
      <div v-else class="nge-pilot-find">
        <input v-model="pilotSearch" type="search" autocomplete="off" placeholder="Search by name or email" aria-label="Search testers by name or email"
               @keydown.stop @keyup.stop @keypress.stop />
        <span>{{ pilotSearch.trim() ? `${pilotShown.length} of ${pilotRows.length}` : `${pilotRows.length} testers` }}</span>
      </div>
      <p v-if="pilotRows.length && !pilotShown.length">Nobody matches "{{ pilotSearch.trim() }}".</p>
      <ul><li v-for="member in pilotShown" :key="member.email">
        <span>
          <b v-if="pilotNames[member.email.toLowerCase()]" class="nge-pilot-name">{{ pilotNames[member.email.toLowerCase()] }}</b>
          <i v-else class="nge-pilot-noname" title="No Pyr account was found under this email. They may not have signed in yet, or they sign in with a different address.">no Pyr name yet</i>
          · {{ member.email }} · {{ member.enabled ? 'Invited' : 'Access paused' }}
        </span>
        <button @click="setPilot(member.email,!member.enabled)">{{ member.enabled ? 'Pause access' : 'Restore access' }}</button>
      </li></ul>
    </section>

    <div v-if="adminSubTab === 'notifications'" class="nge-admin-section" @paste="onNotifImagePaste">
      <div class="nge-admin-block">
        <label class="nge-admin-label">
          {{ editingId != null ? 'Editing Notification' : 'Send Notification' }}
        </label>
        <div v-if="editingId != null" class="nge-admin-editing-banner">
          Editing "{{ notifTitle || 'this notification' }}". Press Save Changes below and it updates for everyone who can see it; no new notification is sent.
        </div>
        <input v-model="notifTitle" class="nge-admin-input" placeholder="Title" />
        <div class="nge-admin-fmtbar" role="toolbar" aria-label="Formatting">
          <button type="button" title="Bold" @click="fmtWrap('**', 'bold text')"><b>B</b></button>
          <button type="button" title="Italic" @click="fmtWrap('*', 'italic text')"><i>I</i></button>
          <button type="button" title="Heading" @click="fmtLines('## ', 'Heading')">H</button>
          <button type="button" title="Bullet list" @click="fmtLines('- ', 'List item')">• List</button>
          <button type="button" title="Numbered list" @click="fmtLines(i => `${i + 1}. `, 'List item')">1. List</button>
          <button type="button" title="Link" @click="fmtLink()">Link</button>
          <span class="nge-admin-fmthint">Paste formatted text and it keeps its bold, headings, lists and links.</span>
        </div>
        <textarea ref="notifBodyEl" v-model="notifBody" class="nge-admin-textarea" rows="6" placeholder="Message body..." @paste="onNotifPaste($event)"></textarea>
        <div v-if="notifBody.trim()" class="nge-admin-fmtpreview">
          <div class="nge-admin-fmtpreview-label">Preview</div>
          <div class="nge-admin-fmtpreview-body" v-html="notifPreview"></div>
        </div>
        <div class="nge-admin-row">
          <select v-model="notifTargetType" class="nge-admin-select">
            <option value="all">All Users</option>
            <option value="group">Group</option>
            <option value="user">Specific User</option>
          </select>
          <select v-if="notifTargetType === 'group'" v-model="notifTargetId" class="nge-admin-select">
            <option value="" disabled>Select group...</option>
            <option v-for="g in backend.groups" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
          </select>
          <div v-if="notifTargetType === 'user'" class="nge-user-pick">
            <div v-if="userPicked" class="nge-user-picked">
              <span class="nge-user-picked-name">{{ userLabel(userPicked) }}</span>
              <button type="button" class="nge-user-picked-x" title="Choose someone else" @click="clearPickedUser">×</button>
            </div>
            <template v-else>
              <input v-model="userQuery" class="nge-admin-input" placeholder="Name or username" autocomplete="off"
                     @input="onUserQuery" @keydown.stop @keyup.stop />
              <div v-if="userQuery.trim().length >= 2" class="nge-user-matches">
                <button v-for="u in userMatches" :key="u.id" type="button" class="nge-user-match" @click="pickUser(u)">
                  <span class="nge-user-match-name">{{ u.display_name || 'Unnamed player' }}</span>
                  <span v-if="u.username" class="nge-user-match-handle">@{{ u.username }}</span>
                </button>
                <div v-if="!userMatches.length" class="nge-user-nomatch">{{ userSearching ? 'Searching…' : 'No player found with that name' }}</div>
              </div>
            </template>
          </div>
        </div>
        <div class="nge-admin-row nge-admin-row--dates">
          <label class="nge-admin-date-label">
            <span>Send at <em class="nge-admin-tz">(ET)</em></span>
            <input type="datetime-local" v-model="notifSendAt" class="nge-admin-date-input" />
          </label>
          <label class="nge-admin-date-label">
            <span title="After this time the notification reaches nobody new. Players who already have it keep it.">Stop sending at <em class="nge-admin-tz">(ET)</em></span>
            <input type="datetime-local" v-model="notifExpiresAt" class="nge-admin-date-input" />
          </label>
        </div>
        <p v-if="notifSendAt" class="nge-admin-hint">
          Sends {{ formatEt(etNaiveToUtcIso(notifSendAt)) }} — times are Eastern regardless of your own timezone.
        </p>
        <p v-else class="nge-admin-hint">Leave "Send at" empty to send immediately</p>
        <div class="nge-admin-row">
          <label class="nge-admin-check" :title="notifTargetType === 'all' ? '' : 'Only notifications sent to everyone can be posted to chat'"><input type="checkbox" v-model="notifPostToChat" :disabled="notifTargetType !== 'all'" /> Also post to chat</label>
          <span v-if="notifTargetType !== 'all'" class="nge-admin-note-inline">Chat posts are for notifications sent to everyone.</span>
          <span v-if="notifPostToChat && isScheduledForLater" class="nge-admin-note-inline">
            Chat post happens when it sends, not now.
          </span>
          <label class="nge-admin-file-label">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onNotifImageChange" class="nge-admin-file-input" />
            {{ notifImageFile ? notifImageFile.name : 'Attach image...' }}
          </label>
          <!-- Optional small icon. The feed renders a thumbnail per card, so a
               purpose-made icon both looks better at 120px than an auto-crop of
               the hero image and keeps the feed light. -->
          <label class="nge-admin-file-label nge-admin-file-label--icon">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onNotifIconChange" class="nge-admin-file-input" />
            {{ notifIconFile ? notifIconFile.name : 'Feed icon (optional)...' }}
          </label>
        </div>
        <p class="nge-admin-hint">Images up to 3 MB (PNG, JPEG, WebP, GIF). You can also paste a picture here with Ctrl+V. The feed always loads the small icon, not the full image.</p>
        <div v-if="notifImagePreview" class="nge-admin-pasted">
          <img :src="notifImagePreview" alt="The image that will be sent" />
          <span>{{ notifImageFile?.name }} · {{ ((notifImageFile?.size || 0) / 1024).toFixed(0) }} KB</span>
          <button type="button" class="nge-admin-action-btn" @click="notifImageFile = null">Remove</button>
        </div>
        <div class="nge-admin-row">
          <button class="nge-admin-primary-btn" :disabled="notifSending || !notifReady" @click="sendNotification">
            <span v-if="notifSent">✓ Saved!</span>
            <span v-else-if="notifSending">{{ notifSteps.find(x => x.key === notifSendStage)?.label || 'Sending' }}…</span>
            <span v-else-if="editingId != null">Save Changes</span>
            <span v-else>Send Notification</span>
          </button>
          <button class="nge-admin-cancel-btn nge-admin-preview-btn" type="button" :disabled="!notifTitle.trim() && !notifBody.trim()"
                  title="See this notification as players will, before it is sent. Nothing is sent or saved." @click="previewNotification">Preview</button>
          <button v-if="editingId != null" class="nge-admin-cancel-btn" @click="cancelEdit">Cancel edit</button>
        </div>
        <!-- While it sends: a neuron that grows a part for each real step. -->
        <div v-if="notifSending" class="nge-admin-sending" role="status" aria-live="polite">
          <GrowingNeuron :stage="notifStepsDone" :stages="notifSteps.length" :seed="notifSeed" />
          <ul class="nge-admin-steps">
            <li v-for="st in notifSteps" :key="st.key" class="nge-admin-step" :class="`nge-admin-step--${notifStepState(st.key)}`">
              <span class="nge-admin-step-mark" aria-hidden="true">{{ notifStepState(st.key) === 'done' ? '✓' : '' }}</span>
              <span>{{ st.label }}</span>
            </li>
          </ul>
        </div>
        <div v-if="notifError" class="nge-admin-error">⚠ {{ notifError }}</div>
        <!-- Explicit confirmation of what actually happened, including the
             scheduled time, rather than a transient "Sent!" on the button. -->
        <div v-if="notifConfirm" class="nge-admin-confirm">
          ✓ {{ notifConfirm }}
          <button class="nge-admin-confirm-x" @click="notifConfirm = ''">×</button>
        </div>
      </div>

      <!-- Category filters. Auto-generated notifications (per-user badges,
           weekly recaps, help replies) are off by default so the list shows the
           admin's own broadcasts + weekly champions; toggle a chip to reveal a
           category. Persisted per browser. -->
      <div class="nge-admin-block nge-admin-notif-filters">
        <label class="nge-admin-label">Show</label>
        <div class="nge-admin-filter-chips">
          <button
            v-for="cat in NOTIF_CATEGORIES"
            :key="cat.key"
            class="nge-admin-filter-chip"
            :class="{ 'nge-admin-filter-chip--on': visibleCategories.has(cat.key) }"
            @click="toggleNotifCategory(cat.key)"
          >{{ cat.label }} <span class="nge-admin-filter-count">{{ categoryCount(cat.key) }}</span></button>
        </div>
      </div>

      <!-- Notifications by lifecycle stage. All three come from ONE paginated
           admin query (send_at DESC), so future-dated rows sort to the top and
           the scheduled queue is always on the first page. Loading every
           notification ever just to render this panel would get slow for no
           benefit, hence "Load more". -->
      <div class="nge-admin-block" v-if="scheduledNotifs.length > 0">
        <label class="nge-admin-label">Scheduled ({{ scheduledNotifs.length }})</label>
        <div v-for="n in scheduledNotifs" :key="n.id" class="nge-admin-notif-row nge-admin-notif-row--queued">
          <div class="nge-admin-notif-info">
            <strong>{{ n.title }}</strong>
            <span class="nge-admin-notif-meta">
              {{ n.target_type }} · sends {{ formatEt(n.send_at) }}
              <span v-if="n.post_to_chat"> · posts to chat</span>
            </span>
          </div>
          <button class="nge-admin-edit-btn" @click="viewNotification(n)" title="See this notification as players see it. Nothing changes.">View</button>
          <button class="nge-admin-edit-btn" @click="startEdit(n)" title="Edit this notification (changes it in place, sends nothing new)">&#9998; Edit</button>
          <button class="nge-admin-delete-btn" @click="requestDelete(n)" title="Cancel this scheduled notification">&times;</button>
        </div>
      </div>

      <div class="nge-admin-block" v-if="activeNotifs.length > 0">
        <label class="nge-admin-label">Active ({{ activeNotifs.length }})</label>
        <div v-for="n in activeNotifs" :key="n.id" class="nge-admin-notif-row nge-admin-notif-row--active">
          <div class="nge-admin-notif-info">
            <strong>{{ n.title }}</strong>
            <span class="nge-admin-notif-meta">
              {{ n.target_type }} · sent {{ formatEt(n.send_at) }}
              <span v-if="n.expires_at"> · stops sending {{ formatEt(n.expires_at) }}</span>
            </span>
          </div>
          <button class="nge-admin-edit-btn" @click="viewNotification(n)" title="See this notification as players see it. Nothing changes.">View</button>
          <button class="nge-admin-edit-btn" @click="startEdit(n)" title="Edit this notification (changes it in place, sends nothing new)">&#9998; Edit</button>
          <button class="nge-admin-delete-btn" @click="requestDelete(n)" title="Delete">&times;</button>
        </div>
      </div>

      <!-- Expired: no edit button. Editing something nobody can see any more
           would just be misleading, so these are read-only apart from delete. -->
      <div class="nge-admin-block" v-if="expiredNotifs.length > 0">
        <label class="nge-admin-label">No longer sending ({{ expiredNotifs.length }})</label>
        <div class="nge-admin-hint">These reach nobody new. Players who already had one still see it; Delete removes it for everyone.</div>
        <div v-for="n in expiredNotifs" :key="n.id" class="nge-admin-notif-row nge-admin-notif-row--expired">
          <div class="nge-admin-notif-info">
            <strong>{{ n.title }}</strong>
            <span class="nge-admin-notif-meta">{{ n.target_type }} · stopped sending {{ formatEt(n.expires_at) }}</span>
          </div>
          <button class="nge-admin-edit-btn" @click="viewNotification(n)" title="See this notification as players see it. Nothing changes.">View</button>
          <button class="nge-admin-delete-btn" @click="requestDelete(n)" title="Delete">&times;</button>
        </div>
      </div>

      <div class="nge-admin-block" v-if="backend.adminNotifHasMore">
        <button class="nge-admin-more-btn" @click="backend.loadAdminNotifications(true)">Load more</button>
      </div>
    </div>

    <!-- ── Groups ── -->
    <div v-if="adminSubTab === 'groups'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">Create Group</label>
        <div class="nge-admin-row">
          <input v-model="newGroupName" class="nge-admin-input" placeholder="Group name (e.g. Scythes)" />
          <input v-model="newGroupColor" type="color" class="nge-admin-color" title="Group color" />
          <button class="nge-admin-action-btn" @click="createGroup" :disabled="!newGroupName.trim()">Create</button>
        </div>
      </div>

      <div class="nge-admin-block">
        <label class="nge-admin-label">Manage Groups</label>
        <div class="nge-admin-group-list">
          <button v-for="g in backend.groups" :key="g.id" class="nge-admin-group-chip" :class="{ 'nge-admin-group-chip--active': selectedGroupId === g.id }" :style="{ borderColor: g.color }" @click="selectGroup(g.id)">
            <span class="nge-admin-group-dot" :style="{ background: g.color }"></span>
            {{ g.name }}
          </button>
        </div>

        <div v-if="selectedGroupId" class="nge-admin-members">
          <div class="nge-admin-row">
            <input v-model="memberSearch" @input="onMemberSearch" class="nge-admin-input" placeholder="Search users to add..." />
          </div>
          <div v-if="memberSearchResults.length > 0" class="nge-admin-search-results">
            <button v-for="u in memberSearchResults" :key="u.id" class="nge-admin-search-item" @click="addMember(u.id)">
              + {{ u.display_name || u.email }}
            </button>
          </div>
          <div class="nge-admin-member-list">
            <div v-for="m in groupMembers" :key="m.user_id" class="nge-admin-member-row">
              <span>{{ m.display_name || m.email || m.user_id }}</span>
              <button class="nge-admin-delete-btn" @click="removeMember(m.user_id)">×</button>
            </div>
            <div v-if="groupMembers.length === 0" class="nge-admin-hint">No members yet.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Special Badges ── -->
    <div v-if="adminSubTab === 'badges'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">Create Special Badge</label>
        <input v-model="badgeName" class="nge-admin-input" placeholder="Badge name" />
        <input v-model="badgeSlug" class="nge-admin-input" placeholder="Code name (optional; made from the name when empty)"
               title="How the game finds this one when it gives it out by itself. The Merger Sandbox award is: merger-sandbox" />
        <textarea v-model="badgeDesc" class="nge-admin-textarea" rows="2" placeholder="Description..."></textarea>
        <label class="nge-admin-file-label">
          <input type="file" accept="image/*" @change="onBadgeImageChange" class="nge-admin-file-input" />
          {{ badgeImageFile ? badgeImageFile.name : 'Choose badge image...' }}
        </label>
        <button class="nge-admin-primary-btn" :disabled="badgeCreating || !badgeName.trim() || !badgeImageFile" @click="createBadge">
          <span v-if="badgeCreated">✓ Created!</span>
          <span v-else-if="badgeCreating">Creating...</span>
          <span v-else>Create Badge</span>
        </button>
        <div v-if="badgeError" class="nge-admin-error">⚠ {{ badgeError }}</div>
      </div>

      <div class="nge-admin-block" v-if="backend.specialBadges.length > 0">
        <label class="nge-admin-label">Award Badge <span class="nge-admin-hint" style="font-weight:normal; margin-left:6px">Click a badge to select it</span></label>

        <div v-if="awardSuccess" class="nge-admin-success">{{ awardSuccess }}</div>

        <!-- The chosen badge and how to award it, above the grid (Ames
             2026-10-27: "if I select one the award input should be added at
             the top"). -->
        <div v-if="awardBadgeId" ref="awardSectionEl" class="nge-admin-award-section">
          <div v-if="awardBadge" class="nge-admin-award-chosen">
            <img v-if="(awardBadge.thumbnail_url || awardBadge.image_url) && !brokenBadgeImg.has(awardBadge.id)" :src="awardBadge.thumbnail_url || awardBadge.image_url" class="nge-admin-badge-img nge-admin-badge-img--sm" @error="onBadgeImgError(awardBadge.id)" />
            <span v-else class="nge-admin-badge-fallback nge-admin-badge-fallback--sm">🏅</span>
            <span class="nge-admin-award-chosen-name">{{ awardBadge.name }}</span>
            <button class="nge-admin-action-btn" @click="awardBadgeId = null">Change</button>
          </div>
          <div class="nge-admin-row">
            <label class="nge-admin-file-label">
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="nge-admin-file-input" :disabled="badgeImageBusy" @change="replaceBadgeImage" />
              {{ badgeImageBusy ? 'Replacing…' : 'Replace this award’s picture...' }}
            </label>
            <span v-if="badgeImageNote" class="nge-admin-note-inline">{{ badgeImageNote }}</span>
          </div>
          <p class="nge-admin-hint">Award to individual user:</p>
          <div class="nge-admin-row">
            <input v-model="awardUserSearch" @input="onAwardUserSearch" class="nge-admin-input" placeholder="Search by name or email..." />
          </div>
          <div v-if="awardUserResults.length > 0" class="nge-admin-search-results">
            <button v-for="u in awardUserResults" :key="u.id" class="nge-admin-search-item" @click="awardToUser(u.id, u.display_name || u.email)">
              Award to {{ u.display_name || u.email }}
            </button>
          </div>

          <p class="nge-admin-hint" style="margin-top:10px">Or award to entire group:</p>
          <div class="nge-admin-row">
            <select v-model="awardGroupId" class="nge-admin-select">
              <option :value="null" disabled>Select group...</option>
              <option v-for="g in backend.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <button class="nge-admin-action-btn" :disabled="!awardGroupId" @click="awardToGroup">Award to Group</button>
          </div>
        </div>

        <div class="nge-admin-row nge-admin-badge-tools">
          <input v-model="badgeFind" class="nge-admin-input" placeholder="Find a badge by name..." />
          <span class="nge-admin-hint">{{ filteredBadges.length }} {{ filteredBadges.length === 1 ? 'badge' : 'badges' }}</span>
        </div>
        <div class="nge-admin-badge-grid">
          <div v-for="b in pagedBadges" :key="b.id"
            class="nge-admin-badge-card" :class="{ 'nge-admin-badge-card--selected': awardBadgeId === b.id }"
            @click="selectBadgeForAward(b.id)" :title="b.description || b.name">
            <img v-if="(b.thumbnail_url || b.image_url) && !brokenBadgeImg.has(b.id)" :src="b.thumbnail_url || b.image_url" class="nge-admin-badge-img" loading="lazy" @error="onBadgeImgError(b.id)" />
            <span v-else class="nge-admin-badge-fallback">🏅</span>
            <div class="nge-admin-badge-name">{{ b.name }}</div>
          </div>
        </div>
        <div v-if="badgePages > 1" class="nge-admin-row nge-admin-badge-pager">
          <button class="nge-admin-action-btn" :disabled="badgePage === 0" @click="badgePage--">‹ Back</button>
          <span class="nge-admin-hint">Page {{ badgePage + 1 }} of {{ badgePages }}</span>
          <button class="nge-admin-action-btn" :disabled="badgePage >= badgePages - 1" @click="badgePage++">Next ›</button>
        </div>
      </div>
    </div>

    <!-- ═══ PRACTICE CELLS (resettable Cut & Merge examples) ═══ -->
    <div v-if="adminSubTab === 'practice'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">Register a practice cell from the current view</label>
        <p class="nge-admin-hint">Open the sandbox view learners should start from. Press "Pick A and B in the viewer", put the crosshair on a spot in the 2D view (the black and white images), hover the cell and press the A key, then do the same for the second spot and press the B key. The crosshair coordinates are what is recorded, and they stay valid after every cut and merge. The view is saved as the start state.</p>
        <div class="nge-admin-row">
          <label class="nge-practice-kind"><input type="radio" value="cut" v-model="practiceKind" /> Cut example: leave the cell fused. A and B are two spots on it, one on each side of where the cut should go</label>
          <label class="nge-practice-kind"><input type="radio" value="merge_then_cut" v-model="practiceKind" /> Merge example: B is wrongly disconnected from A, the learner merges it back</label>
        </div>
        <div class="nge-admin-row">
          <button class="nge-admin-primary-btn" @click="startPicking">Pick A and B in the viewer</button>
          <span class="nge-admin-hint">Hides this panel so you can hover the cell. A small chip stays on screen with the A and B buttons.</span>
        </div>
        <Teleport to="body">
          <div v-if="practicePicking" class="nge-practice-picker">
            <span class="nge-practice-picker-label">Practice cell</span>
            <span class="nge-practice-hover">Hovered: <code>{{ practiceHover ? practiceHover.root : 'move over a segment' }}</code><span v-if="practiceHover && !practiceHover.sv"> (hover it in 2D for the exact spot)</span></span>
            <span class="nge-practice-hover">Put the crosshair on a spot in 2D (right-click there) and press the <b>A</b> key. Move it to the other side of the join and press <b>B</b>. The point and the segment both come from the crosshair.</span>
            <span class="nge-practice-picks">A: <code>{{ pickLabel(practiceA) }}</code> B: <code>{{ pickLabel(practiceB) }}</code></span>
            <button class="nge-admin-primary-btn" @click="stopPicking">Back to Admin Hub</button>
          </div>
        </Teleport>
        <div class="nge-admin-row nge-practice-picks">
          <span>A: <code>{{ pickLabel(practiceA) }}</code></span>
          <span>B: <code>{{ pickLabel(practiceB) }}</code></span>
        </div>
        <div class="nge-admin-row">
          <span class="nge-admin-hint">Or type root ids:</span>
          <input v-model="practiceRootA" class="nge-admin-input nge-admin-input--sm" placeholder="root A" />
          <input v-model="practiceRootB" class="nge-admin-input nge-admin-input--sm" placeholder="root B" />
        </div>
        <div class="nge-admin-row">
          <input v-model="practiceTitle" class="nge-admin-input" placeholder="Title, e.g. Pyramidal cell, missing apical branch" />
          <button class="nge-admin-primary-btn" :disabled="practiceSaving || !practiceA || !practiceB" @click="registerPractice">
            {{ practiceSaving ? 'Saving…' : 'Register' }}
          </button>
        </div>
        <div v-if="practiceError" class="nge-admin-error">⚠ {{ practiceError }}</div>
        <div v-if="practiceNotice" class="nge-admin-success">{{ practiceNotice }}</div>
      </div>

      <div class="nge-admin-block">
        <label class="nge-admin-label">Practice cells <button class="nge-admin-action-btn" style="margin-left:8px" @click="loadPractice">Refresh</button></label>
        <p v-if="practiceLoading" class="nge-admin-hint">Loading…</p>
        <p v-else-if="!practiceRows.length" class="nge-admin-hint">None registered yet. Tutorial 3 tells learners every cell is busy until one exists.</p>
        <div v-for="ex in practiceRows" :key="ex.id" class="nge-practice-row" :class="'nge-practice-row--' + ex.status">
          <div class="nge-practice-main">
            <strong>{{ ex.title }}</strong>
            <span class="nge-practice-status">{{ ex.status }}{{ ex.enabled ? '' : ', disabled' }}</span>
            <span class="nge-admin-hint">{{ ex.kind === 'cut' ? 'cut example' : 'merge example' }}</span>
            <span class="nge-admin-hint">{{ ex.dataset }} · used {{ ex.uses }}×<template v-if="ex.last_reset_at"> · reset {{ practiceWhen(ex.last_reset_at) }}</template><template v-if="ex.claimed_by"> · claimed until {{ practiceWhen(ex.expires_at) }}</template></span>
            <span v-if="ex.last_error" class="nge-admin-warn-inline">{{ ex.last_error }}</span>
          </div>
          <div class="nge-admin-row">
            <button class="nge-admin-action-btn" :disabled="practiceActing === ex.id" @click="checkPractice(ex)">Check</button>
            <button class="nge-admin-action-btn" :disabled="practiceActing === ex.id" @click="resetPracticeNow(ex)">Reset now</button>
            <button class="nge-admin-action-btn" :disabled="practiceActing === ex.id" @click="patchPractice(ex.id, { enabled: !ex.enabled })">{{ ex.enabled ? 'Disable' : 'Enable' }}</button>
            <button class="nge-admin-action-btn" :disabled="practiceActing === ex.id" @click="deletePractice(ex)">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ TRIAGE (agent proposals awaiting human review) ═══ -->
    <div v-if="adminSubTab === 'triage'" class="nge-admin-section">
      <!-- Board view leaves the panel for the whole window. Teleported: the
           profile panel's backdrop filter would otherwise trap a fixed box. -->
      <Teleport to="body" :disabled="!triageBoard || standalone">
      <div class="nge-admin-block" :class="{ 'nge-triage-board': triageBoard, 'nge-triage-light': triageBoard && triageLight }">
        <!-- The admins' own To do board, in place of the reports (Ames 2026-10-19). -->
        <TodoBoard v-if="todoView" :light="triageBoard && triageLight" :focus-id="todoFocus" :report-numbers="triageNumbers"
                   :standalone="standalone" @back="todoView = false; loadTriage()" />
        <template v-else>
        <div class="nge-triage-head">
          <label class="nge-admin-label">Feedback Triage</label>
          <!-- The page on its own has no game around it: a way back, in a new
               tab so the board stays open (Ames 2026-10-12). -->
          <a v-if="standalone" class="nge-admin-action-btn nge-triage-newtab" :href="gameUrl" target="_blank" rel="noopener" title="Opens Pyr in a new tab. This page stays open.">Open Pyr ↗</a>
          <button v-if="!standalone" class="nge-admin-action-btn" @click="triageBoard = !triageBoard"
                  :title="triageBoard ? 'Back to the list in the Admin Hub (Esc)' : 'Fill the window: one column per section'">{{ triageBoard ? '✕ Close board' : '▦ Board view' }}</button>
          <a v-if="!standalone" class="nge-admin-action-btn nge-triage-newtab" :href="boardUrl" target="_blank" rel="noopener" title="Open the triage board on its own page, without the game">↗ New tab</a>
          <button class="nge-admin-action-btn nge-triage-todo-open" @click="openTodoBoard"
                  title="The admins' own planning board: To do, Doing, Done"><span v-html="TODO_ICON"></span>To do board</button>
          <div class="nge-triage-score" :class="{ 'nge-triage-score--lit': !!triageCheer }">
            <!-- Level: one for every 25 reports closed. The ring fills toward the next. -->
            <div class="nge-hud-level" :class="{ 'nge-hud-level--up': triageCheer?.levelUp }"
                 :title="`${triageScore.total} closed in all. ${triageScore.toGo} to go to level ${triageGame.level + 1}.`">
              <div class="nge-hud-ring" :style="{ '--fill': triageScore.fill + '%' }">
                <div class="nge-hud-ring-in">
                  <span class="nge-hud-ring-word">LEVEL</span>
                  <b>{{ triageGame.level }}</b>
                </div>
              </div>
              <div class="nge-hud-level-text">
                <div class="nge-hud-rank">{{ triageGame.rank }}</div>
                <div class="nge-triage-score-bar"><span :style="{ width: triageScore.fill + '%' }"></span></div>
                <div class="nge-triage-score-goal-text"><b>{{ triageScore.toGo }}</b> to go to level {{ triageGame.level + 1 }}</div>
              </div>
            </div>
            <div class="nge-triage-score-item nge-triage-score-item--bug" :class="{ 'nge-triage-score-item--pop': triageCheer?.kind === 'bug' }">
              <span class="nge-triage-score-icon" aria-hidden="true">🐛</span>
              <b><RollUp :value="triageTally.bugs" /></b>
              <span class="nge-triage-score-word">{{ triageTally.bugs === 1 ? 'bug' : 'bugs' }} fixed</span>
            </div>
            <div class="nge-triage-score-item nge-triage-score-item--feature" :class="{ 'nge-triage-score-item--pop': triageCheer?.kind === 'feature' }">
              <span class="nge-triage-score-icon" aria-hidden="true">✨</span>
              <b><RollUp :value="triageTally.features" /></b>
              <span class="nge-triage-score-word">{{ triageTally.features === 1 ? 'feature' : 'features' }} shipped</span>
            </div>
            <div class="nge-triage-score-item nge-triage-score-item--other" :class="{ 'nge-triage-score-item--pop': triageCheer?.kind === 'other' }"
                 title="Closed reports filed as Other, and any that were not a bug or an idea">
              <span class="nge-triage-score-icon" aria-hidden="true">💬</span>
              <b><RollUp :value="triageTally.other" /></b>
              <span class="nge-triage-score-word">answered</span>
            </div>
            <div class="nge-triage-score-item nge-triage-score-item--today"
                 :class="{ 'nge-triage-score-item--pop': !!triageCheer, 'nge-triage-score-item--record': triageGame.record }"
                 :title="triageGame.best ? `Best day so far: ${triageGame.best} closed` : undefined">
              <span class="nge-triage-score-icon" aria-hidden="true">{{ triageGame.record ? '🏆' : triageTally.today ? '🔥' : '☕' }}</span>
              <b><RollUp :value="triageTally.today" /></b>
              <span class="nge-triage-score-word">{{ triageGame.record ? 'today, a new best' : 'closed today' }}</span>
            </div>
            <div class="nge-triage-score-item nge-triage-score-item--streak" :class="{ 'nge-triage-score-item--cold': !triageGame.streak }"
                 :title="triageGame.streak ? (triageGame.streakAtRisk ? 'Close one today to keep the streak going' : 'Days in a row with a report closed') : 'Close one today to start a streak'">
              <span class="nge-triage-score-icon" aria-hidden="true">{{ triageGame.streak ? '⚡' : '💤' }}</span>
              <b><RollUp :value="triageGame.streak" /></b>
              <span class="nge-triage-score-word">{{ triageGame.streak === 1 ? 'day' : 'days' }} in a row</span>
            </div>
            <div class="nge-triage-score-item nge-triage-score-item--inbox" :class="{ 'nge-triage-score-item--zero': !triageGame.waiting }"
                 title="Reports waiting for your decision">
              <span class="nge-triage-score-icon" aria-hidden="true">{{ triageGame.waiting ? '📥' : '🎉' }}</span>
              <template v-if="triageGame.waiting">
                <b><RollUp :value="triageGame.waiting" /></b>
                <span class="nge-triage-score-word">waiting for you</span>
              </template>
              <span v-else class="nge-triage-score-word nge-triage-score-word--big">Triage zero</span>
            </div>
            <!-- Today's Nurro: a different one each day (Ames 2026-10-10). -->
            <div class="nge-hud-nurro" aria-hidden="true"><img :src="todaysNurro" alt="" /></div>
            <!-- The last 14 days, one bar a day. -->
            <div class="nge-hud-spark" title="Reports closed on each of the last 14 days">
              <div class="nge-hud-spark-bars">
                <span v-for="d in triageGame.spark" :key="d.key" class="nge-hud-spark-bar"
                      :class="{ 'nge-hud-spark-bar--today': d.today, 'nge-hud-spark-bar--none': !d.n }"
                      :style="{ height: d.h + '%' }" :title="`${d.label}: ${d.n} closed`"></span>
              </div>
              <div class="nge-hud-spark-word">last 14 days</div>
            </div>
            <div v-if="repoStats" class="nge-hud-repo" title="Your commits on the live branch, and how many times it has gone live">
              <div><b><RollUp :value="repoStats.commits" /></b><span>commits</span></div>
              <div><b><RollUp :value="repoStats.deploys" /></b><span>deploys</span></div>
            </div>
          </div>
          <input v-model="triageSearch" class="nge-triage-search" type="search" placeholder="Search reports, or #number"
                 aria-label="Search reports" @keydown.stop @keyup.stop @keypress.stop @keydown.esc.stop="triageSearch = ''" />
          <span v-if="triageWords.length" class="nge-triage-search-count">{{ triageMatchCount }} of {{ triageRows.length }}</span>
          <span class="nge-triage-kinds" role="radiogroup" aria-label="Show">
            <button v-for="k in TRIAGE_KINDS" :key="k.key" type="button" role="radio" class="nge-triage-kind" title="Open reports of this kind. The board shows only these."
                    :class="{ 'nge-triage-kind--on': triageKind === k.key }" :aria-checked="triageKind === k.key ? 'true' : 'false'"
                    @click="triageKind = k.key">{{ k.label }} <span class="nge-triage-kind-n">{{ triageKindCount[k.key] }}</span></button>
          </span>
          <button v-if="triageBoard" class="nge-admin-action-btn" :aria-pressed="triageLight ? 'true' : 'false'"
                  :title="triageLight ? 'Switch to the dark page' : 'Switch to a light page, easier for reading a lot of text'"
                  @click="toggleTriageLight">{{ triageLight ? '☾ Dark' : '☀ Light' }}</button>
          <label class="nge-triage-toggle">
            <input type="checkbox" v-model="triageShowReviewed" />
            <span>Show older</span>
          </label>
          <button class="nge-admin-action-btn" @click="loadTriage" :disabled="triageLoading">↻ Refresh</button>
        </div>
        <div class="nge-admin-hint nge-triage-howto">
          The triage agent reads every incoming report and proposes an action.
          Nothing happens until you approve it, here or in Slack; both show the
          same list. Approving "Send a message" delivers the text to the
          reporter. Approving a fix sends it to Claude, who posts a preview in
          the Slack thread for you to test before anything goes live.
        </div>
        <div v-if="zeroParty" :key="zeroParty" class="nge-zero-party" role="status" @click="zeroParty = 0">
            <i v-for="(c, i) in ZERO_BITS" :key="i" class="nge-zero-bit" :class="{ 'nge-zero-bit--wide': c.wide }"
               :style="{ left: c.left + '%', background: c.color, animationDelay: c.delay + 's', animationDuration: c.dur + 's', '--r': c.rot + 'deg' }"></i>
            <div class="nge-zero-card">
              <img :src="nurroConfetti" alt="" />
              <div class="nge-zero-title">Triage zero!</div>
              <div class="nge-zero-sub">Every report handled. Nurro is so proud of you.</div>
            </div>
          </div>
        <Transition name="nge-triage-cheer">
          <div v-if="triageCheer" :key="triageCheer.key" class="nge-triage-cheer" :class="`nge-triage-cheer--${triageCheer.kind}`" role="status">
            <span class="nge-triage-cheer-ring" aria-hidden="true"></span>
            <span class="nge-triage-cheer-check" aria-hidden="true">✓</span>
            <span class="nge-triage-cheer-text">{{ triageCheer.text }}</span>
          </div>
        </Transition>
        <div v-if="triageError" class="nge-admin-error">⚠ {{ triageError }}</div>
        <div v-if="dupNotice" class="nge-admin-ok">✓ {{ dupNotice }}</div>
        <div v-if="triageLoading && !triageRows.length" class="nge-admin-hint">Loading…</div>
        <div v-else-if="!triageRows.length" class="nge-admin-hint">
          No proposals waiting. The agent runs on a schedule; new feedback shows up here after its next pass.
        </div>

        <div class="nge-triage-cols" :style="triageBoard ? { gridTemplateColumns: boardColumns } : undefined">
        <div v-for="g in triageGroups" :key="g.key" class="nge-triage-col"
             :class="[`nge-triage-col--${g.key}`, { 'nge-triage-col--folded': triageBoard && isFolded(g.key) }]">
        <button
          v-if="triageRows.length"
          class="nge-triage-group"
          :class="{ 'nge-triage-group--open': triageOpen[g.key], 'nge-triage-group--empty': !g.rows.length }"
          :aria-expanded="(triageBoard ? !isFolded(g.key) : triageOpen[g.key]) ? 'true' : 'false'"
          :title="triageBoard ? (isFolded(g.key) ? `Open ${g.title}` : `Fold ${g.title} away`) : undefined"
          @click="triageBoard ? toggleFold(g.key) : (triageOpen[g.key] = !triageOpen[g.key])"
        >
          <span class="nge-triage-group-caret" aria-hidden="true">▸</span>
          <span class="nge-triage-group-icon" aria-hidden="true">{{ g.icon }}</span>
          <span class="nge-triage-group-title">{{ g.title }}</span>
          <span class="nge-triage-group-count">{{ g.rows.length }}</span>
          <span class="nge-triage-group-hint">{{ g.hint }}</span>
        </button>
        <template v-if="triageBoard ? !isFolded(g.key) : triageOpen[g.key]">
        <div v-for="row in g.rows" :key="row.id" class="nge-triage-card" :data-triage-id="row.id"
             :class="[`nge-triage-card--${row.recommendation}`, { 'nge-triage-card--closed': g.closed, 'nge-triage-card--selected': triageSelected === row.id, 'nge-triage-card--reply': hasNewReply(row), 'nge-triage-card--waiting': isAwaitingReply(row) }]"
             @click="triageSelected = row.id">
          <div class="nge-triage-meta">
            <span v-if="triageNumbers[row.id]" class="nge-triage-num" :title="'Report number ' + triageNumbers[row.id]">#{{ triageNumbers[row.id] }}</span>
            <span v-if="dupOf(row)" class="nge-triage-dup-badge" :title="'Grouped into report #' + (triageNumbers[dupOf(row) || ''] || '')">Same as #{{ triageNumbers[dupOf(row) || ''] || '?' }}</span>
            <span v-if="dupsOf(row).length" class="nge-triage-dup-badge nge-triage-dup-badge--main"
                  :title="'Also reported by ' + dupsOf(row).map(d => (reporterOf(d)?.name || 'someone') + ' (#' + (triageNumbers[d.id] || '?') + ')').join(', ')">+{{ dupsOf(row).length }} same</span>
            <span v-if="hasNewReply(row)" class="nge-triage-rec nge-triage-rec--reply" title="The submitter answered your question. Their reply is under Sent to submitter on this card.">💬 New reply</span>
            <span v-if="row.admin_notes?.length" class="nge-triage-impl nge-triage-notes-chip" :title="`${row.admin_notes.length} note${row.admin_notes.length === 1 ? '' : 's'} from admins`">📝 {{ row.admin_notes.length }}</span>
            <span v-if="isAwaitingReply(row)" class="nge-triage-rec nge-triage-rec--waiting"
                  :title="'You asked the submitter for a reply' + (awaitingReplySince(row) ? ' ' + ago(awaitingReplySince(row) || '') + ' ago' : '') + ' and it has not come yet. It comes back under Needs your decision when it does.'">⏳ Waiting on their reply<template v-if="awaitingReplySince(row)"> · {{ ago(awaitingReplySince(row) || '') }}</template></span>
            <span class="nge-triage-rec" :class="isNewReport(row) ? 'nge-triage-rec--new' : `nge-triage-rec--${row.recommendation}`">{{ isNewReport(row) ? 'New report' : hadNoSuggestion(row) ? 'No suggestion' : TRIAGE_LABELS[row.recommendation] }}</span>
            <span class="nge-triage-src">{{ row.source.replace('_', ' ') }}</span>
            <span v-if="row.status !== 'proposed'" class="nge-triage-status">{{ row.status }}<template v-if="row.reviewed_by"> · {{ row.reviewed_by.startsWith('slack:') ? 'in Slack' : row.reviewed_by }}</template></span>
            <span v-if="isByHand(row)" class="nge-triage-impl" title="Marked in progress by hand. The robot is not building this.">by hand</span>
            <span v-if="row.impl_state" class="nge-triage-impl" :class="`nge-triage-impl--${row.impl_state}`">{{ IMPL_LABELS[row.impl_state] }}</span>
            <a v-if="slackThreadUrl(row)" class="nge-triage-link" :href="slackThreadUrl(row) || undefined" target="_blank" rel="noopener">Slack thread</a>
          </div>
          <div v-if="reporterOf(row)" class="nge-triage-from">
            <span class="nge-triage-avatar" aria-hidden="true" :style="{ '--hue': avatarHue(reporterOf(row)?.name || '') }">{{ (reporterOf(row)?.name || '?').slice(0, 1).toUpperCase() }}</span>
            <span class="nge-triage-from-word">From </span><strong>{{ reporterOf(row)?.name }}</strong><template v-if="reporterOf(row)?.category"> · {{ reporterOf(row)?.category }}</template><template v-if="reporterOf(row)?.at"> · <span class="nge-triage-when" :title="shortDate(reporterOf(row)?.at || '')">{{ shortDate(reporterOf(row)?.at || '') }}</span><span class="nge-triage-ago" :title="shortDate(reporterOf(row)?.at || '')">{{ ago(reporterOf(row)?.at || '') }}</span></template>
          </div>
          <div v-if="reporterOf(row)?.title" class="nge-triage-title">{{ reporterOf(row)?.title }}</div>
          <!-- A one line report is all title: say it once. -->
          <div v-if="fullTextOf(row) && fullTextOf(row) !== reporterOf(row)?.title" class="nge-triage-excerpt">"<template v-for="(pt, pi) in linkParts(fullTextOf(row))" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template>"</div>
          <div v-if="row.source === 'site_issue'" class="nge-triage-console">
            <a v-if="reporterOf(row)?.url" class="nge-triage-console-btn nge-triage-view-btn" :href="reporterOf(row)?.url" target="_blank" rel="noopener noreferrer" @click.stop
               title="The view they were in when they sent the report">↗ Open their view</a>
            <a v-if="reporterOf(row)?.shot" class="nge-triage-console-btn nge-triage-view-btn" :href="reporterOf(row)?.shot" target="_blank" rel="noopener noreferrer" @click.stop
               title="The screenshot they attached">🖼 Screenshot</a>
            <button class="nge-triage-console-btn" @click="toggleIssueConsole(row)">
              {{ issueConsole[row.id] === undefined ? '🖥 Console messages' : issueConsoleOpen[row.id] ? '▾ Console messages' : '▸ Console messages' }}
            </button>
            <!-- Copy the whole log (Ames 2026-10-21: "we need a copy button for console logs"). -->
            <button v-if="issueConsoleOpen[row.id] && issueConsole[row.id]" class="nge-triage-console-btn" title="Copy all the console messages"
                    @click.stop="copyText(issueConsole[row.id] || '')">{{ copied === issueConsole[row.id] ? '✓ Copied' : '📋 Copy' }}</button>
            <div v-if="issueConsoleOpen[row.id]" class="nge-triage-console-wrap">
              <!-- Also on the log itself, where the eye is (Ames 2026-10-23: "I need a copy console logs button"). -->
              <button v-if="issueConsole[row.id]" class="nge-triage-console-copy" title="Copy all the console messages"
                      @click.stop="copyText(issueConsole[row.id] || '')">{{ copied === issueConsole[row.id] ? '✓ Copied' : '📋 Copy logs' }}</button>
              <pre class="nge-triage-console-log">{{ issueConsole[row.id] || 'No console messages were attached to this report.' }}</pre>
            </div>
          </div>
          <div v-if="isNewReport(row)" class="nge-triage-rationale">{{ suggestAsked(row) ? 'Claude is reading the code. A suggested fix will appear on this card in a few minutes; press Refresh.' : 'No suggestion has been asked for. Fix it by hand, or ask Claude to suggest a fix (one Claude run).' }}</div>
          <div v-else-if="row.rationale && !hadNoSuggestion(row)" class="nge-triage-rationale"><template v-for="(pt, pi) in linkParts(row.rationale)" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template></div>
          <textarea
            v-if="row.recommendation === 'message' && row.status === 'proposed'"
            v-model="triageEdits[row.id]"
            class="nge-triage-message"
            rows="3"
            @keydown.stop @keyup.stop @keypress.stop
          ></textarea>
          <div v-else-if="row.proposed_message" class="nge-triage-rationale">💬 <template v-for="(pt, pi) in linkParts(row.proposed_message)" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template></div>
          <div v-if="row.spec" class="nge-triage-spec">
            <div v-for="(line, i) in parseSpec(row.spec)" :key="i" class="nge-triage-spec-row">
              <span v-if="line.label" class="nge-triage-spec-label">{{ line.label }}</span>
              <span class="nge-triage-spec-text">{{ line.text }}</span>
            </div>
          </div>
          <div v-if="row.approver_note" class="nge-triage-note">
            <span class="nge-triage-spec-label">Comment</span>
            <span class="nge-triage-spec-text"><template v-for="(pt, pi) in linkParts(row.approver_note)" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template></span>
          </div>
          <div v-if="row.impl_state" class="nge-triage-loop">
            <div v-if="row.impl_summary"><span class="nge-triage-spec-label">Change</span> {{ row.impl_summary }}</div>
            <div v-if="row.preview_url"><span class="nge-triage-spec-label">Preview</span> <a :href="row.preview_url" target="_blank" rel="noopener">{{ row.preview_url }}</a></div>
            <div v-if="row.impl_state === 'testing' || row.impl_state === 'live_testing' || row.impl_state === 'needs_info'"><span class="nge-triage-spec-label">Waiting on</span> the tester in the Slack thread{{ row.impl_state === 'needs_info' ? ', to answer Claude' : '' }}. Reminded {{ row.nag_count || 0 }} time{{ row.nag_count === 1 ? '' : 's' }}.</div>
            <div v-for="f in (row.feedback_log || []).slice(-3)" :key="f.ts"><span class="nge-triage-spec-label">{{ roleLabel(f.role) }}</span> <template v-for="(pt, pi) in linkParts(f.text)" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template></div>
            <div v-if="row.impl_run_url"><a :href="row.impl_run_url" target="_blank" rel="noopener">Claude's run log</a><template v-if="row.impl_attempts"> · attempt {{ row.impl_attempts }}</template></div>
          </div>
          <!-- Notes from admins, with no decision (Celia #178). -->
          <div class="nge-triage-notes" @click.stop>
            <div v-for="(n, i) in row.admin_notes || []" :key="i" class="nge-triage-note nge-triage-admin-note">
              <span class="nge-triage-spec-label">Note</span>
              <span class="nge-triage-spec-text"><template v-for="(pt, pi) in linkParts(n.text)" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer">{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template><span class="nge-triage-reporter-by"> · {{ n.by }}, {{ relTime(n.at) }}</span></span>
            </div>
            <template v-if="noteOpen[row.id]">
              <textarea v-model="noteDrafts[row.id]" class="nge-triage-message nge-triage-comment" rows="2" maxlength="2000"
                        placeholder="A note for the admins. Nothing else changes. Type @Celia to tag her."
                        @keydown.stop @keyup.stop @keypress.stop></textarea>
              <div class="nge-triage-actions">
                <button class="nge-admin-primary-btn" :disabled="noteSaving === row.id || !noteDrafts[row.id]?.trim()" @click="saveNote(row)">{{ noteSaving === row.id ? 'Saving…' : 'Save note' }}</button>
                <button class="nge-admin-action-btn" :disabled="noteSaving === row.id" @click="noteOpen[row.id] = false">Cancel</button>
              </div>
            </template>
            <button v-else class="nge-admin-action-btn nge-triage-note-btn" title="Leave a note for the admins. Nothing else on the card changes, nothing is sent to the submitter, and the robot ignores it."
                    @click="noteOpen[row.id] = true">📝 Add a note</button>
          </div>
          <!-- Reviewer comment, saved with Approve or Dismiss. Internal: it is
               never sent to the reporter (the message box above is). -->
          <textarea
            v-if="row.status === 'proposed'"
            v-model="triageNotes[row.id]"
            class="nge-triage-message nge-triage-comment"
            rows="2"
            placeholder="Comment (optional), saved with your decision"
            @keydown.stop @keyup.stop @keypress.stop
          ></textarea>
          <!-- The decision first (Ames 2026-10-05), then the other tools. -->
          <div v-if="row.status === 'proposed'" class="nge-triage-actions">
            <button v-if="isNewReport(row)" class="nge-admin-primary-btn" :disabled="triageActing === row.id || suggestAsked(row)"
                    title="Asks Claude to read the code and suggest a fix for this report. One Claude run, 20 to 60 cents."
                    @click="askForSuggestion(row)">{{ suggestAsked(row) ? 'Suggestion on its way…' : '✨ Suggest a fix' }}</button>
            <button v-else class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'approved')">
              {{ (row.recommendation === 'message' ? 'Approve + Send' : 'Approve') + (triageNotes[row.id]?.trim() ? ' with comment' : '') }}
            </button>
            <button class="nge-admin-action-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'dismissed')">
              {{ triageNotes[row.id]?.trim() ? 'Dismiss with comment' : 'Dismiss' }}
            </button>
          </div>
          <div v-else-if="row.status === 'approved'" class="nge-triage-actions">
            <button v-if="isBuildable(row) && !row.impl_state && !isTodo(row)" class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setImplState(row, 'queued')">Have Claude build it</button>
            <button v-if="row.impl_state === 'failed' && !releaseBuildOf(row)" class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setImplState(row, 'queued')">Retry build</button>
          </div>
          <div class="nge-triage-claude">
            <button class="nge-admin-action-btn" @click="openInClaude(row)" title="Copies a full briefing and opens a new Claude chat with it. Paste the briefing into Claude Code to change the code.">Work on it with Claude</button>
            <!-- Done, on every card that is not already done (Ames 2026-10-01:
                 "a lot of the time I fix in Claude"), whatever state it is in:
                 waiting for a decision, in progress, or dismissed. -->
            <button v-if="row.status === 'proposed' || isLater(row) || isTodo(row)" class="nge-admin-action-btn" :disabled="triageActing === row.id"
                    title="You are fixing this yourself, for example in a Claude chat. Moves the card to In progress. The robot does not build it and nothing is sent to the reporter."
                    @click="markInProgress(row)">▶ In progress</button>
            <button v-if="row.status === 'proposed' || isByHand(row) || isLater(row)" class="nge-admin-action-btn" :disabled="triageActing === row.id"
                    title="A bigger job to plan. Puts a card for it on the To do board and moves this report under On the To do board. The robot does not build it and nothing is sent to the reporter."
                    @click="sendToTodoBoard(row)"><span v-html="TODO_ICON"></span>To do</button>
            <button v-if="row.status === 'proposed' || isByHand(row) || isTodo(row)" class="nge-admin-action-btn" :disabled="triageActing === row.id"
                    title="A good idea, but not now. Moves the card to Ideas for later. The robot does not build it and nothing is sent to the reporter."
                    @click="markInProgress(row, true)">💡 Later</button>
            <button v-if="triageGroupOf(row) !== 'done'" class="nge-admin-action-btn nge-triage-done-btn" :disabled="triageActing === row.id"
                    title="It is fixed or handled. Moves this card to Done and posts the update in its Slack thread."
                    @click="setTriageStatus(row, 'done')">✓ Done</button>
            <!-- Dismiss at any stage after approval too (a failed or unwanted
                 build), and Discard for junk (Ames 2026-10-05). -->
            <button v-if="row.status === 'approved'" class="nge-admin-action-btn" :disabled="triageActing === row.id || isGoingLive(row)"
                    :title="isGoingLive(row) ? 'It is on, or on its way to, the live site. Revert it in the Slack thread first.' : 'It was built another way, so the robot is not needed. Stops its work, cancels any build in progress and moves the card to Dismissed.'"
                    @click="setTriageStatus(row, 'dismissed', false, true)">Dismiss: built independently</button>
            <button v-if="triageGroupOf(row) !== 'done' && !isDiscarded(row)" class="nge-admin-action-btn nge-triage-discard-btn" :disabled="triageActing === row.id || isGoingLive(row)"
                    title="Junk, a duplicate or a test: dismiss it and take it off the board. Still findable with Show older."
                    @click="setTriageStatus(row, 'dismissed', true)">🗑 Discard</button>
            <button v-if="row.status === 'dismissed'" class="nge-admin-action-btn" :disabled="triageActing === row.id"
                    title="Undo the dismiss: the report goes back under Needs your decision, with its history kept."
                    @click="undismiss(row)">↩ Back to the board</button>
            <span v-if="claudeCopied === row.id" class="nge-triage-copied">Briefing copied. Paste it into Claude Code to change the code.</span>
          </div>
          <!-- Going live is approved in Slack only: the deploy checks the
               tester's exact reply there before it touches the live site. -->
          <div v-if="row.status === 'approved' && releaseBuildOf(row)" class="nge-triage-release">
            <div class="nge-triage-release-why">Tested it? Put this exact build live from here:</div>
            <div class="nge-triage-actions">
              <button class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="releaseFromHub(row, 'final')"
                      title="Deploys this build to the live community site. The same as replying good with the build ID in Slack.">🚀 Deploy to the live site</button>
              <button class="nge-admin-action-btn" :disabled="triageActing === row.id" @click="releaseFromHub(row, 'live_test')"
                      title="Puts it on the live site as a test, for things only the live site can show. Keep or revert it in the Slack thread.">Live test</button>
            </div>
            <div class="nge-triage-release-why">Or reply in its Slack thread with:</div>
            <div class="nge-triage-release-row">
              <code>good {{ releaseBuildOf(row) }}</code>
              <button type="button" class="nge-admin-action-btn" @click="copyText('good ' + releaseBuildOf(row))">{{ copied === 'good ' + releaseBuildOf(row) ? 'Copied' : 'Copy' }}</button>
            </div>
            <div class="nge-triage-release-row">
              <code>ship to test {{ releaseBuildOf(row) }}</code>
              <button type="button" class="nge-admin-action-btn" @click="copyText('ship to test ' + releaseBuildOf(row))">{{ copied === 'ship to test ' + releaseBuildOf(row) ? 'Copied' : 'Copy' }}</button>
            </div>
          </div>

          <!-- Optional note to the person who filed the report. Drafted from
               the card's state; edit, send, or close it and nothing is sent.
               Slack threads get the same thing via "update reporter". -->
          <!-- A beta access request is granted right here (Ames 2026-10-26:
               "so admin could grant them access from here?"). -->
          <div v-if="betaEmailOfCard(row) && triageGroupOf(row) !== 'done'" class="nge-triage-beta">
            <button class="nge-admin-action-btn nge-triage-done-btn" :disabled="triageActing === row.id || cardLetInBusy === row.id"
                    :title="'Adds ' + betaEmailOfCard(row) + ' to Pilot testers, then moves this card to Done.'"
                    @click="letInFromCard(row)">{{ cardLetInBusy === row.id ? 'Adding…' : '🔑 Let them in' }}</button>
            <span class="nge-triage-beta-email">{{ betaEmailOfCard(row) }}</span>
            <button v-if="!props.standalone" class="nge-triage-link nge-triage-beta-open" type="button" @click="adminSubTab = 'pilot'">Open Beta requests</button>
          </div>
          <p v-if="cardLetInError[row.id]" class="nge-triage-beta-error" role="alert">{{ cardLetInError[row.id] }}</p>
          <div v-if="row.source === 'site_issue'" class="nge-triage-reporter">
            <!-- The thread, oldest first: what was sent, and any reply asked for. -->
            <div v-for="u in reporterThreadFor(row)" :key="u.role + u.ts" class="nge-triage-note"
                 :class="{ 'nge-triage-note--reply': u.reply, 'nge-triage-note--unread': u.reply && u.seen === false }">
              <span class="nge-triage-spec-label">{{ u.reply ? 'Submitter replied' : 'Sent to submitter' }}</span>
              <div v-if="!u.reply" class="nge-triage-spec-text nge-triage-thread-md"><div class="nge-admin-fmtpreview-body" v-html="renderSafeMarkdown(u.text, true)"></div><a v-if="u.image_url" :href="u.image_url" target="_blank" rel="noopener" class="nge-triage-reply-shot" title="Open the image you sent"><img :src="u.image_url" alt="Image sent with this reply" loading="lazy" /></a><span v-else-if="u.image_removed" class="nge-triage-reporter-by">Image removed after 7 days. </span><span class="nge-triage-reporter-by">{{ u.by || (u.reply ? 'the submitter' : 'Slack') }}{{ u.at ? ', ' + relTime(u.at) : '' }}{{ u.ask ? (u.waiting ? ' · asked for a reply, none yet' : ' · asked for a reply') : '' }}{{ u.reply && u.seen === false ? ' · new' : '' }}</span></div>
              <span v-else class="nge-triage-spec-text nge-triage-thread-text"><template v-for="(pt, pi) in linkParts(u.text)" :key="pi"><a v-if="pt.href" class="nge-triage-link" :href="pt.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ pt.t }}</a><template v-else>{{ pt.t }}</template></template><span class="nge-triage-reporter-by"> · {{ u.by || (u.reply ? 'the submitter' : 'Slack') }}{{ u.at ? ', ' + relTime(u.at) : '' }}{{ u.ask ? (u.waiting ? ' · asked for a reply, none yet' : ' · asked for a reply') : '' }}{{ u.reply && u.seen === false ? ' · new' : '' }}</span></span>
              <!-- What came with a reply: a screenshot, their view, console messages. -->
              <div v-if="u.reply && (u.screenshot_url || u.view_url || u.console_lines || u.dataset)" class="nge-triage-reply-parts">
                <a v-if="u.screenshot_url" :href="u.screenshot_url" target="_blank" rel="noopener" class="nge-triage-reply-shot" title="Open the full screenshot">
                  <img :src="u.screenshot_url" alt="Screenshot sent with the reply" loading="lazy" />
                </a>
                <div class="nge-triage-reply-chips">
                  <a v-if="u.view_url" :href="u.view_url" target="_blank" rel="noopener" class="nge-triage-chip">↗ Open their view</a>
                  <button v-if="u.console_lines" type="button" class="nge-triage-chip" @click="toggleReplyConsole(u.notification_id)">
                    {{ replyConsoleOpen[u.notification_id] ? '▾' : '▸' }} Console messages ({{ u.console_lines }})
                  </button>
                  <button v-if="u.console_lines && replyConsoleOpen[u.notification_id] && replyConsole[u.notification_id]" type="button" class="nge-triage-chip" title="Copy all the console messages"
                          @click="copyText(replyConsole[u.notification_id] || '')">{{ copied === replyConsole[u.notification_id] ? '✓ Copied' : '📋 Copy' }}</button>
                  <span v-if="u.dataset" class="nge-triage-chip nge-triage-chip--plain">{{ u.dataset }}{{ u.build ? ' · ' + u.build : '' }}</span>
                </div>
                <pre v-if="u.console_lines && replyConsoleOpen[u.notification_id]" class="nge-triage-reply-console">{{ replyConsole[u.notification_id] === undefined ? 'Loading…' : (replyConsole[u.notification_id] ?? 'These messages are no longer stored.') }}</pre>
              </div>
            </div>
            <button v-if="hasNewReply(row)" class="nge-admin-action-btn nge-triage-reporter-open" :disabled="triageActing === row.id"
                    title="Takes the New reply marker off. The card goes back to where it was; nothing else about it changes."
                    @click="markRepliesSeen(row)">✓ Reply read</button>
            <template v-if="reporterDrafts[row.id] !== undefined">
              <!-- Lists and bold, as the player will see them (Ames 2026-10-16).
                   The text is Markdown; the feed draws it through
                   renderSafeMarkdown, never as raw HTML. -->
              <div class="nge-admin-fmtbar nge-triage-fmtbar" role="toolbar" aria-label="Formatting">
                <button type="button" title="Bold" @click="fmtWrap('**', 'bold text', reporterComposer(row))"><b>B</b></button>
                <button type="button" title="Bulleted list: each selected line becomes a bullet" @click="fmtLines('- ', 'List item', reporterComposer(row))">• Bullets</button>
                <button type="button" title="Numbered list: each selected line gets 1, 2, 3" @click="fmtLines(i => `${i + 1}. `, 'List item', reporterComposer(row))">1. Numbers</button>
                <button type="button" title="Add an image or screenshot. You can also paste or drop one into the box. It is deleted after 7 days." @click="replyFileEls[row.id]?.click()">🖼 Image</button>
                <input :ref="el => setReplyFileEl(row, el)" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
                       @change="onReplyFile($event, row)" />
                <span class="nge-admin-fmthint">Or start lines with "- " or "1. ". Pasted lists keep their numbers.</span>
                <button type="button" class="nge-triage-preview-toggle" :aria-pressed="replyPreviewOpen[row.id] ? 'true' : 'false'"
                        title="Show the message as the player will see it" @click="replyPreviewOpen[row.id] = !replyPreviewOpen[row.id]">{{ replyPreviewOpen[row.id] ? 'Hide preview' : 'Preview' }}</button>
              </div>
              <textarea
                :ref="el => { reporterEls[row.id] = el; }"
                v-model="reporterDrafts[row.id]"
                class="nge-triage-message nge-triage-comment"
                rows="6"
                @paste="onReplyPaste($event, row)"
                @dragover.prevent @drop.prevent="onReplyDrop($event, row)"
                @keydown.stop @keyup.stop @keypress.stop
              ></textarea>
              <div v-if="replyImages[row.id]" class="nge-triage-reply-attach">
                <img v-if="replyImages[row.id].preview" :src="replyImages[row.id].preview" alt="The image going with this reply" />
                <span class="nge-triage-reply-attach-state">{{ replyImages[row.id].error || (replyImages[row.id].uploading ? 'Uploading…' : 'Goes with this reply. Deleted after 7 days.') }}</span>
                <button type="button" class="nge-admin-action-btn" title="Remove the image" @click="dropReplyImage(row)">✕</button>
              </div>
              <!-- Only when asked for (Ames 2026-10-16: "I keep accidentally clicking there"). -->
              <div v-if="replyPreviewOpen[row.id] && reporterDrafts[row.id]?.trim()" class="nge-admin-fmtpreview nge-triage-fmtpreview">
                <div class="nge-admin-fmtpreview-label">What they will see</div>
                <div class="nge-admin-fmtpreview-body" v-html="renderSafeMarkdown(reporterDrafts[row.id], true)"></div>
              </div>
              <!-- Off / On, as a two way switch in the board's own style (Ames
                   2026-10-13: "the black check box is weird"). The lit side
                   is how it is now. -->
              <div class="nge-triage-ask" title="They get a reply form under your message: text, and if they like a screenshot, their view and their console messages. One reply per message. To hear more, ask again.">
                <span :id="'nge-triage-ask-' + row.id" class="nge-triage-ask-label">Ask for a reply</span>
                <div class="nge-triage-switch" role="radiogroup" :aria-labelledby="'nge-triage-ask-' + row.id" :data-on="reporterAsk[row.id] ? 'on' : 'off'">
                  <button type="button" role="radio" class="nge-triage-switch-opt" :aria-checked="reporterAsk[row.id] ? 'false' : 'true'" :tabindex="reporterAsk[row.id] ? -1 : 0"
                          :disabled="reporterSending === row.id" @click="reporterAsk[row.id] = false"
                          @keydown.right.prevent.stop="reporterAsk[row.id] = true" @keydown.left.prevent.stop="reporterAsk[row.id] = false">Off</button>
                  <button type="button" role="radio" class="nge-triage-switch-opt nge-triage-switch-opt--on" :aria-checked="reporterAsk[row.id] ? 'true' : 'false'" :tabindex="reporterAsk[row.id] ? 0 : -1"
                          :disabled="reporterSending === row.id" @click="reporterAsk[row.id] = true"
                          @keydown.right.prevent.stop="reporterAsk[row.id] = true" @keydown.left.prevent.stop="reporterAsk[row.id] = false">On</button>
                </div>
                <span class="nge-triage-ask-hint">{{ reporterAsk[row.id]
                  ? 'They get a reply form under your message: text, a screenshot, their view and console messages. One reply. Ask again to hear more.'
                  : 'They get your message only.' }}</span>
              </div>
              <div class="nge-triage-actions">
                <button class="nge-admin-primary-btn" :disabled="reporterSending === row.id || !reporterDrafts[row.id]?.trim()" @click="sendReporterUpdate(row)">
                  {{ reporterSending === row.id ? 'Sending…' : reporterAsk[row.id] ? 'Send and ask for a reply' : 'Send to submitter' }}
                </button>
                <button v-if="triageGroupOf(row) !== 'done'" class="nge-admin-action-btn nge-triage-done-btn"
                        :disabled="reporterSending === row.id || triageActing === row.id || !reporterDrafts[row.id]?.trim()"
                        title="Sends this to the submitter, then moves the card to Done with the same text as its note."
                        @click="sendReporterUpdate(row, true)">✓ Send and mark done</button>
                <button v-if="triageGroupOf(row) === 'decide'" class="nge-admin-action-btn"
                        :disabled="reporterSending === row.id || triageActing === row.id || !reporterDrafts[row.id]?.trim()"
                        title="Sends this to the submitter, then moves the card to In progress, marked by hand so the robot does not build it."
                        @click="sendReporterUpdate(row, false, true)">▶ Send: mark in progress</button>
                <button v-if="triageGroupOf(row) === 'decide' || isByHand(row)" class="nge-admin-action-btn"
                        :disabled="reporterSending === row.id || triageActing === row.id || !reporterDrafts[row.id]?.trim()"
                        title="Sends this to the submitter, then moves the card to Ideas for later."
                        @click="sendReporterUpdate(row, false, false, true)">💡 Send: mark later</button>
                <button class="nge-admin-action-btn" :disabled="reporterSending === row.id" @click="closeReporterDraft(row)">Not now</button>
              </div>
            </template>
            <button v-else class="nge-admin-action-btn nge-triage-reporter-open" @click="reporterDrafts[row.id] = draftReporterUpdate(row)"
                    title="Draft a notification to the person who reported this. You can edit it before sending, or not send it.">✉ Update submitter</button>
          </div>
        </div>
        <div v-if="triageBoard && !g.rows.length && !isFolded(g.key)" class="nge-triage-col-empty">
          <img v-if="g.key === 'decide'" :src="imgNurroBravo" alt="" class="nge-triage-zero-nurro" />
          <div>{{ g.empty }}</div>
        </div>
        </template>
        </div>
        </div>
        </template>
      </div>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.nge-admin-hub {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 22px 22px;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.25) transparent;
}
.nge-admin-hub::-webkit-scrollbar { width: 6px; }
.nge-admin-hub::-webkit-scrollbar-track { background: transparent; }
.nge-admin-hub::-webkit-scrollbar-thumb { background: rgba(74, 158, 255, 0.25); border-radius: 3px; }
.nge-admin-hub::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.45); }

/* Sub-tabs */
.nge-admin-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  padding-bottom: 0;
  margin-bottom: 4px;
}
a.nge-admin-subtab { text-decoration: none; display: inline-flex; align-items: center; box-sizing: border-box; }
.nge-admin-subtab {
  background: transparent;
  border: none;
  color: #b8c7d9;
  font-size: 1rem;
  line-height: 1.4;
  min-height: 44px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
  font-weight: 500;
}
.nge-admin-subtab:hover { background: rgba(255, 255, 255, 0.04); color: #cde; }
.nge-admin-subtab--active {
  color: #e0ecff;
  border-bottom-color: #4a9eff;
}

/* Triage stands out in red (Ames): it is the tab that needs attention. */
.nge-admin-subtab--triage,
.nge-admin-subtab--triage:hover { color: #ff6b6b; }
/* Special Badges in blue (Ames 2026-10-10), as Triage is in red. */
.nge-admin-subtab--badges,
.nge-admin-subtab--badges:hover { color: #5aa9ff; }
.nge-admin-subtab--badges.nge-admin-subtab--active { color: #8cc4ff; border-bottom-color: #5aa9ff; }
.nge-admin-subtab--triage.nge-admin-subtab--active { color: #ff8585; border-bottom-color: #ff6b6b; }

.nge-admin-section { display: flex; flex-direction: column; gap: 16px; }

.nge-admin-block { display: flex; flex-direction: column; gap: 6px; }

.nge-admin-label {
  font-size: 0.78em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9bb;
  font-weight: 700;
  margin-bottom: 4px;
}

.nge-admin-hint {
  font-size: 0.78em;
  color: #889;
  margin: 0 0 4px;
}

.nge-admin-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 8px 10px;
  outline: none;
  font-family: inherit;
}
.nge-admin-input:focus { border-color: rgba(74, 158, 255, 0.5); }
.nge-admin-input--sm { max-width: 180px; }
/* Specific User: search by name or username. */
.nge-user-pick { position: relative; flex: 1; min-width: 180px; }
.nge-user-pick .nge-admin-input { width: 100%; box-sizing: border-box; }
.nge-user-matches {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5;
  background: #0b1424; border: 1px solid rgba(74, 158, 255, 0.35); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); padding: 4px; max-height: 260px; overflow-y: auto;
}
.nge-user-match {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  background: transparent; border: none; border-radius: 5px;
  padding: 7px 9px; color: #e0ecff; font: inherit; text-align: left; cursor: pointer;
}
.nge-user-match:hover { background: rgba(74, 158, 255, 0.14); }
.nge-user-match-name { font-weight: 600; }
.nge-user-match-handle { color: #8fb4dc; font-size: 0.88em; }
.nge-user-nomatch { padding: 7px 9px; color: #8fa6c2; font-size: 0.9em; }
.nge-user-picked {
  display: flex; align-items: center; gap: 8px;
  background: rgba(74, 158, 255, 0.12); border: 1px solid rgba(74, 158, 255, 0.4);
  border-radius: 6px; padding: 7px 10px; color: #e0ecff; font-size: 0.92em;
}
.nge-user-picked-name { flex: 1; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.nge-user-picked-x { background: none; border: none; color: #a9c4e4; font-size: 1.2em; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-user-picked-x:hover { color: #fff; }

.nge-admin-textarea {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 8px 10px;
  resize: vertical;
  font-family: inherit;
  outline: none;
}
.nge-admin-textarea:focus { border-color: rgba(74, 158, 255, 0.5); }
.nge-admin-fmtbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.nge-admin-fmtbar button {
  min-width: 30px; height: 26px; padding: 0 8px; border-radius: 6px; cursor: pointer;
  font: 600 12px 'Inter', sans-serif; color: #cfe6ff;
  background: rgba(74, 158, 255, 0.1); border: 1px solid rgba(74, 158, 255, 0.3);
}
.nge-admin-fmtbar button:hover { background: rgba(74, 158, 255, 0.22); border-color: rgba(74, 158, 255, 0.6); }
.nge-admin-fmthint { margin-left: 8px; font-size: 11px; color: rgba(200, 215, 240, 0.5); }
.nge-admin-fmtpreview {
  padding: 8px 12px 10px; border-radius: 6px;
  background: rgba(8, 14, 28, 0.7); border: 1px dashed rgba(74, 158, 255, 0.28);
}
.nge-admin-fmtpreview-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(160, 185, 220, 0.6); margin-bottom: 4px; }
.nge-admin-fmtpreview-body { font-size: 13px; line-height: 1.5; color: #dce6f5; max-height: 260px; overflow-y: auto; }
/* The preview looks like the notification players open (the feed's own
   .nge-notif-detail-body rules). !important on the lists: a global rule,
   #vueMain > * ul { list-style: none; padding: 0 }, outranks these and
   stripped the bullets here, though not in the real notification. */
.nge-admin-fmtpreview-body :deep(p) { margin: 0 0 0.7em; }
.nge-admin-fmtpreview-body :deep(.nge-notif-video) { position: relative; width: 100%; max-width: 420px; aspect-ratio: 16 / 9; margin: 4px 0 6px; border-radius: 8px; overflow: hidden; background: #000; }
.nge-admin-fmtpreview-body :deep(.nge-notif-video iframe), .nge-admin-fmtpreview-body :deep(.nge-notif-video video) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.nge-admin-fmtpreview-body :deep(p:last-child) { margin-bottom: 0; }
.nge-admin-fmtpreview-body :deep(strong) { color: #eef4fb; font-weight: 650; }
.nge-admin-fmtpreview-body :deep(em) { font-style: normal; font-weight: 500; color: rgba(110, 220, 255, 0.9); }
.nge-admin-fmtpreview-body :deep(ul),
.nge-admin-fmtpreview-body :deep(ol) { margin: 0 0 0.7em !important; padding-left: 1.3em !important; }
.nge-admin-fmtpreview-body :deep(ul) { list-style: disc outside !important; }
.nge-admin-fmtpreview-body :deep(ol) { list-style: decimal outside !important; }
.nge-admin-fmtpreview-body :deep(ul ul) { list-style: circle outside !important; margin-bottom: 0 !important; }
.nge-admin-fmtpreview-body :deep(li) { display: list-item; margin: 0.15em 0; }
.nge-admin-fmtpreview-body :deep(li::marker) { color: rgba(110, 220, 255, 0.7); }
.nge-admin-fmtpreview-body :deep(h1), .nge-admin-fmtpreview-body :deep(h2),
.nge-admin-fmtpreview-body :deep(h3), .nge-admin-fmtpreview-body :deep(h4) { font-size: 14px; margin: 10px 0 4px; color: #9fdcff; }
.nge-admin-fmtpreview-body :deep(a) { color: #7fd4ff; }

.nge-admin-select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 7px 10px;
  outline: none;
  flex: 1;
  font-family: inherit;
}
.nge-admin-select:focus { border-color: rgba(74, 158, 255, 0.5); }
/* The open list was pale grey words on white (Ames 2026-10-13: "I can't read
   these"): the browser draws the list itself and only took the text colour.
   Give the choices their own dark ground and light words. */
.nge-admin-select { color-scheme: dark; }
.nge-admin-select option { background: #131c2c; color: #eef2f8; }
.nge-admin-select option:disabled { color: #8d99ab; }

.nge-admin-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.nge-admin-row--dates { gap: 12px; }

.nge-admin-date-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.74em;
  color: #889;
  flex: 1;
}
.nge-admin-date-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.86em;
  padding: 6px 8px;
  outline: none;
  font-family: inherit;
  /* Without this the browser paints the native calendar glyph (and the picker
     popup) in its light-theme colours — a black icon on our black input, i.e.
     invisible. `color-scheme: dark` switches the whole native widget to dark. */
  color-scheme: dark;
}
/* Do NOT add `filter: invert(1)` here. `color-scheme: dark` above already
   renders the picker glyph light; inverting it flipped it straight back to
   black, which is what kept the icon invisible after the first fix. Only
   brighten it slightly and make it obviously clickable. */
.nge-admin-date-input::-webkit-calendar-picker-indicator {
  filter: brightness(1.8);
  opacity: 0.85;
  cursor: pointer;
}
.nge-admin-date-input::-webkit-calendar-picker-indicator:hover { opacity: 1; }
.nge-admin-date-input::-webkit-calendar-picker-indicator:hover { opacity: 1; }
.nge-admin-date-input:focus { border-color: rgba(74, 158, 255, 0.5); }
.nge-admin-tz {
  font-style: normal;
  color: rgba(74, 158, 255, 0.75);
  font-size: 0.9em;
}
.nge-admin-warn-inline {
  color: #f0c07a;
  font-size: 0.75em;
  line-height: 1.35;
  max-width: 320px;
}
.nge-admin-note-inline {
  color: rgba(150, 175, 215, 0.9);
  font-size: 0.75em;
  line-height: 1.35;
  max-width: 320px;
}

/* Post-send confirmation, and the post-delete acknowledgement. */
.nge-admin-confirm,
.nge-admin-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(0, 255, 150, 0.09);
  border: 1px solid rgba(0, 255, 150, 0.28);
  color: #9ff0c8;
  font-size: 0.82em;
  line-height: 1.4;
}
.nge-admin-toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10050;
  margin: 0;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
}
.nge-admin-confirm-x {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  font-size: 1.1em;
  cursor: pointer;
}
.nge-admin-confirm-x:hover { opacity: 1; }

.nge-admin-file-label--icon { border-style: dotted; }

/* Lifecycle stage is colour-coded on the left edge: amber = still to come,
   blue = live now, grey = done. */
.nge-admin-notif-row--queued {
  border-left: 2px solid rgba(245, 166, 35, 0.5);
  padding-left: 8px;
}
.nge-admin-notif-row--active {
  border-left: 2px solid rgba(74, 158, 255, 0.5);
  padding-left: 8px;
}
.nge-admin-notif-row--expired {
  border-left: 2px solid rgba(255, 255, 255, 0.12);
  padding-left: 8px;
  opacity: 0.65;
}

.nge-admin-notif-filters { margin-bottom: 6px; }
.nge-admin-filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.nge-admin-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  color: #8b93a7;
  font-size: 0.82em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.nge-admin-filter-chip:hover { border-color: rgba(74, 158, 255, 0.4); color: #cfd6e6; }
.nge-admin-filter-chip--on {
  background: rgba(74, 158, 255, 0.16);
  border-color: rgba(74, 158, 255, 0.5);
  color: #e0ecff;
}
.nge-admin-filter-count {
  font-size: 0.9em;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.nge-admin-edit-btn {
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.35);
  border-radius: 6px;
  color: #cfe6ff;
  cursor: pointer;
  font-size: 0.85em;
  padding: 3px 8px;
  white-space: nowrap;
}
.nge-admin-edit-btn:hover { color: #4a9eff; }

.nge-admin-more-btn {
  width: 100%;
  padding: 7px 0;
  background: none;
  border: 1px dashed rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  color: rgba(150, 175, 215, 0.9);
  font-size: 0.82em;
  cursor: pointer;
}
.nge-admin-more-btn:hover {
  border-color: rgba(74, 158, 255, 0.55);
  color: #cfdcef;
  background: rgba(74, 158, 255, 0.06);
}

.nge-admin-preview-btn { color: #cfe3ff; border-color: rgba(74, 158, 255, 0.45); cursor: pointer; }
.nge-admin-preview-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.12); border-color: rgba(74, 158, 255, 0.7); }
.nge-admin-preview-btn:disabled { opacity: 0.45; cursor: default; }
.nge-admin-cancel-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  color: #aab;
  font-size: 0.82em;
  padding: 0 12px;
  cursor: pointer;
}
.nge-admin-cancel-btn:hover { background: rgba(255, 255, 255, 0.06); color: #cfd6e6; }

.nge-admin-editing-banner {
  margin: 6px 0 10px;
  padding: 7px 10px;
  border-radius: 6px;
  background: rgba(245, 166, 35, 0.1);
  border: 1px solid rgba(245, 166, 35, 0.3);
  color: #f0d0a0;
  font-size: 0.78em;
}

/* Confirm dialog */
.nge-admin-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10040;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nge-admin-modal {
  width: 340px;
  max-width: calc(100 * var(--nge-vw, 1vw) - 32px);
  padding: 18px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(8, 10, 20, 0.98), rgba(12, 16, 28, 0.98));
  border: 1px solid rgba(224, 96, 96, 0.35);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
}
.nge-admin-modal-title {
  font-size: 1.05em;
  font-weight: 600;
  color: #ffd0d0;
  margin-bottom: 8px;
}
.nge-admin-modal-body { font-size: 0.88em; color: #cfd6e6; line-height: 1.5; }
.nge-admin-modal-sub { color: #8b93a7; font-size: 0.92em; }
.nge-admin-modal-actions { display: flex; gap: 8px; margin-top: 16px; }
.nge-admin-modal-danger,
.nge-admin-modal-cancel {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 0.88em;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: none;
  color: #cfd6e6;
}
.nge-admin-modal-danger {
  border-color: rgba(224, 96, 96, 0.55);
  color: #ff9b9b;
}
.nge-admin-modal-danger:hover { background: rgba(224, 96, 96, 0.18); }
.nge-admin-modal-cancel:hover { background: rgba(255, 255, 255, 0.06); }

.nge-admin-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #aab;
  font-size: 0.85em;
  cursor: pointer;
}
.nge-admin-check input { accent-color: #4a9eff; }

.nge-admin-pasted { display: flex; align-items: center; gap: 10px; margin: 2px 0 8px; font-size: 12.5px; color: #aab; }
.nge-admin-pasted img { max-height: 84px; max-width: 220px; border-radius: 6px; border: 1px solid rgba(74, 158, 255, 0.3); }
.nge-admin-file-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(74, 158, 255, 0.04);
  border: 1px dashed rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  padding: 6px 10px;
  color: #aab;
  font-size: 0.85em;
  cursor: pointer;
  flex: 1;
}
.nge-admin-file-label:hover { background: rgba(74, 158, 255, 0.08); }
.nge-admin-file-input { display: none; }

.nge-admin-color {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  padding: 2px;
}

.nge-admin-primary-btn {
  background: rgba(74, 158, 255, 0.15);
  border: 1px solid rgba(74, 158, 255, 0.45);
  color: #e0ecff;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 0.92em;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-start;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
  font-family: inherit;
}
.nge-admin-primary-btn:hover:not(:disabled) {
  background: rgba(74, 158, 255, 0.25);
  border-color: rgba(74, 158, 255, 0.65);
}
.nge-admin-primary-btn:active:not(:disabled) { transform: translateY(1px); }
.nge-admin-primary-btn:disabled { opacity: 0.4; cursor: default; }

.nge-admin-action-btn {
  background: rgba(74, 158, 255, 0.12);
  border: 1px solid rgba(74, 158, 255, 0.35);
  color: #cde;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.85em;
  cursor: pointer;
  transition: background 0.15s;
  font-family: inherit;
}
.nge-admin-action-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.22); }
.nge-admin-action-btn:disabled { opacity: 0.4; cursor: default; }

.nge-admin-delete-btn {
  background: none;
  border: none;
  color: #889;
  font-size: 1.3em;
  cursor: pointer;
  line-height: 1;
  padding: 0 6px;
  transition: color 0.15s;
}
.nge-admin-delete-btn:hover { color: #e55; }

.nge-admin-notif-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  margin-bottom: 4px;
}
/* flex:1 makes the info fill the row so the edit + delete buttons group at the
   right edge instead of being spread out by space-between. */
.nge-admin-notif-info { display: flex; flex-direction: column; gap: 3px; flex: 1 1 auto; min-width: 0; }
.nge-admin-notif-info strong { font-size: 1em; color: #dbe6f5; font-weight: 600; }
.nge-admin-notif-meta { font-size: 0.85em; color: #99a3ba; }

.nge-admin-group-list { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-admin-group-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  color: #cde;
  font-size: 0.84em;
  padding: 4px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s, border-color 0.15s;
  font-family: inherit;
}
.nge-admin-group-chip:hover { background: rgba(255, 255, 255, 0.08); }
.nge-admin-group-chip--active { background: rgba(74, 158, 255, 0.15); color: #e0ecff; }
.nge-admin-group-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.nge-admin-members { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.nge-admin-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  padding: 4px;
  max-height: 180px;
  overflow-y: auto;
}
.nge-admin-search-item {
  background: rgba(255, 255, 255, 0.04);
  border: none;
  color: #cde;
  font-size: 0.86em;
  padding: 6px 8px;
  border-radius: 4px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
  font-family: inherit;
}
.nge-admin-search-item:hover { background: rgba(74, 158, 255, 0.12); }

.nge-admin-member-list { display: flex; flex-direction: column; gap: 2px; }
.nge-admin-member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  font-size: 0.86em;
  color: #cde;
}

.nge-admin-award-section { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }

/* ── Triage ── */
.nge-triage-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.nge-triage-head .nge-admin-label { flex: 1; }
.nge-triage-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: rgba(255, 255, 255, 0.55); cursor: pointer;
}
.nge-triage-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 7px;
}
/* The card you clicked: a bright rail and edge, so it is easy to find again. */
.nge-triage-card { cursor: default; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }
.nge-triage-card--selected {
  border-color: #4fcfff; background: rgba(79, 207, 255, 0.07);
  box-shadow: inset 4px 0 0 #4fcfff, 0 0 0 1px rgba(79, 207, 255, 0.35), 0 0 18px rgba(79, 207, 255, 0.18);
  opacity: 1 !important;
}
.nge-triage-cols, .nge-triage-col { display: flex; flex-direction: column; gap: 8px; }
.nge-triage-newtab { text-decoration: none; display: inline-flex; align-items: center; }

/* ── Board view: the whole window, one column per section ── */
.nge-triage-board {
  position: fixed; inset: 0; z-index: 100000; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10px; padding: 16px 20px 18px;
  background: #070b14; color: #dbe6f5;
  font-family: 'Inter', 'Roboto', system-ui, sans-serif; font-size: 14px;
}
.nge-triage-board .nge-triage-head { flex: 0 0 auto; }
.nge-triage-board .nge-admin-label { font-size: 1.25em; }
.nge-triage-board .nge-admin-hint { max-width: 900px; }
.nge-triage-board .nge-triage-cols {
  flex: 1 1 auto; min-height: 0;
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
}
.nge-triage-board .nge-triage-col {
  min-height: 0; overflow-y: auto; padding: 0 8px 10px;
  border: 1px solid rgba(74, 158, 255, 0.16); border-radius: 10px; background: rgba(255, 255, 255, 0.02);
  scrollbar-width: thin; scrollbar-color: rgba(74, 158, 255, 0.3) transparent;
}
.nge-triage-board .nge-triage-col--decide { border-top: 3px solid #ff8d8d; }
.nge-triage-board .nge-triage-col--progress { border-top: 3px solid #4fcfff; }
.nge-triage-board .nge-triage-col--later { border-top: 3px solid #ffd24d; }
.nge-triage-board .nge-triage-col--done { border-top: 3px solid #5ee8a8; }
.nge-triage-board .nge-triage-col--dismissed { border-top: 3px solid #7f93ad; }
/* Column headers stay put and are not folds here. */
.nge-triage-board .nge-triage-group {
  position: sticky; top: 0; z-index: 2; margin: 0 -8px; width: calc(100% + 16px);
  border: none; border-bottom: 1px solid rgba(255, 255, 255, 0.08); border-radius: 0;
  background: #0b1220; cursor: default; pointer-events: none; opacity: 1;
}
.nge-triage-board .nge-triage-group-caret, .nge-triage-board .nge-triage-group-hint { display: none; }
.nge-triage-board .nge-triage-card { cursor: pointer; background: rgba(10, 18, 32, 0.9); }
.nge-triage-board .nge-triage-card:hover { border-top-color: rgba(79, 207, 255, 0.45); border-right-color: rgba(79, 207, 255, 0.45); border-bottom-color: rgba(79, 207, 255, 0.45); }
/* Compact until clicked: who, what they said, where it stands. */
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) > :not(.nge-triage-meta):not(.nge-triage-from):not(.nge-triage-excerpt):not(.nge-triage-title) { display: none; }
/* The whole report on the chip too, never cut short (Ames 2026-10-10:
   "these are supposed to show the full bug report text"). */
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-excerpt { white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-triage-board .nge-triage-card--selected { cursor: default; }
/* The whole report, with the player's own line breaks, on an opened card. */
.nge-triage-card--selected .nge-triage-excerpt, .nge-triage-cols:not([style]) .nge-triage-excerpt { white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-triage-col-empty { padding: 14px 4px; color: #62738c; font-size: 0.9em; text-align: center; }

/* ── Chips ───────────────────────────────────────────────────────────────
   On the board a report is a chip until you click it: a colored edge for
   what kind it is, a face for who sent it, how long ago, two lines of what
   they said. Clicking opens the whole card in place. */
.nge-triage-group-icon { font-size: 1.05em; }
.nge-triage-avatar, .nge-triage-ago { display: none; }
.nge-triage-board .nge-triage-group-icon { margin-right: -2px; }
.nge-triage-board .nge-triage-card { position: relative; border-left: 4px solid #6f7f98; transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease; }
.nge-triage-board .nge-triage-card.nge-triage-card--bug_fix_spec { border-left-color: #ff7b72; }
.nge-triage-board .nge-triage-card.nge-triage-card--new_feature { border-left-color: #5ad17f; }
.nge-triage-board .nge-triage-card.nge-triage-card--message { border-left-color: #58b6f5; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) {
  padding: 7px 9px 8px 10px; gap: 3px; border-radius: 12px;
}
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected):hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35); }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected):active { transform: translateY(0); }
/* one tidy line at the top of a chip: number, kind, state */
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-meta { gap: 5px; flex-wrap: nowrap; overflow: hidden; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-src,
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-status,
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-link { display: none; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-rec { font-size: 9.5px; padding: 1px 6px; white-space: nowrap; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-impl { font-size: 10px; padding: 1px 6px; white-space: nowrap; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-num { font-size: 10.5px; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-from {
  display: flex; align-items: center; gap: 5px; font-size: 11.5px; white-space: nowrap; overflow: hidden;
}
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-from-word,
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-when { display: none; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-ago { display: inline; }
.nge-triage-board .nge-triage-avatar {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 18px; height: 18px; border-radius: 50%;
  font: 700 10px/1 'Inter', system-ui, sans-serif; color: #fff;
  background: hsl(var(--hue, 210) 58% 46%);
}
.nge-triage-board .nge-triage-card--selected .nge-triage-avatar { margin-right: 6px; vertical-align: -3px; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-excerpt {
  font-size: 12.5px; line-height: 1.35;
}
/* Inside a category the chips sit in as many columns as fit, so a wide
   category shows a lot at once. The heading, an opened card and the empty
   note each take the full width. */
.nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  align-content: start; align-items: start; gap: 8px;
}
.nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) > .nge-triage-group,
.nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) > .nge-triage-card--selected,
.nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) > .nge-triage-col-empty { grid-column: 1 / -1; }
.nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) > .nge-triage-group { width: auto; }
/* chips in a row are the same height, so the rows read as rows */
.nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) > .nge-triage-card:not(.nge-triage-card--selected) { height: 100%; box-sizing: border-box; }
.nge-triage-board .nge-triage-col-empty { font-style: normal; padding: 22px 8px; }
.nge-triage-light .nge-triage-card:not(.nge-triage-card--selected):hover { box-shadow: 0 6px 16px rgba(20, 30, 50, 0.14); }
.nge-triage-board.nge-triage-light .nge-triage-card { border-left-color: #9aa7ba; }
.nge-triage-board.nge-triage-light .nge-triage-card--bug_fix_spec { border-left-color: #e2584f; }
.nge-triage-board.nge-triage-light .nge-triage-card--new_feature { border-left-color: #2e9e68; }
.nge-triage-board.nge-triage-light .nge-triage-card--message { border-left-color: #2f8fd6; }
.nge-triage-board.nge-triage-light .nge-triage-card--selected { border-left-color: #2f6fd6; }
@media (prefers-reduced-motion: reduce) {
  .nge-triage-board .nge-triage-card { transition: none; }
  .nge-triage-board .nge-triage-card:not(.nge-triage-card--selected):hover { transform: none; }
}

/* Folded columns: a narrow rail with the heading turned on its side. */
.nge-triage-board .nge-triage-cols { transition: grid-template-columns 0.22s ease; }
.nge-triage-board .nge-triage-group { pointer-events: auto; cursor: pointer; }
.nge-triage-board .nge-triage-group:hover { filter: brightness(1.15); }
.nge-triage-board .nge-triage-col--folded { padding: 0; overflow: hidden; }
.nge-triage-board .nge-triage-col--folded .nge-triage-group {
  margin: 0; width: 100%; height: 100%; border-bottom: none;
  writing-mode: vertical-rl; text-orientation: mixed;
  display: flex; align-items: center; justify-content: flex-start; gap: 10px; padding: 14px 0;
}
.nge-triage-board .nge-triage-col--folded .nge-triage-group-count { writing-mode: horizontal-tb; }

/* Closed so far, and the moment one more is closed. */
.nge-triage-score { display: inline-flex; align-items: stretch; gap: 8px; flex-wrap: wrap; }
/* On the board the score is its own row: a lit panel under the title. */
.nge-triage-board .nge-triage-score {
  order: 10; flex: 1 1 100%; display: flex; gap: 10px; padding: 10px 12px; border-radius: 14px; position: relative; overflow: hidden;
  background: linear-gradient(100deg, rgba(88, 182, 245, 0.10), rgba(142, 232, 160, 0.06) 45%, rgba(255, 200, 87, 0.08));
  border: 1px solid rgba(120, 190, 255, 0.22); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 26px rgba(0, 0, 0, 0.3);
}
/* A slow sheen across the panel, and a quick one when a report is closed. */
.nge-triage-board .nge-triage-score::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.07), transparent);
  animation: nge-hud-sheen 9s ease-in-out infinite;
}
.nge-triage-board .nge-triage-score--lit::after { animation: nge-hud-sheen 0.9s ease-out 1; background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.22), transparent); }
@keyframes nge-hud-sheen { 0%, 55% { left: -40%; } 100% { left: 115%; } }
.nge-hud-level { display: inline-flex; align-items: center; gap: 11px; padding-right: 8px; }
.nge-hud-ring {
  --fill: 0%; width: 62px; height: 62px; border-radius: 50%; flex: 0 0 auto; display: grid; place-items: center;
  background: conic-gradient(#ffc857 var(--fill), rgba(255, 255, 255, 0.13) 0); box-shadow: 0 0 18px rgba(255, 200, 87, 0.28);
}
.nge-hud-ring-in { width: 50px; height: 50px; border-radius: 50%; background: #0b1424; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.nge-hud-ring-word { font-size: 8px; font-weight: 700; letter-spacing: 0.14em; color: rgba(255, 255, 255, 0.62); }
.nge-hud-ring-in b { font: 800 22px/1 'Inter', system-ui, sans-serif; color: #ffd978; font-variant-numeric: tabular-nums; margin-top: 2px; }
.nge-hud-level-text { display: flex; flex-direction: column; gap: 5px; min-width: 150px; }
.nge-hud-rank { font: 800 15px/1.1 'Inter', system-ui, sans-serif; color: #fff; letter-spacing: 0.01em; white-space: nowrap; }
.nge-hud-level--up .nge-hud-ring { animation: nge-hud-levelup 1.2s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
@keyframes nge-hud-levelup { 0% { transform: scale(1) rotate(0); } 40% { transform: scale(1.35) rotate(200deg); box-shadow: 0 0 44px rgba(255, 200, 87, 0.9); } 100% { transform: scale(1) rotate(360deg); } }
.nge-triage-score-item--streak b { color: #7fd4ff; }
.nge-triage-score-item--inbox b { color: #ff9ecb; }
.nge-triage-score-item--cold { opacity: 0.6; }
.nge-triage-score-item--record { border-color: rgba(255, 200, 87, 0.7); box-shadow: 0 0 18px rgba(255, 200, 87, 0.3); }
.nge-triage-score-item--zero { border-color: rgba(142, 232, 160, 0.6); background: rgba(142, 232, 160, 0.12); }
.nge-triage-score-word--big { max-width: none; font-size: 14px; font-weight: 700; color: #b9f5c6; }
.nge-hud-spark { display: inline-flex; flex-direction: column; justify-content: flex-end; gap: 4px; padding: 0 4px; margin-left: auto; }
.nge-hud-nurro { position: relative; flex: 0 0 130px; align-self: stretch; margin-left: auto; min-height: 62px; pointer-events: none; }
.nge-hud-nurro img { position: absolute; left: 50%; top: 50%; height: 150px; margin-top: -75px; width: auto; transform: translateX(-50%); filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35)); }
.nge-hud-nurro + .nge-hud-spark { margin-left: 0; }
.nge-hud-spark-bars { display: flex; align-items: flex-end; gap: 3px; height: 40px; }
.nge-hud-spark-bar { width: 8px; border-radius: 3px 3px 1px 1px; background: #58b6f5; transition: height 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
.nge-hud-spark-bar--none { background: rgba(255, 255, 255, 0.16); }
.nge-hud-spark-bar--today { background: #ffc857; box-shadow: 0 0 8px rgba(255, 200, 87, 0.6); }
.nge-hud-spark-bar--today.nge-hud-spark-bar--none { background: rgba(255, 200, 87, 0.4); box-shadow: none; }
.nge-hud-spark-word { font-size: 10.5px; color: rgba(255, 255, 255, 0.6); text-align: center; white-space: nowrap; }
.nge-hud-repo { display: inline-flex; flex-direction: column; justify-content: center; gap: 4px; padding: 0 6px 0 12px; border-left: 1px solid rgba(255, 255, 255, 0.12); }
.nge-hud-repo div { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.nge-triage-score .nge-hud-repo b { font: 800 17px/1 'Inter', system-ui, sans-serif; color: #c9b8ff; font-variant-numeric: tabular-nums; min-width: 46px; text-align: right; }
.nge-hud-repo div > span { font-size: 11.5px; color: rgba(255, 255, 255, 0.66); }
.nge-triage-score-item {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px 6px 9px; border-radius: 14px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); white-space: nowrap;
}
.nge-triage-score-icon { font-size: 19px; line-height: 1; }
.nge-triage-score-item b { font: 800 24px/1 'Inter', system-ui, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.nge-triage-score-word { font-size: 12px; line-height: 1.15; color: rgba(255, 255, 255, 0.7); max-width: 62px; white-space: normal; }
.nge-triage-score-item--bug b { color: #ff9c94; }
.nge-triage-score-item--feature b { color: #8ee8a0; }
.nge-triage-score-item--other b { color: #9ec9ff; }
.nge-triage-score-item--today b { color: #ffc857; }
.nge-triage-score-item--pop { animation: nge-score-pop 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.5); }
.nge-triage-score-item--pop .nge-triage-score-icon { animation: nge-score-wiggle 0.7s ease-in-out; display: inline-block; }
@keyframes nge-score-pop { 0% { transform: scale(1); } 30% { transform: scale(1.16); } 100% { transform: scale(1); } }
@keyframes nge-score-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-18deg) scale(1.2); } 60% { transform: rotate(14deg) scale(1.2); } }
.nge-triage-score-goal { display: inline-flex; flex-direction: column; justify-content: center; gap: 5px; min-width: 128px; padding: 0 4px; }
.nge-triage-score-goal-text { font-size: 12px; color: rgba(255, 255, 255, 0.7); white-space: nowrap; }
.nge-triage-score-goal-text b { font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
.nge-triage-score-bar { height: 8px; border-radius: 5px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.nge-triage-score-bar span {
  display: block; height: 100%; border-radius: 5px; min-width: 6px;
  background: linear-gradient(90deg, #58b6f5, #8ee8a0); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.nge-triage-cheer {
  position: fixed; left: 50%; top: 64px; transform: translateX(-50%); z-index: 100002;
  display: inline-flex; align-items: center; gap: 10px; padding: 10px 18px 10px 12px; border-radius: 26px;
  font: 600 15px/1 'Inter', system-ui, sans-serif; color: #eafff0;
  background: linear-gradient(180deg, #1f7a45, #17603a); border: 1px solid #5fd08a;
  box-shadow: 0 10px 34px rgba(20, 110, 60, 0.45), 0 0 0 4px rgba(95, 208, 138, 0.16);
  pointer-events: none;
}
.nge-triage-cheer--feature { background: linear-gradient(180deg, #2f6fd6, #2558ad); border-color: #8db8ff; box-shadow: 0 10px 34px rgba(40, 90, 190, 0.45), 0 0 0 4px rgba(141, 184, 255, 0.18); }
.nge-triage-cheer-check {
  width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.95); color: #17603a; font-weight: 800; font-size: 14px;
  animation: nge-cheer-check 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.5) both;
}
.nge-triage-cheer--feature .nge-triage-cheer-check { color: #2558ad; }
.nge-triage-cheer-ring {
  position: absolute; left: 12px; top: 50%; width: 24px; height: 24px; margin-top: -12px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  animation: nge-cheer-ring 0.9s ease-out both;
}
@keyframes nge-cheer-check { from { transform: scale(0.2) rotate(-40deg); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes nge-cheer-ring { from { transform: scale(1); opacity: 0.9; } to { transform: scale(3.2); opacity: 0; } }
.nge-triage-cheer-enter-active { transition: opacity 0.2s ease, transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
.nge-triage-cheer-leave-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.nge-triage-cheer-enter-from { opacity: 0; transform: translateX(-50%) translateY(-14px) scale(0.92); }
.nge-triage-cheer-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
@media (prefers-reduced-motion: reduce) {
  .nge-triage-board .nge-triage-cols { transition: none; }
  .nge-triage-score-item--pop, .nge-triage-score-item--pop .nge-triage-score-icon, .nge-triage-cheer-check, .nge-triage-cheer-ring { animation: none; }
  .nge-triage-score-bar span, .nge-hud-spark-bar { transition: none; }
  .nge-triage-board .nge-triage-score::after, .nge-hud-level--up .nge-hud-ring { animation: none; }
  .nge-triage-board .nge-triage-score::after { display: none; }
  .nge-triage-cheer-ring { display: none; }
  .nge-triage-cheer-enter-active, .nge-triage-cheer-leave-active { transition: opacity 0.2s ease; }
}

/* ── Light page ──────────────────────────────────────────────────────────
   Dark ink on paper for long reading. Every color the board sets is given
   its light counterpart here; nothing else about the layout changes. */
.nge-triage-light { background: #eef1f6; color: #1c2635; }
.nge-triage-light .nge-admin-label { color: #24324a; }
.nge-triage-light .nge-admin-hint { color: #5a6880; }
.nge-triage-light .nge-admin-error { color: #b3261e; }
.nge-triage-light .nge-triage-toggle { color: #4a5870; }
.nge-triage-light .nge-triage-search {
  background: #ffffff; border-color: #c3ccda; color: #1c2635;
}
.nge-triage-light .nge-triage-search::placeholder { color: #7b889c; }
.nge-triage-light .nge-triage-search:focus { border-color: #2f6fd6; box-shadow: 0 0 0 3px rgba(47, 111, 214, 0.15); }
.nge-triage-light .nge-triage-search-count { color: #5a6880; }
.nge-triage-light .nge-triage-col {
  background: #f7f9fc; border-color: #d3dae6;
  scrollbar-color: #b9c4d6 transparent;
}
.nge-triage-light .nge-triage-col--decide { border-top-color: #e2584f; }
.nge-triage-light .nge-triage-col--progress { border-top-color: #2f8fd6; }
.nge-triage-light .nge-triage-col--done { border-top-color: #2e9e68; }
.nge-triage-light .nge-triage-col--dismissed { border-top-color: #8793a6; }
.nge-triage-light .nge-triage-group { background: #e9edf4; border-bottom-color: #d3dae6; color: #1c2635; }
.nge-triage-light .nge-triage-group-title { color: #1c2635; }
.nge-triage-light .nge-triage-group-count { background: #d7deea; color: #2a3850; }
.nge-triage-light .nge-triage-col-empty { color: #7b889c; }
.nge-triage-light .nge-triage-card {
  background: #ffffff; border-color: #d8dee9; box-shadow: 0 1px 2px rgba(20, 30, 50, 0.05);
}
.nge-triage-light .nge-triage-card:hover { border-top-color: #7fb0ea; border-right-color: #7fb0ea; border-bottom-color: #7fb0ea; }
.nge-triage-light .nge-triage-card--selected {
  background: #ffffff; border-color: #2f6fd6;
  box-shadow: inset 4px 0 0 #2f6fd6, 0 0 0 1px rgba(47, 111, 214, 0.3), 0 4px 16px rgba(47, 111, 214, 0.14);
}
.nge-triage-light .nge-triage-card--closed { opacity: 0.8; }
.nge-triage-light .nge-triage-num { background: #e3ebf8; color: #20457f; }
.nge-triage-light .nge-triage-rec--nothing { background: #e7eaf0; color: #56637a; }
.nge-triage-light .nge-triage-rec--new { background: #dff1ff; color: #14598f; }
.nge-triage-light .nge-triage-rec--message { background: #dceefb; color: #0d5f94; }
.nge-triage-light .nge-triage-rec--bug_fix_spec { background: #fde4e1; color: #a8271e; }
.nge-triage-light .nge-triage-rec--new_feature { background: #dff3e4; color: #1d7038; }
.nge-triage-light .nge-triage-src { color: #6b788d; }
.nge-triage-light .nge-triage-status { color: #46546b; }
.nge-triage-light .nge-triage-link { color: #1f5fc4; }
.nge-triage-light .nge-triage-impl { background: #e3ebf8; color: #20457f; }
.nge-triage-light .nge-triage-impl--testing, .nge-triage-light .nge-triage-impl--changes_requested { background: #fff0cf; color: #7a5200; }
.nge-triage-light .nge-triage-impl--deployed { background: #dff3e4; color: #1d7038; }
.nge-triage-light .nge-triage-impl--failed { background: #fde4e1; color: #a8271e; }
.nge-triage-light .nge-triage-from { color: #46546b; }
.nge-triage-light .nge-triage-from strong { color: #111a28; }
.nge-triage-light .nge-triage-excerpt { color: #18212f; }
.nge-triage-light .nge-triage-rationale { color: #4a5870; }
.nge-triage-light .nge-triage-note, .nge-triage-light .nge-triage-loop { color: #26324a; }
.nge-triage-light .nge-triage-loop { background: #f1f4f9; border-color: #d8dee9; }
.nge-triage-light .nge-triage-copied { color: #1d7038; }
.nge-triage-light .nge-triage-console-btn { background: #eef3fb; border-color: #c3d3ec; color: #1f5fc4; }
.nge-triage-light .nge-triage-console-log { background: #f4f6fa; border-color: #d8dee9; color: #2a3446; }
.nge-triage-light .nge-triage-spec { background: #f4f6fa; border-color: #d8dee9; color: #26324a; }
.nge-triage-light .nge-triage-spec-label { color: #2f6fd6; }
.nge-triage-light .nge-triage-spec-text { color: #1c2635; }
.nge-triage-light .nge-triage-message, .nge-triage-light .nge-triage-comment {
  background: #ffffff; border-color: #c3ccda; color: #1c2635;
}
.nge-triage-light .nge-triage-message::placeholder, .nge-triage-light .nge-triage-comment::placeholder { color: #7b889c; }
.nge-triage-light .nge-triage-reporter { color: #46546b; }
.nge-triage-light .nge-triage-reporter-by { color: #6b788d; }
.nge-triage-light .nge-triage-ask-hint { color: #6b788d; }
.nge-triage-light .nge-triage-switch { background: #e6ecf5; border-color: #9fb6d6; }
.nge-triage-light .nge-triage-switch::before { background: #ffffff; border-color: #b8c6da; }
.nge-triage-light .nge-triage-switch[data-on="on"]::before { background: #cfecfa; border-color: #1487b8; box-shadow: none; }
.nge-triage-light .nge-triage-switch-opt { color: #7a8799; }
.nge-triage-light .nge-triage-switch-opt[aria-checked="true"] { color: #1c2a3d; }
.nge-triage-light .nge-triage-switch-opt--on[aria-checked="true"] { color: #0c5f85; }
.nge-triage-light .nge-triage-chip { background: #e9f6fd; border-color: #58b6dc; color: #0c5f85; }
.nge-triage-light .nge-triage-chip--plain { background: #eef1f6; border-color: #cfd8e5; color: #55647a; }
.nge-triage-light .nge-triage-reply-console { background: #f4f6fa; border-color: #d5dce8; color: #263347; }
.nge-triage-light .nge-triage-reply-shot img { border-color: #58b6dc; }
.nge-triage-light .nge-triage-note--reply { background: #e9f6fd; border-left-color: #58b6dc; }
.nge-triage-light .nge-triage-note--unread { background: #cfecfa; border-left-color: #1487b8; }
.nge-triage-light .nge-triage-rec--reply { background: #0f7fae; color: #ffffff; }
.nge-triage-light .nge-triage-admin-note { border-left-color: #8a77e0; }
.nge-triage-light .nge-triage-rec--waiting { background: #ece8ff; color: #4a36a8; }
.nge-triage-light .nge-triage-card.nge-triage-card--waiting { outline-color: #8a77e0; }
.nge-triage-light.nge-triage-board .nge-triage-card.nge-triage-card--reply,
.nge-triage-light .nge-triage-board .nge-triage-card.nge-triage-card--reply { box-shadow: 0 0 0 1px #1487b8, 0 0 12px rgba(20,135,184,0.22); }
.nge-triage-light .nge-triage-release { background: #eef3fb; border-color: #c3d3ec; }
.nge-triage-light .nge-triage-release-why { color: #34425a; }
.nge-triage-light .nge-triage-claude { border-top-color: #e0e5ee; }
.nge-triage-light .nge-admin-primary-btn { background: #2f6fd6; border-color: #2a62bd; color: #ffffff; }
.nge-triage-light .nge-admin-primary-btn:hover:not(:disabled) { background: #295fb8; border-color: #23529f; }
.nge-triage-light .nge-admin-action-btn { background: #ffffff; border-color: #b9c6da; color: #23324a; }
.nge-triage-light .nge-admin-action-btn:hover:not(:disabled) { background: #edf2fa; border-color: #7fa3d8; }
.nge-triage-light .nge-triage-done-btn { color: #1d7038; border-color: #8fcba3; }
.nge-triage-light .nge-triage-discard-btn { color: #a8271e; border-color: #e3aaa5; }
.nge-triage-light .nge-triage-score-item { background: #ffffff; border-color: #d3dae6; box-shadow: 0 1px 2px rgba(20, 30, 50, 0.06); }
.nge-triage-light .nge-triage-score-word { color: #4a5870; }
.nge-triage-light .nge-triage-score-item--bug b { color: #c0362c; }
.nge-triage-light .nge-triage-score-item--feature b { color: #1f8a4c; }
.nge-triage-light .nge-triage-score-item--other b { color: #2f6fb8; }
.nge-triage-light .nge-triage-score-item--today b { color: #c47a00; }
.nge-triage-light .nge-triage-score-goal-text { color: #4a5870; }
.nge-triage-light .nge-triage-score-goal-text b { color: #1c2635; }
.nge-triage-light .nge-triage-score-bar { background: #d7deea; }
.nge-triage-light.nge-triage-board .nge-triage-score { background: linear-gradient(100deg, #eaf3ff, #eefaf0 45%, #fff6e2); border-color: #c9d6ea; box-shadow: 0 2px 10px rgba(20, 30, 50, 0.08); }
.nge-triage-light .nge-hud-ring { background: conic-gradient(#d68a00 var(--fill), #d7deea 0); box-shadow: none; }
.nge-triage-light .nge-hud-ring-in { background: #ffffff; }
.nge-triage-light .nge-hud-ring-word { color: #5a6880; }
.nge-triage-light .nge-hud-ring-in b { color: #b46f00; }
.nge-triage-light .nge-hud-rank { color: #1c2635; }
.nge-triage-light .nge-triage-score-item--streak b { color: #1670b8; }
.nge-triage-light .nge-triage-score-item--inbox b { color: #b82f73; }
.nge-triage-light .nge-triage-score-item--zero { background: #e4f7e9; border-color: #8fd0a2; }
.nge-triage-light .nge-triage-score-word--big { color: #1f8a4c; }
.nge-triage-light .nge-hud-spark-bar { background: #2f8fd6; }
.nge-triage-light .nge-hud-spark-bar--none { background: #cfd8e6; }
.nge-triage-light .nge-hud-spark-bar--today { background: #d68a00; box-shadow: none; }
.nge-triage-light .nge-hud-spark-word, .nge-triage-light .nge-hud-repo div > span { color: #4a5870; }
.nge-triage-light .nge-hud-repo { border-left-color: #cfd8e6; }
.nge-triage-light .nge-triage-score .nge-hud-repo b { color: #5b3fc4; }
.nge-triage-light .nge-triage-score-bar span { background: linear-gradient(90deg, #2f8fd6, #2e9e68); }
.nge-triage-light a { color: #1f5fc4; }
.nge-triage-light :focus-visible { outline: 2px solid #2f6fd6; outline-offset: 2px; }
@media (max-width: 1100px) {
  .nge-triage-board .nge-triage-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }
}
/* Laptops (Ames 2026-10-14: "top bar is too tall vertically on laptop"):
   the score panel is one compact row, so the columns start higher. */
@media (min-width: 701px) {
  .nge-triage-board { gap: 8px; padding-top: 12px; }
  .nge-triage-board .nge-triage-score { flex-wrap: nowrap; align-items: center; gap: 8px; padding: 6px 10px; }
  .nge-triage-board .nge-triage-score-item { padding: 4px 10px 4px 8px; gap: 6px; border-radius: 11px; flex: 0 1 auto; min-width: 0; }
  .nge-triage-board .nge-triage-score-item b { font-size: 20px; }
  .nge-triage-board .nge-triage-score-icon { font-size: 16px; }
  .nge-triage-board .nge-hud-ring { transform: scale(0.82); margin: -6px; }
  .nge-triage-board .nge-hud-level-text { min-width: 120px; }
  .nge-triage-board .nge-hud-spark { margin-left: auto; }
  .nge-triage-board .nge-hud-spark-bars { height: 26px; }
  .nge-triage-board .nge-hud-nurro { flex: 0 0 70px; min-height: 44px; order: 99; }
  .nge-triage-board .nge-hud-nurro img { height: 70px; margin-top: -35px; }
}
/* Not much room: commits and deploys make way first, then the 14 day chart
   and Nurro; the paragraph on how the board works is left out on short
   screens. All of it is back on a big screen. */
@media (min-width: 701px) and (max-width: 1500px) {
  .nge-triage-board .nge-hud-repo { display: none; }
}
@media (min-width: 701px) and (max-width: 1150px) {
  .nge-triage-board .nge-hud-spark, .nge-triage-board .nge-hud-nurro { display: none; }
}
@media (min-width: 701px) and (max-height: 1000px) {
  .nge-triage-board .nge-triage-howto { display: none; }
}
/* Phones (Ames 2026-10-14: "This page needs a mobile pass"). The board
   scrolls as one page; the categories stack, each as wide as the screen; a
   folded one is a single line to tap instead of a rail on its side. */
@media (max-width: 700px) {
  .nge-triage-board { overflow-y: auto; overscroll-behavior: contain; padding: 12px 12px 24px; gap: 8px; -webkit-overflow-scrolling: touch; }
  .nge-triage-board .nge-triage-cols {
    display: flex !important; flex-direction: column; flex: 0 0 auto; min-height: auto; gap: 10px;
  }
  .nge-triage-board .nge-triage-col { flex: 0 0 auto; overflow: visible; min-height: 0; }
  .nge-triage-board .nge-triage-col:not(.nge-triage-col--folded) { grid-template-columns: minmax(0, 1fr); }
  .nge-triage-board .nge-triage-group { position: static; }
  .nge-triage-board .nge-triage-col--folded .nge-triage-group {
    writing-mode: horizontal-tb; height: auto; padding: 11px 12px; justify-content: flex-start;
  }
  .nge-triage-board .nge-triage-col--folded .nge-triage-group-count { margin-left: auto; }
  /* The score panel: two stats to a line, the mascot smaller beside the counts. */
  .nge-triage-board .nge-triage-score { gap: 8px; padding: 10px; }
  .nge-triage-board .nge-triage-score-item { box-sizing: border-box; flex: 1 1 calc(50% - 8px); min-width: 0; padding: 7px 9px; gap: 7px; white-space: normal; }
  .nge-triage-board .nge-triage-score-item b { font-size: 20px; }
  .nge-hud-level { flex: 1 1 100%; }
  .nge-hud-level-text { min-width: 0; flex: 1; }
  .nge-hud-nurro { flex: 0 0 84px; min-height: 52px; }
  .nge-hud-nurro img { height: 96px; margin-top: -48px; }
  .nge-triage-board .nge-admin-hint { font-size: 12.5px; }
  .nge-triage-search { flex: 1 1 100%; min-width: 0; }
  /* An opened card: its buttons a comfortable size to tap. */
  .nge-triage-board .nge-triage-card--selected .nge-admin-action-btn { min-height: 38px; }
}
.nge-triage-discard-btn { color: #d79a9a; border-color: rgba(255, 120, 120, 0.3); }
.nge-triage-discard-btn:hover:not(:disabled) { background: rgba(255, 90, 90, 0.12); color: #ffb3b3; }
.nge-triage-claude { flex-wrap: wrap; }
.nge-triage-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-triage-from { font-size: 13px; color: #a9bcd4; }
.nge-triage-release { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 6px; background: rgba(74, 158, 255, 0.08); border: 1px solid rgba(74, 158, 255, 0.25); }
.nge-triage-release-why { font-size: 0.88em; color: #b9cbe2; }
.nge-triage-release-row { display: flex; align-items: center; gap: 8px; }
.nge-triage-release-row code { flex: 1; font-family: ui-monospace, Consolas, monospace; color: #e6eefc; background: rgba(0, 0, 0, 0.3); padding: 4px 8px; border-radius: 4px; user-select: all; }
.nge-triage-from strong { color: #e6eefc; font-weight: 600; }
/* Section headers: open work first, finished and dismissed folded and grey. */
.nge-triage-group {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;
  padding: 8px 12px; margin-top: 4px;
  color: #e0ecff; font: inherit; text-align: left; cursor: pointer;
}
.nge-triage-group:hover { background: rgba(255, 255, 255, 0.06); }
.nge-triage-group-caret { color: #8fa6c2; transition: transform 0.15s ease; display: inline-block; }
.nge-triage-group--open .nge-triage-group-caret { transform: rotate(90deg); }
.nge-triage-group-title { font-weight: 600; }
.nge-triage-group-count {
  font-size: 0.8em; font-weight: 700; padding: 0 7px; border-radius: 9px;
  background: rgba(74, 158, 255, 0.18); color: #a9d3ff;
}
.nge-triage-group-hint { font-size: 0.8em; color: #7f93ad; margin-left: auto; }
.nge-triage-group--empty { opacity: 0.55; }
.nge-triage-card--closed { opacity: 0.62; }
.nge-triage-card--closed:hover { opacity: 0.9; }
.nge-triage-rec {
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em;
  padding: 1px 8px; border-radius: 9px; text-transform: uppercase;
}
.nge-triage-rec--nothing      { background: rgba(255,255,255,0.08); color: #aab; }
.nge-triage-rec--new          { background: rgba(79,207,255,0.16); color: #8fdcff; }
.nge-triage-rec--message      { background: rgba(100,200,255,0.14); color: #64c8ff; }
.nge-triage-rec--bug_fix_spec { background: rgba(255,120,120,0.14); color: #f88; }
.nge-triage-rec--new_feature  { background: rgba(160,255,160,0.12); color: #8e8; }
.nge-triage-search {
  flex: 1 1 160px; min-width: 120px; max-width: 320px;
  background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px;
  color: #e6eefc; font: inherit; font-size: 12.5px; padding: 5px 9px;
}
.nge-triage-search:focus { outline: none; border-color: rgba(120, 190, 255, 0.8); }
.nge-triage-search-count { font-size: 11.5px; color: rgba(255, 255, 255, 0.55); white-space: nowrap; }
.nge-triage-num {
  font: 600 11.5px 'Consolas', 'SF Mono', monospace; color: #cfe3ff;
  padding: 1px 6px; border-radius: 4px; background: rgba(120, 180, 255, 0.14);
}
.nge-triage-src { font-size: 12px; color: rgba(255,255,255,0.5); }
.nge-triage-status { font-size: 12px; color: rgba(255,255,255,0.68); }
.nge-triage-done-btn { color: #8fe6a2; border-color: rgba(143, 230, 162, 0.4); }
.nge-triage-done-btn:hover:not(:disabled) { background: rgba(143, 230, 162, 0.12); border-color: rgba(143, 230, 162, 0.75); }
.nge-triage-impl {
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
  background: rgba(100,200,255,0.12); color: #8fd3ff;
}
.nge-triage-impl--testing, .nge-triage-impl--changes_requested,
.nge-triage-impl--needs_info, .nge-triage-impl--live_testing { background: rgba(255,210,90,0.14); color: #ffd35a; }
.nge-triage-impl--deployed { background: rgba(160,255,160,0.12); color: #8e8; }
.nge-triage-impl--failed { background: rgba(255,120,120,0.16); color: #f88; }
.nge-triage-link { font-size: 12px; color: #8fd3ff; }
.nge-triage-claude { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nge-triage-copied { font-size: 12px; color: #8ee88e; }
.nge-triage-note { font-size: 13px; color: rgba(235,238,250,0.9); line-height: 1.45; }
.nge-triage-loop {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 12px; color: rgba(235,238,250,0.88); line-height: 1.45;
  padding: 8px 10px; border-radius: 6px; background: rgba(255,255,255,0.03);
}
.nge-triage-loop a { color: #8fd3ff; word-break: break-all; }
.nge-triage-excerpt { font-size: 14px; line-height: 1.45; color: rgba(255,255,255,0.86); }
.nge-triage-console-btn {
  background: none; border: 1px solid rgba(100,200,255,0.2); border-radius: 999px;
  color: #9cc8ff; font-size: 11px; padding: 2px 9px; cursor: pointer;
}
.nge-triage-console-btn:hover { border-color: rgba(100,200,255,0.5); }
.nge-triage-console-log {
  margin: 6px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
  padding: 7px 9px; font-size: 11px; line-height: 1.4; color: #c9d4e4;
  font-family: 'JetBrains Mono', 'Consolas', monospace; user-select: text;
}
.nge-triage-rationale { font-size: 13px; color: rgba(255,255,255,0.62); line-height: 1.45; }
.nge-triage-message {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(100,200,255,0.2);
  border-radius: 6px; color: #dde; font-size: 13.5px; padding: 8px 10px; resize: vertical;
}
.nge-triage-comment { border-color: rgba(255,255,255,0.14); font-family: inherit; }
.nge-triage-beta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 10px 0 4px; }
.nge-triage-beta-email { font-size: 0.9em; overflow-wrap: anywhere; }
.nge-triage-beta-open { background: none; border: 0; padding: 0; font: inherit; font-size: 0.9em; }
.nge-triage-beta-error { margin: 4px 0; font-size: 0.9em; color: #e05a5a; }
.nge-triage-reporter {
  display: flex; flex-direction: column; gap: 6px;
  padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08);
}
.nge-triage-reporter-open { align-self: flex-start; }
.nge-triage-reporter-by { color: rgba(255,255,255,0.45); }
/* A reply the submitter was asked for (Ames 2026-10-13). */
.nge-triage-thread-text { white-space: pre-wrap; overflow-wrap: anywhere; }
/* Update submitter: format buttons, preview, and a sent update drawn as the
   player sees it (Ames 2026-10-16). */
.nge-triage-fmtbar { margin: 6px 0 4px; }
.nge-triage-fmtpreview { margin-top: 6px; }
.nge-triage-thread-md { overflow-wrap: anywhere; }
.nge-triage-thread-md .nge-admin-fmtpreview-body { max-height: none; overflow: visible; }
.nge-triage-light .nge-triage-fmtbar button { color: #1f4f8a; background: #e6eefb; border-color: #b9cbe6; }
.nge-triage-light .nge-triage-fmtbar button:hover { background: #d6e4f8; border-color: #8fb0dc; }
.nge-triage-light .nge-triage-fmtbar .nge-admin-fmthint { color: #6b788d; }
.nge-triage-light .nge-triage-fmtpreview { background: #f6f8fc; border-color: #b9cbe6; }
.nge-triage-light .nge-admin-fmtpreview-label { color: #6b788d; }
.nge-triage-light .nge-admin-fmtpreview-body { color: #22304a; }
.nge-triage-light .nge-admin-fmtpreview-body :deep(strong) { color: #101b2e; }
.nge-triage-light .nge-admin-fmtpreview-body :deep(li::marker) { color: #3a7bd5; }
.nge-triage-light .nge-admin-fmtpreview-body :deep(a) { color: #1f62b8; }
.nge-triage-note--reply { margin-left: 18px; background: rgba(126,224,255,0.07); border-left: 2px solid rgba(126,224,255,0.45); }
.nge-triage-note--unread { background: rgba(126,224,255,0.16); border-left-color: #7ee0ff; }
.nge-triage-rec--reply { background: #7ee0ff; color: #06202c; font-weight: 700; }
.nge-triage-board .nge-triage-card.nge-triage-card--reply { box-shadow: 0 0 0 1px rgba(126,224,255,0.55), 0 0 14px rgba(126,224,255,0.18); }
.nge-triage-notes { display: flex; flex-direction: column; gap: 6px; }
.nge-triage-admin-note { border-left: 2px solid rgba(160, 140, 255, 0.6); padding-left: 8px; }
.nge-triage-note-btn { align-self: flex-start; }
/* An image going with a reply to the submitter. */
.nge-triage-reply-attach { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.nge-triage-reply-attach img { width: 72px; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(120, 170, 255, 0.35); }
.nge-triage-reply-attach-state { flex: 1 1 auto; font-size: 12px; opacity: 0.8; }
/* Bug, Idea, Other filter in the header. */
.nge-triage-kinds { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.nge-triage-kind {
  font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 999px; cursor: pointer;
  background: transparent; border: 1px solid rgba(120, 170, 255, 0.3); color: #cfe0ff;
}
.nge-triage-kind:hover { border-color: rgba(120, 170, 255, 0.7); }
.nge-triage-kind--on { background: #3f6fd8; border-color: #3f6fd8; color: #fff; }
.nge-triage-kind-n { opacity: 0.7; font-size: 11px; }
.nge-triage-light .nge-triage-kind { border-color: #b9c6da; color: #23324a; }
.nge-triage-light .nge-triage-kind--on { background: #2f6fd6; border-color: #2f6fd6; color: #fff; }
/* The report's title (Celia #178), above what they wrote. */
.nge-triage-title { font-size: 15px; font-weight: 700; line-height: 1.35; color: #eef3ff; overflow-wrap: anywhere; }
.nge-triage-light .nge-triage-title { color: #121a28; }
/* Asked the submitter for a reply, none yet: a dashed edge and a tag. */
.nge-triage-rec--waiting { background: rgba(160, 140, 255, 0.16); color: #c4b8ff; text-transform: none; letter-spacing: 0; }
.nge-triage-card.nge-triage-card--waiting { outline: 1px dashed rgba(160, 140, 255, 0.6); outline-offset: -1px; }
.nge-triage-ask { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; }
.nge-triage-ask-label { font-weight: 600; }
.nge-triage-ask-hint { color: rgba(255,255,255,0.5); flex: 1 1 240px; }
/* Off / On: a two way switch. The lit side is the current state. */
.nge-triage-switch { position: relative; display: inline-grid; grid-template-columns: 1fr 1fr; padding: 2px; border-radius: 7px;
  background: rgba(0,0,0,0.35); border: 1px solid rgba(126,224,255,0.28); }
.nge-triage-switch::before { content: ''; position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc(50% - 2px); border-radius: 5px;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.22); transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease; }
.nge-triage-switch[data-on="on"]::before { transform: translateX(100%); background: rgba(126,224,255,0.2); border-color: rgba(126,224,255,0.75); box-shadow: 0 0 10px rgba(126,224,255,0.25); }
.nge-triage-switch-opt { position: relative; z-index: 1; min-width: 44px; padding: 3px 10px; border: 0; background: none; cursor: pointer;
  font-family: 'Orbitron', 'Inter', sans-serif; font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.45); transition: color 0.18s ease; }
.nge-triage-switch-opt[aria-checked="true"] { color: #ffffff; }
.nge-triage-switch-opt--on[aria-checked="true"] { color: #bfefff; }
.nge-triage-switch-opt:focus-visible { outline: 2px solid #7ee0ff; outline-offset: 1px; border-radius: 5px; }
.nge-triage-switch-opt:disabled { cursor: default; opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .nge-triage-switch::before, .nge-triage-switch-opt { transition: none; } }
/* What came with a reply. */
.nge-triage-note:has(.nge-triage-reply-parts) { flex-wrap: wrap; }
.nge-triage-reply-parts { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-top: 6px; }
.nge-triage-reply-shot img { display: block; max-width: 220px; max-height: 140px; border-radius: 6px; border: 1px solid rgba(126,224,255,0.35); }
.nge-triage-reply-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.nge-triage-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; border: 1px solid rgba(126,224,255,0.4);
  background: rgba(126,224,255,0.1); color: #bfefff; font: inherit; font-size: 12px; text-decoration: none; cursor: pointer; }
.nge-triage-chip:hover { border-color: rgba(126,224,255,0.8); }
.nge-triage-chip:focus-visible { outline: 2px solid #7ee0ff; outline-offset: 1px; }
.nge-triage-chip--plain { cursor: default; border-color: rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.65); }
.nge-triage-reply-console { flex-basis: 100%; max-height: 220px; overflow: auto; margin: 0; padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.1); color: #cdd6e4; font: 11.5px/1.45 'Consolas', 'SF Mono', monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-triage-note {
  display: flex; gap: 8px; align-items: baseline;
  font-size: 12px; line-height: 1.45;
  padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.04);
}
.nge-triage-spec {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; color: #ccd; font-size: 13.5px; padding: 10px 12px;
  /* The whole suggestion, always: no box to scroll inside the card, and a
     long file path wraps instead of running off the side (Ames 2026-10-10). */
  margin: 0;
  display: flex; flex-direction: column; gap: 5px;
}
.nge-triage-spec-row { display: flex; gap: 8px; align-items: baseline; line-height: 1.45; }
.nge-triage-spec-label {
  flex: none; min-width: 62px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em;
  text-transform: uppercase; color: rgba(100, 200, 255, 0.75);
}
.nge-triage-spec-text { color: rgba(235, 238, 250, 0.88); min-width: 0; overflow-wrap: anywhere; }
.nge-triage-actions { display: flex; gap: 8px; }

.nge-admin-badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
}
.nge-admin-badge-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.nge-admin-badge-card:hover {
  background: rgba(74, 158, 255, 0.08);
  border-color: rgba(74, 158, 255, 0.35);
  transform: translateY(-1px);
}
.nge-admin-badge-card--selected {
  background: rgba(74, 158, 255, 0.15);
  border-color: rgba(74, 158, 255, 0.65);
}
.nge-admin-badge-card--selected .nge-admin-badge-name {
  color: #e0ecff;
}
.nge-admin-badge-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
.nge-admin-badge-img--sm { width: 36px; height: 36px; }
.nge-admin-badge-fallback {
  display: flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; font-size: 30px; opacity: 0.55;
}
.nge-admin-badge-fallback--sm { width: 36px; height: 36px; font-size: 20px; }
.nge-admin-award-chosen {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px;
  background: rgba(74, 158, 255, 0.1); border: 1px solid rgba(74, 158, 255, 0.4);
}
.nge-admin-award-chosen-name { flex: 1; font-weight: 600; color: #e0ecff; }
.nge-admin-award-section { margin-bottom: 12px; }
.nge-admin-badge-tools { margin-bottom: 8px; }
.nge-admin-badge-tools .nge-admin-input { flex: 1; }
.nge-admin-badge-pager { justify-content: center; margin-top: 10px; }
.nge-admin-badge-name {
  font-size: 0.78em;
  color: #aab;
  text-align: center;
  line-height: 1.2;
}

.nge-admin-success {
  background: rgba(127, 255, 136, 0.08);
  border: 1px solid rgba(127, 255, 136, 0.4);
  color: #aef;
  font-size: 0.86em;
  padding: 8px 10px;
  border-radius: 4px;
  margin-top: 4px;
}

.nge-admin-error {
  background: rgba(229, 85, 85, 0.08);
  border: 1px solid rgba(229, 85, 85, 0.4);
  color: #faa;
  font-size: 0.86em;
  padding: 6px 10px;
  border-radius: 4px;
}
.nge-practice-hover code, .nge-practice-picks code { font-size: 0.85em; color: #9fd0ff; }
.nge-practice-picks { color: #cde; font-size: 0.9em; }
.nge-practice-kind { color: #cde; font-size: 0.88em; display: flex; gap: 6px; align-items: center; cursor: pointer; }
.nge-practice-row {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border-radius: 6px;
  border: 1px solid rgba(74, 158, 255, 0.18); background: rgba(255, 255, 255, 0.02);
}
.nge-practice-main { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.nge-practice-status { font-size: 0.8em; letter-spacing: 0.06em; text-transform: uppercase; color: #9fd0ff; }
.nge-practice-row--ready .nge-practice-status { color: #60c060; }
.nge-practice-row--needs_reset .nge-practice-status, .nge-practice-row--broken .nge-practice-status { color: #e06060; }
.nge-practice-row--in_use .nge-practice-status { color: #f5d142; }
.nge-practice-picker {
  position: fixed; top: 64px; right: 16px; z-index: 200;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  max-width: 520px; padding: 10px 12px; border-radius: 8px;
  background: rgba(8, 12, 24, 0.96); border: 1px solid rgba(74, 158, 255, 0.35);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); color: #cde; font-size: 0.9em;
}
.nge-practice-picker-label { font-size: 0.75em; letter-spacing: 0.12em; text-transform: uppercase; color: #9fd0ff; }

/* Sending a notification: the same stepped wait as Submit an issue. */
.nge-admin-sending {
  /* the neuron gets the whole width of the chip (Ames 2026-10-06: "too cool
     to be so small"); the steps sit in a row beneath it */
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  margin: 12px 0 6px; padding: 20px 20px 16px;
  border: 1px solid rgba(126, 224, 255, 0.2); border-radius: 10px;
  background: rgba(8, 14, 28, 0.6);
}
.nge-admin-sending .nge-growing-neuron { width: 100%; max-width: 640px; }
.nge-admin-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-flow: row wrap; justify-content: center; gap: 8px 22px; }
.nge-admin-step { display: flex; align-items: center; gap: 9px; font-size: 0.86em; color: #6f7c96; transition: color 0.2s; }
.nge-admin-step-mark {
  width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #06231a;
  border: 1.5px solid rgba(120, 140, 180, 0.4);
}
.nge-admin-step--now { color: #e6eeff; }
.nge-admin-step--now .nge-admin-step-mark {
  border-color: #7ee0ff; box-shadow: 0 0 8px rgba(126, 224, 255, 0.7);
  animation: nge-admin-step-now 1s ease-in-out infinite;
}
.nge-admin-step--done { color: #9fb3cc; }
.nge-admin-step--done .nge-admin-step-mark { background: #34e6a8; border-color: #34e6a8; }
@keyframes nge-admin-step-now { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.25); } }
@media (prefers-reduced-motion: reduce) { .nge-admin-step--now .nge-admin-step-mark { animation: none; } }

/* ── The To do board's column and button (Ames 2026-10-19) ── */
.nge-triage-board .nge-triage-col--todo { border-top: 3px solid #7c9cff; }
.nge-triage-light .nge-triage-col--todo { border-top-color: #4a63d6; }
/* The way to the To do board: a bright pill (Ames 2026-10-23: "more fun"). */
.nge-triage-todo-open, .nge-triage-light .nge-triage-todo-open {
  color: #fff !important; font-weight: 700; border: none !important;
  background: linear-gradient(90deg, #4f8cff, #2ec4b6 60%, #f5c542) !important;
  box-shadow: 0 2px 10px rgba(46, 140, 220, 0.35); transition: transform 0.15s, box-shadow 0.15s;
}
.nge-triage-todo-open:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(46, 140, 220, 0.45); }
.nge-triage-todo-open .nge-todo-icon { color: #fff; }
/* The To do board fills the board's window. */
.nge-triage-board > .nge-todo { flex: 1 1 auto; }
</style>

<style>
/* Picking mode for practice cells: hide the whole profile modal (its
   backdrop swallows clicks and closes on them) while AdminHub stays mounted. */
body.nge-practice-picking #nge-profile-modal { display: none !important; }
</style>

<style scoped>
.nge-pilot-admin { font-size: 1rem; line-height: 1.5; color: #f1f5f9; padding: 16px; }
.nge-pilot-admin h2 { font-size: 1.25rem; }
.nge-pilot-admin form, .nge-pilot-admin li { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:16px 0; }
.nge-pilot-admin label { flex-basis:100%; font-size:1rem; }
.nge-pilot-admin input { flex:1 1 220px; min-width:0; }
.nge-pilot-admin input, .nge-pilot-admin button { font:inherit; padding:10px 12px; border:1px solid #74859a; border-radius:6px; background:#152434; color:#f1f5f9; }
.nge-pilot-admin li span { flex:1 1 220px; overflow-wrap:anywhere; }
.nge-pilot-admin ul { padding:0; list-style:none; }
.nge-pilot-find { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:16px 0 4px; }
.nge-pilot-find span { color:#b6c2d1; font-size:0.9rem; }
.nge-pilot-name { font-weight:700; color:#fff; }
.nge-pilot-noname { font-style:normal; color:#93a1b3; }
.nge-pilot-admin button { cursor:pointer; }
.nge-beta-req li { align-items:flex-start; padding:10px 12px; margin:10px 0; border:1px solid rgba(116,133,154,0.45); border-radius:8px; background:rgba(21,36,52,0.55); }
.nge-beta-req-meta { display:block; font-style:normal; color:#93a1b3; font-size:0.9rem; }
.nge-beta-req-note { display:block; margin-top:4px; color:#d6deea; white-space:pre-wrap; overflow-wrap:anywhere; }
.nge-beta-req-in { font-style:normal; color:#7ee0a0; font-weight:700; align-self:center; }
.nge-beta-req-mail { color:#7ec8ff; align-self:center; }
.nge-beta-req-empty { color:#b6c2d1; }
.nge-beta-req { margin-bottom:28px; }
.nge-beta-req-ew { display:block; margin-top:4px; color:#b6c2d1; }
.nge-pilot-admin .nge-beta-req-acts { flex:0 1 auto; display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
.nge-beta-views { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 4px; }
.nge-pilot-admin .nge-beta-views button { padding:6px 12px; border-radius:999px; background:transparent; color:#b6c2d1; }
.nge-pilot-admin .nge-beta-views button span { opacity:0.75; margin-left:4px; }
.nge-pilot-admin .nge-beta-views .nge-beta-view--on { background:#1d3a55; color:#fff; border-color:#7ec8ff; }
.nge-outbox-line { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; font-size: 0.86em; line-height: 1.5;
  background: rgba(74, 150, 224, 0.08); border: 1px solid rgba(74, 150, 224, 0.25); }
.nge-triage-link { color: #7ec8ff; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; cursor: pointer; }
.nge-triage-link:hover { color: #b3e0ff; }
.nge-triage-light .nge-triage-link { color: #1f5fc4; }
.nge-triage-light .nge-triage-link:hover { color: #0d3f8f; }
.nge-triage-view-btn { text-decoration: none; display: inline-flex; align-items: center; margin-right: 6px; }
.nge-triage-preview-toggle { margin-left: auto; }
.nge-triage-preview-toggle[aria-pressed="true"] { border-color: rgba(79, 207, 255, 0.7); }
.nge-todo-icon { color: #7c9cff; vertical-align: -2px; margin-right: 5px; }
/* Triage zero: Nurro cheers (Ames 2026-10-23: "use nurro on triage zero"). */
/* Bigger, and a slow float up and back (Ames 2026-10-23: "bigger, slower"). */
.nge-triage-zero-nurro { display: block; width: 300px; height: 300px; object-fit: contain; margin: 10px auto 6px; animation: nge-zero-bob 8s ease-in-out infinite; }
@keyframes nge-zero-bob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(-2deg); } }
@media (prefers-reduced-motion: reduce) { .nge-triage-zero-nurro { animation: none; } }
.nge-triage-console-wrap { position: relative; flex-basis: 100%; }
.nge-triage-console-copy { position: sticky; float: right; top: 6px; margin: 6px 8px -34px 0; z-index: 1; padding: 4px 10px; border-radius: 6px; cursor: pointer;
  font: 600 12px Inter, system-ui, sans-serif; color: #fff; background: #4f8cff; border: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); }
.nge-triage-console-copy:hover { background: #3a74e8; }
/* Triage zero party. */
.nge-zero-party { position: fixed; inset: 0; z-index: 10070; pointer-events: auto; overflow: hidden; display: grid; place-items: center; background: rgba(255, 255, 255, 0.35); animation: nge-zero-fade 6s ease-out forwards; cursor: pointer; }
@keyframes nge-zero-fade { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
.nge-zero-bit { position: absolute; top: -20px; width: 8px; height: 14px; border-radius: 2px; animation-name: nge-zero-fall; animation-timing-function: cubic-bezier(.3,.6,.5,1); animation-fill-mode: both; }
.nge-zero-bit--wide { width: 14px; height: 8px; border-radius: 50%; }
@keyframes nge-zero-fall { from { transform: translateY(0) rotate(0); } to { transform: translateY(calc(110 * var(--nge-vh, 1vh))) rotate(calc(var(--r) * 3)); } }
.nge-zero-card { text-align: center; padding: 20px 34px 24px; border-radius: 20px; background: #ffffff; border: 2px solid #f5c542;
  box-shadow: 0 20px 50px rgba(40, 70, 140, 0.22), 0 0 30px rgba(245, 197, 66, 0.3); animation: nge-zero-pop 0.6s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes nge-zero-pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.nge-zero-card img { width: 220px; height: 220px; object-fit: contain; animation: nge-zero-bob 8s ease-in-out infinite; }
.nge-zero-title { font: 800 40px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em;
  color: #2f6fe0; }
.nge-zero-sub { margin-top: 6px; color: #3a4a66; font: 600 16px Inter, system-ui, sans-serif; }
@media (prefers-reduced-motion: reduce) { .nge-zero-bit { display: none; } .nge-zero-card, .nge-zero-card img { animation: none; } }
/* Duplicates. */
.nge-triage-dup { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; font-size: 12.5px; color: #62738c; }
.nge-triage-dup input { width: 52px; margin-left: 2px; padding: 3px 6px; border-radius: 6px; border: 1px solid #c3d3ec; font: inherit; }
.nge-triage-dup-badge { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 9px; background: #fde7f1; color: #b0306f; margin-left: 4px; }
.nge-triage-dup-badge--main { background: #e6f6f4; color: #11766c; }
.nge-admin-ok { margin: 6px 0; padding: 8px 12px; border-radius: 8px; background: #e6f6ee; color: #1d7038; font-size: 13px; }
</style>
