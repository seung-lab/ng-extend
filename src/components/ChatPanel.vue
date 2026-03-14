<script setup lang="ts">
/**
 * ChatPanel.vue
 * Minimal, resizable community chat — stays open while mapping.
 * Three states: open (full), collapsed (header bar only), closed (hidden).
 * Transparent background so the viewer shows through.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useChatStore, useProofreadingBackendStore, ChatMessage } from '../store';

const emit = defineEmits({ hide: null });
const chatStore = useChatStore();
const { chatMessages, connected, unreadMessages } = storeToRefs(chatStore);
const backendStore = useProofreadingBackendStore();

const messageInput = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const scrollContainer = ref<HTMLDivElement | null>(null);
const isScrolledUp = ref(false);
const collapsed = ref(false);

// ── Resize state ──
const panelWidth = ref(320);
const panelHeight = ref(360);
const isResizing = ref(false);
let resizeStart = { mx: 0, my: 0, w: 0, h: 0 };

function startResize(e: MouseEvent) {
  isResizing.value = true;
  resizeStart = { mx: e.clientX, my: e.clientY, w: panelWidth.value, h: panelHeight.value };
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  e.preventDefault();
}

function onResize(e: MouseEvent) {
  if (!isResizing.value) return;
  // Resize from top-left corner — dragging left increases width, dragging up increases height
  panelWidth.value = Math.max(240, Math.min(600, resizeStart.w - (e.clientX - resizeStart.mx)));
  panelHeight.value = Math.max(200, Math.min(700, resizeStart.h - (e.clientY - resizeStart.my)));
}

function stopResize() {
  isResizing.value = false;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}

// Connect on mount, mark read
onMounted(() => {
  chatStore.connect();
  chatStore.markRead();
  nextTick(() => inputEl.value?.focus());
});

onUnmounted(() => {
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
});

// Mark read when panel is visible and new messages arrive
watch(chatMessages, () => {
  if (!isScrolledUp.value && !collapsed.value) {
    chatStore.markRead();
  }
});

// ── Leaderboard trophy mapping ──
const trophyMap = computed(() => {
  const map: Record<string, string> = {};
  const lb = backendStore.leaderboard || [];
  if (lb.length > 0) map[lb[0].display_name] = '\u{1F947}';
  if (lb.length > 1) map[lb[1].display_name] = '\u{1F948}';
  if (lb.length > 2) map[lb[2].display_name] = '\u{1F949}';
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
  isScrolledUp.value = el.scrollTop > 60;
  if (!isScrolledUp.value) {
    chatStore.markRead();
  }
}

function scrollToBottom() {
  const el = scrollContainer.value;
  if (el) el.scrollTop = 0;
  isScrolledUp.value = false;
  chatStore.markRead();
}

function toggleCollapse() {
  collapsed.value = !collapsed.value;
  if (!collapsed.value) {
    chatStore.markRead();
    nextTick(() => inputEl.value?.focus());
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="nge-chat-float"
      :class="{ 'nge-chat-float--collapsed': collapsed }"
      :style="collapsed ? {} : { width: panelWidth + 'px', height: panelHeight + 'px' }"
    >
      <!-- Resize handle (top-left corner) -->
      <div v-if="!collapsed" class="nge-chat-resize" @mousedown="startResize"></div>

      <!-- Header bar -->
      <div class="nge-chat-bar" @dblclick="toggleCollapse">
        <span class="nge-chat-bar-dot" :class="{ 'nge-chat-bar-dot--on': connected }"></span>
        <span class="nge-chat-bar-label">Chat</span>
        <span v-if="collapsed && unreadMessages" class="nge-chat-bar-badge">{{ unreadMessages }}</span>
        <span class="nge-chat-bar-spacer"></span>
        <button class="nge-chat-bar-btn" @click="toggleCollapse" :title="collapsed ? 'Expand' : 'Collapse'">
          {{ collapsed ? '▲' : '▼' }}
        </button>
        <button class="nge-chat-bar-btn" @click="emit('hide')" title="Close">×</button>
      </div>

      <!-- Body (hidden when collapsed) -->
      <template v-if="!collapsed">
        <!-- Message list -->
        <div
          class="nge-chat-messages"
          ref="scrollContainer"
          @scroll="handleScroll"
        >
          <div class="nge-chat-messages-inner">
            <template v-for="(msg, i) in chatMessages" :key="i">
              <div v-if="msg.type === 'time'" class="nge-chat-time-sep">
                <span>{{ msg.time }}</span>
              </div>

              <div v-else-if="msg.type === 'join' || msg.type === 'leave' || msg.type === 'disconnected'"
                   class="nge-chat-sys"
                   :class="{ 'nge-chat-sys--warn': msg.type === 'disconnected' }">
                {{ msg.type === 'join' ? '→' : msg.type === 'leave' ? '←' : '⚠' }}
                {{ msg.parts[0]?.text || '' }}
              </div>

              <div v-else-if="msg.type === 'message'" class="nge-chat-msg">
                <span class="nge-chat-msg-trophy" v-if="trophyMap[msg.name]">{{ trophyMap[msg.name] }}</span>
                <span class="nge-chat-msg-name" :style="{ color: rankColor(msg.rank) }">{{ msg.name }}</span>
                <span class="nge-chat-msg-time">{{ msg.time }}</span>
                <div class="nge-chat-msg-body">
                  <template v-for="(part, pi) in msg.parts" :key="pi">
                    <template v-if="part.type === 'sender'"></template>
                    <a v-else-if="part.type === 'link'" :href="part.text" target="_blank" rel="noopener" class="nge-chat-link">{{ part.text }}</a>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </div>
              </div>
            </template>

            <div v-if="chatMessages.length === 0" class="nge-chat-empty">
              No messages yet. Say hello!
            </div>
          </div>
        </div>

        <!-- New messages banner -->
        <Transition name="nge-chat-banner">
          <div v-if="isScrolledUp && unreadMessages" class="nge-chat-new-banner" @click="scrollToBottom">
            ↓ new
          </div>
        </Transition>

        <!-- Input -->
        <div class="nge-chat-input-wrap">
          <input
            ref="inputEl"
            v-model="messageInput"
            class="nge-chat-input"
            placeholder="Message..."
            @keydown.stop
            @keyup.stop
            @keypress.stop
            @keydown.enter.exact.prevent="send"
            spellcheck="true"
            autocomplete="off"
            :disabled="!connected"
          />
          <button class="nge-chat-send" @click="send" :disabled="!connected || !messageInput.trim()" title="Send">
            ➤
          </button>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Floating container — pinned bottom-right ── */
.nge-chat-float {
  position: fixed;
  bottom: 36px;
  right: 8px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  background: rgba(10, 14, 24, 0.75);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(100, 180, 255, 0.12);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  font-family: 'Inter', 'Roboto', sans-serif;
  transition: width 0.2s, height 0.2s;
}

.nge-chat-float--collapsed {
  width: auto !important;
  height: auto !important;
}

/* ── Resize handle — top-left corner ── */
.nge-chat-resize {
  position: absolute;
  top: 0;
  left: 0;
  width: 14px;
  height: 14px;
  cursor: nw-resize;
  z-index: 10;
}
.nge-chat-resize::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 6px;
  height: 6px;
  border-top: 1.5px solid rgba(255, 255, 255, 0.2);
  border-left: 1.5px solid rgba(255, 255, 255, 0.2);
}

/* ── Header bar ── */
.nge-chat-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: default;
  user-select: none;
  flex-shrink: 0;
}

.nge-chat-bar-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}
.nge-chat-bar-dot--on {
  background: #0fb18b;
  box-shadow: 0 0 5px rgba(15, 177, 139, 0.5);
}

.nge-chat-bar-label {
  font-size: 12px;
  font-weight: 600;
  color: #9aa;
  letter-spacing: 0.03em;
}

.nge-chat-bar-badge {
  background: #4a9eff;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
  line-height: 16px;
}

.nge-chat-bar-spacer { flex: 1; }

.nge-chat-bar-btn {
  background: none;
  border: none;
  color: #667;
  font-size: 14px;
  cursor: pointer;
  padding: 0 3px;
  line-height: 1;
  transition: color 0.12s;
}
.nge-chat-bar-btn:hover { color: #ccc; }

/* ── Messages ── */
.nge-chat-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
  padding: 4px 6px;
  min-height: 0;
}

.nge-chat-messages::-webkit-scrollbar { width: 3px; }
.nge-chat-messages::-webkit-scrollbar-track { background: transparent; }
.nge-chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

.nge-chat-messages-inner {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nge-chat-msg {
  padding: 3px 6px;
  border-radius: 4px;
  line-height: 1.4;
}
.nge-chat-msg:hover { background: rgba(255, 255, 255, 0.03); }

.nge-chat-msg-trophy { font-size: 11px; margin-right: 2px; }

.nge-chat-msg-name {
  font-weight: 600;
  font-size: 12px;
  margin-right: 4px;
}

.nge-chat-msg-time {
  font-size: 9px;
  color: #445;
  float: right;
  margin-top: 2px;
}

.nge-chat-msg-body {
  font-size: 12px;
  color: #b0b8c8;
  word-break: break-word;
}

.nge-chat-link {
  color: #4a9eff;
  text-decoration: none;
  word-break: break-all;
}
.nge-chat-link:hover { text-decoration: underline; }

/* System messages */
.nge-chat-sys {
  font-size: 10px;
  color: #556;
  font-style: italic;
  padding: 1px 6px;
}
.nge-chat-sys--warn { color: #c08030; }

/* Time separator */
.nge-chat-time-sep {
  text-align: center;
  padding: 4px 0;
}
.nge-chat-time-sep span {
  font-size: 9px;
  color: #445;
  background: rgba(0, 0, 0, 0.25);
  padding: 1px 8px;
  border-radius: 8px;
}

/* New messages banner */
.nge-chat-new-banner {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(74, 158, 255, 0.85);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 12px;
  border-radius: 10px;
  cursor: pointer;
  z-index: 5;
}
.nge-chat-new-banner:hover { background: rgba(74, 158, 255, 1); }

.nge-chat-banner-enter-active { transition: opacity 0.15s; }
.nge-chat-banner-leave-active { transition: opacity 0.12s; }
.nge-chat-banner-enter-from,
.nge-chat-banner-leave-to { opacity: 0; }

/* ── Input ── */
.nge-chat-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.nge-chat-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(100, 180, 255, 0.12);
  border-radius: 6px;
  padding: 5px 8px;
  color: #e0e4ec;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.12s;
}
.nge-chat-input:focus { border-color: rgba(74, 158, 255, 0.35); }
.nge-chat-input::placeholder { color: #445; }
.nge-chat-input:disabled { opacity: 0.3; }

.nge-chat-send {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.12);
  border: 1px solid rgba(74, 158, 255, 0.15);
  color: #4a9eff;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.12s;
}
.nge-chat-send:hover:not(:disabled) { background: rgba(74, 158, 255, 0.25); color: #fff; }
.nge-chat-send:disabled { opacity: 0.2; cursor: default; }

/* Empty state */
.nge-chat-empty {
  text-align: center;
  padding: 30px 12px;
  color: #445;
  font-size: 12px;
}
</style>
