<script setup lang="ts">
/**
 * AccessRequestsTab: Admin Hub > Access requests (Ames, 2026-10-16). Each
 * player's ten examples for retina access. Open one in the view to judge
 * every point (AccessReviewBar), mark examples good or redo, then ask for
 * redos or invite. An invite adds the player to the pilot testers; the CAVE
 * group (Eyewire_2_Edit) is still given by hand, and the tab says so.
 */
import { ref, computed, onMounted } from 'vue';
import ConfirmDialog from 'components/ConfirmDialog.vue';
import { listAccessRequests, reviewAccessItem, decideAccess, reviewInView, reviewing, resetAccess,
  type AccessRequest, type AccessItem, type AccessFilter } from '../access_request';

const filter = ref<AccessFilter>('open');
const FILTERS: AccessFilter[] = ['open', 'submitted', 'invited', 'all'];
const requests = ref<AccessRequest[]>([]);
const loading = ref(false);
const error = ref('');
const openId = ref<number | null>(null);
const notes = ref<Record<number, string>>({});
const busy = ref('');
const done = ref<Record<number, string>>({});

async function load() {
  loading.value = true; error.value = ''; done.value = {};
  try {
    requests.value = await listAccessRequests(filter.value);
    // Back from the view: the request just reviewed stays open.
    if (reviewing.value) openId.value = reviewing.value.request.id;
    else if (requests.value.length === 1) openId.value = requests.value[0].id;
  } catch (e: any) { error.value = e?.message || 'The requests could not be loaded.'; }
  finally { loading.value = false; }
}
onMounted(load);
function setFilter(f: AccessFilter) { filter.value = f; void load(); }

const statusWord: Record<string, string> = { submitted: 'Waiting', redo: 'Redos asked', invited: 'Granted', draft: 'Collecting' };
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const sorted = (r: AccessRequest) => [...(r.items ?? [])].sort((a, b) => (a.kind === b.kind ? a.slot - b.slot : a.kind === 'cut' ? -1 : 1));
/** Changed by the player since the last answer was sent (Ames 2026-10-16:
 *  "which one did she redo?"). */
const isNew = (r: AccessRequest, it: AccessItem) => !!(r.reviewed_at && it.saved_at && it.saved_at > r.reviewed_at);
function waitingLine(r: AccessRequest): string {
  if (r.status !== 'redo') return '';
  const items = r.items ?? [];
  const changed = items.filter(i => isNew(r, i)).map(i => `${i.kind} ${i.slot}`);
  const left = items.filter(i => i.verdict === 'redo').map(i => `${i.kind} ${i.slot}`);
  const who = r.player_name || 'The player';
  return `Waiting for ${who} to send again. ${changed.length ? `Changed so far: ${changed.join(', ')}.` : 'Nothing changed yet.'}${left.length ? ` Still to redo: ${left.join(', ')}.` : ''} You can mark examples once it is sent.`;
}
const openEarlier = ref<Record<string, boolean>>({});
function summary(it: AccessItem): string {
  if (it.kind === 'cut') return `${it.points.red?.length ?? 0} red, ${it.points.blue?.length ?? 0} blue`;
  const n = Math.floor((it.points.merge?.length ?? 0) / 2);
  return `${n} ${n === 1 ? 'merge' : 'merges'} placed`;
}
function markCount(it: AccessItem) {
  const m = Object.values(it.point_marks ?? {});
  return { good: m.filter(x => x === 'good').length, off: m.filter(x => x === 'off').length };
}
const counts = (r: AccessRequest) => {
  const items = r.items ?? [];
  return { good: items.filter(i => i.verdict === 'good').length, redo: items.filter(i => i.verdict === 'redo').length, open: items.filter(i => !i.verdict).length };
};

async function setVerdict(r: AccessRequest, it: AccessItem, verdict: 'good' | 'redo') {
  if (!it.id) return;
  busy.value = `v${it.id}`;
  try {
    const saved = await reviewAccessItem(it.id, { verdict: it.verdict === verdict ? null : verdict });
    Object.assign(it, saved);
  } catch (e: any) { error.value = e?.message || 'That mark was not saved.'; }
  finally { busy.value = ''; }
}

/** Requests whose grant needs the reviewer's own CAVE step (no CAVE id kept). */
const needsHand = ref<Record<number, boolean>>({});
async function decide(r: AccessRequest, outcome: 'redo' | 'invited', byHand = false) {
  busy.value = `d${r.id}`; error.value = '';
  try {
    const out = await decideAccess(r.id, outcome, notes.value[r.id] || '', byHand);
    Object.assign(r, out);
    done.value[r.id] = outcome === 'invited'
      ? (out.cave_granted
        ? `Access granted: ${r.player_name || r.email} is in Eyewire_2_Edit, on the pilot testers, and was told.`
        : `Access granted by hand: ${r.player_name || r.email} is on the pilot testers and was told.`)
      : `Sent. ${r.player_name} will redo ${out.redos === 1 ? 'one example' : `${out.redos} examples`}.`;
  } catch (e: any) {
    error.value = e?.message || 'That was not sent.';
    if (/no CAVE id/.test(error.value)) needsHand.value[r.id] = true;
  }
  finally { busy.value = ''; }
}
// Delete a request, for a test or a player who wants a clean slate.
const askingDelete = ref<number | null>(null);
async function remove(r: AccessRequest) {
  askingDelete.value = null;
  busy.value = `x${r.id}`; error.value = '';
  try { await resetAccess(r.id); requests.value = requests.value.filter(x => x.id !== r.id); }
  catch (e: any) { error.value = e?.message || 'That request was not deleted.'; }
  finally { busy.value = ''; }
}
const waiting = computed(() => requests.value.filter(r => r.status === 'submitted').length);
</script>

<template>
  <section class="nge-accr">
    <div class="nge-accr-top">
      <h2>Access requests</h2>
      <span class="nge-accr-sub">{{ waiting }} waiting for a review</span>
      <button class="nge-accr-filter nge-accr-refresh" :disabled="loading" title="Look for new requests" @click="load">Refresh</button>
      <div class="nge-accr-filters" role="tablist">
        <button v-for="f in FILTERS" :key="f" class="nge-accr-filter"
                :class="{ 'nge-accr-filter--on': filter === f }" role="tab" :aria-selected="filter === f" @click="setFilter(f)">
          {{ f === 'open' ? 'Open' : f === 'submitted' ? 'Waiting' : f === 'invited' ? 'Granted' : 'All' }}
        </button>
      </div>
    </div>
    <p class="nge-accr-how">
      Each player sends 7 cuts (red and blue Multicut points where they would cut) and 3 merges (merge points on the two pieces), placed but not submitted.
      Open an example in the view to judge every point, mark it good or redo, then ask for redos or grant edit access.
    </p>
    <p v-if="error" class="nge-accr-err" role="alert">{{ error }}</p>
    <p v-if="loading" class="nge-accr-how">Loading…</p>
    <p v-else-if="!requests.length && !error" class="nge-accr-how">No requests here.</p>

    <article v-for="r in requests" :key="r.id" class="nge-accr-card" :class="`nge-accr-card--${r.status}`">
      <button class="nge-accr-head" :aria-expanded="openId === r.id" @click="openId = openId === r.id ? null : r.id">
        <span class="nge-accr-name">{{ r.player_name || r.email }}</span>
        <span class="nge-accr-meta">{{ r.email }}<template v-if="r.eyewire_username"> · EyeWire: {{ r.eyewire_username }}</template><template v-else-if="r.affiliation"> · {{ r.affiliation }}</template></span>
        <span class="nge-accr-meta">Sent {{ when(r.submitted_at) }}<template v-if="r.tries > 1"> · try {{ r.tries }}</template></span>
        <span class="nge-accr-status">{{ statusWord[r.status] || r.status }}</span>
        <span class="nge-accr-tally">{{ counts(r).good }} good · {{ counts(r).redo }} redo · {{ counts(r).open }} to check</span>
      </button>

      <div v-if="openId === r.id" class="nge-accr-body">
        <p v-if="waitingLine(r)" class="nge-accr-waiting">{{ waitingLine(r) }}</p>
        <p v-if="r.player_note" class="nge-accr-note">Player's note: {{ r.player_note }}</p>
        <table class="nge-accr-table">
          <tbody>
            <tr v-for="(it, i) in sorted(r)" :key="it.id" :class="{ 'nge-accr-row--good': it.verdict === 'good', 'nge-accr-row--redo': it.verdict === 'redo' }">
              <td class="nge-accr-kind">{{ it.kind === 'cut' ? 'Cut' : 'Merge' }} {{ it.slot }}
                <span v-if="isNew(r, it)" class="nge-accr-new">new since your review</span></td>
              <td>
                {{ summary(it) }}
                <span v-if="markCount(it).good || markCount(it).off" class="nge-accr-marks">
                  · points {{ markCount(it).good }} good, {{ markCount(it).off }} off
                </span>
                <div v-if="it.note" class="nge-accr-note">Player: {{ it.note }}</div>
                <div v-if="it.feedback" class="nge-accr-note nge-accr-note--you">Note: {{ it.feedback }}</div>
                <button v-if="it.earlier && it.earlier.length" class="nge-accr-earlier-btn"
                        @click="openEarlier[`${r.id}${it.kind}${it.slot}`] = !openEarlier[`${r.id}${it.kind}${it.slot}`]">
                  {{ it.earlier.length === 1 ? '1 earlier try' : `${it.earlier.length} earlier tries` }} {{ openEarlier[`${r.id}${it.kind}${it.slot}`] ? '▴' : '▾' }}</button>
                <div v-if="openEarlier[`${r.id}${it.kind}${it.slot}`]" class="nge-accr-earlier">
                  <div v-for="(h, hi) in it.earlier" :key="hi" class="nge-accr-earlier-row">
                    <span>Try {{ h.try || hi + 1 }}: {{ summary(h) }}<template v-if="h.verdict">, marked {{ h.verdict }}</template></span>
                    <a class="nge-accr-link" :href="h.link" target="_blank" rel="noopener" title="Open that earlier example in a new tab">open ↗</a>
                    <div v-if="h.note" class="nge-accr-note">Player: {{ h.note }}</div>
                    <div v-if="h.feedback" class="nge-accr-note nge-accr-note--you">Note: {{ h.feedback }}</div>
                  </div>
                </div>
              </td>
              <td class="nge-accr-acts">
                <button class="nge-accr-btn" @click="reviewInView({ ...r, items: sorted(r) }, i)">Review in the view</button>
                <a class="nge-accr-link" :href="it.link" target="_blank" rel="noopener" title="Open the link in a new tab">↗</a>
                <button class="nge-accr-btn nge-accr-btn--good" :class="{ 'nge-accr-btn--on': it.verdict === 'good' }"
                        :disabled="busy === `v${it.id}` || r.status !== 'submitted'" @click="setVerdict(r, it, 'good')">Good</button>
                <button class="nge-accr-btn nge-accr-btn--redo" :class="{ 'nge-accr-btn--on': it.verdict === 'redo' }"
                        :disabled="busy === `v${it.id}` || r.status !== 'submitted'" @click="setVerdict(r, it, 'redo')">Redo</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="r.status === 'submitted'" class="nge-accr-decide">
          <label>Note to {{ r.player_name || 'the player' }} (optional, goes with your answer)
            <textarea v-model="notes[r.id]" rows="3" maxlength="4000"></textarea>
          </label>
          <p class="nge-accr-cave">Grant edit access adds <b>{{ r.email }}</b> to Eyewire_2_Edit in CAVE, then tells them. If CAVE says no, nothing is sent.</p>
          <div class="nge-accr-decide-btns">
            <button class="nge-accr-btn" :disabled="busy === `d${r.id}`" @click="decide(r, 'redo')">Ask for redos ({{ counts(r).redo }})</button>
            <button class="nge-accr-btn nge-accr-btn--invite" :disabled="busy === `d${r.id}`" @click="decide(r, 'invited')">Grant edit access</button>
            <button v-if="needsHand[r.id]" class="nge-accr-btn" :disabled="busy === `d${r.id}`" @click="decide(r, 'invited', true)"
                    title="Only after you added them to Eyewire_2_Edit in CAVE yourself">I added them by hand, grant</button>
          </div>
        </div>
        <p v-if="done[r.id]" class="nge-accr-done" role="status">{{ done[r.id] }}</p>
        <p v-else-if="r.status === 'invited'" class="nge-accr-done">
          Access granted {{ when(r.reviewed_at) }}{{ r.pilot_added ? ', added to the pilot testers' : '' }}. Their CAVE group (Eyewire_2_Edit) is given by hand.
        </p>
        <p v-if="r.reviewer_note && r.status !== 'submitted'" class="nge-accr-note nge-accr-note--you">Your note: {{ r.reviewer_note }}</p>
        <div class="nge-accr-delete">
          <button class="nge-accr-btn" :disabled="busy === `x${r.id}`" @click="askingDelete = r.id">Delete request</button>
        </div>
        <ConfirmDialog v-if="askingDelete === r.id" :title="`Delete ${r.player_name || r.email}'s request?`"
          :text="`This deletes their ten examples and every mark and note on them, for good. It cannot be undone. They would have to start again from nothing.`"
          yes="Delete for good" @yes="remove(r)" @no="askingDelete = null" />
      </div>
    </article>
  </section>
</template>

<style scoped>
.nge-accr { font-size: 1rem; line-height: 1.5; color: #f1f5f9; padding: 16px; }
.nge-accr h2 { font-size: 1.25rem; margin: 0; }
.nge-accr-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.nge-accr-sub { color: #9fb0c4; }
.nge-accr-refresh { margin-left: auto; }
.nge-accr-filters { display: flex; gap: 6px; }
.nge-accr-filter { font: inherit; font-size: 0.9rem; padding: 4px 12px; border-radius: 6px; border: 1px solid #3b4b5e; background: #152434; color: #c9d6e6; cursor: pointer; }
.nge-accr-filter--on { border-color: #7CFFB2; color: #fff; background: #1b3a2c; }
.nge-accr-how { color: #b6c4d4; margin: 10px 0; }
.nge-accr-err { color: #f5d142; }
.nge-accr-card { border: 1px solid #2f4155; border-radius: 10px; margin: 10px 0; background: #0f1b28; }
.nge-accr-card--submitted { border-color: #7CFFB2; }
.nge-accr-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: none; padding: 12px 14px; cursor: pointer; }
.nge-accr-name { font-weight: 600; font-size: 1.05rem; }
.nge-accr-meta { color: #9fb0c4; font-size: 0.9rem; }
.nge-accr-status { margin-left: auto; font-size: 0.85rem; padding: 2px 8px; border-radius: 6px; background: #22344a; }
.nge-accr-card--submitted .nge-accr-status { background: #1b3a2c; color: #7CFFB2; }
.nge-accr-card--redo .nge-accr-status { color: #f5d142; }
.nge-accr-tally { flex-basis: 100%; color: #9fb0c4; font-size: 0.85rem; }
.nge-accr-body { padding: 0 14px 14px; }
.nge-accr-table { width: 100%; border-collapse: collapse; }
.nge-accr-table td { padding: 8px 6px; border-top: 1px solid #22344a; vertical-align: top; }
.nge-accr-kind { white-space: nowrap; font-weight: 600; width: 80px; }
.nge-accr-row--good .nge-accr-kind { color: #7CFFB2; }
.nge-accr-row--redo .nge-accr-kind { color: #f5d142; }
.nge-accr-marks { color: #9fb0c4; }
.nge-accr-note { color: #b6c4d4; font-size: 0.9rem; white-space: pre-wrap; }
.nge-accr-note--you { color: #e4ecf5; }
.nge-accr-acts { white-space: nowrap; text-align: right; }
.nge-accr-btn { font: inherit; font-size: 0.9rem; padding: 4px 10px; margin-left: 4px; border-radius: 6px; border: 1px solid #74859a; background: #152434; color: #f1f5f9; cursor: pointer; }
.nge-accr-btn:disabled { opacity: 0.55; cursor: default; }
.nge-accr-btn--good.nge-accr-btn--on { border-color: #7CFFB2; background: #1b3a2c; color: #7CFFB2; }
.nge-accr-btn--redo.nge-accr-btn--on { border-color: #f5d142; background: #3a3216; color: #f5d142; }
.nge-accr-btn--invite { border-color: #7CFFB2; color: #7CFFB2; }
.nge-accr-link { color: #9fd3ff; margin-left: 6px; text-decoration: none; }
.nge-accr-decide { margin-top: 12px; }
.nge-accr-decide label { display: block; color: #b6c4d4; }
.nge-accr-decide textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; font: inherit; padding: 8px 10px; border: 1px solid #74859a; border-radius: 6px; background: #152434; color: #f1f5f9; }
.nge-accr-decide-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.nge-accr-done { color: #7CFFB2; }
.nge-accr-waiting { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; background: rgba(245, 209, 66, 0.1); color: #f5e3a0; }
.nge-accr-new { display: block; font-size: 0.75rem; font-weight: 500; color: #9fd3ff; }
.nge-accr-earlier-btn { margin-top: 4px; font: inherit; font-size: 0.85rem; color: #9fd3ff; background: none; border: none; padding: 0; cursor: pointer; }
.nge-accr-earlier { margin-top: 4px; padding-left: 10px; border-left: 2px solid #2f4155; border-radius: 0; }
.nge-accr-earlier-row { margin: 4px 0; color: #b6c4d4; font-size: 0.9rem; }
.nge-accr-cave { margin: 8px 0 0; color: #f5d142; }
.nge-accr-delete { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 12px; color: #b6c4d4; }
</style>
