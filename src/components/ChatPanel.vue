<script setup lang="ts">
/**
 * ChatPanel.vue
 * Ultra-minimal draggable community chat — stays open while mapping.
 * Messages fade to transparent at top. No chrome except a tiny drag handle.
 * Three states: open, collapsed (just input bar), closed (hidden).
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

// ── Drag state ──
const panelEl = ref<HTMLDivElement | null>(null);
const posX = ref<number | null>(null); // null = use CSS default (bottom-left)
const posY = ref<number | null>(null);
const isDragging = ref(false);
let dragStart = { mx: 0, my: 0, px: 0, py: 0 };

function startDrag(e: MouseEvent) {
  if (isResizing.value) return;
  isDragging.value = true;
  const el = panelEl.value;
  if (!el) return;
  // If first drag, initialize position from current computed position
  if (posX.value === null || posY.value === null) {
    const rect = el.getBoundingClientRect();
    posX.value = rect.left;
    posY.value = rect.top;
  }
  dragStart = { mx: e.clientX, my: e.clientY, px: posX.value!, py: posY.value! };
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  e.preventDefault();
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStart.mx;
  const dy = e.clientY - dragStart.my;
  posX.value = Math.max(0, Math.min(window.innerWidth - 100, dragStart.px + dx));
  posY.value = Math.max(0, Math.min(window.innerHeight - 40, dragStart.py + dy));
}

function stopDrag() {
  isDragging.value = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}

// ── Resize state ──
const panelWidth = ref(280);
const panelHeight = ref(200);
const isResizing = ref(false);
let resizeStart = { mx: 0, my: 0, w: 0, h: 0 };

function startResize(e: MouseEvent) {
  isResizing.value = true;
  resizeStart = { mx: e.clientX, my: e.clientY, w: panelWidth.value, h: panelHeight.value };
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  e.preventDefault();
  e.stopPropagation();
}

function onResize(e: MouseEvent) {
  if (!isResizing.value) return;
  panelWidth.value = Math.max(180, Math.min(500, resizeStart.w - (e.clientX - resizeStart.mx)));
  panelHeight.value = Math.max(100, Math.min(500, resizeStart.h - (e.clientY - resizeStart.my)));
}

function stopResize() {
  isResizing.value = false;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}

// ── Position style ──
const positionStyle = computed(() => {
  if (posX.value !== null && posY.value !== null) {
    return {
      left: posX.value + 'px',
      top: posY.value + 'px',
      right: 'auto',
      bottom: 'auto',
    };
  }
  return {}; // use CSS defaults (bottom-right)
});

// Connect on mount, mark read
onMounted(() => {
  chatStore.connect();
  chatStore.markRead();
  nextTick(() => inputEl.value?.focus());
});

onUnmounted(() => {
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
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

// ── Format name: "First L." ──
function shortName(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ── Rank-based name colors ──
function rankColor(rank: string): string {
  switch (rank) {
    case 'admin': return '#E6C760';
    case 'eyewirer': return '#0292AE';
    case 'researcher': return '#0FB18B';
    default: return '#8899aa';
  }
}

function msgTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Send message ──
function send() {
  const text = messageInput.value.trim();
  if (!text) return;
  chatStore.sendMessage(text);
  messageInput.value = '';
  inputEl.value?.focus();
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
      ref="panelEl"
      class="nge-chat-float"
      :class="{ 'nge-chat-float--collapsed': collapsed, 'nge-chat-float--dragging': isDragging }"
      :style="{
        ...(collapsed ? {} : { width: panelWidth + 'px', height: panelHeight + 'px' }),
        ...positionStyle
      }"
    >
      <!-- Resize handle (top-left corner) -->
      <div v-if="!collapsed" class="nge-chat-resize" @mousedown="startResize"></div>

      <!-- Tiny drag/control strip -->
      <div class="nge-chat-strip" @mousedown="startDrag" @dblclick="toggleCollapse">
        <span class="nge-chat-strip-dot" :class="{ 'nge-chat-strip-dot--on': connected }"></span>
        <span v-if="collapsed && unreadMessages" class="nge-chat-strip-badge">{{ unreadMessages }}</span>
        <span class="nge-chat-strip-spacer"></span>
        <button class="nge-chat-strip-btn" @click.stop="toggleCollapse" :title="collapsed ? 'Expand' : 'Collapse'">
          {{ collapsed ? '▲' : '▼' }}
        </button>
        <button class="nge-chat-strip-btn" @click.stop="emit('hide')" title="Close">×</button>
      </div>

      <!-- Body (hidden when collapsed) -->
      <template v-if="!collapsed">
        <!-- Message area with top fade -->
        <div class="nge-chat-messages-wrap">
          <div class="nge-chat-fade"></div>
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
                  <span class="nge-chat-msg-time">{{ msgTime(msg.dateTime) }}</span>
                  <span class="nge-chat-msg-trophy" v-if="trophyMap[msg.name]">{{ trophyMap[msg.name] }}</span>
                  <span class="nge-chat-msg-name" :style="{ color: rankColor(msg.rank) }">{{ shortName(msg.name) }}</span>
                  <template v-for="(part, pi) in msg.parts" :key="pi">
                    <template v-if="part.type === 'sender'"></template>
                    <a v-else-if="part.type === 'link'" :href="part.text" target="_blank" rel="noopener" class="nge-chat-link">{{ part.text }}</a>
                    <span v-else class="nge-chat-msg-text">{{ part.text }}</span>
                  </template>
                </div>
              </template>

              <div v-if="chatMessages.length === 0" class="nge-chat-empty">
                Say hello!
              </div>
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
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Floating container ── */
.nge-chat-float {
  position: fixed;
  bottom: 36px;
  left: 8px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 6px;
  overflow: hidden;
  font-family: 'Inter', 'Roboto', sans-serif;
}

.nge-chat-float--collapsed {
  width: auto !important;
  height: auto !important;
  background: rgba(10, 14, 24, 0.6);
}

.nge-chat-float--dragging {
  user-select: none;
}

/* ── Resize handle — top-left corner ── */
.nge-chat-resize {
  position: absolute;
  top: 0;
  left: 0;
  width: 12px;
  height: 12px;
  cursor: nw-resize;
  z-index: 10;
}
.nge-chat-resize::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 5px;
  height: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-left: 1px solid rgba(255, 255, 255, 0.15);
}

/* ── Tiny control strip (drag handle + buttons) ── */
.nge-chat-strip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
}
.nge-chat-strip:active { cursor: grabbing; }

.nge-chat-strip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #444;
  flex-shrink: 0;
}
.nge-chat-strip-dot--on {
  background: #0fb18b;
  box-shadow: 0 0 4px rgba(15, 177, 139, 0.5);
}

.nge-chat-strip-badge {
  background: #4a9eff;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 6px;
  min-width: 14px;
  text-align: center;
  line-height: 14px;
}

.nge-chat-strip-spacer { flex: 1; }

.nge-chat-strip-btn {
  background: none;
  border: none;
  color: #556;
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.12s;
}
.nge-chat-strip-btn:hover { color: #aaa; }

/* ── Messages wrapper with fade ── */
.nge-chat-messages-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

/* Background gradient: opaque at bottom (contrast for text) → transparent at top */
.nge-chat-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100%;
  background: linear-gradient(to top, rgba(8,10,20,0.88) 0%, rgba(8,10,20,0.65) 30%, rgba(8,10,20,0.3) 60%, transparent 100%);
  pointer-events: none;
  z-index: 1;
}

.nge-chat-messages {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
  padding: 2px 8px;
  position: relative;
  z-index: 2;
}

.nge-chat-messages::-webkit-scrollbar { width: 2px; }
.nge-chat-messages::-webkit-scrollbar-track { background: transparent; }
.nge-chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 2px; }

.nge-chat-messages-inner {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Message line — inline name + text ── */
.nge-chat-msg {
  padding: 2px 4px;
  line-height: 1.4;
  font-size: 13px;
}
.nge-chat-msg:hover { background: rgba(255, 255, 255, 0.03); border-radius: 3px; }

.nge-chat-msg-time {
  font-size: 9px;
  color: #445;
  margin-right: 4px;
  flex-shrink: 0;
}
.nge-chat-msg:hover .nge-chat-msg-time { color: #667; }

.nge-chat-msg-trophy { font-size: 10px; margin-right: 1px; }

.nge-chat-msg-name {
  font-weight: 600;
  font-size: 13px;
  margin-right: 4px;
}

.nge-chat-msg-text {
  color: #b0b8c8;
}

.nge-chat-link {
  color: #4a9eff;
  text-decoration: none;
  word-break: break-all;
  font-size: 13px;
}
.nge-chat-link:hover { text-decoration: underline; }

/* System messages */
.nge-chat-sys {
  font-size: 11px;
  color: #556;
  font-style: italic;
  padding: 0 4px;
}
.nge-chat-sys--warn { color: #c08030; }

/* Time separator */
.nge-chat-time-sep {
  text-align: center;
  padding: 2px 0;
}
.nge-chat-time-sep span {
  font-size: 10px;
  color: #556;
  padding: 0 6px;
}

/* New messages banner */
.nge-chat-new-banner {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(74, 158, 255, 0.8);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 8px;
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
  padding: 4px 4px;
  flex-shrink: 0;
  background: rgba(8, 10, 20, 0.92);
  border-top: 1px solid rgba(100, 180, 255, 0.08);
}

.nge-chat-input {
  width: 100%;
  background: rgba(20, 24, 40, 0.9);
  border: 1px solid rgba(100, 180, 255, 0.15);
  border-radius: 4px;
  padding: 5px 8px;
  color: #e0e4ec;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.12s;
  box-sizing: border-box;
}
.nge-chat-input:focus { border-color: rgba(74, 158, 255, 0.3); }
.nge-chat-input::placeholder { color: #556; }
.nge-chat-input:disabled { opacity: 0.3; }

/* Empty state */
.nge-chat-empty {
  text-align: center;
  padding: 16px 8px;
  color: #556;
  font-size: 12px;
}
</style>
