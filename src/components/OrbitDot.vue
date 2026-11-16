<script setup lang="ts">
/** The rotating mote beside a row's JUMP button (CellLibraryPanel), one row
 *  at a time. Its own small component so the 2.8 s tick redraws only these
 *  dots, not the whole Cell Library (perf audit 2026-11-14). */
import { computed } from 'vue';
import { orbitSeq } from '../util/orbit_tick';

const props = defineProps<{ idx: number; len: number }>();
const on = computed(() => props.len > 0 && orbitSeq.value % props.len === props.idx);
</script>

<template>
  <span v-if="on" class="nge-orbit-dot" aria-hidden="true"></span>
</template>
