<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useProofreadingBackendStore } from '../store';

const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();

onMounted(() => {
  backend.loadNotifications();
  backend.subscribeToNotifications();
});

onUnmounted(() => {
  backend.unsubscribeFromNotifications();
});

const lightboxUrl = ref<string | null>(null);

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
</script>

<template>
  <div class="nge-notif-panel">
    <div class="nge-notif-topbar">
      <span class="nge-notif-title">🔔 Notifications</span>
      <div class="nge-notif-topbar-actions">
        <button
          v-if="backend.unreadNotificationCount > 0"
          class="nge-notif-mark-all"
          @click="backend.markAllNotificationsRead()"
        >Mark all read</button>
        <button class="nge-notif-close" @click="emit('hide')">×</button>
      </div>
    </div>

    <div class="nge-notif-list" v-if="backend.notifications.length > 0">
      <div
        v-for="notif in backend.notifications"
        :key="notif.id"
        class="nge-notif-card"
        :class="{ 'nge-notif-card--unread': !isRead(notif.id) }"
        @click="backend.markNotificationRead(notif.id)"
      >
        <div class="nge-notif-card-header">
          <span v-if="!isRead(notif.id)" class="nge-notif-unread-dot"></span>
          <div class="nge-notif-card-title">{{ notif.title }}</div>
          <span class="nge-notif-time">{{ relativeTime(notif.send_at) }}</span>
        </div>
        <div class="nge-notif-card-body">{{ notif.body }}</div>
        <div v-if="notif.thumbnail_url" class="nge-notif-card-image">
          <img
            :src="notif.thumbnail_url"
            class="nge-notif-thumb"
            @click.stop="lightboxUrl = notif.image_url || notif.thumbnail_url"
          />
        </div>
      </div>
    </div>

    <div class="nge-notif-empty" v-else>
      No notifications yet.
    </div>

    <!-- Lightbox for full-size images -->
    <Teleport to="body">
      <div v-if="lightboxUrl" class="nge-notif-lightbox" @click="lightboxUrl = null">
        <img :src="lightboxUrl" class="nge-notif-lightbox-img" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nge-notif-panel {
  position: fixed;
  top: 42px;
  right: 8px;
  width: 340px;
  max-height: 480px;
  background: rgba(14, 17, 23, 0.97);
  border: 1px solid rgba(74, 158, 255, 0.15);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  z-index: 8000;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(8px);
  font-size: 0.85em;
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

.nge-notif-card {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.15s;
}
.nge-notif-card:hover { background: rgba(74, 158, 255, 0.04); }
.nge-notif-card--unread { background: rgba(74, 158, 255, 0.03); }

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

.nge-notif-card-body {
  margin-top: 3px;
  font-size: 0.82em;
  color: #888;
  line-height: 1.4;
}

.nge-notif-card-image { margin-top: 8px; }

.nge-notif-thumb {
  max-width: 100%;
  max-height: 120px;
  border-radius: 6px;
  cursor: zoom-in;
  object-fit: cover;
}

.nge-notif-empty {
  padding: 32px 16px;
  text-align: center;
  color: #556;
  font-size: 0.82em;
  font-style: italic;
}

/* Lightbox */
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
