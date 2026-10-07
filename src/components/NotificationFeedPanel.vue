<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { renderSafeMarkdown } from '../util/safe_markdown';
import { useProofreadingBackendStore } from '../store';
import pyrIcon from '../../static/badges/pyr/neuron-icon-white.png';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits({ hide: null, 'open-help': null });
const backend = useProofreadingBackendStore();
const panelRef = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (!props.visible) return;
  const target = e.target as HTMLElement;
  // Ignore clicks on the toolbar bell button (it handles its own toggle)
  if (target.closest?.('.nge-icon-btn')) return;
  // Ignore clicks inside the detail overlay or lightbox (separate Teleport)
  if (target.closest?.('.nge-notif-detail-backdrop') || target.closest?.('.nge-notif-lightbox')) return;
  if (panelRef.value && !panelRef.value.contains(target)) {
    emit('hide');
  }
}

/**
 * Poll for notifications whose scheduled send time has arrived.
 *
 * The realtime subscription only fires on INSERT, which happens when the admin
 * CREATES the notification — but a scheduled one is filtered out at that moment
 * by `send_at <= now`. Nothing re-ran the query at the actual send time, so a
 * notification scheduled for later never appeared until the user happened to
 * reload the page. A modest poll closes that gap; the query is a single
 * indexed select and the app is a long-lived session.
 */
const SCHEDULED_POLL_MS = 60_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Open a specific notification's detail view, e.g. after clicking the chat
 * announcement that links to it. Loads first in case it isn't in the list yet.
 */
async function onShowDetail(e: Event) {
  const id = (e as CustomEvent).detail?.id;
  if (id == null) return;
  let notif = backend.notifications.find((n: any) => n.id === id);
  if (!notif) {
    await backend.loadNotifications();
    notif = backend.notifications.find((n: any) => n.id === id);
  }
  if (notif) openDetail(notif);
}

onMounted(() => {
  backend.loadNotifications();
  backend.subscribeToNotifications();
  document.addEventListener('mousedown', onDocClick, true);
  document.addEventListener('nge:show-notification-detail', onShowDetail as EventListener);
  pollTimer = setInterval(() => {
    // Skip while the tab is hidden — it'll refresh on the next visible tick.
    if (document.hidden) return;
    backend.loadNotifications();
    // Post any scheduled "also post to chat" announcements that have come due.
    // Atomic-claimed inside, so running it on every client posts each once.
    backend.postDueChatAnnouncements();
  }, SCHEDULED_POLL_MS);
});

onUnmounted(() => {
  backend.unsubscribeFromNotifications();
  document.removeEventListener('mousedown', onDocClick, true);
  document.removeEventListener('nge:show-notification-detail', onShowDetail as EventListener);
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
});

// Panel mounts before auth completes (v-show), so reload once userId is available
watch(() => backend.userId, (id) => {
  if (id) backend.loadNotifications();
});

// Close detail overlay when panel hides
watch(() => props.visible, (v) => {
  if (!v) {
    openNotif.value = null;
    lightboxUrl.value = null;
  }
});

const lightboxUrl = ref<string | null>(null);
const openNotif = ref<any | null>(null);
const confirmDeleteAll = ref(false);

// Admins get the triage loop's alerts (a new suggestion to approve, a report
// that shipped) in a tab of their own, so they stop burying everything else
// (Ames 2026-10-06: "they are clogging up my feed"). Players never see the
// tabs: a "Fixed!" note about their own report stays in their one feed.
const feedTab = ref<'main' | 'triage'>('main');
function isTriageNote(n: { title?: string | null }): boolean {
  const t = n.title || '';
  return backend.isAdmin && (t.startsWith('🗂') || t.startsWith('🎉 Fixed'));
}
const triageNotes = computed(() => backend.notifications.filter(isTriageNote));
const mainNotes = computed(() => backend.notifications.filter(n => !isTriageNote(n)));
const showFeedTabs = computed(() => backend.isAdmin && triageNotes.value.length > 0);
const shownNotes = computed(() => !showFeedTabs.value ? backend.notifications : feedTab.value === 'triage' ? triageNotes.value : mainNotes.value);
const unreadIn = (list: { id: number }[]) => list.filter(n => !isRead(n.id)).length;
watch(showFeedTabs, on => { if (!on) feedTab.value = 'main'; });
watch(feedTab, () => { confirmDeleteAll.value = false; });   // the question was about the other tab

// With the two admin tabs showing, "Delete all" clears the tab you are on
// (Ames 2026-10-06: "dismiss just the triage notifs"), never the other one.
async function doDeleteAll() {
  confirmDeleteAll.value = false;
  if (showFeedTabs.value) await backend.dismissAllNotifications(shownNotes.value.map(n => n.id));
  else await backend.dismissAllNotifications();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isRead(id: number): boolean {
  return (backend as any).notificationReads?.has?.(id) ?? false;
}

function isBadgeNotification(notif: any): boolean {
  return notif?.title?.includes('New Achievement');
}

function openDetail(notif: any) {
  backend.markNotificationRead(notif.id);
  // The weekly recap opens the full Week in Science tab in the profile.
  if ((notif.title || '').startsWith('✨') && (notif.title || '').includes('Week in Science')) {
    document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'weekInScience' } }));
    emit('hide');
    return;
  }
  // Triage alerts open the triage board on its own page, in a new tab
  // (Ames 2026-10-05), so the game stays where it is.
  if ((notif.title || '').startsWith('🗂')) {
    // Open on THAT report (Ames 2026-10-05). The note quotes the report, so
    // leave the quote for the board to find its card by. Through this
    // browser's own storage, never the address.
    try {
      const quoted = String(notif.body || '').match(/^"([\s\S]*?)" Claude has a suggestion/)?.[1] || '';
      const excerpt = quoted.replace(/\.\.\.$/, '').replace(/\s+/g, ' ').trim();
      if (excerpt) window.localStorage.setItem('nge_triage_focus', JSON.stringify({ excerpt, at: Date.now() }));
    } catch { /* the board still opens */ }
    window.open(`${window.location.origin}${window.location.pathname}?triage=board`, '_blank', 'noopener');
    emit('hide');
    return;
  }
  // Badge notifications trigger the hero celebration overlay
  if (isBadgeNotification(notif)) {
    backend.pendingBadgeCelebration = {
      title: notif.title,
      body: notif.body || '',
      imageUrl: notif.image_url || notif.thumbnail_url || '',
    };
    emit('hide');
    return;
  }
  openNotif.value = notif;
}

function closeDetail() {
  openNotif.value = null;
}

// Weekly Champions: a name opens that player's profile (Ames 2026-10-05).
// The broadcast carries names only, so they are matched to players here,
// once, when a champions broadcast is opened. A name two players share, or
// one that has since changed, simply is not a link.
const championIds = ref<Record<string, string>>({});
let championIdsLoaded = false;
async function loadChampionIds() {
  if (championIdsLoaded) return;
  championIdsLoaded = true;
  try {
    const { supabase } = await import('../supabase');
    const { data, error } = await supabase.from('user_edit_counts').select('id, display_name').limit(10000);
    if (error || !data) { championIdsLoaded = false; return; }
    const seen: Record<string, string | null> = {};
    for (const r of data as any[]) {
      const k = String(r.display_name || '').trim().toLowerCase();
      if (!k) continue;
      seen[k] = k in seen ? null : String(r.id);
    }
    const out: Record<string, string> = {};
    for (const k in seen) if (seen[k]) out[k] = seen[k] as string;
    championIds.value = out;
  } catch { championIdsLoaded = false; }
}
const championId = (name: string) => championIds.value[String(name || '').trim().toLowerCase()] || '';
function openChampion(name: string) {
  const userId = championId(name);
  if (!userId) return;
  closeDetail();
  emit('hide');
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { userId } }));
}

function isHelpNotification(notif: any): boolean {
  return notif?.title?.includes('help request') || notif?.title?.includes('Response to your');
}

function openHelpTab() {
  closeDetail();
  emit('hide');
  emit('open-help');
}

/** Sanitize stored Markdown, including generated URLs; remote images are omitted. */
const renderMarkdown = (text: string) => renderSafeMarkdown(text, true);

/** Markdown stripped to plain text, for the compact card preview line. */
function plainText(text: string): string {
  return (text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1');
}

/**
 * Amy's copy rules at render time: no em or en dashes anywhere user facing.
 * Older notifications were stored with them, so the display cleans them rather
 * than trusting the data. Date and number ranges read "to"; any other dash
 * becomes a comma. Only spaces and tabs are consumed, never newlines, so
 * Markdown line structure survives.
 */
function cleanCopy(text: string): string {
  if (!text) return '';
  return String(text)
    // "Sep 21 – Sep 27" and "Dec 29, 2025 – Jan 4, 2026" become "... to ..."
    .replace(/([A-Z][a-z]{2,8}\.?[ \t]+\d{1,2}(?:,[ \t]*\d{4})?)[ \t]*[–—][ \t]*(?=[A-Z][a-z]{2,8}\.?[ \t]+\d{1,2})/g, '$1 to ')
    // "10–20" becomes "10 to 20"
    .replace(/(\d)[ \t]*[–—][ \t]*(?=\d)/g, '$1 to ')
    // a dash that opens a line is dropped, anything else is a comma
    .replace(/^[ \t]*[–—][ \t]*/gm, '')
    .replace(/[ \t]*[–—][ \t]*/g, ', ')
    // tidy what the comma swap can leave behind
    .replace(/,[ \t]*,/g, ',')
    .replace(/,[ \t]*([.!?;:])/g, '$1')
    .replace(/,[ \t]*$/gm, '');
}

/* ── Weekly Champions ─────────────────────────────────────────────────────
   scripts/weekly-leaderboard-broadcast.mjs writes the body as Markdown lines:
     🎉 **Big congratulations to this week's champions!**
     **Top Editors**
     🥇  **Name**, 19 edits          (older rows: "**Name** — 19 edits")
     4.  **Name**, 3 edits
     **Top Completers**
     _no activity this week_
     Across all datasets, ...
   parseChampions() reads that shape back into sections for the podium view.
   Anything it does not recognise inside a section returns null, and the
   detail view falls back to the ordinary Markdown rendering. */
interface ChampEntry { rank: number; name: string; count: string; unit: string }
interface ChampSection { label: string; entries: ChampEntry[]; empty: boolean }
interface ChampionsView { range: string; intro: string; sections: ChampSection[]; outro: string }

const CHAMP_MEDALS = ['🥇', '🥈', '🥉'];
const CHAMP_HEAD_RE = /^(?:\*\*([^*]+?)\*\*:?|#{1,4}\s+(.+))$/;
const CHAMP_ENTRY_RE = /^(🥇|🥈|🥉|\d{1,3}\.)\s*\*\*(.+?)\*\*\s*(?:[–—:,-]\s*)?(\d[\d,.]*)\s*(.*)$/u;
const CHAMP_EMPTY_RE = /^[_*\s]*no activity this week[_*\s.!]*$/i;

/** Bold markers and a wrapping _emphasis_ off, dashes cleaned. Gentle on
 *  purpose: a display name like "amy_r_s" keeps its underscores. */
function stripMd(text: string): string {
  return cleanCopy(text)
    .replace(/\*\*/g, '')
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseChampions(notif: any): ChampionsView | null {
  const title = String(notif?.title || '');
  if (!/weekly champions/i.test(title)) return null;
  try {
    const range = cleanCopy(title.replace(/^[\s\S]*?weekly champions/i, ''))
      .replace(/^[\s,:;·|-]+/, '')
      .trim();

    const intro: string[] = [];
    const outro: string[] = [];
    const sections: ChampSection[] = [];
    let current: ChampSection | null = null;

    for (const raw of String(notif?.body || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const head = outro.length === 0 ? line.match(CHAMP_HEAD_RE) : null;
      if (head) {
        current = { label: stripMd(head[1] || head[2] || ''), entries: [], empty: false };
        sections.push(current);
        continue;
      }

      if (current) {
        const m = line.match(CHAMP_ENTRY_RE);
        if (m) {
          const medal = CHAMP_MEDALS.indexOf(m[1]);
          const parsed = medal >= 0 ? medal + 1 : parseInt(m[1], 10);
          current.entries.push({
            rank: Number.isFinite(parsed) && parsed > 0 ? parsed : current.entries.length + 1,
            name: stripMd(m[2]) || 'Anonymous',
            count: m[3],
            unit: stripMd(m[4]),
          });
          continue;
        }
        if (CHAMP_EMPTY_RE.test(line)) { current.empty = true; continue; }
        // A section that has shown nothing we understand: not our format.
        if (current.entries.length === 0 && !current.empty) return null;
        current = null;
        outro.push(line);
        continue;
      }

      (sections.length === 0 ? intro : outro).push(line);
    }

    if (sections.length === 0) return null;
    if (sections.some(s => !s.label || (s.entries.length === 0 && !s.empty))) return null;

    return {
      range,
      intro: stripMd(intro.join(' ')),
      sections,
      outro: stripMd(outro.join(' ')),
    };
  } catch {
    return null;
  }
}

const champions = computed<ChampionsView | null>(() =>
  openNotif.value ? parseChampions(openNotif.value) : null);
watch(champions, c => { if (c) void loadChampionIds(); });

/** Podium order: silver, gold, bronze, so gold stands in the middle. */
function podiumOrder(entries: ChampEntry[]): ChampEntry[] {
  const [first, second, third] = entries;
  return [second, first, third].filter(Boolean) as ChampEntry[];
}

function champTier(rank: number): string {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'rest';
}

function champMedal(rank: number): string {
  return CHAMP_MEDALS[rank - 1] || '';
}

function padRank(rank: number): string {
  return String(rank).padStart(2, '0');
}
</script>

<template>
  <Teleport to="body">
  <div v-show="visible" ref="panelRef" class="nge-notif-panel">
    <div class="nge-notif-topbar">
      <span class="nge-notif-title">🔔 Notifications</span>
      <div class="nge-notif-topbar-actions">
        <!-- With the two admin tabs showing, this marks the tab you are on. -->
        <button
          v-if="showFeedTabs ? unreadIn(shownNotes) > 0 : backend.unreadNotificationCount > 0"
          class="nge-notif-mark-all"
          @click="showFeedTabs ? backend.markAllNotificationsRead(shownNotes.map(n => n.id)) : backend.markAllNotificationsRead()"
        >{{ showFeedTabs && feedTab === 'triage' ? 'Mark triage read' : 'Mark all read' }}</button>
        <!-- Separate from "mark all read" on purpose: read state controls the
             unread pip, this clears the feed. Only hides them for THIS user —
             the underlying notification rows are untouched. -->
        <!-- Not on the Triage tab: triage is kept and only marked read
             (Ames 2026-10-07: "I don't want to delete triage, just mark as
             read"). One note can still be removed with its own x. -->
        <button
          v-if="shownNotes.length > 0 && !(showFeedTabs && feedTab === 'triage')"
          class="nge-notif-delete-all"
          @click="confirmDeleteAll = true"
          :title="showFeedTabs ? 'Delete every notification on this tab; triage is kept (only affects your feed)' : 'Delete all notifications (only affects your feed)'"
        >Delete all</button>
        <button class="nge-notif-close" @click.stop="emit('hide')">×</button>
      </div>
    </div>

    <!-- Deleting the whole feed is irreversible, so make it a deliberate two
         step action rather than a single click next to the close button. -->
    <div v-if="confirmDeleteAll" class="nge-notif-confirm">
      <span>Delete {{ shownNotes.length === 1 ? 'this' : 'all ' + shownNotes.length }} {{ showFeedTabs && feedTab === 'triage' ? 'triage ' : '' }}{{ shownNotes.length === 1 ? 'notification' : 'notifications' }}?</span>
      <button class="nge-notif-confirm-yes" @click="doDeleteAll">Delete</button>
      <button class="nge-notif-confirm-no" @click="confirmDeleteAll = false">Cancel</button>
    </div>

    <div v-if="showFeedTabs" class="nge-notif-tabs" role="tablist">
      <button class="nge-notif-tab" :class="{ 'nge-notif-tab--on': feedTab === 'main' }" role="tab" :aria-selected="feedTab === 'main'" @click="feedTab = 'main'">
        Notifications<b v-if="unreadIn(mainNotes) > 0">{{ unreadIn(mainNotes) }}</b>
      </button>
      <button class="nge-notif-tab nge-notif-tab--triage" :class="{ 'nge-notif-tab--on': feedTab === 'triage' }" role="tab" :aria-selected="feedTab === 'triage'" @click="feedTab = 'triage'">
        Triage<b v-if="unreadIn(triageNotes) > 0">{{ unreadIn(triageNotes) }}</b>
      </button>
    </div>

    <div class="nge-notif-list" v-if="shownNotes.length > 0">
      <div
        v-for="notif in shownNotes"
        :key="notif.id"
        class="nge-notif-card"
        :class="{ 'nge-notif-card--unread': !isRead(notif.id), 'nge-notif-card--triage': (notif.title || '').startsWith('🗂'), 'nge-notif-card--fixed': (notif.title || '').startsWith('🎉'), 'nge-notif-card--streak': (notif.title || '').startsWith('🔥'), 'nge-notif-card--thanks': (notif.title || '').startsWith('💙'), 'nge-notif-card--recap': (notif.title || '').startsWith('✨') }"
        @click="openDetail(notif)"
      >
        <div class="nge-notif-card-row">
          <img
            :src="notif.thumbnail_url || notif.image_url || pyrIcon"
            class="nge-notif-thumb-sm"
            :class="{ 'nge-notif-thumb-fallback': !notif.thumbnail_url && !notif.image_url }"
          />
          <div class="nge-notif-card-content">
            <div class="nge-notif-card-header">
              <span v-if="!isRead(notif.id)" class="nge-notif-unread-dot"></span>
              <div class="nge-notif-card-title">{{ cleanCopy(notif.title) }}</div>
              <span class="nge-notif-time">{{ relativeTime(notif.send_at) }}</span>
              <!-- No admin delete here (Ames 2026-10-06): one stray click in the
                   bell removed a broadcast for every player, for good. Deleting a
                   notification for everyone lives in the Admin Hub only. The x
                   below hides it from your own feed and nobody else's. -->
              <button
                class="nge-notif-dismiss"
                @click.stop="backend.dismissNotification(notif.id)"
                title="Dismiss"
              >×</button>
            </div>
            <div class="nge-notif-card-body nge-notif-card-body--preview">{{ plainText(cleanCopy(notif.body)) }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="nge-notif-empty" v-else>
      No notifications yet.
    </div>

  </div>
  </Teleport>

  <!-- ═══ Detail overlay (separate Teleport so it's not clipped by panel) ═══ -->
  <Teleport to="body">
    <Transition name="nge-notif-detail">
      <div v-if="openNotif" class="nge-notif-detail-backdrop" @click.self="closeDetail">
        <div
          class="nge-notif-detail"
          :class="{ 'nge-notif-detail--champions': champions }"
          role="dialog"
          aria-modal="true"
          :aria-label="cleanCopy(openNotif.title)"
        >
          <!-- Instrument chrome: four corner brackets that settle in once, and a
               scan band that passes once on open. Never looping. -->
          <span class="nge-notif-bracket nge-notif-bracket--tl" aria-hidden="true"></span>
          <span class="nge-notif-bracket nge-notif-bracket--tr" aria-hidden="true"></span>
          <span class="nge-notif-bracket nge-notif-bracket--bl" aria-hidden="true"></span>
          <span class="nge-notif-bracket nge-notif-bracket--br" aria-hidden="true"></span>
          <span class="nge-notif-detail-scan" aria-hidden="true"></span>

          <div class="nge-notif-detail-topbar">
            <span class="nge-notif-detail-kicker">
              <span class="nge-notif-detail-kicker-dot" aria-hidden="true"></span>
              <span class="nge-notif-detail-kicker-label">{{ champions ? 'Broadcast' : 'Notification' }}</span>
              <span class="nge-notif-detail-kicker-sep" aria-hidden="true">/</span>
              <span class="nge-notif-detail-time">{{ relativeTime(openNotif.send_at) }}</span>
            </span>
            <button class="nge-notif-detail-close" @click="closeDetail" aria-label="Close">×</button>
          </div>
          <div class="nge-notif-detail-scroll">
            <div class="nge-notif-detail-layout" :class="{ 'nge-notif-detail-layout--has-image': openNotif.image_url || openNotif.thumbnail_url }">
              <div v-if="openNotif.image_url || openNotif.thumbnail_url" class="nge-notif-detail-image">
                <img
                  :src="openNotif.image_url || openNotif.thumbnail_url"
                  class="nge-notif-detail-img"
                  @click="lightboxUrl = openNotif.image_url || openNotif.thumbnail_url"
                />
              </div>
              <div class="nge-notif-detail-text">
                <!-- Weekly Champions: parsed into a podium. parseChampions()
                     returns null on anything unexpected, which lands in the
                     ordinary rendering below. -->
                <template v-if="champions">
                  <header class="nge-champs-head">
                    <div class="nge-champs-emblem" aria-hidden="true">🏆</div>
                    <div class="nge-champs-head-text">
                      <div class="nge-champs-kicker">Weekly Champions</div>
                      <h2 class="nge-champs-range">{{ champions.range || 'This week' }}</h2>
                    </div>
                  </header>
                  <p v-if="champions.intro" class="nge-champs-intro">{{ champions.intro }}</p>

                  <!-- Wide screens: the categories sit side by side (Ames 2026-10-05). -->
                  <div class="nge-champs-columns">
                  <section
                    v-for="(section, si) in champions.sections"
                    :key="si + '-' + section.label"
                    class="nge-champs-section"
                  >
                    <div class="nge-champs-section-head">
                      <span class="nge-champs-section-label">{{ section.label }}</span>
                      <span class="nge-champs-section-rule" aria-hidden="true"></span>
                      <span v-if="section.entries.length" class="nge-champs-section-count">{{ section.entries.length }} ranked</span>
                    </div>

                    <div v-if="section.entries.length === 0" class="nge-champs-empty">
                      <span class="nge-champs-empty-ring" aria-hidden="true"><span></span></span>
                      <div class="nge-champs-empty-text">
                        <div class="nge-champs-empty-title">No activity this week</div>
                        <div class="nge-champs-empty-sub">The podium is open. Next week it could be yours.</div>
                      </div>
                    </div>

                    <template v-else>
                      <div class="nge-champs-podium">
                        <div
                          v-for="entry in podiumOrder(section.entries)"
                          :key="entry.rank + '-' + entry.name"
                          class="nge-champs-step"
                          :class="'nge-champs-step--' + champTier(entry.rank)"
                        >
                          <div class="nge-champs-card" :class="{ 'nge-champs-link': championId(entry.name) }"
                               :role="championId(entry.name) ? 'button' : undefined" :tabindex="championId(entry.name) ? 0 : undefined"
                               :title="championId(entry.name) ? `Open ${entry.name}'s profile` : undefined"
                               @click="openChampion(entry.name)" @keydown.enter="openChampion(entry.name)">
                            <span class="nge-champs-medal" aria-hidden="true">{{ champMedal(entry.rank) }}</span>
                            <span class="nge-champs-name">{{ entry.name }}</span>
                            <span class="nge-champs-num">{{ entry.count }}</span>
                            <span class="nge-champs-unit">{{ entry.unit }}</span>
                          </div>
                          <div class="nge-champs-plinth"><span>{{ padRank(entry.rank) }}</span></div>
                        </div>
                      </div>
                      <ol v-if="section.entries.length > 3" class="nge-champs-list">
                        <li
                          v-for="(entry, ei) in section.entries.slice(3)"
                          :key="ei + '-' + entry.name"
                          class="nge-champs-row"
                          :class="{ 'nge-champs-link': championId(entry.name) }"
                          :role="championId(entry.name) ? 'button' : undefined" :tabindex="championId(entry.name) ? 0 : undefined"
                          :title="championId(entry.name) ? `Open ${entry.name}'s profile` : undefined"
                          @click="openChampion(entry.name)" @keydown.enter="openChampion(entry.name)"
                        >
                          <span class="nge-champs-row-rank">{{ padRank(entry.rank) }}</span>
                          <span class="nge-champs-row-name">{{ entry.name }}</span>
                          <span class="nge-champs-row-num">{{ entry.count }}</span>
                          <span class="nge-champs-row-unit">{{ entry.unit }}</span>
                        </li>
                      </ol>
                    </template>
                  </section>
                  </div>

                  <p v-if="champions.outro" class="nge-champs-outro">{{ champions.outro }}</p>
                </template>

                <template v-else>
                  <h2 class="nge-notif-detail-title">{{ cleanCopy(openNotif.title) }}</h2>
                  <div class="nge-notif-detail-rule" aria-hidden="true"></div>
                  <div
                    class="nge-notif-detail-body"
                    v-html="renderMarkdown(cleanCopy(openNotif.body))"
                  ></div>
                </template>
                <button
                  v-if="isHelpNotification(openNotif)"
                  class="nge-notif-open-help"
                  @click="openHelpTab"
                >Open in Help tab →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Lightbox for full-size images -->
    <div v-if="lightboxUrl" class="nge-notif-lightbox" @click="lightboxUrl = null">
      <img :src="lightboxUrl" class="nge-notif-lightbox-img" />
    </div>
  </Teleport>
</template>

<style scoped>
.nge-notif-panel {
  position: fixed;
  top: 42px;
  right: 8px;
  width: 340px;
  max-height: min(480px, calc(100vh - 60px));
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.97) 0%, rgba(8, 12, 24, 0.95) 50%, rgba(4, 8, 18, 0.97) 100%);
  border: 1px solid rgba(74, 158, 255, 0.15);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  z-index: 8000;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(12px);
  font-size: 0.85em;
  font-family: sans-serif;
}

.nge-notif-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.nge-notif-title {
  font-size: 1em;
  font-weight: 600;
  color: #e0e0e0;
}

.nge-notif-topbar-actions { display: flex; align-items: center; gap: 8px; }

.nge-notif-mark-all {
  background: none;
  border: 1px solid rgba(74, 158, 255, 0.2);
  color: rgba(74, 158, 255, 0.7);
  font-size: 0.72em;
  padding: 2px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.nge-notif-mark-all:hover { color: #4a9eff; border-color: rgba(74, 158, 255, 0.4); }

/* Destructive, so it reads warm rather than in the blue accent. */
.nge-notif-delete-all {
  background: none;
  border: 1px solid rgba(224, 96, 96, 0.22);
  color: rgba(224, 120, 120, 0.75);
  font-size: 0.72em;
  padding: 2px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.nge-notif-delete-all:hover { color: #e06060; border-color: rgba(224, 96, 96, 0.5); }

.nge-notif-tabs {
  display: flex; gap: 4px; flex-shrink: 0;
  padding: 6px 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.nge-notif-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px 7px;
  font: 600 12px/1 'Inter', system-ui, sans-serif; letter-spacing: 0.02em;
  color: #8b97ad; background: none; border: 0; border-bottom: 2px solid transparent;
  cursor: pointer;
}
.nge-notif-tab:hover { color: #dce6f5; }
.nge-notif-tab--on { color: #ffffff; border-bottom-color: #7ee0ff; }
.nge-notif-tab--triage.nge-notif-tab--on { border-bottom-color: #ff8f8f; }
.nge-notif-tab b {
  min-width: 16px; padding: 2px 5px; border-radius: 8px; box-sizing: border-box;
  font-size: 10px; font-weight: 700; text-align: center; color: #06121f; background: #7ee0ff;
}
.nge-notif-tab--triage b { background: #ff8f8f; }

.nge-notif-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(224, 96, 96, 0.08);
  border-bottom: 1px solid rgba(224, 96, 96, 0.2);
  font-size: 0.78em;
  color: #e8c0c0;
}
.nge-notif-confirm span { flex: 1; }
.nge-notif-confirm-yes,
.nge-notif-confirm-no {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 1em;
  cursor: pointer;
}
.nge-notif-confirm-yes { color: #ff8f8f; border-color: rgba(224, 96, 96, 0.5); }
.nge-notif-confirm-yes:hover { background: rgba(224, 96, 96, 0.18); }
.nge-notif-confirm-no { color: #aab; }
.nge-notif-confirm-no:hover { background: rgba(255, 255, 255, 0.06); }

.nge-notif-close {
  background: none; border: none; color: #666; font-size: 1.2em;
  cursor: pointer; padding: 0 4px;
}
.nge-notif-close:hover { color: #fff; }

.nge-notif-list {
  overflow-y: auto;
  max-height: 420px;
  padding: 6px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.15) transparent;
}

/* ── Feed cards (compact list) ── */
/* Triage alerts (title starts with 🗂) pop in red so admins spot them. */
.nge-notif-card--triage {
  border-left: 3px solid rgba(255, 90, 90, 0.85);
  background: rgba(255, 80, 80, 0.06);
}
.nge-notif-card--triage .nge-notif-card-title {
  color: #ff8d8d;
}
/* "Fixed!" cards (title starts with 🎉): a report shipped. Happy mint and gold. */
.nge-notif-card--fixed {
  border-left: 3px solid #5ee8a8;
  background: linear-gradient(90deg, rgba(94, 232, 168, 0.12), rgba(255, 211, 90, 0.05));
}
.nge-notif-card--fixed .nge-notif-card-title {
  color: #ffd35a;
  font-weight: 700;
}
/* Streak milestones (title starts with 🔥): ember orange and gold. */
.nge-notif-card--streak {
  border-left: 3px solid #ff9a3c;
  background: linear-gradient(90deg, rgba(255, 154, 60, 0.16), rgba(255, 211, 90, 0.05));
}
.nge-notif-card--streak .nge-notif-card-title {
  color: #ffc46b;
  font-weight: 700;
}
/* Weekly recap cards (title starts with ✨): science cyan and violet. */
.nge-notif-card--recap {
  border-left: 3px solid #42d5ec;
  background: linear-gradient(90deg, rgba(66, 213, 236, 0.12), rgba(150, 120, 255, 0.06));
}
.nge-notif-card--recap .nge-notif-card-title {
  color: #8fe9f5;
  font-weight: 700;
}
/* Thank you cards (title starts with 💙): the neon blue and pink of the art. */
.nge-notif-card--thanks {
  border-left: 3px solid #d65bf0;
  background: linear-gradient(90deg, rgba(214, 91, 240, 0.12), rgba(90, 160, 255, 0.06));
}
.nge-notif-card--thanks .nge-notif-card-title {
  color: #8fc4ff;
  font-weight: 700;
}

.nge-notif-card {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.15s;
}
.nge-notif-card:hover { background: rgba(74, 158, 255, 0.04); }
.nge-notif-card--unread { background: rgba(74, 158, 255, 0.03); }
/* Read vs unread must be obvious at a glance. The coloured left edge means
   the TYPE (recap, fixed, triage...), so unread is shown another way: read
   cards fade back, unread titles are bright and bold with a glowing dot. */
.nge-notif-card:not(.nge-notif-card--unread) .nge-notif-card-row { opacity: 0.55; transition: opacity 0.15s; }
.nge-notif-card:not(.nge-notif-card--unread):hover .nge-notif-card-row { opacity: 0.85; }
.nge-notif-card--unread .nge-notif-card-title { font-weight: 700; } /* keeps its type colour */
.nge-notif-card--unread .nge-notif-card-body { color: #b4bfd2; }

.nge-notif-card-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.nge-notif-card-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nge-notif-thumb-sm {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  opacity: 0.85;
  margin-top: 2px;
}
.nge-notif-thumb-fallback {
  opacity: 0.35;
  padding: 6px;
  background: rgba(74, 158, 255, 0.06);
  border-radius: 8px;
}

.nge-notif-unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #5cc8ff;
  box-shadow: 0 0 6px 1px rgba(92, 200, 255, 0.75);
  flex-shrink: 0;
  margin-top: 4px;
  animation: nge-notif-dot-pulse 2.4s ease-in-out infinite;
}
@keyframes nge-notif-dot-pulse {
  0%, 100% { box-shadow: 0 0 6px 1px rgba(92, 200, 255, 0.75); }
  50% { box-shadow: 0 0 10px 3px rgba(92, 200, 255, 0.35); }
}
@media (prefers-reduced-motion: reduce) { .nge-notif-unread-dot { animation: none; } }

.nge-notif-card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.nge-notif-card-title {
  font-weight: 600;
  color: #dde;
  font-size: 0.92em;
  flex: 1;
}

.nge-notif-time {
  font-size: 0.72em;
  color: #556;
  flex-shrink: 0;
}

.nge-notif-delete {
  background: none;
  border: none;
  font-size: 0.7em;
  cursor: pointer;
  opacity: 0;
  padding: 0 2px;
  transition: opacity 0.15s;
  flex-shrink: 0;
  filter: grayscale(1);
}
.nge-notif-card:hover .nge-notif-delete { opacity: 0.5; }
.nge-notif-delete:hover { opacity: 1 !important; filter: none; }

.nge-notif-dismiss {
  background: none;
  border: none;
  font-size: 1.1em;
  color: #556;
  cursor: pointer;
  opacity: 0.45;
  padding: 2px 4px;
  transition: opacity 0.15s, color 0.15s;
  flex-shrink: 0;
  line-height: 1;
}
.nge-notif-dismiss:hover { opacity: 1; color: #f66; }

.nge-notif-card-body {
  font-size: 0.82em;
  color: #888;
  line-height: 1.4;
}

.nge-notif-card-body--preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.nge-notif-empty {
  padding: 32px 16px;
  text-align: center;
  color: #556;
  font-size: 0.82em;
}

/* ═══ Detail overlay ═══ */
/* Built from Amy's scifi-ui library (amyleesterling.github.io/scifi-ui),
   copied inline, no runtime dependency:
     - holopanel surface (components/panel-surface.css): dark gradient, soft
       rim, lit hairline on the top edge, one materialise entrance
     - holoframe corner brackets (hologram.css section 4), settling in once
     - holoscan (components/scan-pass.css): a band that passes ONCE on open.
       The old top edge sweep here looped forever; only ambient things loop.
   Palette is the app's own: dark navy, accent rgb(74 158 255), cyan
   rgb(126 224 255), and one warm accent (gold) for the champions podium. */
.nge-notif-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: radial-gradient(circle at 50% 38%, rgba(0, 14, 34, 0.82) 0%, rgba(0, 0, 0, 0.92) 100%);
  backdrop-filter: blur(7px) saturate(1.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nge-notif-detail {
  --nd-accent: 74 158 255;
  --nd-cyan: 126 224 255;
  --nd-line: 196 228 255;
  --nd-ink: 236 243 252;
  --nd-dim: 170 184 204;
  position: relative;
  isolation: isolate;
  width: 920px;
  max-width: 90vw;
  max-height: 80vh;
  background:
    radial-gradient(120% 60% at 50% -10%, rgb(var(--nd-accent) / 0.10), transparent 60%),
    linear-gradient(158deg, rgba(10, 17, 32, 0.97) 0%, rgba(5, 9, 19, 0.985) 100%);
  border: 1px solid rgb(var(--nd-accent) / 0.30);
  border-radius: 14px;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.7),
    0 0 60px rgb(var(--nd-accent) / 0.10),
    inset 0 1px 0 rgb(var(--nd-line) / 0.10),
    inset 0 0 60px rgba(0, 120, 255, 0.05);
  backdrop-filter: blur(10px) saturate(1.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: rgb(var(--nd-ink) / 0.92);
  font-family: 'Inter', system-ui, sans-serif;
  /* holopanel-in, played once. Fill "backwards" rather than "both", so once
     it ends the leave transition below is free to move the panel. */
  animation: ngeNotifMaterialize 720ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
/* The lit hairline along the top edge (holopanel::before). Static. */
.nge-notif-detail::before {
  content: '';
  position: absolute;
  left: 8%;
  right: 8%;
  top: 0;
  height: 1px;
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgb(var(--nd-line) / 0.95) 50%, transparent);
  box-shadow: 0 0 12px rgb(var(--nd-cyan) / 0.55);
}
/* Faint scanlines over the whole surface. Static texture, not motion. */
.nge-notif-detail::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: repeating-linear-gradient(180deg,
    rgb(var(--nd-line) / 0.022) 0px, rgb(var(--nd-line) / 0.022) 1px,
    transparent 1px, transparent 3px);
}
@keyframes ngeNotifMaterialize {
  0%   { opacity: 0; transform: translateY(10px) scale(0.97); filter: blur(10px) brightness(2.5); }
  60%  { opacity: 1; transform: translateY(0) scale(1); filter: blur(0) brightness(1.15); }
  100% { opacity: 1; transform: none; filter: none; }
}

/* Corner brackets: 13px L shapes, drawn in from outside and settling once. */
.nge-notif-bracket {
  position: absolute;
  z-index: 3;
  width: 13px;
  height: 13px;
  pointer-events: none;
  border: 1px solid rgb(var(--nd-line) / 0.55);
  animation: ngeNotifBracketIn 560ms cubic-bezier(0.2, 0.8, 0.25, 1) 160ms backwards;
}
.nge-notif-bracket--tl { top: 7px; left: 7px; border-right: 0; border-bottom: 0; --nd-from: -7px, -7px; }
.nge-notif-bracket--tr { top: 7px; right: 7px; border-left: 0; border-bottom: 0; --nd-from: 7px, -7px; }
.nge-notif-bracket--bl { bottom: 7px; left: 7px; border-right: 0; border-top: 0; --nd-from: -7px, 7px; }
.nge-notif-bracket--br { bottom: 7px; right: 7px; border-left: 0; border-top: 0; --nd-from: 7px, 7px; }
@keyframes ngeNotifBracketIn {
  from { opacity: 0; transform: translate(var(--nd-from)); }
  to   { opacity: 1; transform: translate(0, 0); }
}

/* holoscan: one band, one pass, then gone. The band is 12% of the panel, so
   it travels 950% to clear the bottom edge. */
.nge-notif-detail-scan {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 12%;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(180deg, transparent, rgb(var(--nd-cyan) / 0.11) 70%, rgb(var(--nd-cyan) / 0.22) 98%, transparent);
  animation: ngeNotifScanPass 1600ms cubic-bezier(0.22, 0.9, 0.28, 1) 240ms 1 both;
}
@keyframes ngeNotifScanPass {
  from { transform: translateY(-100%); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  to   { transform: translateY(950%); opacity: 0; }
}

.nge-notif-detail-topbar {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px 12px 24px;
  border-bottom: 1px solid rgb(var(--nd-accent) / 0.14);
  flex-shrink: 0;
}

.nge-notif-detail-kicker {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.nge-notif-detail-kicker-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--nd-cyan));
  box-shadow: 0 0 8px rgb(var(--nd-cyan) / 0.8);
}
.nge-notif-detail-kicker-label {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.68em;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--nd-cyan) / 0.9);
}
.nge-notif-detail-kicker-sep {
  color: rgb(var(--nd-accent) / 0.45);
  font-size: 0.75em;
}
/* "15h ago" carries a unit, so it stays out of text-transform: uppercase. */
.nge-notif-detail-time {
  font-size: 0.78em;
  color: rgb(var(--nd-dim) / 0.9);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.nge-notif-detail-close {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--nd-accent) / 0.06);
  border: 1px solid rgb(var(--nd-accent) / 0.25);
  border-radius: 6px;
  color: rgb(var(--nd-dim));
  font-size: 1.15em;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.nge-notif-detail-close:hover,
.nge-notif-detail-close:focus-visible {
  color: #fff;
  border-color: rgb(var(--nd-cyan) / 0.6);
  background: rgb(var(--nd-cyan) / 0.10);
  box-shadow: 0 0 14px rgb(var(--nd-cyan) / 0.25);
  outline: none;
}

.nge-notif-detail-scroll {
  position: relative;
  z-index: 1;
  overflow-y: auto;
  padding: 20px 26px 26px;
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--nd-accent) / 0.2) transparent;
}

.nge-notif-detail-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 1.12em;
  font-weight: 600;
  color: #eef5ff;
  margin: 0 0 12px;
  line-height: 1.4;
  letter-spacing: 0.04em;
  text-shadow: 0 0 18px rgb(var(--nd-accent) / 0.35);
}
/* A hairline under the title that fades out to the right. */
.nge-notif-detail-rule {
  height: 1px;
  margin: 0 0 16px;
  background: linear-gradient(90deg, rgb(var(--nd-cyan) / 0.55), rgb(var(--nd-accent) / 0.18) 45%, transparent);
}

.nge-notif-detail-body {
  font-size: 0.95em;
  color: rgb(var(--nd-dim));
  line-height: 1.65;
  /* marked emits <p>/<br>/lists now, so it owns line breaks — pre-wrap here
     would double every gap. */
  white-space: normal;
  word-break: break-word;
}
/* Rendered-markdown block spacing. */
.nge-notif-detail-body :deep(p) { margin: 0 0 0.7em; }
.nge-notif-detail-body :deep(p:last-child) { margin-bottom: 0; }
.nge-notif-detail-body :deep(strong) { color: #eef4fb; font-weight: 650; }
/* No thin italic on a dark background: emphasis reads as colour instead. */
.nge-notif-detail-body :deep(em) { font-style: normal; font-weight: 500; color: rgb(var(--nd-cyan) / 0.9); }
.nge-notif-detail-body :deep(ul),
.nge-notif-detail-body :deep(ol) { margin: 0 0 0.7em; padding-left: 1.3em; }
.nge-notif-detail-body :deep(li) { margin: 0.15em 0; }
.nge-notif-detail-body :deep(li::marker) { color: rgb(var(--nd-cyan) / 0.7); }
.nge-notif-detail-body :deep(h1),
.nge-notif-detail-body :deep(h2),
.nge-notif-detail-body :deep(h3),
.nge-notif-detail-body :deep(h4) {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin: 1.1em 0 0.6em;
  color: rgb(var(--nd-cyan) / 0.9);
}
.nge-notif-detail-body :deep(blockquote) {
  margin: 0 0 0.7em;
  padding: 6px 12px;
  border-left: 2px solid rgb(var(--nd-cyan) / 0.6);
  background: rgb(var(--nd-accent) / 0.06);
  color: #d6e2f0;
}
.nge-notif-detail-body :deep(code) {
  font-size: 0.9em;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgb(var(--nd-accent) / 0.10);
  border: 1px solid rgb(var(--nd-accent) / 0.18);
  color: #dbe9ff;
}
.nge-notif-detail-body :deep(hr) {
  border: 0;
  height: 1px;
  margin: 1em 0;
  background: linear-gradient(90deg, transparent, rgb(var(--nd-accent) / 0.35), transparent);
}

.nge-notif-detail-body :deep(.nge-notif-link) {
  color: rgb(var(--nd-cyan));
  text-decoration: none;
  /* Wrap a long link only where it must: break-all split links mid word. */
  word-break: normal;
  overflow-wrap: anywhere;
}
.nge-notif-detail-body :deep(.nge-notif-link:hover) {
  text-decoration: underline;
}

.nge-notif-detail-layout {
  display: flex;
  flex-direction: column;
}
.nge-notif-detail-layout--has-image {
  flex-direction: row;
  gap: 20px;
}

.nge-notif-detail-image {
  flex-shrink: 0;
}
.nge-notif-detail-layout--has-image .nge-notif-detail-image {
  width: 440px;
  /* The image stays put while the text scrolls past it (Ames 2026-09-30). */
  position: sticky;
  top: 0;
  align-self: flex-start;
}
.nge-notif-detail-layout--has-image .nge-notif-detail-img {
  max-height: min(600px, calc(100vh - 220px));
}

.nge-notif-detail-text {
  flex: 1;
  min-width: 0;
}

.nge-notif-detail-img {
  display: block;
  width: 100%;
  max-height: 600px;
  border-radius: 8px;
  border: 1px solid rgb(var(--nd-accent) / 0.22);
  box-shadow: 0 0 24px rgb(var(--nd-accent) / 0.10);
  object-fit: contain;
  cursor: zoom-in;
}

/* Help notification action */
.nge-notif-open-help {
  margin-top: 16px;
  padding: 8px 16px;
  border: 1px solid rgb(var(--nd-cyan) / 0.35);
  border-radius: 6px;
  background: rgb(var(--nd-cyan) / 0.07);
  color: rgb(var(--nd-cyan));
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.7em;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.nge-notif-open-help:hover,
.nge-notif-open-help:focus-visible {
  background: rgb(var(--nd-cyan) / 0.14);
  border-color: rgb(var(--nd-cyan) / 0.65);
  box-shadow: 0 0 16px rgb(var(--nd-cyan) / 0.22);
  outline: none;
}

/* ═══ Weekly Champions ═══ */
.nge-champs-head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.nge-champs-emblem {
  flex-shrink: 0;
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  font-size: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255, 211, 90, 0.5);
  background: radial-gradient(circle, rgba(255, 211, 90, 0.18), rgba(255, 211, 90, 0.02) 70%);
  box-shadow:
    0 0 0 4px rgba(10, 17, 32, 0.9),
    0 0 0 5px rgba(255, 211, 90, 0.16),
    0 0 26px rgba(255, 211, 90, 0.22);
}
.nge-champs-head-text { min-width: 0; }
.nge-champs-kicker {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.66em;
  font-weight: 600;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: #ffd35a;
}
.nge-champs-range {
  margin: 4px 0 0;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 1.28em;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1.3;
  color: #f2f7ff;
  text-shadow: 0 0 18px rgb(var(--nd-accent) / 0.4);
}
.nge-champs-intro {
  margin: 0 0 18px;
  padding: 10px 14px;
  border-left: 2px solid rgba(255, 211, 90, 0.7);
  background: linear-gradient(90deg, rgba(255, 211, 90, 0.08), transparent 80%);
  color: #f1f5fb;
  font-size: 0.95em;
  font-weight: 600;
  line-height: 1.5;
}

/* Two columns on a wide window, one category each; the window widens to
   hold them. Ranks four and below scroll inside their own column, so a top
   twenty never pushes the podiums apart. */
.nge-notif-detail--champions { width: 1140px; max-width: 94vw; max-height: 90vh; }
.nge-champs-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 34px; align-items: start; }
.nge-champs-columns > .nge-champs-section { margin-top: 4px; }
/* Side by side, the lists take what height the window has left, so the
   whole broadcast fits without the page itself scrolling. */
@media (min-width: 901px) {
  .nge-champs-columns .nge-champs-list { max-height: clamp(128px, calc(90vh - 590px), 300px); }
}
@media (max-width: 900px) {
  .nge-champs-columns { grid-template-columns: minmax(0, 1fr); }
  .nge-champs-columns > .nge-champs-section + .nge-champs-section { margin-top: 20px; }
}
.nge-champs-section { margin-top: 20px; }
.nge-champs-section:first-of-type { margin-top: 4px; }
.nge-champs-section-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.nge-champs-section-label {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.74em;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--nd-cyan));
  white-space: nowrap;
}
.nge-champs-section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgb(var(--nd-cyan) / 0.45), transparent);
}
.nge-champs-section-count {
  font-size: 0.72em;
  letter-spacing: 0.08em;
  color: rgb(var(--nd-dim) / 0.85);
  white-space: nowrap;
}

/* The podium: silver, gold, bronze, standing on plinths of three heights. */
.nge-champs-podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 10px;
}
.nge-champs-step {
  --tier: 205 218 235;
  flex: 1 1 0;
  min-width: 0;
  max-width: 200px;
  display: flex;
  flex-direction: column;
  animation: ngeChampsRise 620ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
.nge-champs-step--gold   { --tier: 255 211 90;  animation-delay: 380ms; }
.nge-champs-step--silver { --tier: 205 218 235; animation-delay: 260ms; }
.nge-champs-step--bronze { --tier: 226 152 96;  animation-delay: 500ms; }
@keyframes ngeChampsRise {
  from { opacity: 0; transform: translateY(14px); filter: brightness(1.8); }
  to   { opacity: 1; transform: none; filter: none; }
}

.nge-champs-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 14px 10px 12px;
  text-align: center;
  border: 1px solid rgb(var(--tier) / 0.42);
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
  background: linear-gradient(180deg, rgb(var(--tier) / 0.13), rgba(8, 14, 28, 0.85) 85%);
}
.nge-champs-card::before {
  content: '';
  position: absolute;
  left: 14%;
  right: 14%;
  top: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgb(var(--tier)), transparent);
  box-shadow: 0 0 10px rgb(var(--tier) / 0.7);
}
.nge-champs-step--gold .nge-champs-card {
  padding-top: 18px;
  box-shadow: 0 0 30px rgb(var(--tier) / 0.16), inset 0 0 24px rgb(var(--tier) / 0.06);
}
.nge-champs-medal {
  font-size: 1.6em;
  line-height: 1;
  margin-bottom: 4px;
  filter: drop-shadow(0 0 8px rgb(var(--tier) / 0.45));
}
.nge-champs-step--gold .nge-champs-medal { font-size: 2em; }
/* A name that is a player: the whole card or row opens their profile. */
.nge-champs-link { cursor: pointer; transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease; }
.nge-champs-card.nge-champs-link:hover, .nge-champs-card.nge-champs-link:focus-visible { transform: translateY(-2px); border-color: rgb(var(--tier) / 0.75); outline: none; }
.nge-champs-row.nge-champs-link:hover, .nge-champs-row.nge-champs-link:focus-visible { background: rgb(var(--nd-accent) / 0.13); border-color: rgb(var(--nd-accent) / 0.4); outline: none; }
.nge-champs-link:hover .nge-champs-name, .nge-champs-link:hover .nge-champs-row-name { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(var(--nd-cyan) / 0.6); }
.nge-champs-name {
  max-width: 100%;
  font-size: 0.88em;
  font-weight: 600;
  line-height: 1.3;
  color: #f2f6fc;
  overflow-wrap: anywhere;
}
.nge-champs-num {
  margin-top: 6px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 1.9em;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--tier));
  text-shadow: 0 0 16px rgb(var(--tier) / 0.45);
}
.nge-champs-step--gold .nge-champs-num { font-size: 2.4em; }
.nge-champs-unit {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.6em;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--tier) / 0.85);
}
.nge-champs-plinth {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 6px;
  height: 34px;
  border: 1px solid rgb(var(--tier) / 0.3);
  border-top: 2px solid rgb(var(--tier) / 0.85);
  border-radius: 0 0 4px 4px;
  background:
    repeating-linear-gradient(180deg, rgb(var(--tier) / 0.05) 0 1px, transparent 1px 4px),
    linear-gradient(180deg, rgb(var(--tier) / 0.22), rgb(var(--tier) / 0.03));
}
.nge-champs-step--gold .nge-champs-plinth   { height: 62px; }
.nge-champs-step--silver .nge-champs-plinth { height: 44px; }
.nge-champs-step--bronze .nge-champs-plinth { height: 30px; }
.nge-champs-plinth span {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: rgb(var(--tier) / 0.9);
}

/* Ranks four and below: a compact ranked readout under the podium. */
.nge-champs-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* about five rows, then it scrolls */
  max-height: min(214px, 28vh);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--nd-accent) / 0.35) transparent;
}
.nge-champs-list::-webkit-scrollbar { width: 4px; }
.nge-champs-list::-webkit-scrollbar-thumb { background: rgb(var(--nd-accent) / 0.35); border-radius: 2px; }
.nge-champs-row { flex: none; }
.nge-champs-row {
  display: grid;
  grid-template-columns: 34px 1fr auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgb(var(--nd-accent) / 0.14);
  border-left: 2px solid rgb(var(--nd-accent) / 0.5);
  border-radius: 6px;
  background: rgb(var(--nd-accent) / 0.05);
}
.nge-champs-row-rank {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgb(var(--nd-accent));
}
.nge-champs-row-name {
  min-width: 0;
  font-size: 0.9em;
  font-weight: 500;
  color: #e6edf7;
  overflow-wrap: anywhere;
}
.nge-champs-row-num {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 1em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #eef5ff;
}
.nge-champs-row-unit {
  font-size: 0.72em;
  letter-spacing: 0.08em;
  color: rgb(var(--nd-dim));
}

/* Empty section: an open slot on the board, not a line of small italics. */
.nge-champs-empty {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  border: 1px dashed rgb(var(--nd-accent) / 0.35);
  border-radius: 10px;
  background:
    repeating-linear-gradient(135deg, rgb(var(--nd-accent) / 0.035) 0 8px, transparent 8px 16px),
    rgb(var(--nd-accent) / 0.03);
}
.nge-champs-empty-ring {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid rgb(var(--nd-accent) / 0.45);
  box-shadow: 0 0 14px rgb(var(--nd-accent) / 0.15);
}
.nge-champs-empty-ring span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgb(var(--nd-cyan) / 0.7);
}
.nge-champs-empty-text { min-width: 0; }
.nge-champs-empty-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #dce8f7;
}
.nge-champs-empty-sub {
  margin-top: 4px;
  font-size: 0.86em;
  line-height: 1.45;
  color: rgb(var(--nd-dim));
}

.nge-champs-outro {
  margin: 22px 0 0;
  padding-top: 14px;
  border-top: 1px solid rgb(var(--nd-accent) / 0.14);
  font-size: 0.9em;
  line-height: 1.6;
  color: rgb(var(--nd-dim));
}

/* Narrow windows and phones: the image on top, full width. */
@media (max-width: 760px) {
  .nge-notif-detail-layout--has-image { flex-direction: column; }
  .nge-notif-detail-layout--has-image .nge-notif-detail-image { width: 100%; position: static; }
}
@media (max-width: 560px) {
  .nge-notif-detail-scroll { padding: 16px 16px 20px; }
  .nge-champs-emblem { width: 46px; height: 46px; font-size: 22px; }
  .nge-champs-range { font-size: 1.05em; }
  .nge-champs-podium { gap: 6px; }
  .nge-champs-card { padding: 12px 6px 10px; }
  .nge-champs-num { font-size: 1.5em; }
  .nge-champs-step--gold .nge-champs-num { font-size: 1.85em; }
  .nge-champs-name { font-size: 0.8em; }
}

/* ── Transition ── */
/* The panel's own ngeNotifMaterialize animation drives the entrance, so the Vue
   transition only fades the backdrop in and animates the leave (no enter
   transform on the panel, or the two fight). */
.nge-notif-detail-enter-active { transition: opacity 0.25s ease; }
.nge-notif-detail-leave-active { transition: opacity 0.18s ease; }
.nge-notif-detail-leave-active .nge-notif-detail { transition: transform 0.18s ease, opacity 0.18s ease, filter 0.18s ease; }
.nge-notif-detail-enter-from { opacity: 0; }
.nge-notif-detail-leave-to { opacity: 0; }
.nge-notif-detail-leave-to .nge-notif-detail { transform: scale(0.97); opacity: 0; filter: blur(6px) brightness(1.6); }

/* Reduced motion: every entrance lands on its finished state, the scan band
   never shows, and the leave is instant. */
@media (prefers-reduced-motion: reduce) {
  .nge-notif-detail,
  .nge-notif-bracket,
  .nge-champs-step { animation: none; }
  .nge-notif-detail-scan { animation: none; opacity: 0; display: none; }
  .nge-notif-detail-close,
  .nge-notif-open-help { transition: none; }
  .nge-notif-detail-enter-active,
  .nge-notif-detail-leave-active,
  .nge-notif-detail-leave-active .nge-notif-detail { transition: none; }
  .nge-notif-detail-leave-to .nge-notif-detail { transform: none; filter: none; }
}

/* ── Lightbox ── */
.nge-notif-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10001;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.nge-notif-lightbox-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
}
</style>
