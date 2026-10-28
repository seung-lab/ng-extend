<script setup lang="ts">
/**
 * "Request access" for a dataset this player can't open (Ames 2026-10-28).
 * On the locked cards in the dataset switcher and on the note shown when a
 * view opens on such a dataset. Once asked it reads "Requested ✓"; retina
 * opens its own request with examples. See dataset_access_request.ts.
 */
import { computed, onMounted, ref } from 'vue';
import type { DatasetEntry } from '../datasets';
import { loadMyDatasetRequests, requestDatasetAccess, requestStateOf, RETINA_ID } from '../dataset_access_request';

const props = defineProps<{ ds: DatasetEntry }>();
const busy = ref(false);
const error = ref('');
onMounted(() => { void loadMyDatasetRequests(); });

const state = computed(() => requestStateOf(props.ds));
const label = computed(() => {
  if (busy.value) return 'Sending…';
  if (props.ds.id === RETINA_ID) return 'Request access';
  if (state.value === 'open') return 'Requested ✓';
  if (state.value === 'granted') return 'Granted: reload Pyr';
  return state.value === 'declined' ? 'Ask again' : 'Request access';
});
const title = computed(() => props.ds.id === RETINA_ID
  ? 'Retina access is given after a short test: open the request and send your examples.'
  : state.value === 'open' ? 'Your request is with the admins. You will get a note when they answer.'
    : state.value === 'granted' ? 'An admin gave you access. Reload Pyr, then open it.'
      : `Ask the admins for access to ${props.ds.label}. You will get a note when they answer.`);

async function ask() {
  if (busy.value || (state.value === 'open' && props.ds.id !== RETINA_ID)) return;
  if (state.value === 'granted') { location.reload(); return; }
  busy.value = true; error.value = '';
  try { await requestDatasetAccess(props.ds); }
  catch (e: any) { error.value = e?.message || 'That did not go through. Please try again.'; }
  finally { busy.value = false; }
}
</script>

<template>
  <span class="nge-req-access">
    <button type="button" class="nge-req-access-btn" :class="{ 'is-sent': state === 'open' && ds.id !== RETINA_ID }"
            :disabled="busy" :title="title" @click.stop="ask">{{ label }}</button>
    <span v-if="error" class="nge-req-access-err" role="alert">{{ error }}</span>
  </span>
</template>

<style scoped>
.nge-req-access { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.nge-req-access-btn {
  font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer;
  color: #ffe9a8; background: rgba(245, 209, 66, 0.14); border: 1px solid rgba(245, 209, 66, 0.55);
}
.nge-req-access-btn:hover:not(:disabled) { background: rgba(245, 209, 66, 0.26); color: #fff; }
.nge-req-access-btn.is-sent { cursor: default; color: #a6ffd6; background: rgba(0, 220, 120, 0.1); border-color: rgba(0, 220, 120, 0.4); }
.nge-req-access-btn:disabled { opacity: 0.7; cursor: default; }
.nge-req-access-err { font-size: 12px; color: #f5d142; }
</style>
