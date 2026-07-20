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
import { canonicalDataset, datasetDisplayName } from '../datasets';

const emit = defineEmits({ hide: null });
const chatStore = useChatStore();
const { chatMessages, connected, unreadMessages } = storeToRefs(chatStore);
const backendStore = useProofreadingBackendStore();

const messageInput = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const scrollContainer = ref<HTMLDivElement | null>(null);
const isScrolledUp = ref(false);
const collapsed = ref(false);
/** Segment id most recently copied, for the brief "copied" tick. */
const copiedSegId = ref<string | null>(null);
/** Pending cross-dataset jump awaiting confirmation. */
const pendingSegJump = ref<{ segRef: string; from: string | null; to: string } | null>(null);

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
let resizeStart = { mx: 0, my: 0, w: 0, h: 0, py: 0 };
let resizeAxis: 'corner' | 'top' | 'right' = 'corner';

function startResize(e: MouseEvent, axis: 'corner' | 'top' | 'right' = 'corner') {
  isResizing.value = true;
  resizeAxis = axis;
  resizeStart = { mx: e.clientX, my: e.clientY, w: panelWidth.value, h: panelHeight.value, py: posY.value ?? 0 };
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  e.preventDefault();
  e.stopPropagation();
}

function onResize(e: MouseEvent) {
  if (!isResizing.value) return;
  if (resizeAxis === 'corner' || resizeAxis === 'right') {
    // Right edge or corner: dragging right = wider (panel anchored at left when positioned)
    const newW = posX.value !== null
      ? resizeStart.w + (e.clientX - resizeStart.mx)   // free-positioned: grow right
      : resizeStart.w - (e.clientX - resizeStart.mx);  // CSS default (left:8px): grow left
    panelWidth.value = Math.max(200, Math.min(600, newW));
  }
  if (resizeAxis === 'corner' || resizeAxis === 'top') {
    const dy = e.clientY - resizeStart.my;
    if (posY.value !== null) {
      // Free-positioned (top-anchored): drag top edge up → move posY up + grow taller
      const newH = Math.max(120, Math.min(600, resizeStart.h - dy));
      panelHeight.value = newH;
      posY.value = Math.max(0, resizeStart.py + (resizeStart.h - newH));
    } else {
      // CSS default (bottom-anchored): drag top edge up → just grow taller
      panelHeight.value = Math.max(120, Math.min(600, resizeStart.h - dy));
    }
  }
}

function stopResize() {
  isResizing.value = false;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}

// ── Position style ──
const positionStyle = computed(() => {
  // Collapsed: always settle at the bottom of the screen. Keep whatever
  // horizontal position the user dragged to, but drop the dragged `top` so the
  // CSS default (bottom: 36px) applies again. Without this the collapsed strip
  // stays pinned at the expanded panel's top edge and appears to collapse
  // upward, leaving it stranded mid-screen.
  if (collapsed.value) {
    return posX.value !== null
      ? { left: posX.value + 'px', right: 'auto', top: 'auto' }
      : {};
  }
  if (posX.value !== null && posY.value !== null) {
    return {
      left: posX.value + 'px',
      top: posY.value + 'px',
      right: 'auto',
      bottom: 'auto',
    };
  }
  return {}; // use CSS defaults (bottom-left)
});

// Connect on mount only if logged in — otherwise show login-gate empty state.
// Auto-connect when login resolves (user logs in mid-session).
const isLoggedIn = computed(() => !!backendStore.userId && !!backendStore.userName);

onMounted(() => {
  if (isLoggedIn.value) {
    chatStore.connect();
    chatStore.markRead();
  }
  nextTick(() => inputEl.value?.focus());
});

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn && !connected.value) {
    chatStore.connect();
    chatStore.markRead();
  }
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

/**
 * Is this @mention aimed at the current user?
 *
 * Matched loosely because display names vary ("Amy S.", "Amy Sterling") and the
 * mention token only captures up to two words. Compares against both the full
 * display name and its first word, case-insensitively, ignoring trailing dots.
 */
function isSelfMention(token: string): boolean {
  const me = (backendStore.userName || '').trim();
  if (!me) return false;
  const norm = (s: string) => s.replace(/[.\s]+$/, '').trim().toLowerCase();
  const target = norm(token.slice(1));
  if (!target) return false;
  return target === norm(me) || target === norm(me.split(' ')[0]);
}

/** Active segmentation layer name, for comparing against a message's dataset. */
function activeDatasetName(): string | null {
  try {
    const viewer: any = (window as any)['viewer'];
    for (const l of viewer?.layerManager?.managedLayers || []) {
      const cn = l?.layer?.constructor?.name || '';
      if (cn.includes('Segmentation') || l?.layer?.type === 'segmentation') return l.name || null;
    }
  } catch { /* viewer not ready */ }
  return null;
}

/** Short label for the dataset chip — matches the Dataset selector's naming
 *  rather than leaking the raw layer name (e.g. "Pinky", not "pinky_nf_v2"). */
function datasetLabel(ds: string | null | undefined): string {
  if (!ds) return 'unknown dataset';
  return datasetDisplayName(ds) || ds;
}

/**
 * Guarded click on a shared #SegID.
 *
 * Root IDs only exist within one segmentation, so jumping to a stroeh id while
 * the reader has pinky open lands on a different cell — or nothing — and looks
 * authoritative either way. Only jump when we know the datasets agree; if they
 * don't (or the message predates dataset stamping) ask first.
 */
function onSegClick(segRef: string, msgDataset: string | null | undefined) {
  const active = activeDatasetName();
  const sameDataset = msgDataset && active &&
    (msgDataset === active || canonicalDataset(msgDataset) === canonicalDataset(active));
  if (sameDataset || (!msgDataset && !active)) {
    loadSegment(segRef);
    return;
  }
  pendingSegJump.value = {
    segRef,
    from: msgDataset ? datasetLabel(msgDataset) : null,
    to: active ? datasetLabel(active) : 'your current view',
  };
}

/** User confirmed jumping to a segment shared from another dataset. */
function confirmSegJump() {
  const p = pendingSegJump.value;
  pendingSegJump.value = null;
  if (p) loadSegment(p.segRef);
}

// ── Load segment from #SegID click ──
function loadSegment(segRef: string) {
  const segId = segRef.replace('#', '');
  try {
    const viewer = (window as any)['viewer'];
    if (!viewer) return;
    // Find segmentation layer and add segment
    const segLayer = viewer.layerManager?.managedLayers?.find((x: any) => {
      const layer = x.layer;
      if (!layer) return false;
      const cn = layer.constructor?.name || '';
      return cn.includes('Segmentation') || layer.type === 'segmentation' || x.initialSpecification?.type === 'segmentation';
    });
    if (segLayer?.layer) {
      const groupState = segLayer.layer.displayState?.segmentationGroupState?.value;
      const { Uint64 } = require('neuroglancer/util/uint64');
      const seg = Uint64.parseString(segId);
      if (groupState?.visibleSegments) {
        if (!groupState.visibleSegments.has(seg)) {
          groupState.visibleSegments.add(seg);
        }
      }
      // Adding the segment only makes it visible — it does NOT move the camera,
      // so sharing an ID in chat used to load the cell somewhere off-screen and
      // look like nothing happened. Actually jump to it. `moveToSegment` is the
      // same path the segment-list jump button uses, and move_to_segment_patch
      // extends it to work on graphene MeshLayer datasets too. The mesh may not
      // be loaded yet, so retry briefly before giving up.
      const jump = (attempt = 0) => {
        try {
          segLayer.layer.moveToSegment(seg);
        } catch {
          if (attempt < 10) setTimeout(() => jump(attempt + 1), 300);
        }
      };
      jump();
    }
  } catch (e) {
    console.warn('[chat] loadSegment error:', e);
  }
}

/** Copy a shared segment ID to the clipboard (the chip is also selectable). */
async function copySegId(segRef: string, ev: Event) {
  ev.stopPropagation();
  const segId = segRef.replace('#', '');
  try {
    await navigator.clipboard.writeText(segId);
    copiedSegId.value = segId;
    setTimeout(() => { if (copiedSegId.value === segId) copiedSegId.value = null; }, 1200);
  } catch { /* clipboard blocked — the chip text is still selectable */ }
}

// ── Open user profile from chat name click ──
async function openUserProfile(displayName: string) {
  try {
    const results = await backendStore.searchUsers(displayName);
    const match = results.find((u: any) => u.display_name === displayName) || results[0];
    if (match) {
      document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { userId: match.id } }));
    }
  } catch (e) {
    console.warn('[chat] openUserProfile error:', e);
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
      ref="panelEl"
      class="nge-chat-float"
      :class="{ 'nge-chat-float--collapsed': collapsed, 'nge-chat-float--dragging': isDragging }"
      :style="{
        ...(collapsed ? {} : { width: panelWidth + 'px', height: panelHeight + 'px' }),
        ...positionStyle
      }"
    >
      <!-- Resize handles — edges and corner -->
      <div v-if="!collapsed" class="nge-chat-resize nge-chat-resize--corner" @mousedown="startResize($event, 'corner')"></div>
      <div v-if="!collapsed" class="nge-chat-resize nge-chat-resize--top" @mousedown="startResize($event, 'top')"></div>
      <div v-if="!collapsed" class="nge-chat-resize nge-chat-resize--right" @mousedown="startResize($event, 'right')"></div>

      <!-- Tiny drag/control strip -->
      <div class="nge-chat-strip" @mousedown="startDrag" @dblclick="toggleCollapse">
        <span class="nge-chat-strip-dot" :class="{ 'nge-chat-strip-dot--on': connected }"></span>
        <span v-if="collapsed" class="nge-chat-strip-label">Chat</span>
        <span v-if="collapsed && unreadMessages" class="nge-chat-strip-unread" title="New messages"></span>
        <span class="nge-chat-strip-spacer"></span>
        <button class="nge-chat-strip-btn nge-chat-collapse-btn" @click.stop="toggleCollapse" :title="collapsed ? 'Expand chat' : 'Collapse chat'">
          {{ collapsed ? '▲' : '▼' }}
        </button>
        <button class="nge-chat-strip-btn nge-chat-close-btn" @click.stop="emit('hide')" title="Close chat">×</button>
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
                  <button class="nge-chat-msg-name nge-chat-msg-name--clickable" :style="{ color: rankColor(msg.rank) }" @click="openUserProfile(msg.name)" :title="'View ' + msg.name + '\'s profile'">{{ shortName(msg.name) }}</button>
                  <template v-for="(part, pi) in msg.parts" :key="pi">
                    <template v-if="part.type === 'sender'"></template>
                    <a v-else-if="part.type === 'link'" :href="part.text" target="_blank" rel="noopener" class="nge-chat-link">{{ part.text }}</a>
                    <span
                      v-else-if="part.type === 'mention'"
                      class="nge-chat-mention"
                      :class="{ 'nge-chat-mention--me': isSelfMention(part.text) }"
                      role="button"
                      tabindex="0"
                      @click="openUserProfile(part.text.slice(1))"
                      @keydown.enter="openUserProfile(part.text.slice(1))"
                      :title="'Open ' + part.text.slice(1) + '’s profile'"
                    >{{ part.text }}</span>
                    <span v-else-if="part.type === 'segment'" class="nge-chat-seg-chip"><span
                        class="nge-chat-seg-link"
                        role="button"
                        tabindex="0"
                        @click="onSegClick(part.text, msg.dataset)"
                        @keydown.enter="onSegClick(part.text, msg.dataset)"
                        :title="'Jump to segment ' + part.text.slice(1) + (msg.dataset ? ' in ' + msg.dataset : '')"
                      >{{ part.text }}</span><span
                        class="nge-chat-seg-ds"
                        :title="msg.dataset || 'Sent before the dataset was recorded'"
                      >{{ datasetLabel(msg.dataset) }}</span><button
                        class="nge-chat-seg-copy"
                        @click="copySegId(part.text, $event)"
                        :title="'Copy ' + part.text.slice(1)"
                      >{{ copiedSegId === part.text.slice(1) ? '✓' : '⧉' }}</button></span>
                    <span v-else class="nge-chat-msg-text">{{ part.text }}</span>
                  </template>
                </div>
              </template>

              <div v-if="!isLoggedIn" class="nge-chat-empty">
                Log in to chat
              </div>
              <div v-else-if="chatMessages.length === 0" class="nge-chat-empty">
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

        <!-- Cross-dataset jump guard: a root ID from another segmentation would
             land on a different cell (or nothing) without warning. -->
        <div v-if="pendingSegJump" class="nge-chat-segwarn">
          <div class="nge-chat-segwarn-text">
            This ID is from <strong>{{ pendingSegJump.from || 'an unknown dataset' }}</strong>,
            but you're viewing <strong>{{ pendingSegJump.to }}</strong>. It may not exist here.
          </div>
          <div class="nge-chat-segwarn-actions">
            <button class="nge-chat-segwarn-go" @click="confirmSegJump">Jump anyway</button>
            <button class="nge-chat-segwarn-no" @click="pendingSegJump = null">Cancel</button>
          </div>
        </div>

        <!-- Input -->
        <div class="nge-chat-input-wrap">
          <input
            ref="inputEl"
            v-model="messageInput"
            class="nge-chat-input"
            :placeholder="isLoggedIn ? 'Message...' : 'Log in to chat'"
            @keydown.stop
            @keyup.stop
            @keypress.stop
            @keydown.enter.exact.prevent="send"
            spellcheck="true"
            autocomplete="off"
            :disabled="!isLoggedIn || !connected"
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
  background: rgba(6, 10, 20, 0.85);
  border-radius: 6px;
  border: 1px solid rgba(74, 158, 255, 0.08);
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

/* ── Resize handles ── */
.nge-chat-resize { position: absolute; z-index: 10; }

.nge-chat-resize--corner {
  top: 0; left: 0;
  width: 14px; height: 14px;
  cursor: nw-resize;
}
.nge-chat-resize--corner::after {
  content: '';
  position: absolute;
  top: 3px; left: 3px;
  width: 6px; height: 6px;
  border-top: 2px solid rgba(74, 158, 255, 0.25);
  border-left: 2px solid rgba(74, 158, 255, 0.25);
  border-radius: 1px;
  transition: border-color 0.15s;
}
.nge-chat-resize--corner:hover::after {
  border-color: rgba(74, 158, 255, 0.6);
}

.nge-chat-resize--top {
  top: 0; left: 14px; right: 0;
  height: 4px;
  cursor: n-resize;
}
.nge-chat-resize--top:hover { background: rgba(74, 158, 255, 0.15); }

.nge-chat-resize--right {
  top: 0; right: 0;
  width: 4px; bottom: 0;
  cursor: e-resize;
}
.nge-chat-resize--right:hover { background: rgba(74, 158, 255, 0.15); }

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

.nge-chat-strip-label {
  font-size: 10px;
  color: #667;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.nge-chat-strip-unread {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4a9eff;
  box-shadow: 0 0 6px rgba(74, 158, 255, 0.6);
  flex-shrink: 0;
  animation: nge-chat-unread-pulse 2s ease-in-out infinite;
}
@keyframes nge-chat-unread-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.nge-chat-strip-spacer { flex: 1; }

.nge-chat-strip-btn {
  background: none;
  border: none;
  color: #556;
  cursor: pointer;
  line-height: 1;
  transition: color 0.12s, background 0.12s;
  border-radius: 3px;
}
.nge-chat-strip-btn:hover { color: #ccc; background: rgba(255, 255, 255, 0.06); }

.nge-chat-collapse-btn {
  font-size: 11px;
  padding: 2px 5px;
}

.nge-chat-close-btn {
  font-size: 16px;
  padding: 0 5px;
  font-weight: 300;
}
.nge-chat-close-btn:hover { color: #ff6b6b; background: rgba(255, 80, 80, 0.08); }

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
  padding: 3px 4px;
  line-height: 1.45;
  font-size: 14.5px;
}
.nge-chat-msg:hover { background: rgba(255, 255, 255, 0.03); border-radius: 3px; }

.nge-chat-msg-time {
  font-size: 11px;
  color: #556;
  margin-right: 5px;
  flex-shrink: 0;
}
.nge-chat-msg:hover .nge-chat-msg-time { color: #889; }

.nge-chat-msg-trophy { font-size: 12px; margin-right: 1px; }

.nge-chat-msg-name {
  font-weight: 600;
  font-size: 14.5px;
  margin-right: 4px;
}
.nge-chat-msg-name--clickable {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: 14.5px;
  transition: opacity 0.15s;
}
.nge-chat-msg-name--clickable:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.nge-chat-msg-text {
  color: #b0b8c8;
}

.nge-chat-link {
  color: #4a9eff;
  text-decoration: none;
  word-break: break-all;
  font-size: 14.5px;
}
.nge-chat-link:hover { text-decoration: underline; }

/* Shared segment id: click the id to jump, click ⧉ to copy — and the id text
   itself is selectable so it can be dragged out / copied manually. It used to
   be a <button>, which browsers don't let you select text inside, so a shared
   ID could neither be copied nor (see loadSegment) actually jumped to. */
.nge-chat-seg-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(0, 220, 120, 0.1);
  border: 1px solid rgba(0, 220, 120, 0.25);
  border-radius: 4px;
  transition: background 0.15s, border-color 0.15s;
}
.nge-chat-seg-chip:hover {
  background: rgba(0, 220, 120, 0.2);
  border-color: rgba(0, 220, 120, 0.4);
}
.nge-chat-seg-link {
  color: #80ffc0;
  padding: 1px 2px 1px 6px;
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  cursor: pointer;
  /* The chat body sets user-select: none; re-enable it here so the id can be
     highlighted and copied by hand. */
  user-select: text;
  -webkit-user-select: text;
}
.nge-chat-seg-link:focus-visible {
  outline: 1px solid rgba(0, 220, 120, 0.7);
  outline-offset: 1px;
}
.nge-chat-seg-copy {
  background: none;
  border: none;
  color: rgba(128, 255, 192, 0.6);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 2px 5px 2px 2px;
}
.nge-chat-seg-copy:hover { color: #80ffc0; background: none; }
/* @mention: click to open that person's profile. Highlighted more strongly
   when it's you being mentioned, so it's noticeable in a busy channel. */
.nge-chat-mention {
  color: #9db8ff;
  background: rgba(74, 158, 255, 0.12);
  border-radius: 3px;
  padding: 0 3px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.nge-chat-mention:hover { background: rgba(74, 158, 255, 0.25); color: #cfe0ff; }
.nge-chat-mention--me {
  color: #ffe6a8;
  background: rgba(245, 166, 35, 0.2);
  font-weight: 600;
}
.nge-chat-mention--me:hover { background: rgba(245, 166, 35, 0.32); color: #fff2cf; }
.nge-chat-mention:focus-visible { outline: 1px solid rgba(74, 158, 255, 0.7); outline-offset: 1px; }

/* Which segmentation the id belongs to — a bare root ID is ambiguous without it. */
.nge-chat-seg-ds {
  color: rgba(128, 255, 192, 0.55);
  font-size: 10px;
  padding: 0 2px;
  white-space: nowrap;
  user-select: none;
}

.nge-chat-segwarn {
  margin: 4px 6px;
  padding: 7px 9px;
  background: rgba(245, 166, 35, 0.1);
  border: 1px solid rgba(245, 166, 35, 0.3);
  border-radius: 6px;
  font-size: 11.5px;
  color: #f0d0a0;
}
.nge-chat-segwarn-text { line-height: 1.35; }
.nge-chat-segwarn-text strong { color: #ffd9a3; font-weight: 600; }
.nge-chat-segwarn-actions { display: flex; gap: 6px; margin-top: 6px; }
.nge-chat-segwarn-go,
.nge-chat-segwarn-no {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.nge-chat-segwarn-go { color: #ffc98a; border-color: rgba(245, 166, 35, 0.5); }
.nge-chat-segwarn-go:hover { background: rgba(245, 166, 35, 0.18); }
.nge-chat-segwarn-no { color: #99a; }
.nge-chat-segwarn-no:hover { background: rgba(255, 255, 255, 0.06); }

/* System messages */
.nge-chat-sys {
  font-size: 12.5px;
  color: #6a7282;
  font-style: italic;
  padding: 1px 4px;
}
.nge-chat-sys--warn { color: #c08030; }

/* Time separator */
.nge-chat-time-sep {
  text-align: center;
  padding: 3px 0;
}
.nge-chat-time-sep span {
  font-size: 11.5px;
  color: #6a7282;
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
  padding: 6px 8px;
  color: #e0e4ec;
  font-size: 14.5px;
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
  padding: 20px 8px;
  color: #889;
  font-size: 13.5px;
  font-style: italic;
}
</style>
