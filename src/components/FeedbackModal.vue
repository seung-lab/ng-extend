<script setup lang="ts">
/**
 * FeedbackModal.vue
 * "Submit an issue" — lets any user report a bug / idea / data problem from
 * anywhere in the app. Posts to the `submitIssue` Cloud Function which relays
 * to Slack (#citsci_feedback) and keeps a Firestore record. No auth required.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import { useProofreadingBackendStore } from '../store';
import { mintShortStateLink } from '../util/state_link';

const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();

const ISSUE_URL =
  (window as any).__NGE_SUBMIT_ISSUE_URL ||
  'https://us-central1-ytho-4bff2.cloudfunctions.net/submitIssue';

const CATEGORIES = ['Bug', 'Idea', 'Data problem', 'Other'] as const;
const category = ref<typeof CATEGORIES[number]>('Bug');
const message = ref('');
const sending = ref(false);
const done = ref(false);
const error = ref('');

function currentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      if ((ml.layer?.constructor?.name ?? '').includes('Segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

async function submit() {
  const text = message.value.trim();
  if (!text || sending.value) {
    if (!text) error.value = 'Please describe the issue.';
    return;
  }
  sending.value = true;
  error.value = '';
  try {
    // NEVER send window.location.href: the hash carries the full viewer
    // state (multiple KB) and relays like Slack truncate it, leaving a link
    // that dies with "Error parsing state: Unterminated string in JSON".
    // Mint a short saved-state link instead; if that fails (no auth, state
    // server down), send the bare page URL plus the position so the report
    // still locates the spot without a broken link.
    const shortLink = await mintShortStateLink();
    let pageUrl = shortLink;
    if (!pageUrl) {
      const v: any = (window as any)['viewer'];
      const pos = v?.navigationState?.position?.value;
      const at = pos ? ` @ ${Math.round(pos[0])},${Math.round(pos[1])},${Math.round(pos[2])}` : '';
      pageUrl = `${window.location.origin}${window.location.pathname}${at}`;
    }
    const res = await fetch(ISSUE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        category: category.value,
        url: pageUrl,
        dataset: currentDataset(),
        user: backend.userName || '',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Mirror into Supabase so the triage agent can read reports (the Cloud
    // Function's Slack/Firestore relay stays the human-facing feed).
    // Best-effort: a failure here must not surface as a failed submit.
    try {
      const { supabase } = await import('../supabase');
      await supabase.from('site_issues').insert({
        category: category.value,
        message: text,
        url: pageUrl,
        dataset: currentDataset() || null,
        user_id: backend.userId || null,
        user_name: backend.userName || null,
      });
    } catch (e) {
      console.warn('[feedback] Supabase mirror failed:', e);
    }
    done.value = true;
    setTimeout(() => emit('hide'), 1600);
  } catch (e: any) {
    error.value = 'Could not submit — please try again.';
    console.warn('[feedback] submit failed:', e);
  } finally {
    sending.value = false;
  }
}

// ── Flow-field backdrop ──────────────────────────────────────────────────────
// Particles drifting along a gradient-noise flow field across the whole
// overlay backdrop, BEHIND the dialog (feedback_triage proposal approved by
// Amy 2026-08-11; inspiration: amyleesterling.github.io/experimental-UI).
// The canvas is declared inside this component but re-parented into
// ModalOverlay's `.nge-overlay-blocker` on mount, where z-index 0 puts it
// above the dim backdrop and below the `.overlay-content` box (z-index 100).
// Purely decorative: skipped entirely under prefers-reduced-motion, capped
// DPR, particle count scaled to viewport area, and the rAF loop lives only
// while the modal is mounted.
const fxCanvas = ref<HTMLCanvasElement | null>(null);
let fxRaf = 0;
let fxObserver: ResizeObserver | null = null;

/** Smooth 2D value noise: deterministic hash grid + smoothstep interpolation. */
function makeNoise() {
  const hash = (x: number, y: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

onMounted(() => {
  const canvas = fxCanvas.value;
  if (!canvas) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Re-parent the canvas into the overlay blocker so the field spans the
  // whole backdrop and paints behind the dialog. The element keeps its
  // data-v scope attribute, so the scoped .nge-fb-fx rule still applies.
  const blocker = canvas.closest('.nge-overlay-blocker');
  if (blocker) blocker.insertBefore(canvas, blocker.firstChild);

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const noise = makeNoise();
  let w = 0, h = 0;

  const fit = () => {
    const el = canvas.parentElement!;
    w = el.offsetWidth; h = el.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  fxObserver = new ResizeObserver(fit);
  fxObserver.observe(canvas.parentElement!);

  // Glowing motes, not trails: long-lived line trails read as worms (Amy).
  // Each particle is a soft radial-gradient sprite drawn with additive
  // blending, drifting slowly along the field; a fast per-frame fade keeps
  // only the faintest comet tail.
  const COLOR_TRIPLETS: [number, number, number][] =
    [[120, 140, 255], [100, 200, 255], [150, 170, 255]];
  const SPRITE = 48; // sprite canvas size; glow radius = SPRITE/2
  const sprites = COLOR_TRIPLETS.map(([r, g, b]) => {
    const s = document.createElement('canvas');
    s.width = s.height = SPRITE;
    const sc = s.getContext('2d')!;
    const grad = sc.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    grad.addColorStop(0, `rgba(255, 255, 255, 0.9)`);
    grad.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 0.55)`);
    grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.12)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    sc.fillStyle = grad;
    sc.fillRect(0, 0, SPRITE, SPRITE);
    return s;
  });

  const COUNT = Math.min(160, Math.max(60, Math.round((w * h) / 9000)));
  const particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    sprite: sprites[Math.floor(Math.random() * sprites.length)],
    size: 5 + Math.random() * 13,          // drawn sprite diameter in px
    speed: 0.12 + Math.random() * 0.18,    // slow drift
    phase: Math.random() * Math.PI * 2,    // twinkle offset
    life: Math.random() * 600,
  }));

  let t = Math.random() * 100;
  const SCALE = 0.010; // field frequency in px⁻¹

  const frame = () => {
    t += 0.0016;
    // Fast fade: only a whisper of a comet tail survives, no worm trails.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(0, 0, w, h);
    // Additive blending makes overlapping motes bloom instead of muddying.
    ctx.globalCompositeOperation = 'lighter';

    for (const p of particles) {
      const angle = noise(p.x * SCALE, p.y * SCALE + t) * Math.PI * 4;
      p.x += Math.cos(angle) * p.speed;
      p.y += Math.sin(angle) * p.speed;
      p.life -= 1;
      if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        p.x = Math.random() * w; p.y = Math.random() * h;
        p.life = 300 + Math.random() * 600;
        continue;
      }
      // Gentle twinkle so the field breathes; fade in/out at life edges.
      const twinkle = 0.55 + 0.45 * Math.sin(t * 40 + p.phase);
      const edge = Math.min(1, p.life / 60);
      ctx.globalAlpha = 0.5 * twinkle * edge;
      ctx.drawImage(p.sprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    fxRaf = requestAnimationFrame(frame);
  };
  fxRaf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(fxRaf);
  fxObserver?.disconnect();
  fxObserver = null;
});
</script>

<template>
  <modal-overlay id="nge-feedback-modal" class="nge-feedback-modal" @hide="emit('hide')">
    <div class="nge-fb-shell">
      <canvas ref="fxCanvas" class="nge-fb-fx" aria-hidden="true"></canvas>
      <button class="nge-fb-exit" @click="emit('hide')">×</button>

      <div v-if="!done" class="nge-fb-body">
        <div class="nge-fb-title">Submit an issue</div>
        <div class="nge-fb-hint">Found a bug or have an idea? Tell us — it goes straight to the team.</div>

        <div class="nge-fb-chips">
          <button
            v-for="c in CATEGORIES" :key="c"
            class="nge-fb-chip"
            :class="{ 'nge-fb-chip--active': category === c }"
            @click="category = c"
          >{{ c }}</button>
        </div>

        <textarea
          v-model="message"
          class="nge-fb-note"
          rows="4"
          placeholder="What happened? What did you expect? Steps to reproduce help a lot."
          @keydown.stop @keyup.stop @keypress.stop
          @input="error = ''"
        ></textarea>

        <div v-if="error" class="nge-fb-err">{{ error }}</div>

        <div class="nge-fb-actions">
          <button class="nge-fb-submit" :disabled="sending" @click="submit">
            {{ sending ? 'Sending…' : 'Submit' }}
          </button>
          <button class="nge-fb-cancel" @click="emit('hide')">Cancel</button>
        </div>
      </div>

      <div v-else class="nge-fb-done holoscan holo-on">
        <span class="holoscan-line" aria-hidden="true"></span>
        <div class="nge-fb-done-icon">✓</div>
        <div class="nge-fb-done-text">Thanks — your report was sent.</div>
      </div>
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-feedback-modal { font-size: 0.9em; }
.nge-fb-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 340px;
  max-width: 460px;
  padding: 20px 22px;
}
/* Lives in .nge-overlay-blocker after mount: above the dim backdrop
   (z-index auto), below the .overlay-content dialog (z-index 100). */
.nge-fb-fx {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.nge-fb-exit {
  position: absolute;
  top: 8px;
  right: 10px;
  background: none;
  border: none;
  color: #889;
  font-size: 1.4em;
  cursor: pointer;
  line-height: 1;
}
.nge-fb-exit:hover { color: #ccd; }
.nge-fb-title {
  font-size: 1.15em;
  font-weight: 700;
  color: #eef;
  margin-bottom: 4px;
}
.nge-fb-hint {
  font-size: 0.82em;
  color: #99a;
  margin-bottom: 14px;
}
.nge-fb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.nge-fb-chip {
  font-size: 0.78em;
  padding: 4px 12px;
  border-radius: 14px;
  color: #bcd;
  background: rgba(120, 140, 255, 0.08);
  border: 1px solid rgba(120, 140, 255, 0.2);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.nge-fb-chip:hover { background: rgba(120, 140, 255, 0.16); }
.nge-fb-chip--active {
  background: rgba(120, 140, 255, 0.28);
  border-color: rgba(150, 170, 255, 0.6);
  color: #fff;
}
.nge-fb-note {
  width: 100%;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #ccd;
  font-size: 0.86em;
  font-family: inherit;
  padding: 8px 10px;
  resize: vertical;
  min-height: 84px;
}
.nge-fb-note:focus { outline: none; border-color: rgba(120, 140, 255, 0.5); }
.nge-fb-note::placeholder { color: #667; }
.nge-fb-err { color: #ff9d9d; font-size: 0.78em; margin-top: 6px; }
.nge-fb-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.nge-fb-submit {
  padding: 7px 18px;
  font-size: 0.84em;
  font-weight: 600;
  color: #fff;
  background: rgba(90, 130, 255, 0.9);
  border: 1px solid rgba(120, 150, 255, 0.7);
  border-radius: 7px;
  cursor: pointer;
}
.nge-fb-submit:hover:not(:disabled) { background: rgba(110, 150, 255, 1); }
.nge-fb-submit:disabled { opacity: 0.5; cursor: default; }
.nge-fb-cancel {
  padding: 7px 16px;
  font-size: 0.84em;
  color: #99a;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  cursor: pointer;
}
.nge-fb-cancel:hover { color: #ccd; border-color: rgba(255, 255, 255, 0.25); }
.nge-fb-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 24px;
  min-width: 300px;
  /* Host requirements for the scan pass (scifi-ui scan-pass.css). */
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}

/* ── Scan pass on the success state ──
   Ported verbatim from scifi-ui components/scan-pass.css (the "light bar"):
   a band that passes ONCE when the panel appears, and never loops. The
   .holo-on class is on the element at insert time, so the pass fires the
   moment the success state mounts. Values carried across unmodified per the
   kit's porting discipline; only the trigger differs (mount instead of
   hover), which is the touch path the kit itself defines. */
.holoscan > .holoscan-line {
  position: absolute; left: 0; right: 0; top: 0; height: 9%; z-index: 2;
  pointer-events: none; opacity: 0;
  background: linear-gradient(180deg, transparent,
    rgb(var(--holo-cyan, 126 224 255) / .13), transparent);
}
@keyframes holoscan-pass {
  from { transform: translateY(-100%); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  to   { transform: translateY(1100%); opacity: 0; }
}
.holoscan.holo-on > .holoscan-line {
  animation: holoscan-pass 1600ms cubic-bezier(.22, .9, .28, 1);
}
@media (prefers-reduced-motion: reduce) {
  .holoscan.holo-on > .holoscan-line { animation: none; opacity: 0; }
}
.nge-fb-done-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 220, 120, 0.15);
  border: 1px solid rgba(0, 220, 120, 0.5);
  color: #34e6a8;
  font-size: 1.4em;
}
.nge-fb-done-text { color: #cde; font-size: 0.9em; }
</style>
