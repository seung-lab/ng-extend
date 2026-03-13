<script setup lang="ts">
/**
 * ChatPanel.vue
 * Community chat room via WebSocket.
 * Ported from cj-eyewire-chat-2 branch, adapted to eyewire-ii-community patterns.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';
import { useChatStore, useProofreadingBackendStore, ChatMessage } from '../store';

const emit = defineEmits({ hide: null });
const chatStore = useChatStore();
const { chatMessages, connected, unreadMessages } = storeToRefs(chatStore);
const backendStore = useProofreadingBackendStore();

const messageInput = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const scrollContainer = ref<HTMLDivElement | null>(null);
const isScrolledUp = ref(false);

// Connect on mount, mark read
onMounted(() => {
  chatStore.connect();
  chatStore.markRead();
  nextTick(() => inputEl.value?.focus());
});

// Mark read when panel is visible and new messages arrive
watch(chatMessages, () => {
  if (!isScrolledUp.value) {
    chatStore.markRead();
  }
});

// ── Leaderboard trophy mapping ──
const trophyMap = computed(() => {
  const map: Record<string, string> = {};
  const lb = backendStore.leaderboard || [];
  if (lb.length > 0) map[lb[0].display_name] = '\u{1F947}'; // gold
  if (lb.length > 1) map[lb[1].display_name] = '\u{1F948}'; // silver
  if (lb.length > 2) map[lb[2].display_name] = '\u{1F949}'; // bronze
  return map;
});

// ── Rank-based name colors ──
function rankColor(rank: string): string {
  switch (rank) {
    case 'admin': return '#E6C760';
    case 'eyewirer': return '#0292AE';
    case 'researcher': return '#0FB18B';
    default: return '#c8d0e0';
  }
}

// ── Send message ──
function send() {
  const text = messageInput.value.trim();
  if (!text) return;
  chatStore.sendMessage(text);
  messageInput.value = '';
  inputEl.value?.focus();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

// ── Scroll handling (inverted scroll) ──
function handleScroll() {
  const el = scrollContainer.value;
  if (!el) return;
  // In inverted scroll, scrollTop 0 = bottom (newest), higher = scrolled up
  isScrolledUp.value = el.scrollTop > 60;
  if (!isScrolledUp.value) {
    chatStore.markRead();
  }
}

function scrollToBottom() {
  const el = scrollContainer.value;
  if (el) el.scrollTop = 0; // inverted: 0 = bottom
  isScrolledUp.value = false;
  chatStore.markRead();
}
</script>

<template>
  <modal-overlay class="nge-chat-modal" @hide="emit('hide')">
    <div class="nge-chat-shell" @click.stop>
      <!-- Header -->
      <div class="nge-chat-header">
        <div class="nge-chat-header-left">
          <h2 class="nge-chat-title">Community Chat</h2>
          <span class="nge-chat-status" :class="{ 'nge-chat-status--on': connected }">
            {{ connected ? 'Connected' : 'Connecting...' }}
          </span>
        </div>
        <button class="nge-chat-close" @click="emit('hide')" title="Close">&times;</button>
      </div>

      <!-- Message list (inverted scroll: newest at bottom visually) -->
      <div
        class="nge-chat-messages"
        ref="scrollContainer"
        @scroll="handleScroll"
      >
        <div class="nge-chat-messages-inner">
          <template v-for="(msg, i) in chatMessages" :key="i">
            <!-- Time separator -->
            <div v-if="msg.type === 'time'" class="nge-chat-time-sep">
              <span>{{ msg.time }}</span>
            </div>

            <!-- System messages: join / leave / disconnected -->
            <div v-else-if="msg.type === 'join' || msg.type === 'leave' || msg.type === 'disconnected'"
                 class="nge-chat-system"
                 :class="{ 'nge-chat-system--warn': msg.type === 'disconnected' }">
              <span class="nge-chat-system-icon">
                {{ msg.type === 'join' ? '\u{2192}' : msg.type === 'leave' ? '\u{2190}' : '\u{26A0}' }}
              </span>
              {{ msg.parts[0]?.text || '' }}
              <span class="nge-chat-msg-time">{{ msg.time }}</span>
            </div>

            <!-- Chat message -->
            <div v-else-if="msg.type === 'message'" class="nge-chat-msg">
              <div class="nge-chat-msg-header">
                <span class="nge-chat-msg-trophy" v-if="trophyMap[msg.name]">{{ trophyMap[msg.name] }}</span>
                <span class="nge-chat-msg-sender" :style="{ color: rankColor(msg.rank) }">
                  {{ msg.name }}
                </span>
                <span class="nge-chat-msg-time">{{ msg.time }}</span>
              </div>
              <div class="nge-chat-msg-body">
                <template v-for="(part, pi) in msg.parts" :key="pi">
                  <template v-if="part.type === 'sender'"><!-- skip, rendered above --></template>
                  <a v-else-if="part.type === 'link'" :href="part.text" target="_blank" rel="noopener" class="nge-chat-link">{{ part.text }}</a>
                  <span v-else>{{ part.text }}</span>
                </template>
              </div>
            </div>
          </template>

          <!-- Empty state -->
          <div v-if="chatMessages.length === 0" class="nge-chat-empty">
            <div class="nge-chat-empty-icon">\u{1F4AC}</div>
            <p>No messages yet. Say hello!</p>
          </div>
        </div>
      </div>

      <!-- New messages banner -->
      <Transition name="nge-chat-banner-fade">
        <div v-if="isScrolledUp && unreadMessages" class="nge-chat-new-banner" @click="scrollToBottom">
          \u{2B07} NEW MESSAGES
        </div>
      </Transition>

      <!-- Input -->
      <div class="nge-chat-input-wrap">
        <input
          ref="inputEl"
          v-model="messageInput"
          class="nge-chat-input"
          placeholder="Type a message..."
          @keydown="handleKeydown"
          spellcheck="true"
          autocomplete="off"
          :disabled="!connected"
        />
        <button class="nge-chat-send" @click="send" :disabled="!connected || !messageInput.trim()" title="Send">
          \u{27A4}
        </button>
      </div>
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-chat-shell {
  width: 420px;
  max-width: 90vw;
  height: 520px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', 'Roboto', sans-serif;
}

/* ── Header ── */
.nge-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 12px;
  border-bottom: 1px solid rgba(0, 180, 255, 0.15);
  margin-bottom: 0;
}

.nge-chat-header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nge-chat-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #e0e0e0;
  letter-spacing: 0.5px;
}

.nge-chat-status {
  font-size: 11px;
  color: #665;
  display: flex;
  align-items: center;
  gap: 5px;
}

.nge-chat-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #665;
  display: inline-block;
}

.nge-chat-status--on { color: #0fb18b; }
.nge-chat-status--on::before { background: #0fb18b; box-shadow: 0 0 6px rgba(15, 177, 139, 0.5); }

.nge-chat-close {
  background: none;
  border: none;
  color: #667;
  font-size: 24px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}
.nge-chat-close:hover { color: #fff; }

/* ── Message list (inverted scroll) ── */
.nge-chat-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
  padding: 8px 4px 8px 0;
  min-height: 0;
}

.nge-chat-messages::-webkit-scrollbar { width: 4px; }
.nge-chat-messages::-webkit-scrollbar-track { background: transparent; }
.nge-chat-messages::-webkit-scrollbar-thumb { background: rgba(0, 180, 255, 0.2); border-radius: 2px; }

.nge-chat-messages-inner {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ── Chat message ── */
.nge-chat-msg {
  padding: 6px 10px;
  border-radius: 6px;
  transition: background 0.15s;
}
.nge-chat-msg:hover { background: rgba(255, 255, 255, 0.03); }

.nge-chat-msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.nge-chat-msg-trophy {
  font-size: 12px;
}

.nge-chat-msg-sender {
  font-weight: 600;
  font-size: 13px;
}

.nge-chat-msg-time {
  font-size: 10px;
  color: #445;
  margin-left: auto;
  flex-shrink: 0;
}

.nge-chat-msg-body {
  font-size: 13px;
  color: #b0b8c8;
  line-height: 1.5;
  word-break: break-word;
}

.nge-chat-link {
  color: #4a9eff;
  text-decoration: none;
  word-break: break-all;
}
.nge-chat-link:hover { text-decoration: underline; }

/* ── System messages ── */
.nge-chat-system {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 11px;
  color: #556;
  font-style: italic;
}

.nge-chat-system-icon {
  font-size: 10px;
  font-style: normal;
}

.nge-chat-system--warn {
  color: #c08030;
}

/* ── Time separator ── */
.nge-chat-time-sep {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
}

.nge-chat-time-sep span {
  font-size: 10px;
  color: #445;
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 10px;
  border-radius: 10px;
  letter-spacing: 0.05em;
}

/* ── New messages banner ── */
.nge-chat-new-banner {
  position: absolute;
  bottom: 62px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(74, 158, 255, 0.9);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 16px;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  z-index: 5;
  transition: background 0.15s;
}
.nge-chat-new-banner:hover { background: rgba(74, 158, 255, 1); }

.nge-chat-banner-fade-enter-active { transition: opacity 0.2s, transform 0.2s; }
.nge-chat-banner-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.nge-chat-banner-fade-enter-from { opacity: 0; transform: translateX(-50%) translateY(8px); }
.nge-chat-banner-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ── Input ── */
.nge-chat-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 0;
  border-top: 1px solid rgba(0, 180, 255, 0.1);
}

.nge-chat-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(100, 180, 255, 0.15);
  border-radius: 8px;
  padding: 8px 12px;
  color: #e0e4ec;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.nge-chat-input:focus { border-color: rgba(74, 158, 255, 0.4); }
.nge-chat-input::placeholder { color: #445; }
.nge-chat-input:disabled { opacity: 0.4; cursor: not-allowed; }

.nge-chat-send {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(74, 158, 255, 0.15);
  border: 1px solid rgba(74, 158, 255, 0.2);
  color: #4a9eff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}
.nge-chat-send:hover:not(:disabled) { background: rgba(74, 158, 255, 0.3); color: #fff; }
.nge-chat-send:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Empty state ── */
.nge-chat-empty {
  text-align: center;
  padding: 60px 20px;
  color: #445;
}

.nge-chat-empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.nge-chat-empty p {
  font-size: 14px;
  margin: 0;
  line-height: 1.5;
}
</style>
