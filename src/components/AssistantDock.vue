<script setup lang="ts">
// AssistantDock.vue — the EyeWire II Guide chat dock. A slim floating panel
// that answers questions and drives the UI. It posts to the guideAssistant
// Cloud Function and runs the returned actions through the allow-list in
// dispatch(). Styling mirrors ChatPanel.vue.

import { ref, computed, nextTick, watch } from "vue";
import { marked } from "marked";
import { buildAppContext, type UiState } from "../assistant/context";
import { buildUiReference } from "../assistant/knowledge";
import { getMaterializationInfo } from "../assistant/materialization";
import { dispatch } from "../assistant/dispatch";

const props = defineProps<{
  show: boolean;
  // Panel/tool state owned by ExtensionBar, read fresh on each send.
  uiState?: UiState;
}>();
const emit = defineEmits<{ (e: "hide"): void }>();

// Stable alias URLs for the v2 functions (work regardless of the Cloud Run hash).
const GUIDE_URL =
  (window as any).__NGE_GUIDE_URL ||
  "https://us-central1-ytho-4bff2.cloudfunctions.net/guideAssistant";
const FEEDBACK_URL =
  (window as any).__NGE_GUIDE_FEEDBACK_URL ||
  "https://us-central1-ytho-4bff2.cloudfunctions.net/guideFeedback";

interface Msg {
  role: "user" | "assistant";
  text: string;
  logId?: string;                       // id of the guide_logs doc for this reply
  feedback?: "up" | "down" | null;      // which button the user pressed
  correcting?: boolean;                 // correction box is open
  correctionText?: string;              // draft correction
  feedbackDone?: boolean;               // feedback submitted — hide controls
}

const messages = ref<Msg[]>([]);
const input = ref("");
const loading = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

// ── Resize (anchored bottom-right; drags grow the panel up and to the left) ──
const W_KEY = "nge-guide-width";
const H_KEY = "nge-guide-height";
const MIN_W = 280, MAX_W = 720;
const MIN_H = 220, MAX_H = 760;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function loadSize(key: string, fallback: number) {
  const n = parseInt(localStorage.getItem(key) || "", 10);
  return Number.isFinite(n) ? n : fallback;
}

const dockWidth = ref(loadSize(W_KEY, 340));
const dockHeight = ref(loadSize(H_KEY, 460));

const dockStyle = computed(() => ({
  width: dockWidth.value + "px",
  height: dockHeight.value + "px",
}));

let resizeAxis: "corner" | "left" | "top" = "corner";
let resizeStart = { mx: 0, my: 0, w: 0, h: 0 };

function startResize(e: MouseEvent, axis: "corner" | "left" | "top") {
  e.preventDefault();
  resizeAxis = axis;
  resizeStart = { mx: e.clientX, my: e.clientY, w: dockWidth.value, h: dockHeight.value };
  document.addEventListener("mousemove", onResize);
  document.addEventListener("mouseup", stopResize);
}

function onResize(e: MouseEvent) {
  if (resizeAxis === "corner" || resizeAxis === "left") {
    // Anchored right → dragging left (negative dx) widens the panel.
    dockWidth.value = clamp(resizeStart.w - (e.clientX - resizeStart.mx), MIN_W, Math.min(MAX_W, window.innerWidth - 16));
  }
  if (resizeAxis === "corner" || resizeAxis === "top") {
    // Anchored bottom → dragging up (negative dy) grows the panel taller.
    dockHeight.value = clamp(resizeStart.h - (e.clientY - resizeStart.my), MIN_H, Math.min(MAX_H, window.innerHeight - 80));
  }
}

function stopResize() {
  document.removeEventListener("mousemove", onResize);
  document.removeEventListener("mouseup", stopResize);
  localStorage.setItem(W_KEY, String(dockWidth.value));
  localStorage.setItem(H_KEY, String(dockHeight.value));
}

const SUGGESTIONS = [
  "Take me to the leaderboard",
  "How do I fix a merge error?",
  "Open the command palette",
  "Why can't I see my edits?",
];

function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch {
    return text;
  }
}

async function scrollToBottom() {
  await nextTick();
  const el = scrollEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(() => props.show, (v) => {
  if (v) nextTick(() => inputEl.value?.focus());
});

async function send(text?: string) {
  const message = (text ?? input.value).trim();
  if (!message || loading.value) return;
  input.value = "";
  messages.value.push({ role: "user", text: message });
  loading.value = true;
  scrollToBottom();

  // Last 8 turns as plain {role, content}.
  const history = messages.value.slice(-9, -1).map((m) => ({
    role: m.role,
    content: m.text,
  }));

  let appContext: any = {};
  let uiReference = "";
  try {
    appContext = buildAppContext(props.uiState || {});
    uiReference = buildUiReference(props.uiState?.commandCatalog);
  } catch (e) {
    console.warn("[assistant] context/reference build failed:", e);
  }

  // Grounds "why can't I see my edits?" in the real materialization lag.
  // Best-effort + cached; never blocks the answer if CAVE is unreachable.
  try {
    const mat = await getMaterializationInfo(appContext.caveServer, appContext.datastack);
    if (mat) appContext.materialization = mat;
  } catch (e) {
    console.warn("[assistant] materialization fetch failed:", e);
  }

  try {
    const resp = await fetch(GUIDE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, appContext, uiReference, stream: true }),
    });

    if (!resp.ok) {
      // Rate-limited (429) and other errors return JSON with a friendly `reply`.
      const data = await resp.json().catch(() => ({} as any));
      messages.value.push({
        role: "assistant",
        text: data?.reply || (resp.status === 429
          ? "You're going a little fast — give me a few seconds and try again."
          : "I couldn't reach the guide just now. Please try again in a moment."),
      });
      return;
    }

    // Stream the NDJSON reply, filling one assistant message as tokens arrive.
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("no stream");
    const decoder = new TextDecoder();
    let buffer = "";
    let idx = -1;
    const ensureMsg = () => {
      if (idx === -1) {
        messages.value.push({
          role: "assistant", text: "", logId: undefined,
          feedback: null, correcting: false, correctionText: "", feedbackDone: false,
        });
        idx = messages.value.length - 1;
        loading.value = false; // hide the typing dots once real text starts
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt: any;
        try { evt = JSON.parse(line); } catch { continue; }

        if (evt.type === "text") {
          ensureMsg();
          messages.value[idx].text += evt.delta;
          scrollToBottom();
        } else if (evt.type === "done") {
          ensureMsg();
          if (!messages.value[idx].text) messages.value[idx].text = evt.reply || "…";
          messages.value[idx].logId = typeof evt.logId === "string" ? evt.logId : undefined;
          dispatch(Array.isArray(evt.actions) ? evt.actions : []);
        } else if (evt.type === "error") {
          ensureMsg();
          messages.value[idx].text = evt.reply || "The guide had trouble just now. Please try again.";
        }
      }
    }

    if (idx === -1) {
      messages.value.push({
        role: "assistant",
        text: "The guide had trouble just now. Please try again in a moment.",
      });
    }
  } catch (e) {
    console.error("[assistant] send failed:", e);
    messages.value.push({
      role: "assistant",
      text: "I couldn't reach the guide just now. Please try again in a moment.",
    });
  } finally {
    loading.value = false;
    scrollToBottom();
  }
}

// ── Feedback: let the user flag a wrong answer (and optionally correct it) ──
function startCorrection(msg: Msg) {
  msg.feedback = "down";
  msg.correcting = true;
}

async function submitFeedback(msg: Msg, verdict: "up" | "down") {
  msg.feedback = verdict;
  msg.correcting = false;
  msg.feedbackDone = true;             // optimistic — feedback is best-effort
  const correction = verdict === "down" ? (msg.correctionText || "") : "";
  try {
    await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logId: msg.logId,
        verdict,
        correction,
        reply: msg.text,
      }),
    });
  } catch (e) {
    console.warn("[assistant] feedback failed:", e);
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
</script>

<template>
  <div v-if="show" class="nge-guide" :style="dockStyle">
    <!-- Resize handles (top edge, left edge, top-left corner) -->
    <div class="nge-guide-resize nge-guide-resize--corner" title="Drag to resize" @mousedown="startResize($event, 'corner')"></div>
    <div class="nge-guide-resize nge-guide-resize--top" @mousedown="startResize($event, 'top')"></div>
    <div class="nge-guide-resize nge-guide-resize--left" @mousedown="startResize($event, 'left')"></div>
    <div class="nge-guide-header">
      <span class="nge-guide-dot"></span>
      <span class="nge-guide-title">EyeWire II Guide</span>
      <button class="nge-guide-close" title="Close" @click="emit('hide')">✕</button>
    </div>

    <div ref="scrollEl" class="nge-guide-scroll">
      <div v-if="messages.length === 0" class="nge-guide-empty">
        <p class="nge-guide-hi">Hi! Ask me anything about proofreading, or tell me where you want to go.</p>
        <button
          v-for="s in SUGGESTIONS"
          :key="s"
          class="nge-guide-suggest"
          @click="send(s)"
        >{{ s }}</button>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="nge-guide-msg"
        :class="msg.role === 'user' ? 'nge-guide-msg--user' : 'nge-guide-msg--bot'"
      >
        <div v-if="msg.role === 'user'" class="nge-guide-bubble nge-guide-bubble--user">{{ msg.text }}</div>
        <div v-else class="nge-guide-botwrap">
          <div class="nge-guide-bubble nge-guide-bubble--bot" v-html="renderMarkdown(msg.text)"></div>

          <!-- Feedback controls (only on real backend replies) -->
          <div v-if="msg.logId" class="nge-guide-fb">
            <template v-if="!msg.feedbackDone && !msg.correcting">
              <button class="nge-guide-fb-btn" title="This was helpful" @click="submitFeedback(msg, 'up')">👍</button>
              <button class="nge-guide-fb-btn" title="This is wrong or unhelpful" @click="startCorrection(msg)">👎</button>
            </template>

            <div v-else-if="msg.correcting" class="nge-guide-correct">
              <textarea
                v-model="msg.correctionText"
                class="nge-guide-correct-input"
                rows="2"
                placeholder="What's the correct answer? (optional)"
              ></textarea>
              <div class="nge-guide-correct-actions">
                <button class="nge-guide-correct-send" @click="submitFeedback(msg, 'down')">Send correction</button>
                <button class="nge-guide-correct-skip" @click="submitFeedback(msg, 'down')">Just mark wrong</button>
              </div>
            </div>

            <span v-else class="nge-guide-fb-thanks">
              {{ msg.feedback === 'up' ? 'Thanks! 🙌' : 'Thanks — logged. We\'ll use this to improve. ✓' }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="loading" class="nge-guide-msg nge-guide-msg--bot">
        <div class="nge-guide-bubble nge-guide-bubble--bot nge-guide-typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>

    <div class="nge-guide-inputrow">
      <textarea
        ref="inputEl"
        v-model="input"
        class="nge-guide-input"
        rows="1"
        placeholder="Ask the guide…"
        @keydown="onKeydown"
      ></textarea>
      <button class="nge-guide-send" :disabled="loading || !input.trim()" @click="send()">↑</button>
    </div>
  </div>
</template>

<style scoped>
.nge-guide {
  position: fixed;
  bottom: 36px;
  right: 8px;
  width: 340px;
  max-width: calc(100vw - 16px);
  height: 460px;
  max-height: calc(100vh - 80px);
  z-index: 9001;
  display: flex;
  flex-direction: column;
  background: rgba(6, 10, 20, 0.92);
  border-radius: 8px;
  border: 1px solid rgba(74, 158, 255, 0.18);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  font-family: 'Inter', 'Roboto', sans-serif;
  color: #dbe4f0;
}

/* ── Resize handles ── */
.nge-guide-resize { position: absolute; z-index: 20; }
.nge-guide-resize--corner {
  top: 0; left: 0; width: 16px; height: 16px; cursor: nwse-resize;
}
.nge-guide-resize--corner::after {
  content: ''; position: absolute; top: 4px; left: 4px;
  width: 6px; height: 6px;
  border-top: 2px solid rgba(74, 158, 255, 0.3);
  border-left: 2px solid rgba(74, 158, 255, 0.3);
  border-radius: 1px; transition: border-color 0.15s;
}
.nge-guide-resize--corner:hover::after { border-color: rgba(74, 158, 255, 0.75); }
.nge-guide-resize--top {
  top: 0; left: 16px; right: 0; height: 5px; cursor: ns-resize;
}
.nge-guide-resize--top:hover { background: rgba(74, 158, 255, 0.18); }
.nge-guide-resize--left {
  top: 16px; left: 0; width: 5px; bottom: 0; cursor: ew-resize;
}
.nge-guide-resize--left:hover { background: rgba(74, 158, 255, 0.18); }

.nge-guide-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(74, 158, 255, 0.12);
  flex-shrink: 0;
}
.nge-guide-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #0fb18b;
  box-shadow: 0 0 6px rgba(15, 177, 139, 0.6);
}
.nge-guide-title {
  font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
  color: #cfe0f5; flex: 1;
}
.nge-guide-close {
  background: none; border: none; color: #6b7a90; cursor: pointer;
  font-size: 12px; padding: 2px 5px; border-radius: 4px;
}
.nge-guide-close:hover { color: #cfe0f5; background: rgba(255,255,255,0.06); }

.nge-guide-scroll {
  flex: 1; overflow-y: auto; padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.35) transparent;
}
/* Chrome / Edge / Safari */
.nge-guide-scroll::-webkit-scrollbar { width: 8px; }
.nge-guide-scroll::-webkit-scrollbar-track { background: transparent; }
.nge-guide-scroll::-webkit-scrollbar-thumb {
  background: rgba(74, 158, 255, 0.3);
  border-radius: 4px;
}
.nge-guide-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(74, 158, 255, 0.5);
}

.nge-guide-empty { display: flex; flex-direction: column; gap: 6px; }
.nge-guide-hi { font-size: 12.5px; color: #9fb2c8; line-height: 1.5; margin: 2px 0 6px; }
.nge-guide-suggest {
  text-align: left; background: rgba(74, 158, 255, 0.08);
  border: 1px solid rgba(74, 158, 255, 0.16); color: #bcd2ee;
  border-radius: 6px; padding: 7px 9px; font-size: 12px; cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.nge-guide-suggest:hover { background: rgba(74, 158, 255, 0.16); border-color: rgba(74, 158, 255, 0.35); }

.nge-guide-msg { display: flex; }
.nge-guide-msg--user { justify-content: flex-end; }
.nge-guide-msg--bot { justify-content: flex-start; }

.nge-guide-bubble {
  max-width: 85%; padding: 7px 10px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.5; word-wrap: break-word;
}
.nge-guide-bubble--user {
  background: rgba(74, 158, 255, 0.22); color: #eaf2ff;
  border-bottom-right-radius: 3px;
}
.nge-guide-bubble--bot {
  background: rgba(255, 255, 255, 0.06); color: #dbe4f0;
  border-bottom-left-radius: 3px;
}
.nge-guide-bubble--bot :deep(p) { margin: 0 0 6px; }
.nge-guide-bubble--bot :deep(p:last-child) { margin-bottom: 0; }
.nge-guide-bubble--bot :deep(code) {
  background: rgba(0,0,0,0.35); padding: 1px 4px; border-radius: 3px;
  font-size: 11.5px;
}
.nge-guide-bubble--bot :deep(a) { color: #6fb2ff; }
.nge-guide-bubble--bot :deep(ul), .nge-guide-bubble--bot :deep(ol) { margin: 4px 0; padding-left: 18px; }

/* ── Feedback controls ── */
.nge-guide-botwrap { display: flex; flex-direction: column; max-width: 85%; }
.nge-guide-botwrap .nge-guide-bubble { max-width: 100%; }

.nge-guide-fb { display: flex; align-items: center; gap: 4px; margin: 3px 2px 0; min-height: 20px; }
.nge-guide-fb-btn {
  background: none; border: none; cursor: pointer; font-size: 13px;
  line-height: 1; padding: 2px 4px; border-radius: 4px; opacity: 0.5;
  filter: grayscale(0.4); transition: opacity 0.12s, background 0.12s, filter 0.12s;
}
.nge-guide-fb-btn:hover { opacity: 1; filter: none; background: rgba(255, 255, 255, 0.07); }
.nge-guide-fb-thanks { font-size: 10.5px; color: #7c8ba0; }

.nge-guide-correct { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; width: 100%; }
.nge-guide-correct-input {
  resize: none; background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(74, 158, 255, 0.25); border-radius: 6px;
  color: #eaf2ff; font-size: 12px; padding: 6px 8px; font-family: inherit; line-height: 1.4;
}
.nge-guide-correct-input:focus { outline: none; border-color: rgba(74, 158, 255, 0.5); }
.nge-guide-correct-actions { display: flex; gap: 6px; }
.nge-guide-correct-send {
  background: rgba(74, 158, 255, 0.85); color: #fff; border: none;
  border-radius: 5px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer;
}
.nge-guide-correct-send:hover { background: rgba(74, 158, 255, 1); }
.nge-guide-correct-skip {
  background: none; color: #8b9ab0; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;
}
.nge-guide-correct-skip:hover { color: #cfe0f5; border-color: rgba(255, 255, 255, 0.25); }

.nge-guide-typing { display: flex; gap: 4px; align-items: center; }
.nge-guide-typing span {
  width: 6px; height: 6px; border-radius: 50%; background: #6b7a90;
  animation: nge-guide-blink 1.2s infinite ease-in-out;
}
.nge-guide-typing span:nth-child(2) { animation-delay: 0.2s; }
.nge-guide-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes nge-guide-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.nge-guide-inputrow {
  display: flex; align-items: flex-end; gap: 6px;
  padding: 8px; border-top: 1px solid rgba(74, 158, 255, 0.12);
  flex-shrink: 0;
}
.nge-guide-input {
  flex: 1; resize: none; max-height: 90px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(74,158,255,0.16);
  border-radius: 6px; color: #eaf2ff; font-size: 12.5px; padding: 7px 9px;
  font-family: inherit; line-height: 1.4;
}
.nge-guide-input:focus { outline: none; border-color: rgba(74,158,255,0.45); }
.nge-guide-input { scrollbar-width: thin; scrollbar-color: rgba(74, 158, 255, 0.35) transparent; }
.nge-guide-input::-webkit-scrollbar { width: 8px; }
.nge-guide-input::-webkit-scrollbar-track { background: transparent; }
.nge-guide-input::-webkit-scrollbar-thumb { background: rgba(74, 158, 255, 0.3); border-radius: 4px; }
.nge-guide-send {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 6px;
  background: rgba(74, 158, 255, 0.85); color: #fff; border: none;
  cursor: pointer; font-size: 15px; font-weight: 700;
}
.nge-guide-send:disabled { background: rgba(74,158,255,0.25); cursor: default; }
.nge-guide-send:not(:disabled):hover { background: rgba(74, 158, 255, 1); }
</style>
