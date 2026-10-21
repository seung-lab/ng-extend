<script setup lang="ts">
/**
 * TestQueueCard: a player's place in the Proofreading Test line (Ames,
 * 2026-10-21: "we need a queue"). Top left while they wait: their place and
 * a rough wait, and Leave the line. When their turn comes the card says so,
 * counts down the 10 minutes the cell is held for them, and starts the test.
 * The rules are on the server; src/proofreading-test.ts joins and leaves.
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import { testStatus, refreshTestStatus, leaveLine, startTest, currentTest, ordinal, waitWords, queueBusy, queueError } from '../proofreading-test';

const q = computed(() => testStatus.value?.queue ?? null);
const working = computed(() => ['claiming', 'working', 'scoring'].includes(currentTest().phase));
const inLine = computed(() => !!q.value?.position && !working.value);
const called = computed(() => !!q.value?.called_until);
/** Said once when a player's place goes without them taking the cell. */
const gone = ref('');
const leaving = ref(false);

// While in line: look every 30 seconds, every second for the countdown.
const now = ref(Date.now());
let poll: ReturnType<typeof setInterval> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
watch(inLine, on => {
  if (on && !poll) poll = setInterval(() => { void refreshTestStatus(); }, 30_000);
  if (!on && poll) { clearInterval(poll); poll = null; }
}, { immediate: true });
watch(called, on => {
  if (on && !tick) tick = setInterval(() => {
    now.value = Date.now();
    if (q.value?.called_until && Date.parse(q.value.called_until) <= now.value) void refreshTestStatus();
  }, 1000);
  if (!on && tick) { clearInterval(tick); tick = null; }
}, { immediate: true });
onUnmounted(() => { if (poll) clearInterval(poll); if (tick) clearInterval(tick); });

// A turn that ran out, or an admin taking them out of the line.
watch(() => [q.value?.position ?? null, q.value?.called_until ?? null, working.value] as const, (cur, before) => {
  if (!before) return;
  const [pos, , isWorking] = cur;
  const [hadPos, wasCalled] = before;
  if (hadPos && !pos && !isWorking && !leaving.value) {
    gone.value = wasCalled ? 'Your turn for the Proofreading Test ran out, so you left the line. Join again from the menu when you are ready.' : 'You are no longer in the Proofreading Test line. Join again from the menu.';
  }
  if (pos) gone.value = '';
});

const left = computed(() => {
  if (!q.value?.called_until) return '';
  const s = Math.max(0, Math.ceil((Date.parse(q.value.called_until) - now.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
async function leave() { leaving.value = true; await leaveLine(); leaving.value = false; }
function start() { void startTest(1); }
</script>

<template>
  <div v-if="inLine || gone" class="ng-extend nge-tqc" :class="{ 'nge-tqc--turn': called }" role="status" aria-live="polite">
    <template v-if="inLine && q">
      <div class="nge-tqc-eyebrow">Proofreading Test</div>
      <template v-if="called">
        <p class="nge-tqc-main">It is your turn. The cell is held for you for <b class="nge-tqc-time">{{ left }}</b>.</p>
        <div class="nge-tqc-btns">
          <button type="button" class="nge-hud-btn nge-hud-btn--sm nge-hud-btn--go" @click="start">Start the test</button>
          <button type="button" class="nge-hud-btn nge-hud-btn--sm nge-hud-btn--quiet" :disabled="queueBusy" title="Give your turn to the next player" @click="leave">Not now</button>
        </div>
      </template>
      <template v-else>
        <p class="nge-tqc-main">You are <b>{{ ordinal(q.position || 1) }}</b> in line.</p>
        <p class="nge-tqc-sub">{{ waitWords(q) }}</p>
        <div class="nge-tqc-btns">
          <button type="button" class="nge-hud-btn nge-hud-btn--sm nge-hud-btn--quiet" :disabled="queueBusy" @click="leave">Leave the line</button>
        </div>
      </template>
      <p v-if="queueError" class="nge-tqc-err" role="alert">{{ queueError }}</p>
    </template>
    <template v-else>
      <p class="nge-tqc-sub">{{ gone }}</p>
      <div class="nge-tqc-btns"><button type="button" class="nge-hud-btn nge-hud-btn--sm" @click="gone = ''">OK</button></div>
    </template>
  </div>
</template>

<style scoped>
.nge-tqc {
  position: fixed; top: 64px; left: 12px; z-index: 60;
  width: 300px; max-width: calc(100vw - 24px); box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid rgba(126, 224, 255, 0.45); border-radius: 10px;
  background: rgba(8, 16, 28, 0.92); color: #d8f3ff; backdrop-filter: blur(4px);
  font-family: Inter, system-ui, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.45;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.nge-tqc--turn { border-color: rgba(124, 255, 178, 0.75); box-shadow: 0 0 0 1px rgba(124, 255, 178, 0.25), 0 8px 28px rgba(0, 0, 0, 0.45); }
.nge-tqc-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #7ee0ff; margin-bottom: 4px; }
.nge-tqc--turn .nge-tqc-eyebrow { color: #7CFFB2; }
.nge-tqc-main { margin: 0; color: #e8f6ff; }
.nge-tqc-sub { margin: 4px 0 0; color: rgba(216, 243, 255, 0.75); }
.nge-tqc-time { font-variant-numeric: tabular-nums; color: #7CFFB2; }
.nge-tqc-btns { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
.nge-tqc-btns .nge-hud-btn { margin: 0; border-radius: 999px; }
.nge-tqc-err { margin: 6px 0 0; color: #f5d142; }
</style>
