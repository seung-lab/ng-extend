<script setup lang="ts">
/**
 * "The Hunt begins!" (Ames 2026-10-21: "will there be a fun UI when it begins?").
 * Once per Hunt in this browser: when a Hunt starts while Pyr is open, or the
 * first time Pyr opens while one runs, a gold banner sweeps across with gems
 * falling, then the Hunt box opens. A click ends it early. Calm screen and
 * reduced motion get the banner still, with no falling gems.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { huntState, featuredHunt, phaseNow, type HuntInfo } from '../hunt';

const emit = defineEmits<{ (e: 'open', id: number): void }>();
const showing = ref<HuntInfo | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

const key = (id: number) => `nge-hunt-began-${id}`;
function seen(id: number) { try { return !!localStorage.getItem(key(id)); } catch { return true; } }

const live = computed(() => {
  void huntState.now;   // turns over with the hunt clock
  const h = featuredHunt();
  return h && phaseNow(h) === 'live' && h.view ? h : null;
});

watch(() => live.value?.id, (id) => {
  if (!id || showing.value || seen(id)) return;
  try { localStorage.setItem(key(id), '1'); } catch { /* shown anyway */ }
  showing.value = live.value;
  if (timer) clearTimeout(timer);
  timer = setTimeout(close, 4200);
}, { immediate: true });

function close() {
  const h = showing.value;
  showing.value = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (h) emit('open', h.id);
}
onUnmounted(() => { if (timer) clearTimeout(timer); });

const what = computed(() => {
  const h = showing.value; if (!h) return '';
  const s = h.spots ?? { cut: h.target_count, merge: 0 };
  const c = s.cut === 1 ? '1 merger' : `${s.cut} mergers`;
  const m = s.merge === 1 ? '1 missing extension' : `${s.merge} missing extensions`;
  const all = !s.merge ? c : !s.cut ? m : `${c} and ${m}`;
  return `${all} ${h.target_count === 1 ? 'is' : 'are'} hidden. You have ${h.budget} gems.`;
});
// Gems that fall across the banner: spread over the width, each with its own pace.
const gems = Array.from({ length: 22 }, (_, i) => ({ x: (i * 47) % 100, delay: (i % 7) * 0.18, dur: 1.6 + ((i * 13) % 9) / 10, size: 12 + ((i * 7) % 10), blue: i % 3 === 0 }));
</script>

<template>
  <div v-if="showing" class="nge-hunt-begins" role="status" @click="close">
    <div class="nge-hunt-begins-band">
      <span v-for="(g, i) in gems" :key="i" class="nge-hunt-begins-gem" :class="{ 'nge-hunt-begins-gem--blue': g.blue }"
            :style="{ left: g.x + '%', animationDelay: g.delay + 's', animationDuration: g.dur + 's', width: g.size + 'px', height: g.size + 'px' }"></span>
      <div class="nge-hunt-begins-eyebrow">{{ showing.admins_only ? "The admins' test" : 'Pyr' }}</div>
      <div class="nge-hunt-begins-title">The Hunt begins!</div>
      <div class="nge-hunt-begins-name">{{ showing.title }}</div>
      <div class="nge-hunt-begins-what">{{ what }} Happy Hunting!</div>
    </div>
  </div>
</template>

<style scoped>
.nge-hunt-begins { position: fixed; inset: 0; z-index: 9300; display: flex; align-items: center; justify-content: center; cursor: pointer; background: rgba(2, 6, 16, 0.45); animation: nge-hb-dim 4.2s ease forwards; }
.nge-hunt-begins-band {
  position: relative; overflow: hidden; width: 100%; padding: 28px 16px 26px; text-align: center;
  background: rgba(8, 13, 26, 0.94); border-top: 2px solid rgba(245, 209, 66, 0.85); border-bottom: 2px solid rgba(245, 209, 66, 0.85);
  box-shadow: 0 0 40px rgba(245, 209, 66, 0.25);
  animation: nge-hb-sweep 0.7s cubic-bezier(0.2, 1.2, 0.4, 1);
}
.nge-hunt-begins-eyebrow { font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: #9fd0ff; }
.nge-hunt-begins-title { margin-top: 6px; font: 800 clamp(30px, 6vw, 56px) 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; color: #f5d142; text-shadow: 0 0 24px rgba(245, 209, 66, 0.55); animation: nge-hb-title 0.9s cubic-bezier(0.2, 1.6, 0.4, 1) 0.15s both; }
.nge-hunt-begins-name { margin-top: 4px; font: 600 18px 'Inter', sans-serif; color: #fff; }
.nge-hunt-begins-what { margin-top: 6px; font: 15px 'Inter', sans-serif; color: #cfdcef; }
.nge-hunt-begins-gem {
  position: absolute; top: -20px; background: #f5d142; clip-path: polygon(15% 32%, 35% 0, 65% 0, 85% 32%, 50% 100%);
  filter: drop-shadow(0 0 4px rgba(245, 209, 66, 0.8)); animation: nge-hb-fall linear infinite;
}
.nge-hunt-begins-gem--blue { background: #5aaaff; filter: drop-shadow(0 0 4px rgba(90, 170, 255, 0.8)); }
@keyframes nge-hb-sweep { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
@keyframes nge-hb-title { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes nge-hb-fall { from { transform: translateY(0) rotate(0); opacity: 0.95; } to { transform: translateY(240px) rotate(200deg); opacity: 0; } }
@keyframes nge-hb-dim { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .nge-hunt-begins, .nge-hunt-begins-band, .nge-hunt-begins-title { animation: none !important; }
  .nge-hunt-begins-gem { display: none; }
}
:global(body.nge-calm) .nge-hunt-begins-band, :global(body.nge-calm) .nge-hunt-begins-title { animation: none !important; }
:global(body.nge-calm) .nge-hunt-begins-gem { display: none; }
</style>
