<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { marked } from 'marked';
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

onMounted(() => {
  backend.loadNotifications();
  backend.subscribeToNotifications();
  document.addEventListener('mousedown', onDocClick, true);
});

onUnmounted(() => {
  backend.unsubscribeFromNotifications();
  document.removeEventListener('mousedown', onDocClick, true);
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

async function doDeleteAll() {
  confirmDeleteAll.value = false;
  await backend.dismissAllNotifications();
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

function isHelpNotification(notif: any): boolean {
  return notif?.title?.includes('help request') || notif?.title?.includes('Response to your');
}

function openHelpTab() {
  closeDetail();
  emit('hide');
  emit('open-help');
}

/** Render a notification body (markdown) to safe HTML.
 *  HTML is escaped FIRST — bodies can carry user text (e.g. help-response
 *  responder names / note previews, see store.createNotification), and there's
 *  no sanitizer dep — so raw tags become inert text. marked then turns
 *  **bold** / _italic_ / links / lists into markup (gfm autolinks bare URLs,
 *  breaks turns newlines into <br>). Links get target/rel + the panel link
 *  class via a post-pass so they still open in a new tab. */
function renderMarkdown(text: string): string {
  const escaped = (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = marked.parse(escaped, { gfm: true, breaks: true, async: false }) as string;
  return html.replace(/<a /g, '<a target="_blank" rel="noopener" class="nge-notif-link" ');
}

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
</script>

<template>
  <Teleport to="body">
  <div v-show="visible" ref="panelRef" class="nge-notif-panel">
    <div class="nge-notif-topbar">
      <span class="nge-notif-title">🔔 Notifications</span>
      <div class="nge-notif-topbar-actions">
        <button
          v-if="backend.unreadNotificationCount > 0"
          class="nge-notif-mark-all"
          @click="backend.markAllNotificationsRead()"
        >Mark all read</button>
        <!-- Separate from "mark all read" on purpose: read state controls the
             unread pip, this clears the feed. Only hides them for THIS user —
             the underlying notification rows are untouched. -->
        <button
          v-if="backend.notifications.length > 0"
          class="nge-notif-delete-all"
          @click="confirmDeleteAll = true"
          title="Delete all notifications (only affects your feed)"
        >Delete all</button>
        <button class="nge-notif-close" @click.stop="emit('hide')">×</button>
      </div>
    </div>

    <!-- Deleting the whole feed is irreversible, so make it a deliberate two
         step action rather than a single click next to the close button. -->
    <div v-if="confirmDeleteAll" class="nge-notif-confirm">
      <span>Delete all {{ backend.notifications.length }} notifications?</span>
      <button class="nge-notif-confirm-yes" @click="doDeleteAll">Delete all</button>
      <button class="nge-notif-confirm-no" @click="confirmDeleteAll = false">Cancel</button>
    </div>

    <div class="nge-notif-list" v-if="backend.notifications.length > 0">
      <div
        v-for="notif in backend.notifications"
        :key="notif.id"
        class="nge-notif-card"
        :class="{ 'nge-notif-card--unread': !isRead(notif.id) }"
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
              <div class="nge-notif-card-title">{{ notif.title }}</div>
              <span class="nge-notif-time">{{ relativeTime(notif.send_at) }}</span>
              <button
                v-if="backend.isAdmin"
                class="nge-notif-delete"
                @click.stop="backend.deleteNotification(notif.id)"
                title="Delete notification (admin)"
              >🗑</button>
              <button
                class="nge-notif-dismiss"
                @click.stop="backend.dismissNotification(notif.id)"
                title="Dismiss"
              >×</button>
            </div>
            <div class="nge-notif-card-body nge-notif-card-body--preview">{{ plainText(notif.body) }}</div>
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
        <div class="nge-notif-detail">
          <div class="nge-notif-detail-topbar">
            <span class="nge-notif-detail-time">{{ relativeTime(openNotif.send_at) }}</span>
            <button class="nge-notif-detail-close" @click="closeDetail">×</button>
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
                <h2 class="nge-notif-detail-title">{{ openNotif.title }}</h2>
                <div
                  class="nge-notif-detail-body"
                  v-html="renderMarkdown(openNotif.body)"
                ></div>
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
  max-height: 480px;
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
.nge-notif-card {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.15s;
}
.nge-notif-card:hover { background: rgba(74, 158, 255, 0.04); }
.nge-notif-card--unread { background: rgba(74, 158, 255, 0.03); }

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
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4a9eff;
  flex-shrink: 0;
  margin-top: 4px;
}

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
  font-style: italic;
}

/* ═══ Detail overlay ═══ */
.nge-notif-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nge-notif-detail {
  width: 740px;
  max-width: 90vw;
  max-height: 80vh;
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.97) 0%, rgba(8, 12, 24, 0.95) 50%, rgba(4, 8, 18, 0.97) 100%);
  border: 1px solid rgba(74, 158, 255, 0.2);
  border-radius: 12px;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.7), 0 0 40px rgba(74, 158, 255, 0.06);
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(12px);
  font-family: sans-serif;
}

.nge-notif-detail-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.nge-notif-detail-time {
  font-size: 0.75em;
  color: #556;
}

.nge-notif-detail-close {
  background: none;
  border: none;
  color: #666;
  font-size: 1.4em;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.nge-notif-detail-close:hover { color: #fff; }

.nge-notif-detail-scroll {
  overflow-y: auto;
  padding: 18px 22px 24px;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.15) transparent;
}

.nge-notif-detail-title {
  font-size: 1.2em;
  font-weight: 700;
  color: #e8e8ee;
  margin: 0 0 14px;
  line-height: 1.3;
}

.nge-notif-detail-body {
  font-size: 0.95em;
  color: #b0b0b8;
  line-height: 1.65;
  /* marked emits <p>/<br>/lists now, so it owns line breaks — pre-wrap here
     would double every gap. */
  white-space: normal;
  word-break: break-word;
}
/* Rendered-markdown block spacing. */
.nge-notif-detail-body :deep(p) { margin: 0 0 0.7em; }
.nge-notif-detail-body :deep(p:last-child) { margin-bottom: 0; }
.nge-notif-detail-body :deep(strong) { color: #dfe6f0; font-weight: 650; }
.nge-notif-detail-body :deep(ul),
.nge-notif-detail-body :deep(ol) { margin: 0 0 0.7em; padding-left: 1.3em; }
.nge-notif-detail-body :deep(li) { margin: 0.15em 0; }
.nge-notif-detail-body :deep(h1),
.nge-notif-detail-body :deep(h2),
.nge-notif-detail-body :deep(h3) { font-size: 1.05em; margin: 0.2em 0 0.5em; color: #dfe6f0; }

.nge-notif-detail-body :deep(.nge-notif-link) {
  color: #4a9eff;
  text-decoration: none;
  word-break: break-all;
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
  gap: 18px;
}

.nge-notif-detail-image {
  flex-shrink: 0;
}
.nge-notif-detail-layout--has-image .nge-notif-detail-image {
  width: 320px;
}

.nge-notif-detail-text {
  flex: 1;
  min-width: 0;
}

.nge-notif-detail-img {
  width: 100%;
  max-height: 600px;
  border-radius: 8px;
  object-fit: contain;
  cursor: zoom-in;
}

/* Help notification action */
.nge-notif-open-help {
  margin-top: 14px;
  padding: 7px 16px;
  border: 1px solid rgba(255, 136, 170, 0.25);
  border-radius: 6px;
  background: rgba(255, 136, 170, 0.08);
  color: #f8a;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.nge-notif-open-help:hover {
  background: rgba(255, 136, 170, 0.15);
  border-color: rgba(255, 136, 170, 0.4);
}

/* ── Transition ── */
.nge-notif-detail-enter-active { transition: opacity 0.2s ease; }
.nge-notif-detail-enter-active .nge-notif-detail { transition: transform 0.2s ease, opacity 0.2s ease; }
.nge-notif-detail-leave-active { transition: opacity 0.15s ease; }
.nge-notif-detail-leave-active .nge-notif-detail { transition: transform 0.15s ease, opacity 0.15s ease; }
.nge-notif-detail-enter-from { opacity: 0; }
.nge-notif-detail-enter-from .nge-notif-detail { transform: scale(0.95) translateY(8px); opacity: 0; }
.nge-notif-detail-leave-to { opacity: 0; }
.nge-notif-detail-leave-to .nge-notif-detail { transform: scale(0.97); opacity: 0; }

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
