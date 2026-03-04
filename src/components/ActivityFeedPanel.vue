<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {useProofreadingBackendStore, ActivityFeedItem} from '../store';

const store = useProofreadingBackendStore();
const emit = defineEmits({hide: null});

onMounted(() => {
  store.subscribeToFeed();
});

onUnmounted(() => {
  store.unsubscribeFromFeed();
});

const feed = computed(() => [...store.activityFeed].reverse());

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function actionIcon(action: string): string {
  if (action.includes('split')) return '✂';
  if (action.includes('merge')) return '🔗';
  if (action.includes('complete')) return '✓';
  if (action.includes('claim')) return '📌';
  if (action.includes('release')) return '↩';
  return '•';
}

function actionClass(action: string): string {
  if (action.includes('split')) return 'action-split';
  if (action.includes('merge')) return 'action-merge';
  if (action.includes('complete')) return 'action-complete';
  if (action.includes('claim')) return 'action-claim';
  return '';
}
</script>

<template>
  <modal-overlay class="nge-feed-modal" @hide="emit('hide')">
    <div class="nge-feed-shell" @click.stop>
      <div class="nge-feed-header">
        <h2 class="nge-feed-title">Activity Feed</h2>
        <span class="nge-feed-subtitle">Live community proofreading activity</span>
      </div>

      <div class="nge-feed-list" v-if="feed.length > 0">
        <div
          v-for="item in feed"
          :key="item.id"
          class="nge-feed-item"
          :class="actionClass(item.action)"
        >
          <span class="nge-feed-icon">{{ actionIcon(item.action) }}</span>
          <span class="nge-feed-user">{{ item.user_name || 'Anonymous' }}</span>
          <span class="nge-feed-action">{{ item.action }}</span>
          <span class="nge-feed-time">{{ timeAgo(item.timestamp) }}</span>
        </div>
      </div>

      <div class="nge-feed-empty" v-else>
        <div class="nge-feed-empty-icon">📡</div>
        <p>No activity yet. Start proofreading to see the feed come alive!</p>
      </div>
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-feed-shell {
  width: 480px;
  max-width: 90vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', 'Roboto', sans-serif;
}

.nge-feed-header {
  padding: 0 0 14px;
  border-bottom: 1px solid rgba(0, 180, 255, 0.15);
  margin-bottom: 12px;
}

.nge-feed-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #e0e0e0;
  letter-spacing: 0.5px;
}

.nge-feed-subtitle {
  font-size: 12px;
  color: #667;
  margin-top: 2px;
  display: block;
}

.nge-feed-list {
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}

.nge-feed-list::-webkit-scrollbar { width: 4px; }
.nge-feed-list::-webkit-scrollbar-track { background: transparent; }
.nge-feed-list::-webkit-scrollbar-thumb { background: rgba(0, 180, 255, 0.2); border-radius: 2px; }

.nge-feed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.15s ease;
  font-size: 13px;
}

.nge-feed-item:hover {
  background: rgba(0, 180, 255, 0.06);
}

.nge-feed-icon {
  font-size: 16px;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.nge-feed-user {
  font-weight: 600;
  color: #c8d0e0;
  white-space: nowrap;
  flex-shrink: 0;
}

.nge-feed-action {
  color: #8898a8;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nge-feed-time {
  font-size: 11px;
  color: #556;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Action-specific accent colors */
.action-split .nge-feed-icon { color: #ff6060; }
.action-split .nge-feed-action { color: #ff8888; }

.action-merge .nge-feed-icon { color: #60c0ff; }
.action-merge .nge-feed-action { color: #88d0ff; }

.action-complete .nge-feed-icon { color: #60ffa0; }
.action-complete .nge-feed-action { color: #80ffc0; }

.action-claim .nge-feed-icon { color: #ffb060; }
.action-claim .nge-feed-action { color: #ffc888; }

/* Empty state */
.nge-feed-empty {
  text-align: center;
  padding: 40px 20px;
  color: #667;
}

.nge-feed-empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.nge-feed-empty p {
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}
</style>
