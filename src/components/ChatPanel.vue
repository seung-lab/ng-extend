<script setup lang="ts">
/**
 * ChatPanel.vue
 * Ultra-minimal draggable community chat — stays open while mapping.
 * Messages fade to transparent at top. No chrome except a tiny drag handle.
 * Three states: open, collapsed (just input bar), closed (hidden).
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useChatStore, useProofreadingBackendStore, useUserPreferencesStore, ChatMessage, isSelfMentionToken, CHAT_REACTION_EMOJI, CHAT_MAX_CHARS, chatTextLength } from '../store';
import ScreenshotDialog from 'components/ScreenshotDialog.vue';
import { mintShortStateLink } from '../util/state_link';
import { supabase } from '../supabase';
import nurroAvatar from '../../static/nurro/nurro-original.png';

const DAILY_MEDALS = ['🥇', '🥈', '🥉'];

/** Nurro's joke profile (NurroProfile.vue, opened by ExtensionBar). */
function openNurroProfile() {
  document.dispatchEvent(new CustomEvent('nge:open-nurro-profile'));
}
import { canonicalDataset, datasetDisplayName, switchToDataset, segLayerName, DATASETS } from '../datasets';

const emit = defineEmits({ hide: null });
const chatStore = useChatStore();
const { chatMessages, connected, unreadMessages } = storeToRefs(chatStore);
const backendStore = useProofreadingBackendStore();

const messageInput = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);
const scrollContainer = ref<HTMLDivElement | null>(null);
const isScrolledUp = ref(false);
const collapsed = ref(false);
/** Segment id most recently copied, for the brief "copied" tick. */
const copiedSegId = ref<string | null>(null);
/** Pending cross-dataset jump awaiting confirmation. `dataset` is the raw
 *  dataset the segment belongs to, so we can switch to it before loading. */
const pendingSegJump = ref<{ segRef: string; dataset: string | null | undefined; from: string | null; to: string } | null>(null);

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
// Your size sticks (Ames 2026-09-30): read from your settings (this browser,
// then your account once it loads), saved whenever a resize ends.
function applySavedChatSize() {
  const sz = useUserPreferencesStore().prefs.chatSize;
  if (!sz || isResizing.value) return;
  panelWidth.value = Math.max(200, Math.min(600, Math.round(sz.w), window.innerWidth - 16));
  panelHeight.value = Math.max(120, Math.min(600, Math.round(sz.h), window.innerHeight - 80));
}
const isResizing = ref(false);
applySavedChatSize();
// The account copy can arrive after chat opens (a new computer): apply it then.
watch(() => useUserPreferencesStore().prefs.chatSize, applySavedChatSize, { deep: true });
let resizeStart = { mx: 0, my: 0, w: 0, h: 0, px: 0, py: 0 };
let resizeAxis: 'corner' | 'top' | 'right' = 'corner';

function startResize(e: MouseEvent, axis: 'corner' | 'top' | 'right' = 'corner') {
  isResizing.value = true;
  resizeAxis = axis;
  // The top-left corner moves the left edge, so the panel has to be free
  // positioned for that edge to follow the mouse.
  if (axis === 'corner' && (posX.value === null || posY.value === null) && panelEl.value) {
    const rect = panelEl.value.getBoundingClientRect();
    posX.value = rect.left;
    posY.value = rect.top;
  }
  resizeStart = { mx: e.clientX, my: e.clientY, w: panelWidth.value, h: panelHeight.value, px: posX.value ?? 0, py: posY.value ?? 0 };
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  e.preventDefault();
  e.stopPropagation();
}

function onResize(e: MouseEvent) {
  if (!isResizing.value) return;
  // The panel's left edge is anchored in both modes (CSS default left: 8px,
  // or a dragged left), so (Ames 2026-09-28: width moved the wrong way):
  //   right edge: drag right = wider;
  //   top-left corner: drag left = wider, and the left edge follows the mouse.
  const dx = e.clientX - resizeStart.mx;
  if (resizeAxis === 'right') {
    panelWidth.value = Math.max(200, Math.min(600, resizeStart.w + dx));
  } else if (resizeAxis === 'corner') {
    // Can't grow past the screen's left edge: the right edge stays put.
    const newW = Math.max(200, Math.min(600, resizeStart.w + resizeStart.px, resizeStart.w - dx));
    panelWidth.value = newW;
    posX.value = Math.max(0, resizeStart.px + (resizeStart.w - newW));
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
  useUserPreferencesStore().save({ chatSize: { w: panelWidth.value, h: panelHeight.value } });
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}

// ── Quiet mode (Ames 2026-09-28, like the original EyeWire chat) ──
// Click away and chat shrinks to its latest messages, background fading out;
// click back in and it takes its full size again. The bottom edge stays put.
const QUIET_H = 150;
const chatFocused = ref(true);
function onDocPointerDown(e: PointerEvent) {
  const t = e.target as HTMLElement | null;
  const inside = !!t && (!!panelEl.value?.contains(t) || !!t.closest?.('.nge-shotdlg-overlay'));
  chatFocused.value = inside;
}
function onPanelFocusIn() { chatFocused.value = true; }
document.addEventListener('pointerdown', onDocPointerDown, true);
// Settings > "Fade chat when I click away" can switch quiet mode off.
const isQuiet = computed(() => useUserPreferencesStore().prefs.chatFadeAway !== false
  && !chatFocused.value && !collapsed.value && !isResizing.value && !isDragging.value
  && panelHeight.value > QUIET_H && !document.body.classList.contains('nge-mobile'));
const shownHeight = computed(() => isQuiet.value ? QUIET_H : panelHeight.value);
/** The last few messages stay faintly readable when chat fades (Amy
 *  2026-09-28: vanishing TOTALLY was a bit much). */
const RECENT_KEEP = 4;
const recentMsgs = computed(() => new Set(chatMessages.value.filter(m => m.type === 'message').slice(-RECENT_KEEP)));

// In quiet mode chat is invisible, like the original EyeWire: a message that
// arrives pops up and fades out after FRESH_MS (Ames 2026-09-28).
const FRESH_MS = 12_000;
const freshUntil = new WeakMap<object, number>();
const freshTick = ref(0);
watch(() => chatMessages.value.length, () => {
  const now = Date.now();
  let added = false;
  for (let i = chatMessages.value.length - 1; i >= 0; i--) {
    const m = chatMessages.value[i];
    if (freshUntil.has(m)) break;                       // reached what we've seen
    // Only live arrivals: history (older than a minute) never pops up.
    freshUntil.set(m, now - m.dateTime.getTime() < 60_000 ? now + FRESH_MS : 0);
    added = true;
  }
  if (added) setTimeout(() => { freshTick.value++; }, FRESH_MS + 50);
  freshTick.value++;
});
function isFresh(m: ChatMessage): boolean {
  void freshTick.value;
  return (freshUntil.get(m) ?? 0) > Date.now();
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
      // Quiet mode keeps the bottom edge where it was.
      top: (posY.value + panelHeight.value - shownHeight.value) + 'px',
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

// The toolbar counter only counts messages you can't see: open and expanded
// means you're reading along, so no counter.
watch(collapsed, (c) => chatStore.setPanelVisible(!c), { immediate: true });

// Someone @mentioned you: flash the panel so it catches your eye mid-trace.
const mentionFlash = ref(false);
let mentionTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => chatStore.mentionPing, () => {
  mentionFlash.value = false;
  nextTick(() => {
    mentionFlash.value = true;
    if (mentionTimer) clearTimeout(mentionTimer);
    mentionTimer = setTimeout(() => { mentionFlash.value = false; }, 3200);
  });
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  document.removeEventListener('mousedown', closePopovers);
  if (handleSearchTimer) clearTimeout(handleSearchTimer);
  chatStore.setPanelVisible(false);
  if (mentionTimer) clearTimeout(mentionTimer);
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

// Follow new messages unless you have scrolled up to read (Amy 2026-09-30).
// The list is bottom-anchored, but a panel resize (fading in and out, drag
// resize) or an arrival mid-layout could leave it short of the newest line.
function followNewest() {
  if (isScrolledUp.value) return;
  const snap = () => {
    const el = scrollContainer.value;
    if (el && !isScrolledUp.value) el.scrollTop = 0;
  };
  void nextTick(snap);
  setTimeout(snap, 320);  // again after the 0.25 s height transition
}
watch(() => chatMessages.value.length, followNewest);
watch(() => shownHeight.value, followNewest);

// ── Leaderboard medals in chat ──
// Whoever is on today's podium wears the medal in chat (Ames 2026-10-06:
// "where is annkri's medal?", top of Cells for the day with none). The old
// version took the first three rows of the loaded board, which since the
// board became six merged rankings were simply the top all-time editors,
// and matched them by display name, which is not the name chat shows. Now:
// the top three of the last 24 hours on Edits and on Cells, matched by
// account, each player wearing the better of their two places.
const MEDALS = ['🥇', '🥈', '🥉'];
const chatMedals = computed(() => {
  const byId: Record<string, { medal: string; place: number; why: string }> = {};
  const byName: Record<string, string> = {};
  const lb: any[] = backendStore.leaderboard || [];
  for (const [col, what] of [['completions_24h', 'cells'], ['edits_24h', 'edits']] as const) {
    const top = lb.filter(u => (u[col] || 0) > 0)
      .sort((a, b) => (b[col] || 0) - (a[col] || 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 3);
    top.forEach((u, place) => {
      const why = `${['1st', '2nd', '3rd'][place]} in ${what} over the last 24 hours`;
      const had = byId[u.id];
      if (!had || place < had.place) byId[u.id] = { medal: MEDALS[place], place, why: had ? `${why}, ${had.why}` : why };
      else had.why = `${had.why}, ${why}`;
    });
  }
  for (const u of lb) if (byId[u.id] && u.display_name) byName[u.display_name] = u.id;
  return { byId, byName };
});
function medalFor(msg: ChatMessage): { medal: string; why: string } | null {
  const { byId, byName } = chatMedals.value;
  const id = (msg.userId && byId[msg.userId]) ? msg.userId : byName[msg.name];
  return id && byId[id] ? byId[id] : null;
}
// The board is loaded when the leaderboard opens; chat keeps its own copy
// fresh so the medals are right even if the board was never opened.
let medalTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  if (!(backendStore.leaderboard || []).length) void backendStore.loadLeaderboard();
  medalTimer = setInterval(() => { void backendStore.loadLeaderboard(); }, 5 * 60 * 1000);
});
onUnmounted(() => { if (medalTimer) clearInterval(medalTimer); });

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

// ── Message length ──
// Links don't count toward the limit, so a plain maxlength can't hold it; the
// counter shows near the limit and sending waits until the text fits.
const messageLength = computed(() => chatTextLength(messageInput.value));
const messageTooLong = computed(() => messageLength.value > CHAT_MAX_CHARS);
const showLengthCount = computed(() => messageLength.value > CHAT_MAX_CHARS - 20);

// The box grows with the message up to its CSS max-height, then scrolls.
function fitInputHeight() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}
watch(messageInput, () => nextTick(fitInputHeight));
watch(isQuiet, () => nextTick(fitInputHeight));

// ── Replies (Ames 2026-10-05) ──
// Reply to a message: yours quotes it, the quote scrolls back to the
// original, and its author is pinged the way an @mention pings.
const replyingTo = ref<ChatMessage | null>(null);
function startReply(msg: ChatMessage) {
  replyingTo.value = msg;
  nextTick(() => inputEl.value?.focus());
}
/** The words of a message, without its links, cut short for a quote. */
function excerptOf(msg: ChatMessage | null | undefined, max = 70): string {
  if (!msg) return '';
  const text = msg.parts.filter(p => p.type !== 'sender' && p.type !== 'link').map(p => p.text).join('').replace(/\s+/g, ' ').trim();
  const out = text || (msg.parts.some(p => p.type === 'link') ? 'a link' : '');
  return Array.from(out).length > max ? Array.from(out).slice(0, max).join('').trimEnd() + '…' : out;
}
/** The message a reply points at, if it is among the loaded ones. */
function repliedMsg(msg: ChatMessage): ChatMessage | null {
  if (!msg.replyTo) return null;
  return chatMessages.value.find(m => m.id === msg.replyTo) || null;
}
const flashedMsgId = ref<string | null>(null);
let flashTimer = 0;
function goToMessage(id: string | null | undefined) {
  if (!id) return;
  const el = document.querySelector<HTMLElement>(`.nge-chat-float [data-msg-id="${CSS.escape(String(id))}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flashedMsgId.value = String(id);
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { flashedMsgId.value = null; }, 1600);
}

// ── Send message ──
function send() {
  const text = messageInput.value.trim();
  if (!text || messageTooLong.value) return;
  chatStore.sendMessage(text, null, replyingTo.value?.id != null ? String(replyingTo.value.id) : null);
  replyingTo.value = null;
  messageInput.value = '';
  mentionQuery.value = null;
  inputEl.value?.focus();
}

// ── @ autocomplete (Ames 2026-09-28) ──
// Typing "@" offers people: online now first, then recent speakers, then any
// username that starts with what you typed. Mentions only ping someone when
// the handle is exact, so picking from the list keeps them reliable.
const mentionQuery = ref<string | null>(null);
const mentionIndex = ref(0);
const remoteHandles = ref<string[]>([]);
let handleSearchTimer: ReturnType<typeof setTimeout> | null = null;

function mentionToken(): { start: number; end: number; q: string } | null {
  const el = inputEl.value;
  const end = el?.selectionStart ?? messageInput.value.length;
  const m = messageInput.value.slice(0, end).match(/(?:^|\s)@([A-Za-z0-9._-]{0,30})$/);
  return m ? { start: end - m[1].length - 1, end, q: m[1] } : null;
}

function onInputChange() {
  const t = mentionToken();
  mentionQuery.value = t ? t.q : null;
  mentionIndex.value = 0;
  if (handleSearchTimer) clearTimeout(handleSearchTimer);
  if (t && t.q.length >= 1) {
    const q = t.q;
    handleSearchTimer = setTimeout(async () => {
      try {
        const { data } = await supabase.from('users').select('username')
          .ilike('username', `${q}%`).not('username', 'is', null).limit(8);
        if (mentionQuery.value === q) remoteHandles.value = (data || []).map((u: any) => u.username).filter(Boolean);
      } catch { /* suggestions are best effort */ }
    }, 180);
  } else {
    remoteHandles.value = [];
  }
}

const mentionOptions = computed(() => {
  if (mentionQuery.value === null) return [];
  const q = mentionQuery.value.toLowerCase();
  const me = (backendStore.username || '').toLowerCase();
  const seen = new Set<string>();
  const out: Array<{ handle: string; online: boolean; prefix: boolean }> = [];
  const add = (h: string | undefined, online: boolean) => {
    if (!h || /\s/.test(h)) return;
    const k = h.toLowerCase();
    if (seen.has(k) || k === me || (q && !k.includes(q))) return;
    seen.add(k);
    out.push({ handle: h, online, prefix: k.startsWith(q) });
  };
  for (const p of Object.values(chatStore.online)) add(p.name, true);
  for (let i = chatMessages.value.length - 1; i >= 0; i--) {
    const m = chatMessages.value[i];
    if (m.type === 'message' && !m.notificationId && m.rank !== 'bot') add(m.name, false);
  }
  for (const h of remoteHandles.value) add(h, false);
  return out
    .sort((a, b) => Number(b.prefix) - Number(a.prefix) || Number(b.online) - Number(a.online))
    .slice(0, 6);
});

function pickMention(handle: string) {
  const t = mentionToken();
  if (!t) return;
  const v = messageInput.value;
  messageInput.value = v.slice(0, t.start) + '@' + handle + ' ' + v.slice(t.end);
  mentionQuery.value = null;
  const caret = t.start + handle.length + 2;
  nextTick(() => { inputEl.value?.focus(); inputEl.value?.setSelectionRange(caret, caret); });
}

function onInputKeydown(e: KeyboardEvent) {
  const opts = mentionOptions.value;
  if (opts.length) {
    if (e.key === 'ArrowDown') { mentionIndex.value = (mentionIndex.value + 1) % opts.length; e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { mentionIndex.value = (mentionIndex.value - 1 + opts.length) % opts.length; e.preventDefault(); return; }
    if (e.key === 'Escape') { mentionQuery.value = null; e.preventDefault(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      pickMention(opts[Math.min(mentionIndex.value, opts.length - 1)].handle);
      e.preventDefault();
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    send();
  } else if (e.key === 'Enter') {
    // The box wraps long text but messages stay one line, so no newlines.
    e.preventDefault();
  }
}

// ── Share my view (Ames 2026-09-28) ──
// Posts a short link to exactly what you're looking at, optionally with a
// screenshot. Anything typed in the box rides along as the caption.
const shareMenuOpen = ref(false);
const sharing = ref(false);
const shareError = ref('');
const showShareShot = ref(false);

async function postView(shotUrl: string | null) {
  if (messageTooLong.value) { shareError.value = `Messages can be up to ${CHAT_MAX_CHARS} characters. Shorten it and share again.`; return; }
  sharing.value = true;
  shareError.value = '';
  try {
    const link = await mintShortStateLink();
    if (!link) { shareError.value = 'Could not make a link to your view. Try again in a moment.'; return; }
    const caption = messageInput.value.trim();
    chatStore.sendMessage([caption || '📍 My view', link, shotUrl].filter(Boolean).join(' '));
    if (caption) messageInput.value = '';
  } finally {
    sharing.value = false;
  }
}
function shareView(withShot: boolean) {
  shareMenuOpen.value = false;
  if (withShot) showShareShot.value = true;
  else void postView(null);
}
function onShareShotAttached(payload: { url: string }) {
  showShareShot.value = false;
  void postView(payload.url);
}

// Links in messages all open in a new tab (Ames 2026-09-30); a shared view
// shows as an "Open view" chip, and our own screenshots
// show as thumbnails instead of long storage URLs.
const OWN_STORAGE = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/';
function isViewLink(u: string): boolean {
  try { const x = new URL(u); return x.origin === window.location.origin && x.hash.startsWith('#!'); } catch { return false; }
}
function isShotLink(u: string): boolean {
  return u.startsWith(OWN_STORAGE) && /\.(png|jpe?g|webp)$/i.test(u);
}

// ── Reactions (Ames 2026-09-28) ──
const pickerFor = ref<string | null>(null);
function togglePicker(id: string) { pickerFor.value = pickerFor.value === id ? null : id; }
function react(id: string, emoji: string) {
  pickerFor.value = null;
  void chatStore.toggleReaction(id, emoji);
}
function reactionsOf(msg: ChatMessage) {
  return msg.id != null ? chatStore.reactions[String(msg.id)] || {} : {};
}
function reactedByMe(list: Array<{ userId: string }>) {
  return list.some(r => r.userId === backendStore.userId);
}
function closePopovers(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (!t.closest?.('.nge-chat-react-add')) pickerFor.value = null;
  if (!t.closest?.('.nge-chat-share')) shareMenuOpen.value = false;
  if (!t.closest?.('.nge-chat-emoji')) emojiOpen.value = false;
}

// ── Emoji for writing messages (Amy 2026-09-30), not just reactions ──
const CHAT_EMOJI = [
  '😊', '😂', '😅', '🥳', '😍', '😎', '🤔', '😮', '😢', '🙏',
  '👍', '👏', '🙌', '💪', '👀', '✨', '🔥', '💯', '🎉', '❤️',
  '🧠', '🔬', '🧬', '⚡', '👁️', '🐭', '🪰', '🐟', '🦉', '🐙',
  '🚀', '🌟', '🎯', '✅', '❌', '⚠️', '☕', '🍕', '🌈', '😴',
];
const emojiOpen = ref(false);
function insertEmoji(emo: string) {
  const el = inputEl.value;
  const v = messageInput.value;
  const at = el && el.selectionStart != null ? el.selectionStart : v.length;
  const end = el && el.selectionEnd != null ? el.selectionEnd : at;
  messageInput.value = v.slice(0, at) + emo + v.slice(end);
  void nextTick(() => {
    const pos = at + emo.length;
    inputEl.value?.focus();
    inputEl.value?.setSelectionRange(pos, pos);
  });
}
document.addEventListener('mousedown', closePopovers);

/**
 * Is this @mention aimed at the current user?
 *
 * Matched loosely because display names vary ("Amy S.", "Amy Sterling") and the
 * mention token only captures up to two words. Compares against both the full
 * display name and its first word, case-insensitively, ignoring trailing dots.
 */
function isSelfMention(token: string): boolean {
  return isSelfMentionToken(token, backendStore.username, backendStore.userName);
}

/** Open the notification an announcement message refers to. */
/** The 🗑 on chat messages is hidden for now (Ames 2026-09-28). Deleting still
 *  works server side; flip this to bring the button back. */
const SHOW_CHAT_DELETE = false;

/** Admin moderation: delete a message for everyone (the gateway enforces admin). */
async function deleteChatMessage(msg: ChatMessage) {
  if (msg.id == null) return;
  const preview = msg.parts.filter(p => p.type !== 'sender').map(p => p.text).join('').slice(0, 80);
  const mine = msg.userId && msg.userId === backendStore.userId;
  if (!window.confirm(`${mine ? 'Delete your message' : `Delete this message from ${msg.name}`} for everyone?\n\n"${preview}"`)) return;
  const ok = await chatStore.deleteMessage(msg.id);
  if (!ok) window.alert('Could not delete that message. Please try again.');
}

function openAnnouncement(id: number) {
  document.dispatchEvent(new CustomEvent('nge:open-notification', { detail: { id } }));
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
    dataset: msgDataset,
    from: msgDataset ? datasetLabel(msgDataset) : null,
    to: active ? datasetLabel(active) : 'your current view',
  };
}

/**
 * User confirmed jumping to a segment shared from another dataset. Switch to
 * that dataset FIRST, then load the segment — a root ID only means anything in
 * its own segmentation, so adding it to the current dataset's layer lands on
 * the wrong cell or nothing. (This is the regression: confirm used to call
 * loadSegment directly without switching, so cross-dataset jumps silently
 * failed to load.)
 */
async function confirmSegJump() {
  const p = pendingSegJump.value;
  pendingSegJump.value = null;
  if (!p) return;
  const target = p.dataset
    ? DATASETS.find(d => canonicalDataset(segLayerName(d)) === canonicalDataset(p.dataset))
    : undefined;
  const active = activeDatasetName();
  const needSwitch = !!target && (!active || canonicalDataset(p.dataset) !== canonicalDataset(active));
  if (needSwitch) {
    const ok = await switchToDataset(target!);
    if (ok) {
      // Let the new layers mount before moving the camera to the segment.
      setTimeout(() => loadSegment(p.segRef), 800);
      return;
    }
  }
  loadSegment(p.segRef);
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
  // Selecting text across a name (to copy it) is not a click on the name.
  if (String(window.getSelection() || '').length) return;
  if (/^nurro$/i.test(displayName.trim())) { openNurroProfile(); return; }
  try {
    const name = displayName.trim().replace(/^@/, '');
    const results = await backendStore.searchUsers(name);
    const lower = name.toLowerCase();
    const match = results.find((u: any) => u.display_name === name || u.username === name)
      || results.find((u: any) => (u.display_name || '').toLowerCase() === lower || (u.username || '').toLowerCase() === lower)
      || results[0];
    if (match) {
      document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { userId: match.id } }));
    } else {
      console.warn('[chat] no profile found for', name);
    }
  } catch (e) {
    console.warn('[chat] openUserProfile error:', e);
  }
}

// ── Scroll handling (inverted scroll) ──
function handleScroll() {
  const el = scrollContainer.value;
  if (!el) return;
  // column-reverse: scrollTop is 0 at the newest message and grows negative
  // as you scroll up (the old "> 60" test never fired in Chrome).
  const up = Math.abs(el.scrollTop);
  isScrolledUp.value = up > 60;
  if (!isScrolledUp.value) {
    chatStore.markRead();
  }
  // Near the top: fetch the previous page. The view is anchored to the
  // bottom, so older messages appear above without moving what you read.
  if (el.scrollHeight - el.clientHeight - up < 40) void chatStore.loadOlder();
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
      :class="{ 'nge-chat-float--collapsed': collapsed, 'nge-chat-float--dragging': isDragging, 'nge-chat-float--mentioned': mentionFlash, 'nge-chat-float--quiet': isQuiet, 'nge-chat-float--resizing': isResizing }"
      @focusin="onPanelFocusIn"
      :style="{
        ...(collapsed ? {} : { width: panelWidth + 'px', height: shownHeight + 'px' }),
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
        <span v-if="connected && chatStore.onlineCount > 0" class="nge-chat-online"
              :title="Object.values(chatStore.online).map(p => p.name).join(', ')">{{ chatStore.onlineCount }} online</span>
        <span v-if="collapsed && unreadMessages" class="nge-chat-strip-unread" title="New messages"></span>
        <span v-if="mentionFlash && chatStore.lastMentionFrom" class="nge-chat-mentioned-by">@ from {{ chatStore.lastMentionFrom }}</span>
        <span class="nge-chat-strip-spacer"></span>
        <button class="nge-chat-strip-btn nge-chat-bell-btn" :class="{ 'nge-chat-bell-btn--on': chatStore.mentionNotify }"
                @click.stop="chatStore.setMentionNotify(!chatStore.mentionNotify)"
                :title="chatStore.mentionNotify ? 'Chat notifications are on: new messages notify you while EyeWire is in the background (click to turn off)' : 'Turn on browser notifications for new chat messages while EyeWire is in the background'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            <line v-if="!chatStore.mentionNotify" x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </button>
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
              <div v-if="isLoggedIn && chatMessages.length" class="nge-chat-history-top">
                <button v-if="chatStore.hasMoreHistory" class="nge-chat-history-btn" :disabled="chatStore.loadingHistory"
                        @click="chatStore.loadOlder()">{{ chatStore.loadingHistory ? 'Loading…' : 'Load earlier messages' }}</button>
                <span v-else>Beginning of chat</span>
              </div>
              <template v-for="(msg, i) in chatMessages" :key="msg.id ?? ('i' + i)">
                <div v-if="msg.type === 'time'" class="nge-chat-time-sep">
                  <span>{{ msg.time }}</span>
                </div>

                <div v-else-if="msg.type === 'join' || msg.type === 'leave' || msg.type === 'disconnected' || msg.type === 'complete'"
                     class="nge-chat-sys"
                     :class="{ 'nge-chat-sys--warn': msg.type === 'disconnected', 'nge-chat-fresh': isFresh(msg) }">
                  {{ msg.type === 'join' ? '→' : msg.type === 'leave' ? '←' : msg.type === 'complete' ? '✓' : '⚠' }}
                  {{ msg.parts[0]?.text || '' }}
                </div>

                <!-- Announcement: carries a notification id, so the whole
                     message opens that notification instead of telling the
                     reader to go and look for it. -->
                <div v-else-if="msg.type === 'message' && msg.notificationId"
                     class="nge-chat-msg nge-chat-announce"
                     :class="{ 'nge-chat-fresh': isFresh(msg), 'nge-chat-recent': recentMsgs.has(msg) }"
                     role="button"
                     tabindex="0"
                     @click="openAnnouncement(msg.notificationId)"
                     @keydown.enter="openAnnouncement(msg.notificationId)"
                     title="Open this notification">
                  <span class="nge-chat-msg-time">{{ msgTime(msg.dateTime) }}</span>
                  <span class="nge-chat-announce-text">{{ msg.parts.filter(p => p.type !== 'sender').map(p => p.text).join('') }}</span>
                  <span class="nge-chat-announce-cta">Open →</span>
                </div>

                <!-- Nurro's daily leaders, as a card (Ames 2026-09-29). -->
                <div v-else-if="msg.type === 'message' && msg.daily" class="nge-chat-msg nge-chat-daily" :class="{ 'nge-chat-fresh': isFresh(msg), 'nge-chat-recent': recentMsgs.has(msg) }">
                  <div class="nge-chat-daily-head">
                    <img :src="nurroAvatar" alt="" class="nge-chat-daily-nurro" />
                    <span class="nge-chat-daily-title">Today's leaders</span>
                    <span class="nge-chat-daily-sub">last 24 h</span>
                  </div>
                  <div v-if="msg.daily.edits.length || msg.daily.cells.length" class="nge-chat-daily-cols">
                    <div v-if="msg.daily.edits.length" class="nge-chat-daily-col">
                      <div class="nge-chat-daily-label">Most edits</div>
                      <div v-for="(r, ri) in msg.daily.edits" :key="'e' + ri" class="nge-chat-daily-row">
                        <span class="nge-chat-daily-medal">{{ DAILY_MEDALS[ri] }}</span>
                        <span class="nge-chat-daily-name" role="button" @click="openUserProfile(r.name)" :title="'View ' + r.name + '\'s profile'">{{ r.name }}</span>
                        <span class="nge-chat-daily-n">{{ r.n }}</span>
                      </div>
                    </div>
                    <div v-if="msg.daily.cells.length" class="nge-chat-daily-col">
                      <div class="nge-chat-daily-label">Most cells</div>
                      <div v-for="(r, ri) in msg.daily.cells" :key="'c' + ri" class="nge-chat-daily-row">
                        <span class="nge-chat-daily-medal">{{ DAILY_MEDALS[ri] }}</span>
                        <span class="nge-chat-daily-name" role="button" @click="openUserProfile(r.name)" :title="'View ' + r.name + '\'s profile'">{{ r.name }}</span>
                        <span class="nge-chat-daily-n">{{ r.n }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-else class="nge-chat-daily-empty">No edits in the last 24 hours yet. The top spot is wide open!</div>
                </div>

                <div v-else-if="msg.type === 'message'" class="nge-chat-msg" :class="{ 'nge-chat-fresh': isFresh(msg), 'nge-chat-recent': recentMsgs.has(msg), 'nge-chat-private': msg.private, 'nge-chat-msg--flash': msg.id != null && flashedMsgId === String(msg.id) }"
                     :data-msg-id="msg.id != null ? String(msg.id) : undefined"
                     :title="msg.private ? 'Only you can see this' : undefined">
                  <!-- A reply: the message it answers, quoted above it. -->
                  <button v-if="msg.replyTo && repliedMsg(msg)" class="nge-chat-quote" @click.stop="goToMessage(msg.replyTo)"
                          title="Go to the message this replies to">
                    <span class="nge-chat-quote-arrow" aria-hidden="true">↩</span><span class="nge-chat-quote-name">{{ shortName(repliedMsg(msg)?.name || '') }}</span><span class="nge-chat-quote-text">{{ excerptOf(repliedMsg(msg)) }}</span>
                  </button>
                  <span v-else-if="msg.replyTo" class="nge-chat-quote nge-chat-quote--gone"><span class="nge-chat-quote-arrow" aria-hidden="true">↩</span><span class="nge-chat-quote-text">an earlier message</span></span>
                  <span class="nge-chat-msg-time">{{ msgTime(msg.dateTime) }}</span>
                  <span class="nge-chat-msg-trophy" v-if="medalFor(msg)" :title="medalFor(msg)?.why">{{ medalFor(msg)?.medal }}</span>
                  <button v-if="msg.rank === 'bot' && msg.name === 'Nurro'" class="nge-chat-msg-name nge-chat-nurro-name"
                          @click="openNurroProfile" title="Nurro's profile"><img :src="nurroAvatar" alt="" />Nurro<span class="nge-chat-bot-tag nge-chat-nurro-tag">guide</span></button>
                  <span v-else-if="msg.rank === 'bot'" class="nge-chat-msg-name nge-chat-bot-name"
                        :title="'nkem_test: the original EyeWire chat bot, by @nkem (2013). Say \'for science\' and it answers.'">nkem_test<span class="nge-chat-bot-tag">bot</span></span>
                  <span v-else class="nge-chat-msg-name nge-chat-msg-name--clickable" :style="{ color: rankColor(msg.rank) }"
                        @click="openUserProfile(msg.name)" :title="'View ' + msg.name + '\'s profile'">{{ shortName(msg.name) }}</span>
                  <template v-for="(part, pi) in msg.parts" :key="pi">
                    <template v-if="part.type === 'sender'"></template>
                    <a v-else-if="part.type === 'link' && isViewLink(part.text)" class="nge-chat-view-chip" :href="part.text" target="_blank" rel="noopener"
                            title="Open this view in a new tab">📍 Open view</a>
                    <a v-else-if="part.type === 'link' && isShotLink(part.text)" :href="part.text" target="_blank" rel="noopener"
                       class="nge-chat-shot" title="Open the screenshot full size"><img :src="part.text" alt="Screenshot" loading="lazy" /></a>
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
                    <span v-else class="nge-chat-msg-text" :class="{ 'nge-chat-bot-text': msg.rank === 'bot' && msg.name !== 'Nurro' }">{{ part.text }}</span>
                  </template>
                  <span v-if="msg.botLanguage" class="nge-chat-bot-lang">{{ msg.botLanguage }}</span>
                  <button v-if="SHOW_CHAT_DELETE && msg.id != null && (backendStore.isAdmin || (msg.userId && msg.userId === backendStore.userId))" class="nge-chat-del"
                          :title="msg.userId === backendStore.userId ? 'Delete your message' : 'Delete this message for everyone (admin)'"
                          @click.stop="deleteChatMessage(msg)">🗑</button>
                  <template v-if="msg.id != null && isLoggedIn">
                    <span class="nge-chat-react-add">
                      <button v-if="msg.rank !== 'bot' && !msg.notificationId" class="nge-chat-react-plus nge-chat-reply-btn" @click.stop="startReply(msg)" title="Reply">↩</button>
                      <button class="nge-chat-react-plus" :class="{ 'nge-chat-react-plus--open': pickerFor === String(msg.id) }"
                              @click.stop="togglePicker(String(msg.id))" title="React">☺+</button>
                      <span v-if="pickerFor === String(msg.id)" class="nge-chat-react-picker">
                        <button v-for="e in CHAT_REACTION_EMOJI" :key="e" @click.stop="react(String(msg.id), e)">{{ e }}</button>
                      </span>
                    </span>
                    <div v-if="Object.keys(reactionsOf(msg)).length" class="nge-chat-react-row">
                      <button v-for="(list, emo) in reactionsOf(msg)" :key="emo" class="nge-chat-react"
                              :class="{ 'nge-chat-react--mine': reactedByMe(list) }"
                              :title="list.map(r => r.name).join(', ')"
                              @click.stop="react(String(msg.id), String(emo))">{{ emo }}<span>{{ list.length }}</span></button>
                    </div>
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
          <div v-if="replyingTo" class="nge-chat-replying">
            <span class="nge-chat-quote-arrow" aria-hidden="true">↩</span>
            <span class="nge-chat-replying-text">Replying to <b>{{ shortName(replyingTo.name) }}</b><span class="nge-chat-quote-text">{{ excerptOf(replyingTo, 48) }}</span></span>
            <button class="nge-chat-replying-x" @click="replyingTo = null" title="Cancel the reply" aria-label="Cancel the reply">×</button>
          </div>
          <div v-if="mentionOptions.length" class="nge-chat-mention-menu" role="listbox">
            <button v-for="(o, oi) in mentionOptions" :key="o.handle" class="nge-chat-mention-opt"
                    :class="{ 'nge-chat-mention-opt--active': oi === mentionIndex }" role="option"
                    @mousedown.prevent="pickMention(o.handle)" @mouseenter="mentionIndex = oi">
              <span class="nge-chat-mention-dot" :class="{ 'nge-chat-mention-dot--on': o.online }"></span>@{{ o.handle }}
            </button>
          </div>
          <div v-if="shareError" class="nge-chat-share-error" @click="shareError = ''">{{ shareError }}</div>
          <div class="nge-chat-input-row">
            <span class="nge-chat-share">
              <button class="nge-chat-share-btn" :disabled="!isLoggedIn || !connected || sharing"
                      @click.stop="shareMenuOpen = !shareMenuOpen" title="Share my view in chat"><template v-if="sharing">…</template><svg v-else class="nge-chat-share-pin" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M8 15.4S2.6 10.5 2.6 6.3a5.4 5.4 0 0 1 10.8 0C13.4 10.5 8 15.4 8 15.4zM8 8.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z"/></svg></button>
              <span v-if="shareMenuOpen" class="nge-chat-share-menu">
                <button @click="shareView(false)">📍 Share my view</button>
                <button @click="shareView(true)">📷 Share view + screenshot</button>
              </span>
            </span>
            <textarea
              ref="inputEl"
              v-model="messageInput"
              class="nge-chat-input"
              :class="{ 'nge-chat-input--over': messageTooLong }"
              rows="1"
              :placeholder="!isLoggedIn ? 'Log in to chat' : isQuiet ? '>' : 'Message... (@ to mention)'"
              @keydown.stop="onInputKeydown"
              @keyup.stop
              @keypress.stop
              @input="onInputChange"
              @click="onInputChange"
              @blur="mentionQuery = null"
              spellcheck="true"
              autocomplete="off"
              :disabled="!isLoggedIn || !connected"
            ></textarea>
            <span v-if="showLengthCount" class="nge-chat-count" :class="{ 'nge-chat-count--over': messageTooLong }"
                  :title="`Up to ${CHAT_MAX_CHARS} characters, links don't count`">{{ CHAT_MAX_CHARS - messageLength }}</span>
            <span class="nge-chat-emoji">
              <button class="nge-chat-share-btn nge-chat-emoji-btn" :disabled="!isLoggedIn || !connected"
                      @mousedown.prevent @click.stop="emojiOpen = !emojiOpen" title="Add an emoji">🙂</button>
              <span v-if="emojiOpen" class="nge-chat-emoji-grid">
                <button v-for="e in CHAT_EMOJI" :key="e" @mousedown.prevent @click.stop="insertEmoji(e)">{{ e }}</button>
              </span>
            </span>
          </div>
        </div>
        <ScreenshotDialog v-if="showShareShot" :show="showShareShot" mode="attach"
                          @close="showShareShot = false" @attached="onShareShotAttached" />
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Floating container ── */
.nge-chat-float {
  position: fixed;
  /* Above whatever bar is open along the bottom (Find Path, a status line). */
  bottom: calc(36px + var(--nge-bottom-bar, 0px));
  transition: bottom 0.25s ease;
  left: 8px;
  z-index: 9000;
}
/* (While a ModalOverlay window is open, chat tucks behind it: the rule is
   in ModalOverlay.vue's unscoped styles.) */
.nge-chat-float {
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

/* Quiet mode, like the original EyeWire chat (Ames 2026-09-28): click away
   and the panel disappears. No background, no bands, no header; only a faint
   ">" line to click back into, and new messages that pop up and fade out.
   Clicks pass through to the viewer everywhere but that line. */
.nge-chat-float:not(.nge-chat-float--dragging):not(.nge-chat-float--resizing) {
  transition: bottom 0.25s ease, height 0.25s ease, top 0.25s ease, background-color 0.3s ease, border-color 0.3s ease;
}
.nge-chat-float--quiet {
  background: transparent !important;
  border-color: transparent !important;
  pointer-events: none;
}
.nge-chat-float--quiet .nge-chat-resize,
.nge-chat-float--quiet .nge-chat-react-add,
.nge-chat-float--quiet .nge-chat-fade,
.nge-chat-float--quiet .nge-chat-new-banner,
.nge-chat-float--quiet .nge-chat-share,
.nge-chat-float--quiet .nge-chat-emoji { display: none; }
.nge-chat-float--quiet .nge-chat-strip { opacity: 0; }
.nge-chat-float .nge-chat-strip,
.nge-chat-float .nge-chat-msg,
.nge-chat-float .nge-chat-sys,
.nge-chat-float .nge-chat-time-sep,
.nge-chat-float .nge-chat-history-top { transition: opacity 0.6s ease; }
.nge-chat-float--quiet .nge-chat-msg:not(.nge-chat-fresh),
.nge-chat-float--quiet .nge-chat-sys:not(.nge-chat-fresh),
.nge-chat-float--quiet .nge-chat-time-sep,
.nge-chat-float--quiet .nge-chat-history-top { opacity: 0; transition: opacity 1.4s ease; }
.nge-chat-float--quiet .nge-chat-msg:hover { background: none; }
/* Faded chat reads like subtitles (Amy 2026-09-29: "so ugly"). The blurred
   strips turned bright EM into muddy grey slabs of uneven width; now each
   visible message is a tight, solid dark pill hugging its text, stacked with
   even gaps, a thin accent on the left, no timestamps, no ghost header. */
.nge-chat-float--quiet .nge-chat-messages-inner { gap: 4px; }
/* A pill that does not fit fades out at the top instead of being cut through
   the middle of a line (Amy 2026-09-29). */
.nge-chat-float--quiet .nge-chat-messages {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, rgba(0, 0, 0, 0.35) 18px, #000 48px);
  mask-image: linear-gradient(to bottom, transparent 0, rgba(0, 0, 0, 0.35) 18px, #000 48px);
}
.nge-chat-float--quiet .nge-chat-msg.nge-chat-recent,
.nge-chat-float--quiet .nge-chat-fresh {
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
  padding: 3px 10px 4px 9px;
  background: rgba(7, 11, 20, 0.84);
  border-left: 2px solid rgba(91, 227, 255, 0.55);
  border-radius: 4px 9px 9px 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  text-shadow: none;
}
.nge-chat-float--quiet .nge-chat-msg.nge-chat-recent:not(.nge-chat-fresh) { opacity: 0.88; }
.nge-chat-float--quiet .nge-chat-fresh { border-left-color: rgba(91, 227, 255, 0.95); }
.nge-chat-float--quiet .nge-chat-msg-time { display: none; }
.nge-chat-float--quiet .nge-chat-input-wrap {
  pointer-events: auto;
  background: transparent;
  border-top-color: transparent;
}
.nge-chat-float--quiet .nge-chat-input {
  background: transparent;
  border-color: transparent;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}
/* The entry line stays findable (Amy 2026-09-29): a small dark pill with a
   bright ">", in the same style as the message pills. */
.nge-chat-float--quiet .nge-chat-input {
  flex: 0 0 auto;
  width: 46px;
  background: rgba(7, 11, 20, 0.84);
  border: none;
  border-left: 2px solid rgba(91, 227, 255, 0.55);
  border-radius: 4px 9px 9px 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
/* A draft left in the box stays one line in the pill; it grows again on focus. */
.nge-chat-float--quiet .nge-chat-input { max-height: 31px; overflow: hidden; white-space: nowrap; }
.nge-chat-float--quiet .nge-chat-input::placeholder { color: rgba(210, 235, 255, 0.9); font-weight: 700; }
/* One left edge for the message pills, the ">" line and the coordinate
   chip under them (Ames 2026-10-04): they sat at 17, 13 and 8 px. The panel's
   own inset only makes sense while its box is drawn. */
.nge-chat-float--quiet { margin-left: -1px; }
.nge-chat-float--quiet .nge-chat-messages { padding-left: 0; }
.nge-chat-float--quiet .nge-chat-input-wrap { padding-left: 0; }

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
/* Nurro commands and answers are yours alone (Amy 2026-09-30). */
.nge-chat-private { border-left: 2px solid rgba(200, 164, 255, 0.5); padding-left: 6px; }
.nge-chat-private::after {
  content: 'only you';
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 10px;
  color: #c8a4ff;
  background: rgba(200, 164, 255, 0.12);
  vertical-align: 1px;
}
.nge-chat-online {
  margin-left: 6px;
  font-size: 11px;
  color: rgba(125, 255, 176, 0.85);
  white-space: nowrap;
  cursor: default;
}
.nge-chat-del {
  visibility: hidden;
  margin-left: 6px;
  padding: 0 4px;
  border: none;
  background: none;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
  vertical-align: middle;
}
.nge-chat-msg:hover .nge-chat-del { visibility: visible; }
.nge-chat-del:hover { opacity: 1; }

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
  user-select: text;
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
/* Announcement message — visually distinct from conversation so it reads as
   something actionable rather than someone talking. */
.nge-chat-announce {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  background: rgba(74, 158, 255, 0.09);
  border-left: 2px solid rgba(74, 158, 255, 0.55);
  border-radius: 4px;
  padding: 3px 6px;
  margin: 2px 0;
  transition: background 0.15s;
}
.nge-chat-announce:hover { background: rgba(74, 158, 255, 0.18); }
.nge-chat-announce-text { flex: 1; color: #d6e6ff; }
.nge-chat-announce-cta {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: rgba(150, 190, 245, 0.9);
  white-space: nowrap;
}

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
/* Flash when someone @mentions you: an amber ring pulses three times. */
.nge-chat-float--mentioned {
  animation: nge-chat-mention-flash 1s ease-in-out 3;
}
@keyframes nge-chat-mention-flash {
  0%, 100% { box-shadow: 0 0 0 1px rgba(245, 166, 35, 0.25), 0 0 0 rgba(245, 166, 35, 0); }
  50% { box-shadow: 0 0 0 2px rgba(245, 166, 35, 0.95), 0 0 28px rgba(245, 166, 35, 0.55); }
}
.nge-chat-mentioned-by {
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: #1a1204;
  background: #f5a623;
  white-space: nowrap;
}
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
  display: block;
  resize: none;
  line-height: 1.35;
  max-height: 96px;  /* about five lines, then it scrolls */
  overflow-y: auto;
  /* No scrollbar (Ames 2026-10-05): the box grows to fit, so a bar with its
     arrows only got in the way. Past five lines it still scrolls, by wheel,
     arrow keys or the caret. */
  scrollbar-width: none;
}
.nge-chat-input::-webkit-scrollbar { display: none; }
.nge-chat-input:focus { border-color: rgba(74, 158, 255, 0.3); }
.nge-chat-input--over, .nge-chat-input--over:focus { border-color: rgba(255, 110, 110, 0.55); }
.nge-chat-count { flex-shrink: 0; font-size: 12px; font-weight: 600; color: #8797ad; font-variant-numeric: tabular-nums; }
.nge-chat-count--over { color: #ff8a8a; }

/* ── Nurro's daily leaders card ── */
.nge-chat-daily {
  margin: 6px 2px;
  padding: 9px 10px 8px;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(245, 196, 80, 0.10), rgba(245, 196, 80, 0.02) 55%),
    rgba(10, 14, 26, 0.85);
  border: 1px solid rgba(245, 196, 80, 0.32);
  box-shadow: 0 0 14px rgba(245, 196, 80, 0.08), inset 0 1px 0 rgba(255, 230, 170, 0.08);
}
.nge-chat-daily:hover { background:
    linear-gradient(180deg, rgba(245, 196, 80, 0.13), rgba(245, 196, 80, 0.03) 55%),
    rgba(10, 14, 26, 0.9); }
.nge-chat-daily-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.nge-chat-daily-nurro { width: 20px; height: 20px; object-fit: contain; }
.nge-chat-daily-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #ffd27a;
}
.nge-chat-daily-sub { margin-left: auto; font-size: 10.5px; color: rgba(255, 220, 150, 0.55); }
.nge-chat-daily-cols { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.nge-chat-daily-col { flex: 1 1 110px; min-width: 0; }
.nge-chat-daily-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #8fb4dc;
  margin-bottom: 2px;
}
.nge-chat-daily-row { display: flex; align-items: center; gap: 5px; font-size: 13px; line-height: 1.55; }
.nge-chat-daily-medal { font-size: 12px; width: 16px; text-align: center; flex-shrink: 0; }
.nge-chat-daily-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e8eef8;
  cursor: pointer;
}
.nge-chat-daily-name:hover { color: #fff; text-decoration: underline; }
.nge-chat-daily-n {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #ffd27a;
}
.nge-chat-daily-empty { font-size: 12.5px; color: #c9d6e8; }

/* ── Nurro ── */
.nge-chat-nurro-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: #7ee8ff;
  cursor: pointer;
  vertical-align: bottom;
}
.nge-chat-nurro-name:hover { text-decoration: underline; }
.nge-chat-nurro-name img { width: 18px; height: 18px; object-fit: contain; }
.nge-chat-bot-tag.nge-chat-nurro-tag { background: #7ee8ff; color: #04202a; }

/* ── nkem_test ── */
.nge-chat-bot-name {
  color: #c79bff;
  font-weight: 600;
  cursor: help;
}
.nge-chat-bot-tag {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  vertical-align: 1px;
  color: #1a0f2a;
  background: #c79bff;
}
.nge-chat-bot-text { color: #e8d9ff; font-weight: 600; }
.nge-chat-bot-lang {
  margin-left: 6px;
  font-size: 11px;
  color: rgba(199, 155, 255, 0.65);
}

/* ── History header ── */
.nge-chat-history-top {
  text-align: center;
  padding: 4px 0 6px;
  font-size: 11px;
  color: #667;
}
.nge-chat-history-btn {
  background: rgba(74, 158, 255, 0.08);
  border: 1px solid rgba(74, 158, 255, 0.2);
  color: #9cc8ff;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
}
.nge-chat-history-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.18); }
.nge-chat-history-btn:disabled { opacity: 0.6; cursor: default; }

/* ── Mention bell ── */
/* Same quiet grey as the other header buttons (Ames 2026-10-02: too bright);
   on is a touch lighter, never a white glow. */
.nge-chat-bell-btn { display: inline-flex; align-items: center; padding: 2px 4px; }
.nge-chat-bell-btn--on { color: #8797ad; }

/* ── @ autocomplete ── */
.nge-chat-input-wrap { position: relative; }
.nge-chat-mention-menu {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: calc(100% + 2px);
  display: flex;
  flex-direction: column;
  background: rgba(10, 16, 30, 0.98);
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  padding: 3px;
  z-index: 5;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}
.nge-chat-mention-opt {
  display: flex;
  align-items: center;
  gap: 7px;
  text-align: left;
  background: none;
  border: none;
  color: #cfe0ff;
  font: inherit;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.nge-chat-mention-opt--active { background: rgba(74, 158, 255, 0.2); color: #fff; }
.nge-chat-mention-dot { width: 7px; height: 7px; border-radius: 50%; background: #445; flex-shrink: 0; }
.nge-chat-mention-dot--on { background: #4ad07a; box-shadow: 0 0 6px rgba(74, 208, 122, 0.7); }

/* ── Share my view ── */
.nge-chat-input-row { display: flex; align-items: flex-end; gap: 4px; }
.nge-chat-input-row .nge-chat-input { flex: 1; min-width: 0; }
.nge-chat-share { position: relative; flex-shrink: 0; }
/* Dimmed to the input row's tone, and centred in its square (Ames 2026-10-02). */
.nge-chat-share-pin { display: block; color: rgba(170, 190, 215, 0.75); transition: color 0.15s; }
.nge-chat-share-btn:hover:not(:disabled) .nge-chat-share-pin { color: rgba(205, 222, 240, 0.95); }
.nge-chat-share-btn {
  width: 30px;
  height: 30px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.15);
  background: rgba(20, 24, 40, 0.9);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.nge-chat-share-btn:hover:not(:disabled) { border-color: rgba(74, 158, 255, 0.5); }
.nge-chat-share > .nge-chat-share-btn { display: flex; align-items: center; justify-content: center; padding: 0; }
.nge-chat-share-btn:disabled { opacity: 0.4; cursor: default; }
.nge-chat-emoji { position: relative; flex: 0 0 auto; margin-left: 4px; }
.nge-chat-emoji-grid {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  display: grid;
  grid-template-columns: repeat(8, 30px);
  gap: 2px;
  padding: 6px;
  background: rgba(10, 16, 30, 0.98);
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  z-index: 6;
}
.nge-chat-emoji-grid button {
  width: 30px; height: 30px;
  border: none; border-radius: 6px;
  background: none; cursor: pointer;
  font-size: 18px; line-height: 1;
}
.nge-chat-emoji-grid button:hover { background: rgba(74, 158, 255, 0.18); }
.nge-chat-share-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  display: flex;
  flex-direction: column;
  background: rgba(10, 16, 30, 0.98);
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  padding: 3px;
  z-index: 6;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}
.nge-chat-share-menu button {
  background: none;
  border: none;
  color: #cfe0ff;
  font: inherit;
  font-size: 13px;
  text-align: left;
  padding: 5px 9px;
  border-radius: 4px;
  cursor: pointer;
}
.nge-chat-share-menu button:hover { background: rgba(74, 158, 255, 0.2); color: #fff; }
.nge-chat-share-error {
  font-size: 12px;
  color: #ffb3b3;
  padding: 2px 4px 4px;
  cursor: pointer;
}
.nge-chat-view-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 0 2px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgba(74, 158, 255, 0.4);
  background: rgba(74, 158, 255, 0.12);
  color: #9cc8ff;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.nge-chat-view-chip:hover { background: rgba(74, 158, 255, 0.25); color: #fff; }
.nge-chat-view-chip { text-decoration: none; }
.nge-chat-shot { display: block; margin: 4px 0 2px; }
.nge-chat-shot img {
  display: block;
  max-width: 100%;
  max-height: 140px;
  border-radius: 4px;
  border: 1px solid rgba(74, 158, 255, 0.25);
}

/* ── Replies ── */
.nge-chat-quote {
  display: flex; align-items: baseline; gap: 5px; width: 100%; min-width: 0;
  margin: 0 0 1px; padding: 1px 6px 1px 7px; box-sizing: border-box;
  background: rgba(74, 158, 255, 0.06); border: 0; border-left: 2px solid rgba(74, 158, 255, 0.45); border-radius: 0 4px 4px 0;
  font: inherit; font-size: 0.86em; color: #8fa3bd; text-align: left; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
button.nge-chat-quote:hover { background: rgba(74, 158, 255, 0.13); border-left-color: #4a9eff; }
.nge-chat-quote--gone { cursor: default; opacity: 0.7; }
.nge-chat-quote-arrow { flex: none; color: #6fb1ff; }
.nge-chat-quote-name { flex: none; font-weight: 600; color: #b8c9de; }
.nge-chat-quote-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-chat-msg--flash { animation: nge-chat-msg-flash 1.6s ease-out; border-radius: 4px; }
@keyframes nge-chat-msg-flash { 0% { background: rgba(74, 158, 255, 0.28); box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.55); } 100% { background: transparent; box-shadow: 0 0 0 1px transparent; } }
.nge-chat-replying {
  display: flex; align-items: center; gap: 6px; margin: 0 0 4px; padding: 3px 6px 3px 8px;
  background: rgba(74, 158, 255, 0.08); border-left: 2px solid #4a9eff; border-radius: 0 4px 4px 0;
  font-size: 12px; color: #9fb3cc;
}
.nge-chat-replying-text { flex: 1; min-width: 0; display: flex; gap: 6px; overflow: hidden; white-space: nowrap; }
.nge-chat-replying-text b { color: #dbe7f5; font-weight: 600; }
.nge-chat-replying-x { flex: none; background: none; border: 0; color: #8fa3bd; font-size: 15px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-chat-replying-x:hover { color: #fff; }
.nge-chat-float--quiet .nge-chat-replying { display: none; }

/* ── Reactions ── */
.nge-chat-msg { position: relative; }
.nge-chat-react-add { position: absolute; top: 1px; right: 2px; display: flex; gap: 3px; }
.nge-chat-reply-btn { font-size: 12px; }
.nge-chat-react-plus {
  opacity: 0;
  background: rgba(20, 26, 44, 0.95);
  border: 1px solid rgba(74, 158, 255, 0.25);
  color: #9cc8ff;
  border-radius: 999px;
  font-size: 11px;
  padding: 0 6px;
  line-height: 18px;
  cursor: pointer;
  transition: opacity 0.12s;
}
.nge-chat-msg:hover .nge-chat-react-plus,
.nge-chat-react-plus--open { opacity: 1; }
.nge-chat-react-picker {
  position: absolute;
  right: calc(100% + 4px);
  top: -4px;
  display: flex;
  gap: 1px;
  background: rgba(10, 16, 30, 0.98);
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 999px;
  padding: 2px 4px;
  z-index: 6;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}
.nge-chat-react-picker button {
  background: none;
  border: none;
  font-size: 17px;
  line-height: 1;
  padding: 3px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.1s;
}
.nge-chat-react-picker button:hover { transform: scale(1.25); background: rgba(74, 158, 255, 0.15); }
.nge-chat-react-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.nge-chat-react {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  line-height: 20px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #cfd8e8;
  font-size: 13px;
  cursor: pointer;
}
.nge-chat-react span { font-size: 11px; color: #9ab; }
.nge-chat-react:hover { border-color: rgba(74, 158, 255, 0.45); }
.nge-chat-react--mine { border-color: rgba(74, 158, 255, 0.6); background: rgba(74, 158, 255, 0.18); }
.nge-chat-react--mine span { color: #cfe0ff; }
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
/* The cut/merge bar is open: clear it. */
body.nge-tool-bar-open .nge-chat-float { bottom: calc(36px + var(--nge-tool-bar-h, 66px) + var(--nge-bottom-bar, 0px)); }
</style>
