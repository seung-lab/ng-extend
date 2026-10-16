<script setup lang="ts">
/**
 * AccessRequestPanel: "Ask for Edit Access" (Ames, 2026-10-16). The EyeWire
 * II Dataset Access form in the game: save 7 cut examples and 3 merge
 * examples straight from the view, then send them for review. Reviewers'
 * notes come back here, on each example and each point. A narrow panel on
 * the right, so the player keeps working in the view while it is open.
 * Logic: src/access_request.ts.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ACCESS_SLOTS, myAccess, loadMyAccess, viewContents, whyNot, saveExample, removeExample, submitAccess, withdrawAccess, resetAccess, flyTo,
  type AccessKind, type AccessItem } from '../access_request';
import { openStartLink } from '../util/start_link';
import { pointName } from '../access_request';
import { useDragBox } from '../util/drag_box';
import ConfirmDialog from 'components/ConfirmDialog.vue';
import { useProofreadingBackendStore } from '../store';

const emit = defineEmits({ hide: null });
const boxEl = ref<HTMLElement | null>(null);
// A slim box for laptop screens (Ames 2026-10-16): what is in view, the two
// Save buttons and Send. Remembered in this browser.
const SLIM_KEY = 'nge_access_panel_slim';
const slim = ref((() => { try { return localStorage.getItem(SLIM_KEY) === '1'; } catch { return false; } })());
function toggleSlim() { slim.value = !slim.value; try { localStorage.setItem(SLIM_KEY, slim.value ? '1' : '0'); } catch { /* private mode */ } }
const { dragging, posStyle, startDrag } = useDragBox('nge_access_panel_pos', boxEl);

const loading = ref(true);
const busy = ref('');
const message = ref('');
const messageBad = ref(false);
const note = ref('');
const ewName = ref('');
const openKey = ref('');

const request = computed(() => myAccess.value?.request ?? null);
const items = computed(() => myAccess.value?.items ?? []);
const status = computed(() => request.value?.status ?? 'draft');
const canEdit = computed(() => status.value === 'draft' || status.value === 'redo');
const itemAt = (kind: AccessKind, slot: number) => items.value.find(i => i.kind === kind && i.slot === slot);
const countOf = (kind: AccessKind) => items.value.filter(i => i.kind === kind).length;
const total = computed(() => countOf('cut') + countOf('merge'));
const redoLeft = computed(() => items.value.filter(i => i.verdict === 'redo').length);
const slots = (kind: AccessKind) => Array.from({ length: ACCESS_SLOTS[kind] }, (_, i) => i + 1);
/** Where the next save goes: a slot to redo first, else the first empty one. */
function nextSlot(kind: AccessKind): number | null {
  for (const s of slots(kind)) { const it = itemAt(kind, s); if (it?.verdict === 'redo') return s; }
  for (const s of slots(kind)) if (!itemAt(kind, s)) return s;
  return null;
}
const KINDS: AccessKind[] = ['cut', 'merge'];
/** Each slot that holds an example, for the template (no TypeScript there). */
const filled = (kind: AccessKind) => slots(kind).map(s => ({ s, it: itemAt(kind, s) })).filter((r): r is { s: number; it: AccessItem } => !!r.it);
function saveLabel(kind: AccessKind): string {
  const n = nextSlot(kind);
  if (n === null) return '';
  if (busy.value === `${kind}${n}`) return 'Saving…';
  return itemAt(kind, n) ? `Save this view as the new ${kind} ${n}` : `Save this view as ${kind} ${n}`;
}
/** Where the note goes: with the next example saved, or, once all ten are
 *  in, with the request itself when it is sent (Ames 2026-10-16). */
const noteGoes = computed(() => (nextSlot('cut') !== null || nextSlot('merge') !== null) ? 'goes with your next save' : 'sent with your request');
function saveNext(kind: AccessKind) { const n = nextSlot(kind); if (n !== null) askSave(kind, n); }

// What is in the view now, refreshed while the panel is open.
const live = ref(viewContents());
let timer: number | undefined;
onMounted(async () => {
  timer = window.setInterval(() => { live.value = viewContents(); }, 1000);
  try {
    const mine = await loadMyAccess();
    ewName.value = mine.request?.eyewire_username ?? '';
  } catch (e: any) { say(e?.message || 'Your request could not be loaded.', true); }
  finally { loading.value = false; }
});
onBeforeUnmount(() => window.clearInterval(timer));

function say(text: string, bad = false) { message.value = text; messageBad.value = bad; }

/** A save that needs a yes first (Ames 2026-10-16): several merges in one
 *  example, or a saved example about to be replaced. */
const confirming = ref<{ kind: AccessKind; slot: number; text: string; yes: string } | null>(null);
function askSave(kind: AccessKind, slot: number) {
  const reason = whyNot(kind, live.value);
  if (reason) { say(reason, true); return; }
  const merges = Math.floor(live.value.merge.length / 2);
  const old = itemAt(kind, slot);
  const parts: string[] = [];
  if (kind === 'merge' && merges > 1) parts.push(`This view has ${merges} merges queued. They will all be saved together as merge ${slot}. For separate examples, keep one merge queued per save.`);
  if (old) parts.push(`This replaces the ${kind} ${slot} you saved before${old.verdict === 'good' ? ', which the reviewer marked good' : ''}.`);
  if (!parts.length) { void save(kind, slot); return; }
  say('');
  confirming.value = { kind, slot, text: parts.join(' '), yes: old ? `Replace ${kind} ${slot}` : `Save all ${merges} as merge ${slot}` };
}
// Admins can start their own request over, to send a test again (Ames 2026-10-16).
const backend = useProofreadingBackendStore();
const askingReset = ref(false);
async function startOver() {
  askingReset.value = false;
  busy.value = 'reset';
  try { await resetAccess(); say('Started over. Your examples and their notes are gone.'); }
  catch (e: any) { say(e?.message || 'That did not work.', true); }
  finally { busy.value = ''; }
}

function confirmYes() { const c = confirming.value; confirming.value = null; if (c) void save(c.kind, c.slot); }

async function save(kind: AccessKind, slot: number) {
  const reason = whyNot(kind, live.value);
  if (reason) { say(reason, true); return; }
  busy.value = `${kind}${slot}`;
  say('');
  try {
    await saveExample(kind, slot, note.value, ewName.value);
    note.value = '';
    say(`Saved as ${kind} ${slot}. Its points were cleared from the view for the next one; the saved view keeps them.`);
  } catch (e: any) { say(e?.message || 'That could not be saved.', true); }
  finally { busy.value = ''; }
}

async function remove(kind: AccessKind, slot: number) {
  busy.value = `${kind}${slot}`;
  try { await removeExample(kind, slot); say(''); }
  catch (e: any) { say(e?.message || 'That could not be removed.', true); }
  finally { busy.value = ''; }
}

async function send() {
  if (total.value < 10) { say(`Save all ten first: ${countOf('cut')} of 7 cuts and ${countOf('merge')} of 3 merges so far.`, true); return; }
  if (redoLeft.value) { say('Redo every example marked redo first.', true); return; }
  busy.value = 'send';
  try { await submitAccess(ewName.value, note.value); note.value = ''; say('Sent. You will hear back in your notifications.'); }
  catch (e: any) { say(e?.message || 'That could not be sent.', true); }
  finally { busy.value = ''; }
}

async function takeBack() {
  busy.value = 'back';
  try { await withdrawAccess(); say('Taken back. Change any example, then send again.'); }
  catch (e: any) { say(e?.message || 'That did not work.', true); }
  finally { busy.value = ''; }
}

function open(it: AccessItem) {
  if (!openStartLink(it.link)) window.open(it.link, '_blank', 'noopener');
}

function summary(it: AccessItem): string {
  if (it.kind === 'cut') {
    const r = it.points.red?.length ?? 0, b = it.points.blue?.length ?? 0;
    return `${r} red, ${b} blue`;
  }
  const n = Math.floor((it.points.merge?.length ?? 0) / 2);
  return `${n} ${n === 1 ? 'merge' : 'merges'} placed`;
}
function pointList(it: AccessItem) {
  const out: { key: string; color: 'red' | 'blue' | 'merge'; n: string; position: number[]; mark?: 'good' | 'off' }[] = [];
  for (const color of ['red', 'blue', 'merge'] as const) {
    (it.points[color] ?? []).forEach((p, i) => out.push({ key: `${color}:${i}`, color, n: pointName(color, i), position: p.position, mark: it.point_marks?.[`${color}:${i}`] }));
  }
  return out;
}
const hasMarks = (it: AccessItem) => !!it.feedback || Object.keys(it.point_marks ?? {}).length > 0;
const liveLine = computed(() => {
  const v = live.value;
  const m = Math.floor(v.merge.length / 2);
  return `In view: ${v.red.length} red, ${v.blue.length} blue, ${m} ${m === 1 ? 'merge' : 'merges'} placed`;
});
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
</script>

<template>
  <div ref="boxEl" class="nge-acc" :class="{ 'nge-acc--dragging': dragging, 'nge-acc--slim': slim }" :style="posStyle" role="dialog" aria-label="Ask for Edit Access">
    <div class="nge-acc-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-acc-title">Retina access</span>
      <button class="nge-acc-size" :title="slim ? 'Show everything' : 'Make the box smaller'" :aria-pressed="slim" @click="toggleSlim">{{ slim ? 'Full' : 'Slim' }}</button>
      <button class="nge-acc-close" aria-label="Close" @click="emit('hide')">×</button>
    </div>

    <div v-if="loading" class="nge-acc-how">Loading your request…</div>
    <template v-else>
      <p v-if="slim && status === 'submitted'" class="nge-acc-slimline">Sent. Waiting for a review.</p>
      <p v-else-if="slim && status === 'redo'" class="nge-acc-slimline nge-acc-slimline--redo">{{ redoLeft === 1 ? '1 example' : `${redoLeft} examples` }} to redo. Full shows the notes.</p>
      <p v-else-if="slim && status === 'invited'" class="nge-acc-slimline nge-acc-slimline--yes">Your edit access has been granted!</p>
      <ul v-else-if="status === 'draft' && !slim" class="nge-acc-how nge-acc-steps">
        <li>Find ten mistakes on cells that are not tutorial cells, in the Sandbox or the retina.</li>
        <li><b>Seven cuts:</b> place red and blue Multicut (cut) points on each side of where you would cut.</li>
        <li><b>Three merges:</b> press M, then Ctrl+click the two pieces to place merge points.</li>
        <li><b>Place the cut or merge points, but do not submit the edit.</b> Then save the view here.</li>
      </ul>
      <div v-else-if="status === 'submitted' && !slim" class="nge-acc-state">
        Sent{{ request?.submitted_at ? ` on ${when(request.submitted_at)}` : '' }}. A reviewer is looking at your examples.
        You will hear back in your notifications.
        <button class="nge-acc-back" :disabled="!!busy" @click="takeBack">{{ busy === 'back' ? 'Taking back…' : 'Take them back to change' }}</button>
      </div>
      <div v-else-if="status === 'redo' && !slim" class="nge-acc-state nge-acc-state--redo">
        <b>A reviewer would like {{ redoLeft === 1 ? 'one example' : `${redoLeft} examples` }} again.</b>
        Their notes are on each one below. Redo those (you can change any of the others too), then send again.
        <p v-if="request?.reviewer_note" class="nge-acc-quote">{{ request.reviewer_note }}</p>
      </div>
      <div v-else-if="status === 'invited' && !slim" class="nge-acc-state nge-acc-state--yes">
        <b>Congratulations! Your edit access has been granted!</b> The retina is open to you for editing. If it still says View only, sign out of Pyr and back in.
        <p v-if="request?.reviewer_note" class="nge-acc-quote">{{ request.reviewer_note }}</p>
      </div>

      <div v-if="canEdit" class="nge-acc-live">{{ liveLine }}</div>

      <template v-for="kind in KINDS" :key="kind">
        <div class="nge-acc-sec">
          <span>{{ kind === 'cut' ? 'Cuts' : 'Merges' }}</span>
          <span class="nge-acc-count">{{ countOf(kind) }} of {{ ACCESS_SLOTS[kind] }}</span>
        </div>
        <div v-if="!slim" class="nge-acc-sub">{{ kind === 'cut' ? 'Two cells wrongly joined: Multicut points, not cut' : 'One cell wrongly broken in two: merge points, not merged' }}</div>
        <ul class="nge-acc-list">
          <li v-for="row in (slim ? [] : filled(kind))" :key="kind + row.s" class="nge-acc-item"
              :class="{ 'nge-acc-item--good': row.it.verdict === 'good', 'nge-acc-item--redo': row.it.verdict === 'redo' }">
            <div class="nge-acc-row">
              <button class="nge-acc-open" title="Go back to this view" @click="open(row.it)">
                <span class="nge-acc-n">{{ row.s }}</span>{{ summary(row.it) }}
              </button>
              <span v-if="row.it.verdict" class="nge-acc-verdict">{{ row.it.verdict === 'good' ? 'good' : 'redo' }}</span>
              <button v-if="hasMarks(row.it)" class="nge-acc-more" :aria-expanded="openKey === kind + row.s"
                      @click="openKey = openKey === kind + row.s ? '' : kind + row.s">{{ openKey === kind + row.s ? 'Hide notes' : 'Notes' }}</button>
              <button v-if="canEdit" class="nge-acc-rep" :disabled="!!busy" title="Put the view you are looking at in this slot"
                      @click="askSave(kind, row.s)">{{ busy === kind + row.s ? 'Saving…' : 'Replace' }}</button>
              <button v-if="canEdit" class="nge-acc-x" :disabled="!!busy"
                      :aria-label="`Remove ${kind} ${row.s}`" @click="remove(kind, row.s)">×</button>
            </div>
            <div v-if="row.it.note" class="nge-acc-note">Your note: {{ row.it.note }}</div>
            <div v-if="openKey === kind + row.s" class="nge-acc-marks">
              <p v-if="row.it.feedback" class="nge-acc-quote">{{ row.it.feedback }}</p>
              <button v-for="p in pointList(row.it)" :key="p.key" class="nge-acc-pt" :class="`nge-acc-pt--${p.color}`"
                      title="Fly to this point" @click="flyTo(p.position)">
                <span class="nge-acc-dot"></span>{{ p.n }}<span v-if="p.mark" class="nge-acc-ptmark" :class="`nge-acc-ptmark--${p.mark}`">{{ p.mark }}</span>
              </button>
            </div>
          </li>
          <li v-if="canEdit && nextSlot(kind) !== null">
            <button class="nge-acc-save" :disabled="!!busy" @click="saveNext(kind)">{{ saveLabel(kind) }}</button>
          </li>
          <!-- The yes, right under the button that asked for it. -->
          <li v-if="confirming && confirming.kind === kind" class="nge-acc-confirm" role="alertdialog" aria-label="Confirm the save">
            <p>{{ confirming.text }}</p>
            <div class="nge-acc-confirm-btns">
              <button class="nge-acc-confirm-yes" @click="confirmYes">{{ confirming.yes }}</button>
              <button class="nge-acc-confirm-no" @click="confirming = null">Cancel</button>
            </div>
          </li>
        </ul>
      </template>

      <template v-if="canEdit">
        <label v-if="!slim" class="nge-acc-label">Note for the reviewer, {{ noteGoes }} (optional)
          <textarea v-model="note" class="nge-acc-input" rows="2" maxlength="1000" placeholder="Where the merger starts, what you checked"></textarea>
        </label>
        <label v-if="!slim" class="nge-acc-label">Your EyeWire username (optional)
          <input v-model="ewName" class="nge-acc-input" maxlength="60" />
        </label>
        <button class="nge-acc-send" :disabled="busy === 'send'" @click="send">
          {{ busy === 'send' ? 'Sending…' : `Send for review (${total} of 10)` }}
        </button>
      </template>

      <p v-if="message" class="nge-acc-msg" :class="{ 'nge-acc-msg--bad': messageBad }" role="status">{{ message }}</p>
      <div v-if="backend.isAdmin && request && !slim" class="nge-acc-admin">
        <button class="nge-acc-rep" :disabled="!!busy" @click="askingReset = true">Start over (admins, for testing)</button>
        <ConfirmDialog v-if="askingReset" title="Start over?"
          text="This deletes your request, its ten examples and every mark and note on them, for good. It cannot be undone."
          yes="Delete for good" @yes="startOver" @no="askingReset = false" />
      </div>
      <p v-if="!slim" class="nge-acc-help">
        Taking more than one try is normal. You are never locked out.
        <a href="https://connectome.quest/blog/post.html?p=getting-access-to-the-retina" target="_blank" rel="noopener">How access works ↗</a>
      </p>
    </template>
  </div>
</template>

<style scoped>
.nge-acc {
  position: fixed; right: 16px; top: 64px; z-index: 9000;
  width: 380px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(124, 255, 178, 0.35);
  border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 15px;
}
.nge-acc-head { display: flex; align-items: center; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 0; padding: 12px 14px 4px; }
.nge-acc--dragging .nge-acc-head { cursor: grabbing; }
.nge-acc-title { font-size: 17px; font-weight: 600; color: #7CFFB2; }
.nge-acc-close { margin-left: auto; background: none; border: none; color: rgba(255, 255, 255, 0.55); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-acc-close:hover { color: #fff; }
.nge-acc-size { margin-left: auto; margin-right: 8px; font: inherit; font-size: 13px; color: rgba(220, 230, 245, 0.8); background: none; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 6px; padding: 1px 8px; cursor: pointer; }
.nge-acc-size:hover { color: #fff; border-color: rgba(255, 255, 255, 0.45); }
.nge-acc-size + .nge-acc-close { margin-left: 0; }
.nge-acc-steps { padding-left: 18px; }
.nge-acc-steps li { margin: 3px 0; }
.nge-acc--slim { width: 270px; }
.nge-acc--slim .nge-acc-sec { margin-top: 6px; }
.nge-acc--slim .nge-acc-save { padding: 4px 8px; }
.nge-acc--slim .nge-acc-send { margin-top: 8px; }
.nge-acc-slimline { margin: 6px 0; color: rgba(220, 230, 245, 0.85); }
.nge-acc-slimline--redo { color: #f5d142; }
.nge-acc-slimline--yes { color: #7CFFB2; }
.nge-acc-how { margin: 8px 0 10px; line-height: 1.45; color: rgba(220, 230, 245, 0.78); }
.nge-acc-how b { color: #fff; font-weight: 600; }
.nge-acc-state { margin: 8px 0 10px; padding: 8px 10px; border-radius: 8px; line-height: 1.45; background: rgba(255, 255, 255, 0.05); }
.nge-acc-state--redo { background: rgba(245, 209, 66, 0.1); border: 1px solid rgba(245, 209, 66, 0.35); }
.nge-acc-state--yes { background: rgba(124, 255, 178, 0.1); border: 1px solid rgba(124, 255, 178, 0.4); }
.nge-acc-quote { margin: 6px 0 0; padding: 6px 8px; border-left: 2px solid rgba(255, 255, 255, 0.3); border-radius: 0; white-space: pre-wrap; color: #e9eef7; }
.nge-acc-live { font-size: 14px; color: rgba(220, 230, 245, 0.74); margin-bottom: 4px; }
.nge-acc-sec { display: flex; justify-content: space-between; margin-top: 10px; font-weight: 600; color: #fff; }
.nge-acc-count { font-weight: 500; color: rgba(220, 230, 245, 0.7); }
.nge-acc-sub { font-size: 14px; color: rgba(220, 230, 245, 0.72); margin-bottom: 4px; }
.nge-acc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.nge-acc-item { border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 4px 6px; }
.nge-acc-item--good { border-color: rgba(124, 255, 178, 0.45); }
.nge-acc-item--redo { border-color: rgba(245, 209, 66, 0.6); }
.nge-acc-row { display: flex; align-items: center; gap: 6px; }
.nge-acc-open { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; background: none; border: none; color: #dce6f5; cursor: pointer; padding: 2px 0; font: inherit; }
.nge-acc-open:hover { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
.nge-acc-n { display: inline-block; width: 22px; color: rgba(220, 230, 245, 0.72); }
.nge-acc-verdict { font-size: 13px; padding: 1px 6px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); }
.nge-acc-item--good .nge-acc-verdict { color: #7CFFB2; }
.nge-acc-item--redo .nge-acc-verdict { color: #f5d142; }
.nge-acc-back { display: block; margin-top: 8px; font: inherit; font-size: 14px; color: #c9ffe0; background: none; border: 1px solid rgba(124, 255, 178, 0.45); border-radius: 6px; padding: 3px 9px; cursor: pointer; }
.nge-acc-rep { font: inherit; font-size: 13px; color: rgba(220, 230, 245, 0.75); background: none; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; padding: 0 6px; cursor: pointer; }
.nge-acc-rep:hover { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
.nge-acc-more, .nge-acc-x { background: none; border: none; color: rgba(220, 230, 245, 0.7); cursor: pointer; font: inherit; font-size: 14px; padding: 0 2px; }
.nge-acc-x { font-size: 19px; line-height: 1; }
.nge-acc-more:hover, .nge-acc-x:hover { color: #fff; }
.nge-acc-note { font-size: 14px; color: rgba(220, 230, 245, 0.74); margin: 2px 0 0 22px; }
.nge-acc-marks { margin: 4px 0 2px 22px; display: flex; flex-wrap: wrap; gap: 4px; }
.nge-acc-marks .nge-acc-quote { flex-basis: 100%; margin: 0 0 4px; }
.nge-acc-pt { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 14px; color: #dce6f5; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 1px 6px; cursor: pointer; }
.nge-acc-pt:hover { border-color: rgba(255, 255, 255, 0.35); }
.nge-acc-dot { width: 8px; height: 8px; border-radius: 50%; }
.nge-acc-pt--red .nge-acc-dot { background: #e06060; }
.nge-acc-pt--blue .nge-acc-dot { background: #5aa0ff; }
.nge-acc-pt--merge .nge-acc-dot { background: #ff7ad9; }
.nge-acc-ptmark { font-size: 13px; }
.nge-acc-ptmark--good { color: #7CFFB2; }
.nge-acc-ptmark--off { color: #f5d142; }
.nge-acc-save, .nge-acc-send {
  width: 100%; font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 8px;
  background: rgba(124, 255, 178, 0.08); border: 1px dashed rgba(124, 255, 178, 0.45); color: #c9ffe0;
}
.nge-acc-save:hover { background: rgba(124, 255, 178, 0.16); }
.nge-acc-send { margin-top: 10px; border-style: solid; background: rgba(124, 255, 178, 0.18); color: #fff; font-weight: 600; }
.nge-acc-send:hover { background: rgba(124, 255, 178, 0.28); }
.nge-acc-save:disabled, .nge-acc-send:disabled { opacity: 0.6; cursor: wait; }
.nge-acc-label { display: block; margin-top: 10px; font-size: 14px; color: rgba(220, 230, 245, 0.7); }
.nge-acc-input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; font: inherit; font-size: 15px; color: #fff; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; padding: 5px 7px; resize: vertical; }
.nge-acc-msg { margin: 8px 0 0; color: #7CFFB2; }
.nge-acc-admin { margin-top: 10px; }
.nge-acc-confirm { margin-top: 4px; padding: 8px 10px; border-radius: 8px; background: rgba(245, 209, 66, 0.1); border: 1px solid rgba(245, 209, 66, 0.5); line-height: 1.45; }
.nge-acc-confirm p { margin: 0 0 8px; }
.nge-acc-confirm-btns { display: flex; gap: 8px; justify-content: flex-end; }
.nge-acc-confirm-yes, .nge-acc-confirm-no { font: inherit; font-size: 14px; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
.nge-acc-confirm-yes { color: #fff; background: rgba(245, 209, 66, 0.22); border: 1px solid rgba(245, 209, 66, 0.7); font-weight: 600; }
.nge-acc-confirm-no { color: #dce6f5; background: none; border: 1px solid rgba(255, 255, 255, 0.25); }
.nge-acc-msg--bad { color: #f5d142; }
.nge-acc-help { margin: 10px 0 0; font-size: 14px; color: rgba(220, 230, 245, 0.72); }
.nge-acc-help a { color: #9fd3ff; }
</style>
