<script setup lang="ts">
import { secureWrite } from '../secure_write';
import {ref, computed, watch, nextTick, onMounted, onUnmounted} from 'vue';
import {useProofreadingBackendStore} from '../store';
import GrowingNeuron from 'components/GrowingNeuron.vue';
import {etNaiveToUtcIso, utcIsoToEtNaive, formatEt} from '../util/et_time';
import {renderSafeMarkdown} from '../util/safe_markdown';
import {htmlToMarkdown, htmlHasFormatting} from '../util/html_to_markdown';
import {supabase} from '../supabase';
import {getPcgInfo} from '../widgets/pcg_service';
import {mintShortStateLink} from '../util/state_link';
import {rootOfSupervoxel, resetPracticeExample, ensureSupervoxels, anySupervoxelOf, type PracticeExample, type PracticeKind} from '../practice';

const backend = useProofreadingBackendStore();

// standalone: the triage board on its own page (TriagePage.vue), with no
// game around it. Only the Triage tab, always as the board.
const props = defineProps<{ initialSubTab?: string; standalone?: boolean }>();

// Sub-tab: 'notifications' | 'groups' | 'badges' | 'triage'
const adminSubTab = ref<'notifications' | 'groups' | 'badges' | 'triage' | 'practice' | 'pilot'>(
  props.initialSubTab === 'triage' || props.initialSubTab === 'groups' || props.initialSubTab === 'badges' || props.initialSubTab === 'practice' || props.initialSubTab === 'pilot'
    ? props.initialSubTab
    : 'notifications');

// Pilot membership is an explicit admin-maintained list of verified sign-in emails.
const pilotRows = ref<{email:string;enabled:boolean}[]>([]);
const pilotEmail = ref('');
const pilotError = ref('');
const pilotBusy = ref(false);
async function loadPilot() {
  const {data,error} = await supabase.from('pilot_members').select('*').order('email');
  pilotError.value = error?.message || '';
  pilotRows.value = data || [];
}
async function invitePilot() {
  pilotBusy.value = true; pilotError.value = '';
  const {error} = await supabase.from('pilot_members').upsert({email:pilotEmail.value.trim().toLowerCase(),enabled:true},{onConflict:'email'});
  if(error) pilotError.value=error.message;
  else {pilotEmail.value='';await loadPilot();}
  pilotBusy.value=false;
}
async function setPilot(email:string,enabled:boolean) {
  const {error} = await supabase.from('pilot_members').update({enabled}).eq('email',email);
  if(error) pilotError.value=error.message; else await loadPilot();
}
watch(adminSubTab,t=>{if(t==='pilot')loadPilot();});

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
  feedback_log?: { user?: string; text: string; ts: string; role: string; by?: string; at?: string; via?: string; sent?: boolean; echoed?: boolean }[];
  result_note?: string | null;
  nag_count?: number;
  approver_slack_id?: string | null;
  tested_by?: string | null;
  slack_ts?: string | null;
  slack_channel?: string | null;
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
const reporters = ref<Record<string, { name: string; category: string; at: string }>>({});
async function loadReporters(rows: TriageRow[]) {
  const ids = [...new Set(rows.filter(r => r.source === 'site_issue' && r.source_id && !reporters.value[r.source_id]).map(r => r.source_id))];
  if (!ids.length) return;
  try {
    const { supabase } = await import('../supabase');
    const { data } = await supabase.from('site_issues').select('id,user_name,category,created_at').in('id', ids);
    const next = { ...reporters.value };
    for (const i of (data ?? []) as any[]) next[i.id] = { name: i.user_name || 'Unknown player', category: i.category || '', at: i.created_at || '' };
    reporters.value = next;
  } catch (e) { console.warn('[triage] could not load who submitted:', e); }
}
const reporterOf = (r: TriageRow) => (r.source === 'site_issue' ? reporters.value[r.source_id] : undefined);
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ── Board: open work on top, finished and dismissed folded away ───────────
// Slack and this tab write the same rows, so a dismiss, stop or "good" in a
// Slack thread moves the card here too (after Refresh).
type TriageGroupKey = 'decide' | 'progress' | 'done' | 'dismissed';
const triageOpen = ref<Record<TriageGroupKey, boolean>>({ decide: true, progress: true, done: false, dismissed: false });

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
const boardUrl = `${window.location.origin}${window.location.pathname}?triage=board`;
function onBoardKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && triageBoard.value && !props.standalone && !(e.target as HTMLElement)?.closest?.('textarea, input')) triageBoard.value = false;
}
onMounted(() => document.addEventListener('keydown', onBoardKey));
onUnmounted(() => document.removeEventListener('keydown', onBoardKey));
function triageGroupOf(r: TriageRow): TriageGroupKey {
  if (r.status === 'dismissed') return 'dismissed';
  if (r.status === 'done' || r.impl_state === 'deployed') return 'done';
  if (r.status === 'proposed') return 'decide';
  return 'progress';
}
const triageGroups = computed(() => {
  const defs: { key: TriageGroupKey; title: string; hint: string; closed: boolean }[] = [
    { key: 'decide', title: 'Needs your decision', hint: 'Approve or dismiss', closed: false },
    { key: 'progress', title: 'In progress', hint: 'Approved: building, testing or waiting', closed: false },
    { key: 'done', title: 'Done', hint: 'Shipped or handled', closed: true },
    { key: 'dismissed', title: 'Dismissed', hint: 'Stopped or turned down', closed: true },
  ];
  return defs.map(d => ({ ...d, rows: triageRows.value.filter(r => triageGroupOf(r) === d.key) }));
});

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
    // Discarded reports are off the board unless you ask for older ones.
    triageRows.value = ((data ?? []) as TriageRow[]).filter(r => triageShowReviewed.value || !isDiscarded(r));
    void loadReporters(triageRows.value);
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

async function setTriageStatus(row: TriageRow, status: 'approved' | 'dismissed' | 'done', discard = false, builtElsewhere = false) {
  if (triageActing.value) return;
  if (discard && !window.confirm('Discard this report? It is dismissed and taken off the board. Any build in progress is stopped. You can still find it with "Show older".')) return;
  // Shipping a change closes the loop in Slack: the bridge posts a change
  // update into the original thread and tags the approvers, carrying this
  // note. Blank is fine, the update just goes noteless.
  let resultNote: string | null = null;
  if (status === 'done') {
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
    `Report (${row.source.replace('_', ' ')}, ${row.created_at.slice(0, 10)}): "${row.source_excerpt || ''}"`,
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

/** Draft from the card's state. Never includes the internal reviewer comment. */
function draftReporterUpdate(row: TriageRow): string {
  const t = (row.source_excerpt || '').trim();
  const q = t ? `You reported: "${t.length > 90 ? t.slice(0, 87) + '...' : t}".` : 'Thanks for your report.';
  if (row.status === 'done' || row.impl_state === 'deployed') {
    // Same wording as the bridge's fixedNote: thanks, their words, what was built.
    const fix = String(row.result_note || row.impl_summary || '')
      .replace(/\(tested[^)]*\)\.?/gi, ' ').replace(/\bDetails:\s*<?https?:\S+/gi, ' ')
      .replace(/<@[A-Z0-9]+>/g, ' ').replace(/<(https?:[^|>]+)(\|[^>]*)?>/g, '$1')
      .replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
      // "QUESTION: ..." is Claude asking the approver, not a fix: never sent on.
      .replace(/^\s*(?:#+\s*)?(?:QUESTION|BLOCKED)\s*:[\s\S]*$/i, '');
    const thanks = t ? `Thank you for submitting: "${t.length > 200 ? t.slice(0, 197) + '...' : t}".` : 'Thank you for your report.';
    return `${thanks} A fix has been built and deployed${fix ? `: ${fix}.` : '.'}`;
  }
  if (row.status === 'dismissed') {
    return `${q} Thanks for taking the time to tell us. We looked into it and decided not to change this for now. Please keep the reports coming, they really help.`;
  }
  if (row.status === 'approved') {
    return isBuildable(row)
      ? `${q} Thanks! The team accepted it and a fix is in the works. We'll let you know when it's live.`
      : `${q} Thanks! The team reviewed it and is following up.`;
  }
  return `${q} Thanks! The team has it and is looking into it now.`;
}

function closeReporterDraft(row: TriageRow) {
  delete reporterDrafts.value[row.id];
}

function reporterUpdatesFor(row: TriageRow) {
  return (row.feedback_log || []).filter(e => e.role === 'reporter_update' && e.sent !== false);
}

function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

async function sendReporterUpdate(row: TriageRow) {
  const text = (reporterDrafts.value[row.id] || '').trim();
  if (!text || reporterSending.value) return;
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
    await secureWrite('notification.insert', { row: {
      title: '💬 An update on your report',
      body: text,
      thumbnail_url: `${storageBase}/nurro/guide-avatar.png`,
      image_url: `${storageBase}/nurro-neurons/neuron-${1 + Math.floor(Math.random() * 24)}.jpg`,
      target_type: 'user',
      target_id: userId,
      send_at: new Date().toISOString(),
    } });
    // Re-read the log right before appending, so a bridge write in between
    // is not overwritten.
    const { data: fresh } = await supabase.from('feedback_triage').select('feedback_log').eq('id', row.id).single();
    const log = Array.isArray(fresh?.feedback_log) ? [...fresh!.feedback_log] : [];
    const at = new Date().toISOString();
    log.push({ role: 'reporter_update', via: 'admin', by: backend.userName || backend.userEmail || 'admin', text, ts: at, at, sent: true, echoed: false });
    await secureWrite('triage.update', { id: row.id, fields: { feedback_log: log } })
      .catch((lErr: any) => console.warn('[triage] reporter update sent but not logged:', lErr?.message));
    delete reporterDrafts.value[row.id];
    await loadTriage();
  } catch (e: any) {
    triageError.value = `Could not send the update: ${e?.message ?? String(e)}`;
  } finally {
    reporterSending.value = null;
  }
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
const notifPreview = computed(() => renderSafeMarkdown(notifBody.value, true));
function replaceSelection(text: string, selectFrom?: number, selectTo?: number) {
  const el = notifBodyEl.value;
  if (!el) { notifBody.value += text; return; }
  const a = el.selectionStart, b = el.selectionEnd;
  notifBody.value = el.value.slice(0, a) + text + el.value.slice(b);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + (selectFrom ?? text.length), a + (selectTo ?? text.length));
  });
}
function onNotifPaste(e: ClipboardEvent) {
  const html = e.clipboardData?.getData('text/html') || '';
  if (!html || !htmlHasFormatting(html)) return;   // plain paste as usual
  const md = htmlToMarkdown(html);
  if (!md) return;
  e.preventDefault();
  replaceSelection(md);
}
/** Wrap the selection in a marker (bold, italic), or drop in a placeholder. */
function fmtWrap(mark: string, placeholder: string) {
  const el = notifBodyEl.value;
  const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  const inner = sel || placeholder;
  replaceSelection(`${mark}${inner}${mark}`, mark.length, mark.length + inner.length);
}
/** Start each selected line with a prefix (heading, bullet). */
function fmtLines(prefix: string, placeholder: string) {
  const el = notifBodyEl.value;
  if (!el) return;
  const v = el.value;
  const a = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
  let b = v.indexOf('\n', el.selectionEnd);
  if (b < 0) b = v.length;
  const lines = (v.slice(a, b) || placeholder).split('\n')
    .map(l => prefix + l.replace(/^(#{1,4}\s+|[-*]\s+)/, ''));
  el.setSelectionRange(a, b);
  replaceSelection(lines.join('\n'));
}
function fmtLink() {
  const el = notifBodyEl.value;
  const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  const text = sel || 'link text';
  replaceSelection(`[${text}](https://)`, text.length + 3, text.length + 11);
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
  if (t.includes('Weekly Champions')) return 'weeklyChampions';
  if (t.includes('Week in Science')) return 'weeklyRecap';
  if (t.includes('Response to your help request')) return 'helpResponse';
  if (t === '✨ New Achievement!') return 'customBadge';         // admin-awarded special badge
  if (t.includes('New Achievement')) return 'personalBadge';     // tutorial / building / exploration
  return 'announcement';
}

const NOTIF_CATEGORIES: { key: string; label: string }[] = [
  { key: 'announcement',    label: 'Announcements' },
  { key: 'weeklyChampions', label: 'Weekly champions' },
  { key: 'customBadge',     label: 'Custom badges' },
  { key: 'personalBadge',   label: 'Personal badges' },
  { key: 'weeklyRecap',     label: 'Weekly recaps' },
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

const scheduledNotifs = computed(() => backend.adminNotifications.filter(n => notifStage(n) === 'scheduled' && isCategoryVisible(n)));
const activeNotifs    = computed(() => backend.adminNotifications.filter(n => notifStage(n) === 'active'   && isCategoryVisible(n)));
const expiredNotifs   = computed(() => backend.adminNotifications.filter(n => notifStage(n) === 'expired'  && isCategoryVisible(n)));

/** Load an existing notification into the compose form for editing. */
function startEdit(n: any) {
  editingId.value = n.id;
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

async function sendNotification() {
  if (!notifTitle.value.trim() || !notifBody.value.trim()) return;
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
        title: '✨ New Achievement!',
        body: `You earned the "${badge.name}" award!${badge.description ? ' — ' + badge.description : ''}`,
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
}

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
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'badges' }" @click="adminSubTab = 'badges'">Special Badges</button>
      <!-- Triage lives on its own page: the full board, in a new tab (Ames 2026-10-05). -->
      <a class="nge-admin-subtab nge-admin-subtab--triage" :href="boardUrl" target="_blank" rel="noopener" title="Opens the triage board in a new tab">Triage ↗</a>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'practice' }" @click="adminSubTab = 'practice'">Practice cells</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'pilot' }" @click="adminSubTab = 'pilot'">Pilot testers</button>
    </div>

    <!-- ── Notifications ── -->
    <section v-if="adminSubTab === 'pilot'" class="nge-pilot-admin">
      <h2>Pilot testers</h2>
      <p>Invited testers can claim cells, use practice cells, sync Sheets, and contribute to the site. Existing administrators already have access.</p>
      <form @submit.prevent="invitePilot">
        <label for="nge-pilot-email">Tester’s sign-in email</label>
        <input id="nge-pilot-email" v-model="pilotEmail" type="email" required autocomplete="off" placeholder="tester@example.com" />
        <button type="submit" :disabled="pilotBusy">{{ pilotBusy ? 'Saving…' : 'Add tester' }}</button>
      </form>
      <p v-if="pilotError" role="alert">{{ pilotError }}</p>
      <p v-if="!pilotRows.length">No additional testers invited yet.</p>
      <ul><li v-for="member in pilotRows" :key="member.email">
        <span>{{ member.email }} · {{ member.enabled ? 'Invited' : 'Access paused' }}</span>
        <button @click="setPilot(member.email,!member.enabled)">{{ member.enabled ? 'Pause access' : 'Restore access' }}</button>
      </li></ul>
    </section>

    <div v-if="adminSubTab === 'notifications'" class="nge-admin-section">
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
          <button type="button" title="Link" @click="fmtLink">Link</button>
          <span class="nge-admin-fmthint">Paste formatted text and it keeps its bold, headings, lists and links.</span>
        </div>
        <textarea ref="notifBodyEl" v-model="notifBody" class="nge-admin-textarea" rows="6" placeholder="Message body..." @paste="onNotifPaste"></textarea>
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
            <span>Expires at <em class="nge-admin-tz">(ET)</em></span>
            <input type="datetime-local" v-model="notifExpiresAt" class="nge-admin-date-input" />
          </label>
        </div>
        <p v-if="notifSendAt" class="nge-admin-hint">
          Sends {{ formatEt(etNaiveToUtcIso(notifSendAt)) }} — times are Eastern regardless of your own timezone.
        </p>
        <p v-else class="nge-admin-hint">Leave "Send at" empty to send immediately</p>
        <div class="nge-admin-row">
          <label class="nge-admin-check"><input type="checkbox" v-model="notifPostToChat" /> Also post to chat</label>
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
        <p class="nge-admin-hint">Images up to 3 MB (PNG, JPEG, WebP, GIF). The feed always loads the small icon, not the full image.</p>
        <div class="nge-admin-row">
          <button class="nge-admin-primary-btn" :disabled="notifSending || !notifTitle.trim() || !notifBody.trim()" @click="sendNotification">
            <span v-if="notifSent">✓ Saved!</span>
            <span v-else-if="notifSending">{{ notifSteps.find(x => x.key === notifSendStage)?.label || 'Sending' }}…</span>
            <span v-else-if="editingId != null">Save Changes</span>
            <span v-else>Send Notification</span>
          </button>
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
              <span v-if="n.expires_at"> · expires {{ formatEt(n.expires_at) }}</span>
            </span>
          </div>
          <button class="nge-admin-edit-btn" @click="startEdit(n)" title="Edit this notification (changes it in place, sends nothing new)">&#9998; Edit</button>
          <button class="nge-admin-delete-btn" @click="requestDelete(n)" title="Delete">&times;</button>
        </div>
      </div>

      <!-- Expired: no edit button. Editing something nobody can see any more
           would just be misleading, so these are read-only apart from delete. -->
      <div class="nge-admin-block" v-if="expiredNotifs.length > 0">
        <label class="nge-admin-label">Expired ({{ expiredNotifs.length }})</label>
        <div v-for="n in expiredNotifs" :key="n.id" class="nge-admin-notif-row nge-admin-notif-row--expired">
          <div class="nge-admin-notif-info">
            <strong>{{ n.title }}</strong>
            <span class="nge-admin-notif-meta">{{ n.target_type }} · expired {{ formatEt(n.expires_at) }}</span>
          </div>
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
        <div class="nge-admin-badge-grid">
          <div v-for="b in backend.specialBadges" :key="b.id"
            class="nge-admin-badge-card" :class="{ 'nge-admin-badge-card--selected': awardBadgeId === b.id }"
            @click="selectBadgeForAward(b.id)" :title="b.description || b.name">
            <img v-if="b.thumbnail_url || b.image_url" :src="b.thumbnail_url || b.image_url" class="nge-admin-badge-img" />
            <div class="nge-admin-badge-name">{{ b.name }}</div>
          </div>
        </div>

        <div v-if="awardSuccess" class="nge-admin-success">{{ awardSuccess }}</div>

        <div v-if="awardBadgeId" class="nge-admin-award-section">
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
      <div class="nge-admin-block" :class="{ 'nge-triage-board': triageBoard }">
        <div class="nge-triage-head">
          <label class="nge-admin-label">Feedback Triage</label>
          <button v-if="!standalone" class="nge-admin-action-btn" @click="triageBoard = !triageBoard"
                  :title="triageBoard ? 'Back to the list in the Admin Hub (Esc)' : 'Fill the window: one column per section'">{{ triageBoard ? '✕ Close board' : '▦ Board view' }}</button>
          <a v-if="!standalone" class="nge-admin-action-btn nge-triage-newtab" :href="boardUrl" target="_blank" rel="noopener" title="Open the triage board on its own page, without the game">↗ New tab</a>
          <label class="nge-triage-toggle">
            <input type="checkbox" v-model="triageShowReviewed" />
            <span>Show older</span>
          </label>
          <button class="nge-admin-action-btn" @click="loadTriage" :disabled="triageLoading">↻ Refresh</button>
        </div>
        <div class="nge-admin-hint">
          The triage agent reads every incoming report and proposes an action.
          Nothing happens until you approve it, here or in Slack; both show the
          same list. Approving "Send a message" delivers the text to the
          reporter. Approving a fix sends it to Claude, who posts a preview in
          the Slack thread for you to test before anything goes live.
        </div>
        <div v-if="triageError" class="nge-admin-error">⚠ {{ triageError }}</div>
        <div v-if="triageLoading && !triageRows.length" class="nge-admin-hint">Loading…</div>
        <div v-else-if="!triageRows.length" class="nge-admin-hint">
          No proposals waiting. The agent runs on a schedule; new feedback shows up here after its next pass.
        </div>

        <div class="nge-triage-cols">
        <div v-for="g in triageGroups" :key="g.key" class="nge-triage-col" :class="`nge-triage-col--${g.key}`">
        <button
          v-if="triageRows.length"
          class="nge-triage-group"
          :class="{ 'nge-triage-group--open': triageOpen[g.key], 'nge-triage-group--empty': !g.rows.length }"
          :aria-expanded="triageOpen[g.key] ? 'true' : 'false'"
          @click="triageOpen[g.key] = !triageOpen[g.key]"
        >
          <span class="nge-triage-group-caret" aria-hidden="true">▸</span>
          <span class="nge-triage-group-title">{{ g.title }}</span>
          <span class="nge-triage-group-count">{{ g.rows.length }}</span>
          <span class="nge-triage-group-hint">{{ g.hint }}</span>
        </button>
        <template v-if="triageBoard || triageOpen[g.key]">
        <div v-for="row in g.rows" :key="row.id" class="nge-triage-card" :data-triage-id="row.id"
             :class="{ 'nge-triage-card--closed': g.closed, 'nge-triage-card--selected': triageSelected === row.id }"
             @click="triageSelected = row.id">
          <div class="nge-triage-meta">
            <span class="nge-triage-rec" :class="`nge-triage-rec--${row.recommendation}`">{{ TRIAGE_LABELS[row.recommendation] }}</span>
            <span class="nge-triage-src">{{ row.source.replace('_', ' ') }}</span>
            <span v-if="row.status !== 'proposed'" class="nge-triage-status">{{ row.status }}<template v-if="row.reviewed_by"> · {{ row.reviewed_by.startsWith('slack:') ? 'in Slack' : row.reviewed_by }}</template></span>
            <span v-if="row.impl_state" class="nge-triage-impl" :class="`nge-triage-impl--${row.impl_state}`">{{ IMPL_LABELS[row.impl_state] }}</span>
            <a v-if="slackThreadUrl(row)" class="nge-triage-link" :href="slackThreadUrl(row) || undefined" target="_blank" rel="noopener">Slack thread</a>
          </div>
          <div v-if="reporterOf(row)" class="nge-triage-from">
            From <strong>{{ reporterOf(row)?.name }}</strong><template v-if="reporterOf(row)?.category"> · {{ reporterOf(row)?.category }}</template><template v-if="reporterOf(row)?.at"> · {{ shortDate(reporterOf(row)?.at || '') }}</template>
          </div>
          <div v-if="row.source_excerpt" class="nge-triage-excerpt">"{{ row.source_excerpt }}"</div>
          <div v-if="row.source === 'site_issue'" class="nge-triage-console">
            <button class="nge-triage-console-btn" @click="toggleIssueConsole(row)">
              {{ issueConsole[row.id] === undefined ? '🖥 Console messages' : issueConsoleOpen[row.id] ? '▾ Console messages' : '▸ Console messages' }}
            </button>
            <pre v-if="issueConsoleOpen[row.id]" class="nge-triage-console-log">{{ issueConsole[row.id] || 'No console messages were attached to this report.' }}</pre>
          </div>
          <div v-if="row.rationale" class="nge-triage-rationale">{{ row.rationale }}</div>
          <textarea
            v-if="row.recommendation === 'message' && row.status === 'proposed'"
            v-model="triageEdits[row.id]"
            class="nge-triage-message"
            rows="3"
            @keydown.stop @keyup.stop @keypress.stop
          ></textarea>
          <div v-else-if="row.proposed_message" class="nge-triage-rationale">💬 {{ row.proposed_message }}</div>
          <div v-if="row.spec" class="nge-triage-spec">
            <div v-for="(line, i) in parseSpec(row.spec)" :key="i" class="nge-triage-spec-row">
              <span v-if="line.label" class="nge-triage-spec-label">{{ line.label }}</span>
              <span class="nge-triage-spec-text">{{ line.text }}</span>
            </div>
          </div>
          <div v-if="row.approver_note" class="nge-triage-note">
            <span class="nge-triage-spec-label">Comment</span>
            <span class="nge-triage-spec-text">{{ row.approver_note }}</span>
          </div>
          <div v-if="row.impl_state" class="nge-triage-loop">
            <div v-if="row.impl_summary"><span class="nge-triage-spec-label">Change</span> {{ row.impl_summary }}</div>
            <div v-if="row.preview_url"><span class="nge-triage-spec-label">Preview</span> <a :href="row.preview_url" target="_blank" rel="noopener">{{ row.preview_url }}</a></div>
            <div v-if="row.impl_state === 'testing' || row.impl_state === 'live_testing' || row.impl_state === 'needs_info'"><span class="nge-triage-spec-label">Waiting on</span> the tester in the Slack thread{{ row.impl_state === 'needs_info' ? ', to answer Claude' : '' }}. Reminded {{ row.nag_count || 0 }} time{{ row.nag_count === 1 ? '' : 's' }}.</div>
            <div v-for="f in (row.feedback_log || []).slice(-3)" :key="f.ts"><span class="nge-triage-spec-label">{{ roleLabel(f.role) }}</span> {{ f.text }}</div>
            <div v-if="row.impl_run_url"><a :href="row.impl_run_url" target="_blank" rel="noopener">Claude's run log</a><template v-if="row.impl_attempts"> · attempt {{ row.impl_attempts }}</template></div>
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
            <button class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'approved')">
              {{ (row.recommendation === 'message' ? 'Approve + Send' : 'Approve') + (triageNotes[row.id]?.trim() ? ' with comment' : '') }}
            </button>
            <button class="nge-admin-action-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'dismissed')">
              {{ triageNotes[row.id]?.trim() ? 'Dismiss with comment' : 'Dismiss' }}
            </button>
          </div>
          <div v-else-if="row.status === 'approved'" class="nge-triage-actions">
            <button v-if="isBuildable(row) && !row.impl_state" class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setImplState(row, 'queued')">Have Claude build it</button>
            <button v-if="row.impl_state === 'failed' && !releaseBuildOf(row)" class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setImplState(row, 'queued')">Retry build</button>
          </div>
          <div class="nge-triage-claude">
            <button class="nge-admin-action-btn" @click="openInClaude(row)" title="Copies a full briefing and opens a new Claude chat with it. Paste the briefing into Claude Code to change the code.">Work on it with Claude</button>
            <!-- Done, on every card that is not already done (Ames 2026-10-01:
                 "a lot of the time I fix in Claude"), whatever state it is in:
                 waiting for a decision, in progress, or dismissed. -->
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
          <div v-if="row.source === 'site_issue'" class="nge-triage-reporter">
            <div v-for="u in reporterUpdatesFor(row)" :key="u.ts" class="nge-triage-note">
              <span class="nge-triage-spec-label">Sent to submitter</span>
              <span class="nge-triage-spec-text">{{ u.text }}<span class="nge-triage-reporter-by"> · {{ u.by || 'Slack' }}{{ u.at ? ', ' + relTime(u.at) : '' }}</span></span>
            </div>
            <template v-if="reporterDrafts[row.id] !== undefined">
              <textarea
                v-model="reporterDrafts[row.id]"
                class="nge-triage-message nge-triage-comment"
                rows="3"
                @keydown.stop @keyup.stop @keypress.stop
              ></textarea>
              <div class="nge-triage-actions">
                <button class="nge-admin-primary-btn" :disabled="reporterSending === row.id || !reporterDrafts[row.id]?.trim()" @click="sendReporterUpdate(row)">
                  {{ reporterSending === row.id ? 'Sending…' : 'Send to submitter' }}
                </button>
                <button class="nge-admin-action-btn" :disabled="reporterSending === row.id" @click="closeReporterDraft(row)">Not now</button>
              </div>
            </template>
            <button v-else class="nge-admin-action-btn nge-triage-reporter-open" @click="reporterDrafts[row.id] = draftReporterUpdate(row)"
                    title="Draft a notification to the person who reported this. You can edit it before sending, or not send it.">✉ Update submitter</button>
          </div>
        </div>
        <div v-if="triageBoard && !g.rows.length" class="nge-triage-col-empty">Nothing here</div>
        </template>
        </div>
        </div>
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
  max-width: calc(100vw - 32px);
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
.nge-triage-head { display: flex; align-items: center; gap: 12px; }
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
.nge-triage-board .nge-triage-card:hover { border-color: rgba(79, 207, 255, 0.45); }
/* Compact until clicked: who, what they said, where it stands. */
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) > :not(.nge-triage-meta):not(.nge-triage-from):not(.nge-triage-excerpt) { display: none; }
.nge-triage-board .nge-triage-card:not(.nge-triage-card--selected) .nge-triage-excerpt {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.nge-triage-board .nge-triage-card--selected { cursor: default; }
.nge-triage-col-empty { padding: 14px 4px; color: #62738c; font-size: 0.9em; text-align: center; }
@media (max-width: 1100px) {
  .nge-triage-board .nge-triage-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }
}
.nge-triage-discard-btn { color: #d79a9a; border-color: rgba(255, 120, 120, 0.3); }
.nge-triage-discard-btn:hover:not(:disabled) { background: rgba(255, 90, 90, 0.12); color: #ffb3b3; }
.nge-triage-claude { flex-wrap: wrap; }
.nge-triage-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-triage-from { font-size: 0.86em; color: #9fb3cc; }
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
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em;
  padding: 1px 8px; border-radius: 9px; text-transform: uppercase;
}
.nge-triage-rec--nothing      { background: rgba(255,255,255,0.08); color: #aab; }
.nge-triage-rec--message      { background: rgba(100,200,255,0.14); color: #64c8ff; }
.nge-triage-rec--bug_fix_spec { background: rgba(255,120,120,0.14); color: #f88; }
.nge-triage-rec--new_feature  { background: rgba(160,255,160,0.12); color: #8e8; }
.nge-triage-src { font-size: 11px; color: rgba(255,255,255,0.4); }
.nge-triage-status { font-size: 11px; color: rgba(255,255,255,0.62); }
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
.nge-triage-link { font-size: 11px; color: #8fd3ff; }
.nge-triage-claude { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nge-triage-copied { font-size: 12px; color: #8ee88e; }
.nge-triage-note { font-size: 12px; color: rgba(235,238,250,0.88); line-height: 1.45; }
.nge-triage-loop {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 12px; color: rgba(235,238,250,0.88); line-height: 1.45;
  padding: 8px 10px; border-radius: 6px; background: rgba(255,255,255,0.03);
}
.nge-triage-loop a { color: #8fd3ff; word-break: break-all; }
.nge-triage-excerpt { font-size: 12px; color: rgba(255,255,255,0.75); }
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
.nge-triage-rationale { font-size: 11.5px; color: rgba(255,255,255,0.5); line-height: 1.4; }
.nge-triage-message {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(100,200,255,0.2);
  border-radius: 6px; color: #dde; font-size: 12px; padding: 7px 9px; resize: vertical;
}
.nge-triage-comment { border-color: rgba(255,255,255,0.14); font-family: inherit; }
.nge-triage-reporter {
  display: flex; flex-direction: column; gap: 6px;
  padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08);
}
.nge-triage-reporter-open { align-self: flex-start; }
.nge-triage-reporter-by { color: rgba(255,255,255,0.45); }
.nge-triage-note {
  display: flex; gap: 8px; align-items: baseline;
  font-size: 12px; line-height: 1.45;
  padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.04);
}
.nge-triage-spec {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; color: #ccd; font-size: 12px; padding: 9px 11px;
  max-height: 240px; overflow-y: auto; margin: 0;
  display: flex; flex-direction: column; gap: 5px;
}
.nge-triage-spec-row { display: flex; gap: 8px; align-items: baseline; line-height: 1.45; }
.nge-triage-spec-label {
  flex: none; min-width: 62px;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.07em;
  text-transform: uppercase; color: rgba(100, 200, 255, 0.75);
}
.nge-triage-spec-text { color: rgba(235, 238, 250, 0.88); }
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
  display: flex; align-items: center; gap: 18px;
  margin: 10px 0 4px; padding: 12px 16px;
  border: 1px solid rgba(126, 224, 255, 0.2); border-radius: 10px;
  background: rgba(8, 14, 28, 0.6);
}
.nge-admin-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
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
.nge-pilot-admin button { cursor:pointer; }
</style>
