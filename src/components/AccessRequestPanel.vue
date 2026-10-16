<script setup lang="ts">
/**
 * AccessRequestPanel: "Ask for retina access" (Ames, 2026-10-16). The EyeWire
 * II Dataset Access form in the game: save 7 cut examples and 3 merge
 * examples straight from the view, then send them for review. Reviewers'
 * notes come back here, on each example and each point. A narrow panel on
 * the right, so the player keeps working in the view while it is open.
 * Logic: src/access_request.ts.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ACCESS_SLOTS, myAccess, loadMyAccess, viewContents, whyNot, saveExample, removeExample, submitAccess, withdrawAccess, flyTo,
  type AccessKind, type AccessItem } from '../access_request';
import { openStartLink } from '../util/start_link';
import { useDragBox } from '../util/drag_box';

const emit = defineEmits({ hide: null });
const boxEl = ref<HTMLElement | null>(null);
const { dragging, posStyle, startDrag } = useDragBox('nge_access_panel_pos', boxEl);

const loading = ref(true);
const busy = ref('');
const message = ref('');
const messageBad = ref(false);
const note = ref('');
const affiliation = ref('');
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
function saveNext(kind: AccessKind) { const n = nextSlot(kind); if (n !== null) void save(kind, n); }

// What is in the view now, refreshed while the panel is open.
const live = ref(viewContents());
let timer: number | undefined;
onMounted(async () => {
  timer = window.setInterval(() => { live.value = viewContents(); }, 1000);
  try {
    const mine = await loadMyAccess();
    affiliation.value = mine.request?.affiliation ?? '';
  } catch (e: any) { say(e?.message || 'Your request could not be loaded.', true); }
  finally { loading.value = false; }
});
onBeforeUnmount(() => window.clearInterval(timer));

function say(text: string, bad = false) { message.value = text; messageBad.value = bad; }

async function save(kind: AccessKind, slot: number) {
  const reason = whyNot(kind, live.value);
  if (reason) { say(reason, true); return; }
  busy.value = `${kind}${slot}`;
  say('');
  try {
    await saveExample(kind, slot, note.value, affiliation.value);
    note.value = '';
    say(`Saved as ${kind} ${slot}.`);
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
  try { await submitAccess(affiliation.value); say('Sent. You will hear back in your notifications.'); }
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
  return `${it.segments.length} pieces shown`;
}
function pointList(it: AccessItem) {
  const out: { key: string; color: 'red' | 'blue'; n: number; position: number[]; mark?: 'good' | 'off' }[] = [];
  for (const color of ['red', 'blue'] as const) {
    (it.points[color] ?? []).forEach((p, i) => out.push({ key: `${color}:${i}`, color, n: i + 1, position: p.position, mark: it.point_marks?.[`${color}:${i}`] }));
  }
  return out;
}
const hasMarks = (it: AccessItem) => !!it.feedback || Object.keys(it.point_marks ?? {}).length > 0;
const liveLine = computed(() => {
  const v = live.value;
  return `In view: ${v.red.length} red, ${v.blue.length} blue ${v.red.length + v.blue.length === 1 ? 'point' : 'points'}, ${v.segments.length} ${v.segments.length === 1 ? 'piece' : 'pieces'} shown`;
});
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
</script>

<template>
  <div ref="boxEl" class="nge-acc" :class="{ 'nge-acc--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Ask for retina access">
    <div class="nge-acc-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-acc-title">Retina access</span>
      <button class="nge-acc-close" aria-label="Close" @click="emit('hide')">×</button>
    </div>

    <div v-if="loading" class="nge-acc-how">Loading your request…</div>
    <template v-else>
      <p v-if="status === 'draft'" class="nge-acc-how">
        Find ten mistakes on cells that are not tutorial cells, in the Sandbox or the retina.
        <b>Suggest each one, do not edit it.</b> Seven cuts: place red and blue Multicut points where you would cut.
        Three merges: show both pieces you would join. Then save the view here.
      </p>
      <div v-else-if="status === 'submitted'" class="nge-acc-state">
        Sent{{ request?.submitted_at ? ` on ${when(request.submitted_at)}` : '' }}. A reviewer is looking at your examples.
        You will hear back in your notifications.
        <button class="nge-acc-back" :disabled="!!busy" @click="takeBack">{{ busy === 'back' ? 'Taking back…' : 'Take them back to change' }}</button>
      </div>
      <div v-else-if="status === 'redo'" class="nge-acc-state nge-acc-state--redo">
        <b>A reviewer would like {{ redoLeft === 1 ? 'one example' : `${redoLeft} examples` }} again.</b>
        Their notes are on each one below. Redo those (you can change any of the others too), then send again.
        <p v-if="request?.reviewer_note" class="nge-acc-quote">{{ request.reviewer_note }}</p>
      </div>
      <div v-else-if="status === 'invited'" class="nge-acc-state nge-acc-state--yes">
        <b>You are invited to the retina!</b> If it still says View only, sign out and in again.
        <p v-if="request?.reviewer_note" class="nge-acc-quote">{{ request.reviewer_note }}</p>
      </div>

      <div v-if="canEdit" class="nge-acc-live">{{ liveLine }}</div>

      <template v-for="kind in KINDS" :key="kind">
        <div class="nge-acc-sec">
          <span>{{ kind === 'cut' ? 'Cuts' : 'Merges' }}</span>
          <span class="nge-acc-count">{{ countOf(kind) }} of {{ ACCESS_SLOTS[kind] }}</span>
        </div>
        <div class="nge-acc-sub">{{ kind === 'cut' ? 'Two cells wrongly joined' : 'One cell wrongly broken in two' }}</div>
        <ul class="nge-acc-list">
          <li v-for="row in filled(kind)" :key="kind + row.s" class="nge-acc-item"
              :class="{ 'nge-acc-item--good': row.it.verdict === 'good', 'nge-acc-item--redo': row.it.verdict === 'redo' }">
            <div class="nge-acc-row">
              <button class="nge-acc-open" title="Go back to this view" @click="open(row.it)">
                <span class="nge-acc-n">{{ row.s }}</span>{{ summary(row.it) }}
              </button>
              <span v-if="row.it.verdict" class="nge-acc-verdict">{{ row.it.verdict === 'good' ? 'good' : 'redo' }}</span>
              <button v-if="hasMarks(row.it)" class="nge-acc-more" :aria-expanded="openKey === kind + row.s"
                      @click="openKey = openKey === kind + row.s ? '' : kind + row.s">{{ openKey === kind + row.s ? 'Hide notes' : 'Notes' }}</button>
              <button v-if="canEdit" class="nge-acc-rep" :disabled="!!busy" title="Put the view you are looking at in this slot"
                      @click="save(kind, row.s)">{{ busy === kind + row.s ? 'Saving…' : 'Replace' }}</button>
              <button v-if="canEdit" class="nge-acc-x" :disabled="!!busy"
                      :aria-label="`Remove ${kind} ${row.s}`" @click="remove(kind, row.s)">×</button>
            </div>
            <div v-if="row.it.note" class="nge-acc-note">Your note: {{ row.it.note }}</div>
            <div v-if="openKey === kind + row.s" class="nge-acc-marks">
              <p v-if="row.it.feedback" class="nge-acc-quote">{{ row.it.feedback }}</p>
              <button v-for="p in pointList(row.it)" :key="p.key" class="nge-acc-pt" :class="`nge-acc-pt--${p.color}`"
                      title="Fly to this point" @click="flyTo(p.position)">
                <span class="nge-acc-dot"></span>{{ p.color }} {{ p.n }}<span v-if="p.mark" class="nge-acc-ptmark" :class="`nge-acc-ptmark--${p.mark}`">{{ p.mark }}</span>
              </button>
            </div>
          </li>
          <li v-if="canEdit && nextSlot(kind) !== null">
            <button class="nge-acc-save" :disabled="!!busy" @click="saveNext(kind)">{{ saveLabel(kind) }}</button>
          </li>
        </ul>
      </template>

      <template v-if="canEdit">
        <label class="nge-acc-label">Note for the reviewer, with the next save (optional)
          <textarea v-model="note" class="nge-acc-input" rows="2" maxlength="1000" placeholder="Where the merger starts, what you checked"></textarea>
        </label>
        <label class="nge-acc-label">Lab or institute, for researchers (optional)
          <input v-model="affiliation" class="nge-acc-input" maxlength="200" />
        </label>
        <button class="nge-acc-send" :disabled="busy === 'send'" @click="send">
          {{ busy === 'send' ? 'Sending…' : `Send for review (${total} of 10)` }}
        </button>
      </template>

      <p v-if="message" class="nge-acc-msg" :class="{ 'nge-acc-msg--bad': messageBad }" role="status">{{ message }}</p>
      <p class="nge-acc-help">
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
.nge-acc-msg--bad { color: #f5d142; }
.nge-acc-help { margin: 10px 0 0; font-size: 14px; color: rgba(220, 230, 245, 0.72); }
.nge-acc-help a { color: #9fd3ff; }
</style>
