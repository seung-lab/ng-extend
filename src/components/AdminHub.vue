<script setup lang="ts">
import {ref, computed, watch, onMounted} from 'vue';
import {useProofreadingBackendStore} from '../store';
import {etNaiveToUtcIso, utcIsoToEtNaive, formatEt} from '../util/et_time';

const backend = useProofreadingBackendStore();

const props = defineProps<{ initialSubTab?: string }>();

// Sub-tab: 'notifications' | 'groups' | 'badges' | 'triage'
const adminSubTab = ref<'notifications' | 'groups' | 'badges' | 'triage'>(
  props.initialSubTab === 'triage' || props.initialSubTab === 'groups' || props.initialSubTab === 'badges'
    ? props.initialSubTab
    : 'notifications');

// ── Feedback triage ──────────────────────────────────────────────────────────
// A scheduled agent reads incoming feedback (site_issues, client_errors) and
// proposes an action per item into feedback_triage. This subtab is the human
// gate: Amy or Celia approve, edit, or dismiss. Approving a 'message'
// proposal sends it to the reporter as a notification; approving a spec just
// marks it accepted for the work queue.
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
}
const triageRows = ref<TriageRow[]>([]);
const triageLoading = ref(false);
const triageError = ref('');
const triageShowReviewed = ref(false);
const triageActing = ref<string | null>(null);
/** Per-row edited message text, keyed by triage row id. */
const triageEdits = ref<Record<string, string>>({});

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
  return spec.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(Symptom|What|Where|Cause|Fix|Scope|Severity)\s*:\s*(.*)$/i);
    return m ? { label: m[1], text: m[2] } : { label: null, text: line };
  });
}

async function loadTriage() {
  triageLoading.value = true;
  triageError.value = '';
  try {
    const { supabase } = await import('../supabase');
    let q = supabase.from('feedback_triage').select('*').order('created_at', { ascending: false }).limit(100);
    if (!triageShowReviewed.value) q = q.eq('status', 'proposed');
    const { data, error } = await q;
    if (error) throw error;
    triageRows.value = (data ?? []) as TriageRow[];
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

async function setTriageStatus(row: TriageRow, status: 'approved' | 'dismissed' | 'done') {
  if (triageActing.value) return;
  // Shipping a change closes the loop in Slack: the bridge posts a change
  // update into the original thread and tags the approvers, carrying this
  // note. Blank is fine, the update just goes noteless.
  let resultNote: string | null = null;
  if (status === 'done') {
    resultNote = (window.prompt('One line for the Slack update (what shipped?)', '') || '').trim() || null;
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
        await supabase.from('notifications').insert({
          title: '💬 Nurro replied to your feedback',
          body: text,
          thumbnail_url: `${storageBase}/nurro/guide-avatar.png`,
          image_url: `${storageBase}/nurro-neurons/neuron-${1 + Math.floor(Math.random() * 24)}.jpg`,
          target_type: targetUserId ? 'user' : 'all',
          target_id: targetUserId,
          send_at: new Date().toISOString(),
          created_by: backend.userId,
        });
      }
    }

    const { error } = await supabase.from('feedback_triage').update({
      status,
      proposed_message: (triageEdits.value[row.id] ?? row.proposed_message) || null,
      ...(status === 'done' ? { result_note: resultNote } : {}),
      reviewed_by: backend.userName || backend.userEmail || 'admin',
      reviewed_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) throw error;
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
const notifTargetType = ref<'all' | 'group' | 'user'>('all');
const notifTargetId = ref('');
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
  notifSending.value = true;
  notifError.value = '';
  try {
    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    if (notifImageFile.value) {
      const urls = await backend.uploadAdminImage(notifImageFile.value, 'notifications');
      imageUrl = urls.fullUrl;
      thumbnailUrl = urls.thumbUrl;
    }
    // An explicitly-supplied icon wins over the thumbnail auto-cropped from the
    // hero image — that crop often reads badly at feed size.
    if (notifIconFile.value) {
      thumbnailUrl = await backend.uploadAdminIcon(notifIconFile.value);
    }

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
      notifSent.value = true;
      setTimeout(() => { notifSent.value = false; }, 2000);
      await backend.loadAdminNotifications();
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
    notifSent.value = true;
    setTimeout(() => { notifSent.value = false; }, 2000);
    // Refresh the admin list so a newly-scheduled notification appears in it.
    await backend.loadAdminNotifications();
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
    <div class="nge-admin-subtabs">
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'notifications' }" @click="adminSubTab = 'notifications'">Notifications</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'groups' }" @click="adminSubTab = 'groups'">Groups</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'badges' }" @click="adminSubTab = 'badges'">Special Badges</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'triage' }" @click="adminSubTab = 'triage'">Triage</button>
    </div>

    <!-- ── Notifications ── -->
    <div v-if="adminSubTab === 'notifications'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">
          {{ editingId != null ? 'Editing Notification' : 'Send Notification' }}
        </label>
        <div v-if="editingId != null" class="nge-admin-editing-banner">
          Editing an existing notification. Changes apply to everyone who can see it.
        </div>
        <input v-model="notifTitle" class="nge-admin-input" placeholder="Title" />
        <textarea v-model="notifBody" class="nge-admin-textarea" rows="3" placeholder="Message body..."></textarea>
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
          <input v-if="notifTargetType === 'user'" v-model="notifTargetId" class="nge-admin-input nge-admin-input--sm" placeholder="User ID" />
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
        <p class="nge-admin-hint">Images up to 8 MB (PNG, JPEG, WebP, GIF). The feed always loads the small icon, not the full image.</p>
        <div class="nge-admin-row">
          <button class="nge-admin-primary-btn" :disabled="notifSending || !notifTitle.trim() || !notifBody.trim()" @click="sendNotification">
            <span v-if="notifSent">✓ Saved!</span>
            <span v-else-if="notifSending">Saving...</span>
            <span v-else-if="editingId != null">Save Changes</span>
            <span v-else>Send Notification</span>
          </button>
          <button v-if="editingId != null" class="nge-admin-cancel-btn" @click="cancelEdit">Cancel edit</button>
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
          <button class="nge-admin-edit-btn" @click="startEdit(n)" title="Edit">&#9998;</button>
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
          <button class="nge-admin-edit-btn" @click="startEdit(n)" title="Edit">&#9998;</button>
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

    <!-- ═══ TRIAGE (agent proposals awaiting human review) ═══ -->
    <div v-if="adminSubTab === 'triage'" class="nge-admin-section">
      <div class="nge-admin-block">
        <div class="nge-triage-head">
          <label class="nge-admin-label">Feedback Triage</label>
          <label class="nge-triage-toggle">
            <input type="checkbox" v-model="triageShowReviewed" />
            <span>Show reviewed</span>
          </label>
          <button class="nge-admin-action-btn" @click="loadTriage" :disabled="triageLoading">↻ Refresh</button>
        </div>
        <div class="nge-admin-hint">
          The triage agent reads every incoming report and proposes an action.
          Nothing happens until you approve it here. Approving "Send a message"
          delivers the text below to the reporter as a notification.
        </div>
        <div v-if="triageError" class="nge-admin-error">⚠ {{ triageError }}</div>
        <div v-if="triageLoading && !triageRows.length" class="nge-admin-hint">Loading…</div>
        <div v-else-if="!triageRows.length" class="nge-admin-hint">
          No proposals waiting. The agent runs on a schedule; new feedback shows up here after its next pass.
        </div>

        <div v-for="row in triageRows" :key="row.id" class="nge-triage-card">
          <div class="nge-triage-meta">
            <span class="nge-triage-rec" :class="`nge-triage-rec--${row.recommendation}`">{{ TRIAGE_LABELS[row.recommendation] }}</span>
            <span class="nge-triage-src">{{ row.source.replace('_', ' ') }}</span>
            <span v-if="row.status !== 'proposed'" class="nge-triage-status">{{ row.status }}<template v-if="row.reviewed_by"> · {{ row.reviewed_by }}</template></span>
          </div>
          <div v-if="row.source_excerpt" class="nge-triage-excerpt">"{{ row.source_excerpt }}"</div>
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
          <div v-if="row.status === 'proposed'" class="nge-triage-actions">
            <button class="nge-admin-primary-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'approved')">
              {{ row.recommendation === 'message' ? 'Approve + Send' : 'Approve' }}
            </button>
            <button class="nge-admin-action-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'dismissed')">Dismiss</button>
          </div>
          <div v-else-if="row.status === 'approved'" class="nge-triage-actions">
            <button class="nge-admin-action-btn" :disabled="triageActing === row.id" @click="setTriageStatus(row, 'done')">Mark done</button>
          </div>
        </div>
      </div>
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
  gap: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  padding-bottom: 0;
  margin-bottom: 4px;
}
.nge-admin-subtab {
  background: transparent;
  border: none;
  color: #889;
  font-size: 0.85em;
  padding: 6px 12px;
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
  background: none;
  border: none;
  color: rgba(150, 175, 215, 0.75);
  cursor: pointer;
  font-size: 0.95em;
  padding: 0 6px;
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
.nge-triage-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-triage-rec {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em;
  padding: 1px 8px; border-radius: 9px; text-transform: uppercase;
}
.nge-triage-rec--nothing      { background: rgba(255,255,255,0.08); color: #aab; }
.nge-triage-rec--message      { background: rgba(100,200,255,0.14); color: #64c8ff; }
.nge-triage-rec--bug_fix_spec { background: rgba(255,120,120,0.14); color: #f88; }
.nge-triage-rec--new_feature  { background: rgba(160,255,160,0.12); color: #8e8; }
.nge-triage-src { font-size: 11px; color: rgba(255,255,255,0.4); }
.nge-triage-status { font-size: 11px; color: rgba(255,255,255,0.5); font-style: italic; }
.nge-triage-excerpt { font-size: 12px; color: rgba(255,255,255,0.75); }
.nge-triage-rationale { font-size: 11.5px; color: rgba(255,255,255,0.5); line-height: 1.4; }
.nge-triage-message {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(100,200,255,0.2);
  border-radius: 6px; color: #dde; font-size: 12px; padding: 7px 9px; resize: vertical;
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
</style>
