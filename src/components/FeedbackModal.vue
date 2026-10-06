<script setup lang="ts">
import { recentConsoleCount, recentConsoleText } from '../util/console_buffer';
import { caveToken } from '../secure_write';
import { reportFeedbackFailure } from '../util/error_reporting';
import { functionUrl } from '../functions_base';
/**
 * FeedbackModal.vue
 * "Submit an issue" — lets any user report a bug / idea / data problem from
 * anywhere in the app. Posts to the `submitIssue` Cloud Function which relays
 * to Slack (#citsci_feedback) and keeps a Firestore record. No auth required.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import ScreenshotDialog from 'components/ScreenshotDialog.vue';
import GrowingNeuron from 'components/GrowingNeuron.vue';
import { useProofreadingBackendStore } from '../store';
import { mintShortStateLink } from '../util/state_link';

const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();

const ISSUE_URL =
  (window as any).__NGE_SUBMIT_ISSUE_URL ||
  functionUrl('submitIssue');

const CATEGORIES = ['Bug', 'Idea', 'Data problem', 'Other'] as const;
const category = ref<typeof CATEGORIES[number]>('Bug');
const message = ref('');
const sending = ref(false);
/** Attach a share link of the current view (on by default; Celia's ask). */
const attachView = ref(true);
// Recent console warnings and errors (util/console_buffer.ts), for the team.
const attachConsole = ref(true);
const consoleCount = ref(recentConsoleCount());
const done = ref(false);
const error = ref('');

// While it sends, the form gives way to a neuron that grows as the report
// goes (GrowingNeuron: dendrites, axon, terminals, one part for each real
// step of the submit) and the steps themselves, ticked off as each finishes
// (Ames 2026-10-04; the growing cell 2026-10-06). Nothing here is timed for
// show: stage follows submit().
type Stage = 'view' | 'send' | 'file';
const stage = ref<Stage>('send');
const sendSteps = computed(() => [
  ...(attachView.value ? [{ key: 'view' as Stage, label: 'Saving your view' }] : []),
  { key: 'send' as Stage, label: 'Sending it to the team' },
  { key: 'file' as Stage, label: 'Filing it for triage' },
]);
const stepState = (key: Stage) => {
  const order = sendSteps.value.map(x => x.key);
  const at = order.indexOf(stage.value), i = order.indexOf(key);
  return i < at ? 'done' : i === at ? 'now' : 'next';
};
/** Steps finished so far, which is how far the neuron has grown. */
const stepsDone = computed(() => Math.max(0, sendSteps.value.map(x => x.key).indexOf(stage.value)));
/** One cell for each report: the cell that grew while it sent is the one
 *  that lights up when it arrives. */
const neuronSeed = ref(1);
const sentWith = ref<{ k: string; v: string }[]>([]);

// Screenshot attachment. Reuses the help request flow unchanged:
// ScreenshotDialog in `attach` mode captures the viewer, lets the user
// annotate it with the pen, uploads the PNG to Supabase Storage
// (admin-uploads/help-screenshots via backend.uploadHelpScreenshot) and emits
// the public URL.
const screenshotUrl = ref('');
const showScreenshotDialog = ref(false);
function onScreenshotAttached(payload: { url: string }) {
  screenshotUrl.value = payload.url;
  error.value = '';
}
function clearScreenshot() {
  screenshotUrl.value = '';
}

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
  neuronSeed.value = Math.floor(Math.random() * 1e9);
  error.value = '';
  try {
    // NEVER send window.location.href: the hash carries the full viewer
    // state (multiple KB) and relays like Slack truncate it, leaving a link
    // that dies with "Error parsing state: Unterminated string in JSON".
    // Mint a short saved-state link instead; if that fails (no auth, state
    // server down), send the bare page URL plus the position so the report
    // still locates the spot without a broken link.
    stage.value = attachView.value ? 'view' : 'send';
    const shortLink = attachView.value ? await mintShortStateLink() : null;
    stage.value = 'send';
    let pageUrl = shortLink;
    if (!pageUrl) {
      const v: any = (window as any)['viewer'];
      const pos = v?.navigationState?.position?.value;
      const at = pos ? ` @ ${Math.round(pos[0])},${Math.round(pos[1])},${Math.round(pos[2])}` : '';
      pageUrl = `${window.location.origin}${window.location.pathname}${at}`;
    }
    const shot = screenshotUrl.value;
    // The submitIssue Cloud Function only relays message/category/url/
    // dataset/user to Slack, so the screenshot link rides in the message
    // text to reach #citsci_feedback. `screenshotUrl` is sent too, for when
    // the function learns to read it.
    const consoleLog = attachConsole.value && recentConsoleCount() ? recentConsoleText() : '';
    let slackText = shot ? `${text}\n\nScreenshot: ${shot}` : text;
    // The log itself stays in Admin Hub; Slack just says it's there.
    if (consoleLog) slackText += `\n\nConsole: ${recentConsoleCount()} recent warnings/errors attached (Admin Hub > Triage)`;
    // A report must never be lost to a failed relay (Ames 2026-10-02: "Could
    // not submit", with no reason and nothing saved). If the Slack relay
    // fails, remember why, still save the report below, and only show an
    // error, with the real reason, if that fails too.
    let relayFailure = '';
    try {
      const res = await fetch(ISSUE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: caveToken(),
          message: slackText,
          category: category.value,
          url: pageUrl,
          dataset: currentDataset(),
          user: backend.userName || '',
          screenshotUrl: shot || undefined,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any));
        relayFailure = res.status === 429 ? 'Too many reports in a short time. Wait a minute and try again.'
          : res.status === 401 ? 'Your sign in has expired. Reload the page and sign in again.'
          : `${j?.error || 'The report server refused it'} (${res.status})`;
      }
    } catch (e: any) {
      relayFailure = e?.name === 'TimeoutError' ? 'The report server did not answer.' : `Could not reach the report server (${e?.message || 'network error'}).`;
    }
    if (relayFailure) reportFeedbackFailure(relayFailure, pageUrl || '');

    // Mirror into Supabase so the triage agent can read reports (the Cloud
    // Function's Slack/Firestore relay stays the human-facing feed).
    // Best-effort: a failure here must not surface as a failed submit.
    stage.value = 'file';
    try {
      const { supabase } = await import('../supabase');
      const row: Record<string, any> = {
        category: category.value,
        message: text,
        url: pageUrl,
        dataset: currentDataset() || null,
        user_id: backend.userId || null,
        user_name: backend.userName || null,
      };
      if (shot) row.screenshot_url = shot;
      if (consoleLog) row.console_log = consoleLog;
      let { error: insErr } = await supabase.from('site_issues').insert(row);
      // Until supabase-site-issues-screenshot.sql runs, the column is
      // missing: PostgREST answers PGRST204 "Could not find the
      // 'screenshot_url' column" (probed 2026-09-25). Never drop the report:
      // retry without the column and keep the link in the message instead.
      if (insErr && 'screenshot_url' in row &&
          (insErr.code === 'PGRST204' || /screenshot_url/.test(insErr.message || ''))) {
        delete row.screenshot_url;
        row.message = slackText;
        ({ error: insErr } = await supabase.from('site_issues').insert(row));
      }
      // Until supabase-site-issues-console.sql runs, drop the log rather than the report.
      if (insErr && 'console_log' in row &&
          (insErr.code === 'PGRST204' || /console_log/.test(insErr.message || ''))) {
        delete row.console_log;
        ({ error: insErr } = await supabase.from('site_issues').insert(row));
      }
      if (insErr) throw insErr;
    } catch (e: any) {
      console.warn('[feedback] Supabase mirror failed:', e);
      // Saved nowhere: tell the player why instead of pretending.
      if (relayFailure) throw new Error(relayFailure);
    }
    sentWith.value = [
      { k: 'Type', v: category.value },
      { k: 'View', v: shortLink ? 'attached' : 'position only' },
      { k: 'Console', v: consoleLog ? `${recentConsoleCount()} lines` : 'none' },
      { k: 'Screenshot', v: shot ? 'attached' : 'none' },
    ];
    done.value = true;
    setTimeout(() => emit('hide'), 4200);
  } catch (e: any) {
    error.value = `Could not submit. ${e?.message || 'Please try again.'}`;
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

  // Lifecycle: the field greets you, then bows out after a few seconds so
  // it never distracts from typing; it returns for the success state.
  // fieldAlpha eases toward fieldTarget; at 0 the canvas is wiped (traces
  // included) and the rAF loop parks itself until woken.
  let surge = 1;          // particle speed multiplier; jumps when the report lands
  let fieldAlpha = 1;
  let fieldTarget = 1;
  let parked = false;
  const ENTRANCE_MS = 4500;
  let fadeTimer = setTimeout(() => { fieldTarget = 0; }, ENTRANCE_MS);

  const frame = () => {
    t += 0.0016;
    fieldAlpha += (fieldTarget - fieldAlpha) * 0.035;
    surge += (1 - surge) * 0.03;
    if (fieldTarget === 0 && fieldAlpha < 0.01) {
      ctx.clearRect(0, 0, w, h); // traces vanish with the motes
      parked = true;
      return; // stop scheduling frames while invisible
    }

    // Fast fade: only a whisper of a comet tail survives, no worm trails.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(0, 0, w, h);
    // Additive blending makes overlapping motes bloom instead of muddying.
    ctx.globalCompositeOperation = 'lighter';

    for (const p of particles) {
      const angle = noise(p.x * SCALE, p.y * SCALE + t) * Math.PI * 4;
      p.x += Math.cos(angle) * p.speed * surge;
      p.y += Math.sin(angle) * p.speed * surge;
      p.life -= 1;
      if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        p.x = Math.random() * w; p.y = Math.random() * h;
        p.life = 300 + Math.random() * 600;
        continue;
      }
      // Gentle twinkle so the field breathes; fade in/out at life edges.
      const twinkle = 0.55 + 0.45 * Math.sin(t * 40 + p.phase);
      const edge = Math.min(1, p.life / 60);
      ctx.globalAlpha = 0.5 * twinkle * edge * fieldAlpha;
      ctx.drawImage(p.sprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    fxRaf = requestAnimationFrame(frame);
  };
  fxRaf = requestAnimationFrame(frame);

  // Encore while sending and on the success state: wake the field back up.
  watch([done, sending], ([isDone, isSending]) => {
    if (!isDone && !isSending) return;
    if (isDone) surge = 9;
    clearTimeout(fadeTimer);
    fieldTarget = 1;
    if (parked) {
      parked = false;
      fxRaf = requestAnimationFrame(frame);
    }
  });
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

      <!-- The same capture + annotate + upload dialog the help request form
           uses. Teleported to <body>: .nge-overlay-content has a
           backdrop-filter, which would otherwise become the containing block
           for the dialog's position: fixed overlay and clip it to the modal. -->
      <Teleport to="body">
        <ScreenshotDialog
          :show="showScreenshotDialog"
          mode="attach"
          @close="showScreenshotDialog = false"
          @attached="onScreenshotAttached"
        />
      </Teleport>

      <div v-if="sending && !done" class="nge-fb-sending" role="status" aria-live="polite">
        <GrowingNeuron :stage="stepsDone" :stages="sendSteps.length" :seed="neuronSeed" />
        <div class="nge-fb-sending-title">Sending your report</div>
        <ul class="nge-fb-steps">
          <li v-for="st in sendSteps" :key="st.key" class="nge-fb-step" :class="`nge-fb-step--${stepState(st.key)}`">
            <span class="nge-fb-step-mark" aria-hidden="true">{{ stepState(st.key) === 'done' ? '✓' : '' }}</span>
            <span>{{ st.label }}</span>
          </li>
        </ul>
      </div>

      <div v-else-if="!done" class="nge-fb-body">
        <div class="nge-fb-title">Submit an issue</div>
        <div class="nge-fb-hint">Found a bug or have an idea? Tell us, it goes straight to the team.</div>

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

        <label class="nge-fb-attach">
          <input type="checkbox" v-model="attachView" />
          <span>Attach my current view, a share link so the team sees exactly what I see</span>
        </label>
        <label class="nge-fb-attach">
          <input type="checkbox" v-model="attachConsole" :disabled="!consoleCount" />
          <span>Attach recent console messages<template v-if="consoleCount"> ({{ consoleCount }} recent warnings and errors, passwords and tokens removed)</template><template v-else> (none so far)</template></span>
        </label>

        <div class="nge-fb-shot-row">
          <button
            v-if="!screenshotUrl"
            class="nge-fb-chip nge-fb-shot-btn"
            :disabled="sending"
            title="Capture the current view and mark it up with the pen"
            @click="showScreenshotDialog = true"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/>
              <circle cx="12" cy="13.5" r="3.8"/>
            </svg>
            <span>Screenshot</span>
          </button>
          <div v-else class="nge-fb-shot-preview">
            <a :href="screenshotUrl" target="_blank" rel="noopener" title="Open full size">
              <img :src="screenshotUrl" alt="Attached screenshot" />
            </a>
            <button class="nge-fb-shot-remove" :disabled="sending" title="Remove screenshot"
                    aria-label="Remove screenshot" @click="clearScreenshot">×</button>
          </div>
        </div>

        <div v-if="error" class="nge-fb-err">{{ error }}</div>

        <div class="nge-fb-actions">
          <button class="nge-fb-submit" :disabled="sending" @click="submit">
            {{ sending ? 'Sending…' : 'Submit' }}
          </button>
          <button class="nge-fb-cancel" @click="emit('hide')">Cancel</button>
        </div>
      </div>

      <div v-else class="nge-fb-done holoscan holo-on" role="status" aria-live="polite" @click="emit('hide')">
        <span class="holoscan-line" aria-hidden="true"></span>
        <span class="nge-fb-corner nge-fb-corner--tl" aria-hidden="true"></span>
        <span class="nge-fb-corner nge-fb-corner--br" aria-hidden="true"></span>
        <!-- The same neuron, now lit end to end: the signal arrived. -->
        <GrowingNeuron arrived :seed="neuronSeed" />
        <div class="nge-fb-seal" aria-hidden="true">
          <svg viewBox="0 0 96 96">
            <circle class="nge-fb-seal-ticks" cx="48" cy="48" r="44"/>
            <circle class="nge-fb-seal-arc" cx="48" cy="48" r="37"/>
            <circle class="nge-fb-seal-ring" cx="48" cy="48" r="29" pathLength="100"/>
            <path class="nge-fb-seal-check" pathLength="100" d="M34 49.5 44 59 63 38.5"/>
          </svg>
          <span class="nge-fb-seal-wave"></span>
          <span class="nge-fb-seal-wave nge-fb-seal-wave--2"></span>
        </div>
        <div class="nge-fb-done-kicker">Signal received</div>
        <div class="nge-fb-done-text">Thank you! Your report reached the team.</div>
        <div class="nge-fb-done-next">We'll look into it!</div>
        <dl class="nge-fb-readout">
          <div v-for="(x, i) in sentWith" :key="x.k" class="nge-fb-readout-cell" :style="{ '--i': i }">
            <dt>{{ x.k }}</dt><dd>{{ x.v }}</dd>
          </div>
        </dl>
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
.nge-fb-attach {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  font-size: 0.78em;
  color: #9ab;
  cursor: pointer;
}
.nge-fb-attach input { accent-color: #7890ff; }
.nge-fb-shot-row {
  display: flex;
  align-items: center;
  margin-top: 10px;
}
.nge-fb-shot-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.nge-fb-shot-btn:disabled { opacity: 0.5; cursor: default; }
.nge-fb-shot-preview {
  position: relative;
  display: inline-block;
  border-radius: 8px;
  border: 1px solid rgba(120, 140, 255, 0.3);
  background: rgba(0, 0, 0, 0.35);
  overflow: hidden;
  line-height: 0;
}
.nge-fb-shot-preview img {
  display: block;
  max-width: 160px;
  max-height: 90px;
  object-fit: contain;
}
.nge-fb-shot-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(4, 6, 14, 0.8);
  color: #ccd;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.nge-fb-shot-remove:hover { color: #fff; border-color: rgba(150, 170, 255, 0.6); }
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
/* ── Sending: a neuron that grows as the report goes, and the real steps ── */
.nge-fb-sending {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 22px 12px 18px; min-width: 320px;
}
.nge-fb-sending-title { font-size: 1.05em; font-weight: 700; color: #eef; }
.nge-fb-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; align-self: center; }
.nge-fb-step { display: flex; align-items: center; gap: 9px; font-size: 0.86em; color: #6f7c96; transition: color 0.2s; }
.nge-fb-step-mark {
  width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #06231a;
  border: 1.5px solid rgba(120, 140, 180, 0.4);
}
.nge-fb-step--now { color: #e6eeff; }
.nge-fb-step--now .nge-fb-step-mark {
  border-color: #7ee0ff; box-shadow: 0 0 8px rgba(126, 224, 255, 0.7);
  animation: nge-fb-step-now 1s ease-in-out infinite;
}
.nge-fb-step--done { color: #9fb3cc; }
.nge-fb-step--done .nge-fb-step-mark { background: #34e6a8; border-color: #34e6a8; }
@keyframes nge-fb-step-now { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.25); } }
@media (prefers-reduced-motion: reduce) {
  .nge-fb-step--now .nge-fb-step-mark { animation: none; }
}
.nge-fb-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 20px 20px;
  min-width: 340px;
  cursor: pointer;
  /* Host requirements for the scan pass (scifi-ui scan-pass.css). */
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}
/* Instrument corners, as on the scifi-ui hologram tank. */
.nge-fb-corner { position: absolute; width: 16px; height: 16px; border-color: rgba(126, 240, 200, 0.85); filter: drop-shadow(0 0 5px rgba(52, 230, 168, 0.7)); animation: nge-fb-rise 0.4s ease-out 0.15s both; }
.nge-fb-corner--tl { left: 4px; top: 4px; border-left: 2px solid; border-top: 2px solid; border-top-left-radius: 6px; }
.nge-fb-corner--br { right: 4px; bottom: 4px; border-right: 2px solid; border-bottom: 2px solid; border-bottom-right-radius: 6px; }

@keyframes nge-fb-light { to { stroke-dashoffset: 0; } }
@keyframes nge-fb-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* The seal: tick ring, a turning arc, and a check that draws itself. */
.nge-fb-seal { position: relative; width: 96px; height: 96px; margin: 2px 0 4px; }
.nge-fb-seal svg { width: 100%; height: 100%; overflow: visible; }
.nge-fb-seal-ticks {
  fill: none; stroke: rgba(126, 224, 255, 0.5); stroke-width: 4; stroke-dasharray: 1 8.87;
  transform-origin: 48px 48px; animation: nge-fb-spin 24s linear infinite, nge-fb-rise 0.4s ease-out 0.5s both;
}
.nge-fb-seal-arc {
  fill: none; stroke: rgba(52, 230, 168, 0.75); stroke-width: 1.5; stroke-linecap: round; stroke-dasharray: 46 28 12 147;
  transform-origin: 48px 48px; animation: nge-fb-spin 5s linear infinite reverse, nge-fb-rise 0.4s ease-out 0.6s both;
}
.nge-fb-seal-ring {
  fill: rgba(0, 220, 120, 0.1); stroke: #34e6a8; stroke-width: 2; stroke-linecap: round;
  stroke-dasharray: 100; stroke-dashoffset: 100; transform-origin: 48px 48px; transform: rotate(-90deg);
  filter: drop-shadow(0 0 6px rgba(52, 230, 168, 0.7));
  animation: nge-fb-light 0.55s ease-out 0.7s forwards;
}
.nge-fb-seal-check {
  fill: none; stroke: #c8ffe9; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 100; stroke-dashoffset: 100;
  filter: drop-shadow(0 0 6px rgba(52, 230, 168, 0.95));
  animation: nge-fb-light 0.4s cubic-bezier(.5, 0, .2, 1) 1.1s forwards;
}
.nge-fb-seal-wave {
  position: absolute; inset: 19px; border-radius: 50%; border: 1.5px solid rgba(52, 230, 168, 0.8);
  opacity: 0; animation: nge-fb-wave 1.2s ease-out 1.25s forwards;
}
.nge-fb-seal-wave--2 { animation-delay: 1.45s; border-color: rgba(126, 224, 255, 0.6); }
@keyframes nge-fb-spin { to { rotate: 360deg; } }
@keyframes nge-fb-wave { 0% { opacity: 0.9; transform: scale(1); } 100% { opacity: 0; transform: scale(2.7); } }

.nge-fb-done-kicker {
  font-family: 'Consolas', 'Monaco', monospace; font-size: 0.72em; font-weight: 700;
  letter-spacing: 0.22em; text-transform: uppercase; color: #34e6a8;
  animation: nge-fb-rise 0.4s ease-out 1.2s both;
}
.nge-fb-done-text { color: #f0f6ff; font-size: 1.08em; font-weight: 700; animation: nge-fb-rise 0.4s ease-out 1.3s both; }
.nge-fb-done-next { color: #a9bbd3; font-size: 0.84em; text-align: center; max-width: 300px; animation: nge-fb-rise 0.4s ease-out 1.45s both; }
/* What went with it, as a data readout. */
.nge-fb-readout { display: grid; grid-template-columns: repeat(4, auto); gap: 6px; margin: 10px 0 0; }
.nge-fb-readout-cell {
  display: flex; flex-direction: column; gap: 2px; padding: 5px 9px; min-width: 62px;
  border: 1px solid rgba(74, 150, 224, 0.3); border-radius: 6px; background: rgba(8, 16, 30, 0.6);
  animation: nge-fb-rise 0.35s ease-out calc(1.6s + var(--i, 0) * 0.08s) both;
}
.nge-fb-readout dt { font-family: 'Consolas', 'Monaco', monospace; font-size: 0.62em; letter-spacing: 0.14em; text-transform: uppercase; color: #6f8bb0; }
.nge-fb-readout dd { margin: 0; font-size: 0.8em; font-weight: 600; color: #dcebff; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .nge-fb-done *, .nge-fb-done *::before { animation-duration: 0.01s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
  .nge-fb-seal-wave { display: none; }
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
</style>
