<script setup lang="ts">
/**
 * Nurro's profile (Ames 2026-09-28): a joke version of the player profile.
 * Click Nurro's name in chat and, instead of edits and cells, you get the
 * statistics that really matter to a cream cat in a neuron harness.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import nurroJetpack from '../../static/nurro/nurro-3d-card.jpg';

const emit = defineEmits({ hide: null });

type Stat = { icon: string; label: string; value: number | null; shown?: string; note?: string };
const STATS: Stat[] = [
  { icon: '🚀', label: 'Jetpacks built', value: 47, note: '46 flew' },
  { icon: '🌌', label: 'Galaxies visited', value: 1024 },
  { icon: '🥽', label: 'Miles run in VR', value: 3141, note: 'zero in real life' },
  { icon: '🌿', label: 'Catnip meadows frolicked', value: 88 },
  { icon: '🐟', label: 'Fish caught', value: 12406 },
  { icon: '🔴', label: 'Laser dots chased', value: 58210, note: 'caught: 0' },
  { icon: '🧶', label: 'Yarn balls untangled', value: 902, note: 'axon training' },
  { icon: '😴', label: 'Naps taken mid-trace', value: null, shown: '∞' },
  { icon: '🤝', label: 'Synapses high-fived', value: 2718 },
  { icon: '📦', label: 'Boxes sat in', value: 377, note: 'bounding boxes count' },
  { icon: '☕', label: 'Cups of neurotransmitter tea', value: 1650 },
  { icon: '🧪', label: '"For science!" shouted', value: 43, note: 'languages so far' },
];
const BADGES = [
  { icon: '🐾', name: 'Cat of Science' },
  { icon: '🪐', name: 'Galactic Tourist' },
  { icon: '🎣', name: 'Fish Whisperer' },
  { icon: '💤', name: 'Nap Champion' },
  { icon: '🧠', name: 'Honorary Neuron' },
];

// Count the numbers up when the profile opens, like the real one.
const shown = ref<string[]>(STATS.map(s => s.shown ?? '0'));
let raf = 0;
onMounted(() => {
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / 1400);
    const ease = 1 - Math.pow(1 - k, 3);
    shown.value = STATS.map(s => s.value == null ? (s.shown ?? '') : Math.round(s.value * ease).toLocaleString('en-US'));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
});
onUnmounted(() => cancelAnimationFrame(raf));
</script>

<template>
  <modal-overlay class="nge-nurro-profile" @hide="emit('hide')">
    <div class="nge-np" @click.stop>
      <button class="nge-np-close" @click="emit('hide')" aria-label="Close">×</button>
      <div class="nge-np-hero">
        <img :src="nurroJetpack" alt="Nurro in a space suit with a jetpack" />
        <div class="nge-np-id">
          <div class="nge-np-kicker">EyeWire II · Chief Guide</div>
          <h2 class="nge-np-name">Nurro <span class="nge-np-flag" title="Nationality: the cosmos">🐾</span></h2>
          <p class="nge-np-bio">Cream cat. Neuron harness. Has never finished a cell but has supervised thousands. Knows every shortcut and will tell you about them whether or not you asked.</p>
          <div class="nge-np-badges">
            <span v-for="b in BADGES" :key="b.name" class="nge-np-badge">{{ b.icon }} {{ b.name }}</span>
          </div>
        </div>
      </div>

      <div class="nge-np-grid">
        <div v-for="(s, i) in STATS" :key="s.label" class="nge-np-stat">
          <div class="nge-np-stat-icon">{{ s.icon }}</div>
          <div class="nge-np-stat-value">{{ shown[i] }}</div>
          <div class="nge-np-stat-label">{{ s.label }}</div>
          <div v-if="s.note" class="nge-np-stat-note">{{ s.note }}</div>
        </div>
      </div>
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-np {
  position: relative;
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 26px 28px 20px;
  color: #d8e8ff;
  font-family: 'Inter', 'Roboto', sans-serif;
  box-sizing: border-box;
}
.nge-np-close {
  position: absolute;
  top: 10px;
  right: 14px;
  background: none;
  border: none;
  color: #8aa;
  font-size: 22px;
  cursor: pointer;
}
.nge-np-close:hover { color: #fff; }

.nge-np-hero { display: flex; gap: 22px; align-items: center; }
.nge-np-hero img {
  width: 190px;
  height: 190px;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid rgba(126, 232, 255, 0.35);
  box-shadow: 0 0 28px rgba(126, 232, 255, 0.18);
  flex-shrink: 0;
}
.nge-np-id { min-width: 0; }
.nge-np-kicker {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7ee8ff;
}
.nge-np-name {
  margin: 4px 0 6px;
  font-size: 40px;
  font-weight: 700;
  color: #fff;
  line-height: 1.05;
}
.nge-np-flag { font-size: 26px; vertical-align: 4px; }
.nge-np-bio { margin: 0 0 12px; font-size: 14.5px; line-height: 1.5; color: #b9cce4; }
.nge-np-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-np-badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #e6f7ff;
  background: rgba(126, 232, 255, 0.1);
  border: 1px solid rgba(126, 232, 255, 0.3);
  white-space: nowrap;
}

.nge-np-grid {
  margin-top: 22px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
  gap: 10px;
}
.nge-np-stat {
  padding: 12px 12px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(126, 232, 255, 0.14);
  transition: border-color 0.15s, transform 0.15s;
}
.nge-np-stat:hover { border-color: rgba(126, 232, 255, 0.45); transform: translateY(-2px); }
.nge-np-stat-icon { font-size: 22px; line-height: 1; }
.nge-np-stat-value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.nge-np-stat-label { margin-top: 2px; font-size: 12.5px; color: #9fc4e8; }
.nge-np-stat-note { margin-top: 3px; font-size: 11px; color: #7f97b3; }


@media (max-width: 600px) {
  .nge-np { padding: 20px 16px 16px; }
  .nge-np-hero { flex-direction: column; text-align: center; }
  .nge-np-hero img { width: 150px; height: 150px; }
  .nge-np-badges { justify-content: center; }
  .nge-np-name { font-size: 32px; }
  .nge-np-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .nge-np-stat-value { font-size: 20px; }
}
</style>
