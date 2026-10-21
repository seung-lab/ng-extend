<script setup lang="ts">
/**
 * The Pyr Arcade (Ames 2026-10-20): a small game window over the viewer.
 * Opens from the menu and the command palette; Esc or the cross closes it.
 * Each game is its own component, so more can join the list later.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import NeuronTetris from './NeuronTetris.vue';

const emit = defineEmits({ hide: null });

const GAMES = [
  { id: 'tetris', name: 'Neuron Tetris', blurb: 'Stack neuron pieces, merge full rows.' },
] as const;
const gameId = ref<string>('tetris');

/* The window can be moved by its title bar. */
const pos = ref({ x: 0, y: 0 });
let drag: { sx: number; sy: number; ox: number; oy: number } | null = null;
function onDragStart(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return;
  drag = { sx: e.clientX, sy: e.clientY, ox: pos.value.x, oy: pos.value.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onDragMove(e: PointerEvent) {
  if (!drag) return;
  pos.value = { x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy };
}
function onDragEnd() { drag = null; }

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  emit('hide');
}
onMounted(() => window.addEventListener('keydown', onKeyDown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, true));
</script>

<template>
  <teleport to="body">
    <div class="nge-arcade" role="dialog" aria-label="Pyr Arcade"
         :style="{ transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }">
      <div class="nge-arcade-head" @pointerdown="onDragStart" @pointermove="onDragMove"
           @pointerup="onDragEnd" @pointercancel="onDragEnd">
        <span class="nge-arcade-logo" aria-hidden="true">🕹️</span>
        <span class="nge-arcade-title">Pyr Arcade</span>
        <div class="nge-arcade-games">
          <button v-for="g in GAMES" :key="g.id" class="nge-arcade-game" :class="{ on: gameId === g.id }"
                  :title="g.blurb" @click="gameId = g.id">{{ g.name }}</button>
        </div>
        <button class="nge-arcade-close" title="Close (Esc)" aria-label="Close the arcade" @click="emit('hide')">×</button>
      </div>
      <div class="nge-arcade-body">
        <NeuronTetris v-if="gameId === 'tetris'" />
      </div>
    </div>
  </teleport>
</template>

<style>
.nge-arcade {
  position: fixed; left: 50%; top: 50%; z-index: 100050;
  background: linear-gradient(180deg, rgba(14, 22, 40, 0.98), rgba(8, 13, 26, 0.98));
  border: 1px solid rgba(91, 227, 255, 0.28); border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 170, 255, 0.1);
  color: #e8eef8; font: 13px/1.3 Roboto, system-ui, sans-serif;
  max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: auto;
}
.nge-arcade-head {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08); cursor: grab; user-select: none;
}
.nge-arcade-head:active { cursor: grabbing; }
.nge-arcade-logo { font-size: 18px; }
.nge-arcade-title { font-weight: 700; font-size: 15px; letter-spacing: 0.03em; color: #9fdcff; }
.nge-arcade-games { display: flex; gap: 4px; margin-left: 8px; flex: 1; }
.nge-arcade-game {
  padding: 4px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent;
  color: #b8c4d6; font: inherit; cursor: pointer;
}
.nge-arcade-game.on { color: #fff; border-color: rgba(91, 227, 255, 0.4); background: rgba(91, 227, 255, 0.1); }
.nge-arcade-close {
  width: 28px; height: 28px; border-radius: 8px; border: none; background: transparent;
  color: #b8c4d6; font-size: 20px; line-height: 1; cursor: pointer;
}
.nge-arcade-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.nge-arcade-body { padding: 16px; }
</style>
