<script setup lang="ts">
// AssistantDock.vue — the EyeWire II Guide chat dock. A slim floating panel
// that answers questions and drives the UI. It posts to the guideAssistant
// Cloud Function and runs the returned actions through the allow-list in
// dispatch(). Styling mirrors ChatPanel.vue.

import { ref, nextTick, watch } from "vue";
import { marked } from "marked";
import { buildAppContext, type UiState } from "../assistant/context";
import { dispatch } from "../assistant/dispatch";
import type { AssistantAction } from "../assistant/actions";

const props = defineProps<{
  show: boolean;
  // Panel/tool state owned by ExtensionBar, read fresh on each send.
  uiState?: UiState;
}>();
const emit = defineEmits<{ (e: "hide"): void }>();

// Stable alias URL for the v2 function (works regardless of the Cloud Run hash).
const GUIDE_URL =
  (window as any).__NGE_GUIDE_URL ||
  "https://us-central1-ytho-4bff2.cloudfunctions.net/guideAssistant";

interface Msg { role: "user" | "assistant"; text: string; }

const messages = ref<Msg[]>([]);
const input = ref("");
const loading = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

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

  let appContext = {};
  try {
    appContext = buildAppContext(props.uiState || {});
  } catch (e) {
    console.warn("[assistant] buildAppContext failed:", e);
  }

  try {
    const resp = await fetch(GUIDE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, appContext }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const reply: string = data?.reply || "…";
    const actions: AssistantAction[] = Array.isArray(data?.actions) ? data.actions : [];

    messages.value.push({ role: "assistant", text: reply });
    // Run allow-listed UI actions after the reply is shown.
    dispatch(actions);
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

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
</script>

<template>
  <div v-if="show" class="nge-guide">
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
        <div v-else class="nge-guide-bubble nge-guide-bubble--bot" v-html="renderMarkdown(msg.text)"></div>
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
.nge-guide-send {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 6px;
  background: rgba(74, 158, 255, 0.85); color: #fff; border: none;
  cursor: pointer; font-size: 15px; font-weight: 700;
}
.nge-guide-send:disabled { background: rgba(74,158,255,0.25); cursor: default; }
.nge-guide-send:not(:disabled):hover { background: rgba(74, 158, 255, 1); }
</style>
