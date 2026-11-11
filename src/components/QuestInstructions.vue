<script setup lang="ts">
/**
 * The Cilia Quest's instructions in a box of their own (Ames 2026-11-06:
 * "instructions should open up a new box that is larger, with more space,
 * laid out like a notification with an image on left that we can
 * make/provide"). Drawn as the notification box is: the title bar, a picture
 * on the left that opens full size on a click, the words on the right. The
 * lead and the steps are the same EditableTexts as before, so an admin still
 * edits them in the game.
 *
 * The picture is QUEST_INSTRUCTIONS_IMAGE (annotation_quests.ts), and admins
 * change it in the game (EditableImage, key quest.retina_cilia.image: Ames
 * 2026-11-06, "add an 'add image'"). Without a picture players see the words
 * across the whole width; admins see the empty slot with Add image.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue';
import EditableText from './EditableText.vue';
import EditableImage from './EditableImage.vue';
import { QUEST_TITLE, QUEST_INSTRUCTIONS_IMAGE, QUEST_INSTRUCTIONS_IMAGE_ALT } from '../annotation_quests';
import { pictureFor } from '../site_texts';
import { useProofreadingBackendStore } from '../store';

/** Defaults are the Cilia Quest's. The Cell Library's "How to map a cell"
 *  uses the same box with its own words and picture (Ames 2026-11-08). */
const props = withDefaults(defineProps<{
  lead?: string; steps: string[];
  kicker?: string; title?: string;
  leadKey?: string; stepsKey?: string;
  imageKey?: string; image?: string; imageAlt?: string;
  legend?: { name: string; color: string }[];
}>(), {
  lead: '', kicker: QUEST_TITLE, title: 'How to do a Cilia Quest',
  leadKey: 'quest.retina_cilia.lead', stepsKey: 'quest.retina_cilia.steps',
  imageKey: 'quest.retina_cilia.image', image: QUEST_INSTRUCTIONS_IMAGE, imageAlt: QUEST_INSTRUCTIONS_IMAGE_ALT,
  legend: () => [
    { name: 'Basal body', color: '#f5d142' },
    { name: 'Daughter centriole', color: '#e06060' },
    { name: 'Cilium centerline', color: '#7CFFB2' },
  ],
});
const emit = defineEmits<{ (e: 'close'): void; (e: 'action', name: string): void }>();

const backend = useProofreadingBackendStore();
const picture = computed(() => pictureFor(props.imageKey, props.image));
/** The left column: the picture, or for an admin the slot to add one. */
const showFigure = computed(() => !!picture.value || !!backend.showAdminUi);
const zoomed = ref('');

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  if (zoomed.value) zoomed.value = ''; else emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onUnmounted(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <div class="nge-qi-backdrop" @click.self="emit('close')">
      <div class="nge-qi" :class="{ 'nge-qi--picture': showFigure }" role="dialog" aria-modal="true" aria-labelledby="nge-qi-title">
        <span class="nge-qi-bracket nge-qi-bracket--tl" aria-hidden="true"></span>
        <span class="nge-qi-bracket nge-qi-bracket--br" aria-hidden="true"></span>
        <div class="nge-qi-topbar">
          <span class="nge-qi-kicker">
            <span class="nge-qi-kicker-dot" aria-hidden="true"></span>
            <span class="nge-qi-kicker-label">{{ props.kicker }}</span>
            <span class="nge-qi-kicker-sep" aria-hidden="true">/</span>
            <span class="nge-qi-kicker-sub">Instructions</span>
          </span>
          <button class="nge-qi-close" aria-label="Close" @click="emit('close')">×</button>
        </div>
        <div class="nge-qi-scroll">
          <div class="nge-qi-layout">
            <figure v-if="showFigure" class="nge-qi-figure">
              <EditableImage :text-key="props.imageKey" :original="props.image" :alt="props.imageAlt"
                             img-class="nge-qi-img" @zoom="u => zoomed = u" />
              <figcaption v-if="picture && props.legend.length" class="nge-qi-key">
                <span v-for="k in props.legend" :key="k.name" class="nge-qi-key-item">
                  <span class="nge-qi-key-dot" :style="{ background: k.color, boxShadow: `0 0 8px ${k.color}` }" aria-hidden="true"></span>{{ k.name }}
                </span>
              </figcaption>
            </figure>
            <div class="nge-qi-text">
              <h2 id="nge-qi-title" class="nge-qi-title">{{ props.title }}</h2>
              <EditableText v-if="props.lead" :text-key="props.leadKey" :original="props.lead" text-class="nge-qi-lead" @action="n => emit('action', n)" />
              <EditableText :text-key="props.stepsKey" :original="props.steps" list-class="nge-qi-steps" @action="n => emit('action', n)" />
            </div>
          </div>
        </div>
      </div>
      <div v-if="zoomed" class="nge-qi-lightbox" title="Click to close" @click="zoomed = ''">
        <img :src="zoomed" :alt="props.imageAlt" class="nge-qi-lightbox-img" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The notification box's look (NotificationFeedPanel .nge-notif-detail).
   Above the Cell Library (10010) and its collapse bar (10020), which opens it. */
.nge-qi-backdrop {
  position: fixed; inset: 0; z-index: 10030;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: radial-gradient(circle at 50% 38%, rgba(0, 14, 34, 0.82) 0%, rgba(0, 0, 0, 0.92) 100%);
  backdrop-filter: blur(7px) saturate(1.25);
}
.nge-qi {
  --nd-accent: 74 158 255; --nd-cyan: 126 224 255; --nd-line: 196 228 255; --nd-ink: 236 243 252; --nd-dim: 170 184 204;
  position: relative; isolation: isolate;
  width: min(760px, calc(94 * var(--nge-vw, 1vw)));
  max-height: calc(88 * var(--nge-vh, 1vh));
  display: flex; flex-direction: column; overflow: hidden;
  background:
    radial-gradient(120% 60% at 50% -10%, rgb(var(--nd-accent) / 0.10), transparent 60%),
    linear-gradient(158deg, rgba(10, 17, 32, 0.97) 0%, rgba(5, 9, 19, 0.985) 100%);
  border: 1px solid rgb(var(--nd-accent) / 0.30);
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 0 60px rgb(var(--nd-accent) / 0.10), inset 0 1px 0 rgb(var(--nd-line) / 0.10);
  color: rgb(var(--nd-ink) / 0.92);
  font-family: 'Inter', system-ui, sans-serif;
  animation: nge-qi-in 720ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
.nge-qi--picture { width: min(1120px, calc(94 * var(--nge-vw, 1vw))); }
.nge-qi::before {
  content: ''; position: absolute; left: 8%; right: 8%; top: 0; height: 1px; z-index: 3; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgb(var(--nd-line) / 0.95) 50%, transparent);
  box-shadow: 0 0 12px rgb(var(--nd-cyan) / 0.55);
}
@keyframes nge-qi-in {
  0%   { opacity: 0; transform: translateY(10px) scale(0.97); filter: blur(10px) brightness(2.5); }
  60%  { opacity: 1; transform: none; filter: blur(0) brightness(1.15); }
  100% { opacity: 1; transform: none; filter: none; }
}
@media (prefers-reduced-motion: reduce) { .nge-qi { animation: none; } }
.nge-qi-bracket { position: absolute; z-index: 3; width: 13px; height: 13px; pointer-events: none; border: 1px solid rgb(var(--nd-line) / 0.55); }
.nge-qi-bracket--tl { top: 7px; left: 7px; border-right: 0; border-bottom: 0; }
.nge-qi-bracket--br { bottom: 7px; right: 7px; border-left: 0; border-top: 0; }
.nge-qi-topbar {
  display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
  padding: 14px 20px 12px 24px;
  border-bottom: 1px solid rgb(var(--nd-accent) / 0.14);
}
.nge-qi-kicker { display: inline-flex; align-items: center; gap: 9px; min-width: 0; }
.nge-qi-kicker-dot { width: 6px; height: 6px; border-radius: 50%; background: rgb(var(--nd-cyan)); box-shadow: 0 0 8px rgb(var(--nd-cyan) / 0.8); }
.nge-qi-kicker-label {
  font-family: 'Orbitron', 'Inter', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.22em; text-transform: uppercase; color: rgb(var(--nd-cyan) / 0.9);
}
.nge-qi-kicker-sep { color: rgb(var(--nd-accent) / 0.45); font-size: 12px; }
.nge-qi-kicker-sub { font-size: 12.5px; color: rgb(var(--nd-dim) / 0.95); letter-spacing: 0.02em; }
.nge-qi-close {
  width: 28px; height: 28px; padding: 0; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgb(var(--nd-accent) / 0.06); border: 1px solid rgb(var(--nd-accent) / 0.25); border-radius: 6px;
  color: rgb(var(--nd-dim)); font-size: 18px; cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.nge-qi-close:hover, .nge-qi-close:focus-visible {
  color: #fff; border-color: rgb(var(--nd-cyan) / 0.6); background: rgb(var(--nd-cyan) / 0.10);
  box-shadow: 0 0 14px rgb(var(--nd-cyan) / 0.25); outline: none;
}
.nge-qi-scroll {
  overflow-y: auto; padding: 22px 26px 26px;
  scrollbar-width: thin; scrollbar-color: rgb(var(--nd-accent) / 0.2) transparent;
}
.nge-qi-layout { display: flex; gap: 24px; align-items: flex-start; }
/* The picture stays put while the words scroll past it, as in a notification. */
.nge-qi-figure { margin: 0; width: 46%; flex-shrink: 0; position: sticky; top: 0; }
:deep(.nge-qi-img) {
  display: block; width: 100%; max-height: min(560px, calc(88 * var(--nge-vh, 1vh) - 200px)); object-fit: contain;
  border-radius: 8px; border: 1px solid rgb(var(--nd-accent) / 0.22);
  box-shadow: 0 0 24px rgb(var(--nd-accent) / 0.10);
  background: #000; cursor: zoom-in;
}
.nge-qi-key { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 13px; color: rgb(var(--nd-dim)); }
.nge-qi-key-item { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.nge-qi-key-dot { width: 10px; height: 10px; border-radius: 50%; }
.nge-qi-text { flex: 1; min-width: 0; }
.nge-qi-title {
  margin: 0 0 14px;
  font-family: 'Orbitron', 'Inter', sans-serif; font-size: 22px; font-weight: 600; letter-spacing: 0.03em; line-height: 1.3;
  color: #fff;
}
:deep(.nge-qi-lead) { margin: 0 0 16px; font-size: 17px; line-height: 1.6; color: rgb(var(--nd-ink) / 0.86); }
:deep(.nge-qi-steps) { margin: 0; padding-left: 26px; font-size: 17px; line-height: 1.6; color: #d6e2f3; }
:deep(.nge-qi-steps li) { margin: 11px 0; padding-left: 4px; }
:deep(.nge-qi-steps li::marker) { color: #42d5ec; font-weight: 700; }
:deep(.nge-qi-steps b) { color: #fff; font-weight: 600; }
:deep(.nge-qi-steps a), :deep(.nge-qi-lead a) { color: #7ecaff; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
:deep(.nge-qi-steps a:hover), :deep(.nge-qi-lead a:hover) { color: #fff; }
.nge-qi-lightbox {
  position: fixed; inset: 0; z-index: 10031;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.88); cursor: zoom-out;
}
.nge-qi-lightbox-img { max-width: calc(92 * var(--nge-vw, 1vw)); max-height: calc(92 * var(--nge-vh, 1vh)); object-fit: contain; border-radius: 8px; }
/* Narrow windows and phones: the picture above the words. */
@media (max-width: 760px) {
  .nge-qi-layout { flex-direction: column; }
  .nge-qi-figure { width: 100%; position: static; }
  .nge-qi-scroll { padding: 16px; }
}
</style>
