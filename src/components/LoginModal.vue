<script setup lang="ts">
/**
 * LoginModal.vue
 * Center-screen login prompt that intercepts neuroglancer's bottom-corner
 * StatusMessage when middleauth authentication is required.
 *
 * Uses a MutationObserver on #neuroglancer-container (the parent where
 * #statusContainer gets created lazily) to detect login-required messages,
 * hides them, and shows a prominent center-screen modal instead.
 *
 * Handles multiple concurrent login prompts (e.g. two auth servers).
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { openSegPanel } from '../widgets/widget_utils';
import { defaultCredentialsManager } from 'neuroglancer/credentials_provider/default_manager';

/** sticky_auth realm for the CAVE backend (minnie + global.daf-apis CAVE
 *  endpoints). All datasets currently route through this realm. */
const CAVE_STICKY_AUTH_URL = 'https://global.daf-apis.com/sticky_auth';

interface LoginPrompt {
  serverUrl: string;
  statusEl: HTMLElement;
  /** Are we currently waiting for this server's popup to finish? */
  waiting: boolean;
  /** Has the user successfully logged in to this server? */
  done: boolean;
}

const visible   = ref(false);
const prompts   = ref<LoginPrompt[]>([]);
/** True once any server was linked this session; drives the "signing in
 *  twice?" explainer when a second auth realm asks again. */
const hasLinkedBefore = ref((() => {
  try { return sessionStorage.getItem('nge_auth_linked_once') === '1'; } catch { return false; }
})());

/**
 * DOM elements we've already handled (either by surfacing the modal or
 * because the user dismissed). Tracking by element identity, not server URL,
 * so that a NEW login-required status emitted by neuroglancer's credentials
 * provider after a token expiry creates a fresh element that we still
 * surface — even if the user logged into that same server earlier this
 * session. Previously a server-URL Set permanently silenced re-auth.
 */
const handledStatusEls = new WeakSet<HTMLElement>();

let containerObserver: MutationObserver | null = null;
let rootObserver: MutationObserver | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Scan #statusContainer children for middleauth "login required" messages.
 * Collects all of them (there can be multiple servers needing auth).
 */
function scanForLoginPrompts() {
  const container = document.getElementById('statusContainer');
  if (!container) return;

  for (const child of Array.from(container.children) as HTMLElement[]) {
    const text = child.textContent ?? '';
    // Log all status messages for debugging auth issues
    if (text.trim()) {
      console.debug('[LoginModal] statusContainer child:', text.slice(0, 120));
    }
    if (!text.includes('login required') || !text.includes('middleauth')) continue;

    // Already-handled DOM nodes stay hidden. A new credentials prompt
    // creates a new node, which we still want to surface.
    if (handledStatusEls.has(child)) {
      child.style.display = 'none';
      continue;
    }

    // Extract the server URL
    const match = text.match(/middleauth server (\S+)\s+login required/);
    const url = match?.[1] ?? '';
    if (!url) continue;

    // Dedupe within the current modal session — the same DOM child
    // shouldn't be added to prompts twice across rapid mutation events.
    if (prompts.value.some(p => p.statusEl === child)) continue;

    handledStatusEls.add(child);
    child.style.display = 'none';

    prompts.value.push({
      serverUrl: url,
      statusEl: child,
      waiting: false,
      done: false,
    });
  }

  if (prompts.value.length > 0 && prompts.value.some(p => !p.done)) {
    visible.value = true;
  }
}

/**
 * Open the auth popup directly from the user's click event so the browser
 * doesn't block it (programmatic btn.click() loses the user-gesture flag).
 * Then let neuroglancer's own handler wire up its message listener using
 * our popup reference via a temporary window.open override.
 */
function doLogin(prompt: LoginPrompt) {
  if (prompt.waiting || prompt.done) return;
  prompt.waiting = true;

  // Open auth popup directly — user gesture keeps it unblocked
  const w = 400, h = 650;
  const top = window.outerHeight - window.innerHeight + window.innerHeight / 2 - h / 2;
  const left = window.innerWidth / 2 - w / 2;
  const popup = window.open(
    `${prompt.serverUrl}/api/v1/authorize`,
    undefined,
    `toolbar=no,menubar=no,width=${w},height=${h},top=${top},left=${left}`,
  );

  // Temporarily override window.open so neuroglancer's click handler
  // receives our already-opened popup for its message listener.
  const origOpen = window.open;
  window.open = (() => popup) as typeof window.open;

  prompt.statusEl.style.display = '';
  const btn = prompt.statusEl.querySelector('button');
  if (btn) btn.click(); // synchronous — neuroglancer's handler runs inline
  window.open = origOpen;
  prompt.statusEl.style.display = 'none';

  // If user closes popup without completing auth, allow retry
  if (popup) {
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        if (!prompt.done) prompt.waiting = false;
      }
    }, 1000);
  } else {
    prompt.waiting = false; // still blocked somehow
  }
}

function loginAll() {
  for (const p of prompts.value) {
    if (!p.done && !p.waiting) {
      doLogin(p);
      // Stagger popups slightly so they don't overlap
      break; // Only open one at a time
    }
  }
}

function dismiss() {
  visible.value = false;
  // Mark the current status DOM elements as handled — we keep hiding them
  // for the rest of their lifetime. A future re-auth emits a new DOM
  // element, which won't be in handledStatusEls and so will surface.
  for (const p of prompts.value) {
    handledStatusEls.add(p.statusEl);
    if (p.statusEl) p.statusEl.style.display = 'none';
  }
  prompts.value = [];
  // NOTE: Do NOT disconnect the observer here. Neuroglancer may emit
  // new status messages later (mesh loads, new layers, token expiry,
  // dataset switches) and we need the observer to react to them.
}

function handleLoginSuccess() {
  console.log('[LoginModal] middleauthlogin event fired — marking waiting prompts as done');
  // Mark waiting prompts as done. Their DOM elements stay in
  // handledStatusEls so they don't re-prompt, but if neuroglancer emits a
  // NEW status element later (token expired) it will surface fresh.
  for (const p of prompts.value) {
    if (p.waiting) {
      p.done = true;
      p.waiting = false;
      handledStatusEls.add(p.statusEl);
      // Remember that at least one server was linked this session: if the
      // modal resurfaces for another server, the "signing in twice?"
      // explainer shows even though the done row is gone.
      hasLinkedBefore.value = true;
      try { sessionStorage.setItem('nge_auth_linked_once', '1'); } catch {}
    }
  }

  // If all servers are authenticated, auto-dismiss but keep the observer
  // running to silently hide any future messages from these servers.
  if (prompts.value.every(p => p.done)) {
    visible.value = false;
    // Hide any lingering status messages
    for (const p of prompts.value) {
      if (p.statusEl) p.statusEl.style.display = 'none';
    }
    prompts.value = [];
    // NOTE: Do NOT disconnect the observer. Neuroglancer re-emits
    // status messages on new layer/mesh loads and we must keep hiding them.

    // Re-scan aggressively — other auth servers (state, volumes) may take
    // longer to surface their login-required status messages.
    for (const delay of [500, 1500, 3000, 5000, 8000, 12000]) {
      setTimeout(() => scanForLoginPrompts(), delay);
    }

    // After login, auto-select the segmentation layer and open the Seg tab
    // so the user lands in the expected view.
    setTimeout(() => openSegPanel(), 1500);
  }
  // Otherwise modal stays open — user clicks the next server's Login button
}

/** Watch for #statusContainer to appear (it's created lazily by neuroglancer). */
function watchForStatusContainer() {
  const container = document.getElementById('statusContainer');
  if (container) {
    attachContainerObserver(container);
    scanForLoginPrompts();
    return true;
  }
  return false;
}

function attachContainerObserver(container: HTMLElement) {
  if (containerObserver) return; // already watching
  containerObserver = new MutationObserver(() => {
    // Always scan — even after login/dismiss we need to hide messages
    // from already-authenticated servers that neuroglancer re-emits.
    scanForLoginPrompts();
  });
  containerObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

/**
 * Proactively trigger neuroglancer's middleauth flow for the CAVE sticky_auth
 * realm. If the user has no daf-apis token, this surfaces a "login required"
 * status message that our scanner picks up — so the user gets prompted for
 * BOTH brain-wire-test (state server) AND daf-apis (CAVE) in a single modal
 * session.
 *
 * Without this, only whichever auth server neuroglancer happens to query
 * first gets prompted; the other stays silently absent until much later
 * (e.g. when the user clicks Mark Complete and gets a 401), at which point
 * the user is stranded with no obvious recovery path.
 *
 * If the token is already in localStorage, provider.get() returns it
 * immediately and no popup/modal appears. No-op for already-authed users.
 */
async function ensureCaveAuthPrompt() {
  try {
    const provider = defaultCredentialsManager.getCredentialsProvider(
        'middleauth', CAVE_STICKY_AUTH_URL);
    await provider.get();
  } catch (e) {
    // User dismissed popup, network error, etc. — non-fatal; the original
    // 401-on-write flow will catch it later.
    console.warn('[LoginModal] CAVE auth pre-prompt failed:', e);
  }
}

onMounted(() => {
  // Listen for the middleauthlogin event (fired on successful auth)
  window.addEventListener('middleauthlogin', handleLoginSuccess);

  // Try to find statusContainer immediately
  if (!watchForStatusContainer()) {
    // Not created yet — observe the neuroglancer container for its creation
    const ngContainer = document.getElementById('neuroglancer-container');
    if (ngContainer) {
      rootObserver = new MutationObserver(() => {
        if (watchForStatusContainer()) {
          rootObserver?.disconnect();
          rootObserver = null;
        }
      });
      rootObserver.observe(ngContainer, { childList: true, subtree: true });
    }

    // Also poll as a fallback (statusContainer might appear anywhere)
    pollTimer = setInterval(() => {
      if (watchForStatusContainer()) {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
    }, 1000);
  }

  // Proactively prompt for CAVE auth if no daf-apis token exists, so the
  // user logs into both auth servers up front instead of getting a 401
  // surprise on their first save. Small delay so neuroglancer has time to
  // register its credentials providers and surface the status container.
  setTimeout(ensureCaveAuthPrompt, 1500);
});

onUnmounted(() => {
  containerObserver?.disconnect();
  rootObserver?.disconnect();
  if (pollTimer) clearInterval(pollTimer);
  window.removeEventListener('middleauthlogin', handleLoginSuccess);
});

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-login-modal">
      <div v-if="visible" class="nge-login-blocker" @click.self="dismiss">

        <!-- Animated background particles -->
        <div class="nge-holo-particles"></div>

        <div class="nge-login-modal">
          <!-- Glowing ring around icon -->
          <div class="nge-holo-ring-container">
            <div class="nge-holo-ring"></div>
            <div class="nge-holo-ring nge-holo-ring--inner"></div>
            <div class="nge-login-icon">
              <svg viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg" class="nge-neuron-svg">
                <defs>
                  <!-- Fluorescence glow filter -->
                  <filter id="neuronGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur1"/>
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur2"/>
                    <feMerge>
                      <feMergeNode in="blur2"/>
                      <feMergeNode in="blur1"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  <!-- Bright soma glow — animated pulse -->
                  <filter id="somaGlow" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur1">
                      <animate attributeName="stdDeviation" values="4;6;4" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
                    </feGaussianBlur>
                    <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur2">
                      <animate attributeName="stdDeviation" values="8;14;8" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
                    </feGaussianBlur>
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur3">
                      <animate attributeName="stdDeviation" values="2;5;2" dur="4.7s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"/>
                    </feGaussianBlur>
                    <feMerge>
                      <feMergeNode in="blur3"/>
                      <feMergeNode in="blur2"/>
                      <feMergeNode in="blur1"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  <radialGradient id="somaGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#80f0ff" stop-opacity="1"/>
                    <stop offset="40%" stop-color="#20d0ff" stop-opacity="0.85"/>
                    <stop offset="100%" stop-color="#00a0e0" stop-opacity="0.3"/>
                  </radialGradient>
                </defs>

                <g filter="url(#neuronGlow)">
                  <!-- ═══ APICAL DENDRITE (main trunk going up) ═══ -->
                  <path d="M60 52 L59 42 L57 32 L55 22 L52 12 L49 4"
                    stroke="#18cfff" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>
                  <!-- Apical branch right -->
                  <path d="M57 32 L62 26 L68 20 L76 16 L84 13"
                    stroke="#15c8f8" stroke-width="1.4" stroke-linecap="round" opacity="0.75"/>
                  <path d="M68 20 L72 14 L78 8"
                    stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>
                  <path d="M76 16 L82 20 L88 18"
                    stroke="#10b8e8" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
                  <!-- Apical branch left -->
                  <path d="M55 22 L48 16 L40 12 L32 10"
                    stroke="#15c8f8" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/>
                  <path d="M48 16 L44 10 L38 5"
                    stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" opacity="0.5"/>
                  <path d="M40 12 L36 16 L30 15"
                    stroke="#10b8e8" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
                  <!-- Apical tuft (top branches) -->
                  <path d="M52 12 L46 6 L40 2"
                    stroke="#12c0f0" stroke-width="1.0" stroke-linecap="round" opacity="0.6"/>
                  <path d="M49 4 L44 1" stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
                  <path d="M49 4 L52 1" stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
                  <!-- More apical sub-branches -->
                  <path d="M59 42 L66 38 L74 36 L80 33"
                    stroke="#15c8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
                  <path d="M74 36 L78 40 L84 42"
                    stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
                  <path d="M59 42 L52 38 L44 36"
                    stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.55"/>
                  <path d="M44 36 L38 32 L32 30"
                    stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>

                  <!-- ═══ BASAL DENDRITES (spreading from soma) ═══ -->
                  <!-- Basal left-down -->
                  <path d="M54 60 L44 66 L34 74 L26 82 L20 90"
                    stroke="#18cfff" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>
                  <path d="M34 74 L28 70 L20 66 L14 62"
                    stroke="#12c0f0" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
                  <path d="M20 66 L16 72 L10 74"
                    stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
                  <path d="M26 82 L18 80 L12 76"
                    stroke="#0ab0e0" stroke-width="0.8" stroke-linecap="round" opacity="0.45"/>
                  <path d="M20 90 L14 94 L8 96"
                    stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
                  <path d="M20 90 L22 96 L20 102"
                    stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
                  <!-- Basal left-up -->
                  <path d="M52 56 L42 50 L32 48 L22 50"
                    stroke="#15c8f8" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
                  <path d="M32 48 L26 42 L20 38"
                    stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.5"/>
                  <path d="M22 50 L16 54 L10 56"
                    stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
                  <!-- Basal right-down -->
                  <path d="M66 60 L76 66 L86 74 L94 82 L100 90"
                    stroke="#18cfff" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>
                  <path d="M86 74 L92 70 L100 66 L106 62"
                    stroke="#12c0f0" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
                  <path d="M100 66 L104 72 L110 74"
                    stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
                  <path d="M94 82 L102 80 L108 76"
                    stroke="#0ab0e0" stroke-width="0.8" stroke-linecap="round" opacity="0.45"/>
                  <path d="M100 90 L106 94 L112 96"
                    stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
                  <path d="M100 90 L98 96 L100 102"
                    stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
                  <!-- Basal right-up -->
                  <path d="M68 56 L78 50 L88 48 L98 50"
                    stroke="#15c8f8" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
                  <path d="M88 48 L94 42 L100 38"
                    stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.5"/>
                  <path d="M98 50 L104 54 L110 56"
                    stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
                  <!-- Basal down-center -->
                  <path d="M58 64 L52 76 L48 88 L44 98"
                    stroke="#15c8f8" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>
                  <path d="M48 88 L40 92 L34 90"
                    stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.35"/>
                  <path d="M62 64 L68 76 L72 88 L76 98"
                    stroke="#15c8f8" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>
                  <path d="M72 88 L80 92 L86 90"
                    stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.35"/>

                  <!-- ═══ AXON (going down from soma) ═══ -->
                  <path d="M60 64 L60 78 L58 92 L56 106 L54 118 L52 130 L50 138"
                    stroke="#18cfff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
                  <!-- Axon collaterals -->
                  <path d="M58 92 L50 98 L42 100"
                    stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" opacity="0.4"/>
                  <path d="M56 106 L64 112 L72 114"
                    stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" opacity="0.4"/>
                  <path d="M54 118 L46 122 L38 120"
                    stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
                  <!-- Axon terminals -->
                  <path d="M50 138 L44 140" stroke="#08a0d0" stroke-width="0.5" stroke-linecap="round" opacity="0.25"/>
                  <path d="M50 138 L56 140" stroke="#08a0d0" stroke-width="0.5" stroke-linecap="round" opacity="0.25"/>

                  <!-- ═══ DENDRITIC SPINES (tiny dots along branches) ═══ -->
                  <circle cx="57" cy="32" r="0.6" fill="#40e0ff" opacity="0.6"/>
                  <circle cx="52" cy="14" r="0.5" fill="#40e0ff" opacity="0.5"/>
                  <circle cx="66" cy="24" r="0.5" fill="#40e0ff" opacity="0.5"/>
                  <circle cx="44" cy="68" r="0.5" fill="#40e0ff" opacity="0.5"/>
                  <circle cx="36" cy="74" r="0.5" fill="#40e0ff" opacity="0.5"/>
                  <circle cx="76" cy="68" r="0.5" fill="#40e0ff" opacity="0.5"/>
                  <circle cx="86" cy="74" r="0.5" fill="#40e0ff" opacity="0.5"/>
                  <circle cx="48" cy="50" r="0.4" fill="#40e0ff" opacity="0.45"/>
                  <circle cx="78" cy="50" r="0.4" fill="#40e0ff" opacity="0.45"/>
                  <circle cx="28" cy="72" r="0.4" fill="#40e0ff" opacity="0.4"/>
                  <circle cx="92" cy="72" r="0.4" fill="#40e0ff" opacity="0.4"/>
                </g>

                <!-- ═══ SOMA (bright glowing cell body — alive!) ═══ -->
                <g filter="url(#somaGlow)">
                  <!-- Outer soma membrane — gentle size breathe -->
                  <ellipse cx="60" cy="58" rx="7" ry="6" fill="url(#somaGrad)">
                    <animate attributeName="rx" values="7;7.8;7" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
                    <animate attributeName="ry" values="6;6.7;6" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
                  </ellipse>
                  <!-- Inner bright nucleus — faster flicker, slightly offset rhythm -->
                  <ellipse cx="60" cy="58" rx="3.5" ry="3" fill="#b0f8ff" opacity="0.6">
                    <animate attributeName="opacity" values="0.6;0.85;0.55;0.75;0.6" dur="4.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.3 0 0.7 1;0.4 0 0.6 1;0.4 0 0.6 1"/>
                    <animate attributeName="rx" values="3.5;4.2;3.3;3.8;3.5" dur="4.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.3 0 0.7 1;0.4 0 0.6 1;0.4 0 0.6 1"/>
                    <animate attributeName="ry" values="3;3.6;2.8;3.3;3" dur="4.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.3 0 0.7 1;0.4 0 0.6 1;0.4 0 0.6 1"/>
                  </ellipse>
                  <!-- Calcium spark — tiny bright flash that periodically fires -->
                  <ellipse cx="60" cy="57.5" rx="1.5" ry="1.2" fill="#e0ffff" opacity="0">
                    <animate attributeName="opacity" values="0;0;0.9;0.4;0;0;0" dur="5.1s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.9 1;0.0 0 0.2 1;0.3 0 0.7 1;0.8 0 1 1;0.1 0 0.9 1;0.1 0 0.9 1"/>
                    <animate attributeName="rx" values="1.5;1.5;2.5;1.8;1.5;1.5;1.5" dur="5.1s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.9 1;0.0 0 0.2 1;0.3 0 0.7 1;0.8 0 1 1;0.1 0 0.9 1;0.1 0 0.9 1"/>
                  </ellipse>
                </g>

                <!-- ═══ SYNAPTIC SPARKS — signals traveling toward soma ═══ -->
                <!-- Each spark is a tiny bright dot with a soft glow that rides
                     along a dendrite path using animateMotion. Paths run TIP → SOMA
                     so the signal converges inward, like real dendritic integration. -->
                <defs>
                  <filter id="sparkGlow" x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation="2.5" result="g"/>
                    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>

                <!-- Spark 1: Apical tip → soma (main trunk) -->
                <circle r="1.4" fill="#b0ffff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="2.8s" begin="0s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M49 4 L52 12 L55 22 L57 32 L59 42 L60 52"/>
                  <animate attributeName="opacity" values="0;0.85;0.9;0.7;0" dur="2.8s" begin="0s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.8;1.4;1.5;1.2;0.5" dur="2.8s" begin="0s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 2: Apical right branch tip → junction -->
                <circle r="1.1" fill="#90f0ff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="2.2s" begin="1.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M84 13 L76 16 L68 20 L62 26 L57 32"/>
                  <animate attributeName="opacity" values="0;0.7;0.8;0.5;0" dur="2.2s" begin="1.4s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.6;1.1;1.2;0.9;0.3" dur="2.2s" begin="1.4s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 3: Basal left-down tip → soma -->
                <circle r="1.3" fill="#a0f8ff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="3.1s" begin="0.7s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M20 90 L26 82 L34 74 L44 66 L54 60"/>
                  <animate attributeName="opacity" values="0;0.75;0.85;0.6;0" dur="3.1s" begin="0.7s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.7;1.3;1.4;1.0;0.4" dur="3.1s" begin="0.7s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 4: Basal right-down tip → soma -->
                <circle r="1.3" fill="#a0f8ff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="3.1s" begin="2.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M100 90 L94 82 L86 74 L76 66 L66 60"/>
                  <animate attributeName="opacity" values="0;0.75;0.85;0.6;0" dur="3.1s" begin="2.3s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.7;1.3;1.4;1.0;0.4" dur="3.1s" begin="2.3s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 5: Apical left branch → junction -->
                <circle r="1.0" fill="#80e8ff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="2.0s" begin="3.5s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M32 10 L40 12 L48 16 L55 22"/>
                  <animate attributeName="opacity" values="0;0.65;0.75;0.45;0" dur="2.0s" begin="3.5s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.5;1.0;1.1;0.7;0.2" dur="2.0s" begin="3.5s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 6: Axon OUTWARD — signal fires DOWN from soma (efferent!) -->
                <circle r="1.2" fill="#c0ffff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="3.4s" begin="1.0s" repeatCount="indefinite" calcMode="spline" keySplines="0.15 0 0.5 1"
                    path="M60 64 L60 78 L58 92 L56 106 L54 118 L52 130 L50 138"/>
                  <animate attributeName="opacity" values="0;0.9;0.8;0.6;0.3;0" dur="3.4s" begin="1.0s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="1.2;1.5;1.3;1.0;0.7;0.3" dur="3.4s" begin="1.0s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 7: Basal left-up → soma -->
                <circle r="1.0" fill="#90f0ff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="2.3s" begin="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M22 50 L32 48 L42 50 L52 56"/>
                  <animate attributeName="opacity" values="0;0.7;0.8;0.5;0" dur="2.3s" begin="4.2s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.5;1.0;1.1;0.7;0.2" dur="2.3s" begin="4.2s" repeatCount="indefinite"/>
                </circle>

                <!-- Spark 8: Basal right-up → soma -->
                <circle r="1.0" fill="#90f0ff" opacity="0" filter="url(#sparkGlow)">
                  <animateMotion dur="2.3s" begin="5.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
                    path="M98 50 L88 48 L78 50 L68 56"/>
                  <animate attributeName="opacity" values="0;0.7;0.8;0.5;0" dur="2.3s" begin="5.8s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="0.5;1.0;1.1;0.7;0.2" dur="2.3s" begin="5.8s" repeatCount="indefinite"/>
                </circle>

                <!-- ═══ ACTION POTENTIAL RIPPLE — ring radiates from soma ═══ -->
                <circle cx="60" cy="58" r="6" fill="none" stroke="#60e8ff" stroke-width="1.2" opacity="0">
                  <animate attributeName="r" values="6;28;50" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.25 0 0.4 1;0.3 0 0.7 1"/>
                  <animate attributeName="opacity" values="0.45;0.18;0" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.6 1;0.3 0 0.7 1"/>
                  <animate attributeName="stroke-width" values="1.2;0.6;0.2" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.3 0 0.6 1;0.3 0 0.7 1"/>
                </circle>
                <!-- Second ripple, staggered (fires 2s after the first) -->
                <circle cx="60" cy="58" r="6" fill="none" stroke="#40d0ff" stroke-width="0.8" opacity="0">
                  <animate attributeName="r" values="6;28;50" dur="4s" begin="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.25 0 0.4 1;0.3 0 0.7 1"/>
                  <animate attributeName="opacity" values="0.3;0.12;0" dur="4s" begin="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.6 1;0.3 0 0.7 1"/>
                  <animate attributeName="stroke-width" values="0.8;0.4;0.1" dur="4s" begin="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.3 0 0.6 1;0.3 0 0.7 1"/>
                </circle>
              </svg>
            </div>
          </div>

          <!-- Header -->
          <div class="nge-holo-eyebrow">NEURAL ACCESS CONTROL</div>
          <div class="nge-login-title">Identity Verification</div>
          <div class="nge-login-desc">
            Authenticate to connect to the brain mapping community.
          </div>

          <!-- Server list -->
          <div class="nge-login-servers">
            <div
              v-for="(p, i) in prompts"
              :key="p.serverUrl"
              class="nge-login-server-row"
              :class="{
                'nge-login-server-row--done': p.done,
                'nge-login-server-row--waiting': p.waiting,
              }"
            >
              <span class="nge-login-server-status">
                <span v-if="p.done" class="nge-holo-check">✓</span>
                <span v-else-if="p.waiting" class="nge-holo-spinner"></span>
                <span v-else class="nge-holo-dot"></span>
              </span>
              <span class="nge-login-server-url">{{ shortUrl(p.serverUrl) }}</span>
              <button
                v-if="!p.done"
                class="nge-login-server-btn"
                :disabled="p.waiting"
                @click="doLogin(p)"
              >{{ p.waiting ? 'LINKING…' : 'CONNECT' }}</button>
              <span v-else class="nge-login-server-ok">LINKED</span>
            </div>
          </div>

          <!-- The "why do I have to sign in twice" explainer (Amy): each CAVE
               data server runs its own auth realm, so a second dataset means a
               second (instant) allow with the same account. Only shown once
               the first sign-in is done, before that it is just noise. -->
          <div v-if="hasLinkedBefore" class="nge-login-why">
            <span class="nge-login-why-q">Signing in twice?</span>
            Each data server guards its own door. Same account both times, the
            second pass is just a quick allow.
          </div>

          <button
            class="nge-login-btn"
            :disabled="prompts.every(p => p.done || p.waiting)"
            @click="loginAll"
          >
            <span class="nge-login-btn-text">Initialize Connection</span>
            <span class="nge-login-btn-glow"></span>
          </button>
          <button class="nge-login-skip" @click="dismiss">BYPASS ›</button>

          <!-- Bottom data stream decoration -->
          <div class="nge-holo-datastream">
            SYS::AUTH v3.7 · PROTO::MIDDLEAUTH · ENC::TLS1.3
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ══════════════════════════════════════════════════════════════════════════
   HOLOGRAPHIC SCI-FI LOGIN MODAL
   ══════════════════════════════════════════════════════════════════════════ */

.nge-login-why {
  position: relative;
  margin: 14px auto 0;
  max-width: 340px;
  font-size: 11.5px;
  line-height: 1.55;
  color: rgba(190, 212, 240, 0.82);
  background: linear-gradient(135deg, rgba(53, 181, 255, 0.10) 0%, rgba(12, 20, 40, 0.55) 60%);
  border: 1px solid rgba(53, 181, 255, 0.28);
  border-left: 2px solid rgba(53, 181, 255, 0.75);
  border-radius: 10px;
  padding: 10px 14px 11px;
  text-align: left;
  box-shadow: inset 0 0 18px rgba(53, 181, 255, 0.07), 0 2px 12px rgba(0, 0, 0, 0.25);
  animation: nge-login-why-in 0.4s ease;
}
@keyframes nge-login-why-in {
  0%   { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
.nge-login-why-q {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #6fc7ff;
  text-shadow: 0 0 8px rgba(53, 181, 255, 0.5);
  margin-bottom: 4px;
}
.nge-login-why-q::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #35b5ff;
  box-shadow: 0 0 6px rgba(53, 181, 255, 0.9);
}

.nge-login-blocker {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: radial-gradient(ellipse at center, rgba(0, 15, 40, 0.85) 0%, rgba(0, 0, 0, 0.95) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(12px) saturate(1.3);
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}

/* ── Floating particle grid ── */
.nge-holo-particles {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(74, 158, 255, 0.3) 0%, transparent 100%),
    radial-gradient(1px 1px at 40% 70%, rgba(0, 210, 255, 0.2) 0%, transparent 100%),
    radial-gradient(1px 1px at 80% 40%, rgba(206, 147, 216, 0.2) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 65% 80%, rgba(74, 158, 255, 0.25) 0%, transparent 100%),
    radial-gradient(1px 1px at 90% 15%, rgba(0, 255, 200, 0.15) 0%, transparent 100%),
    radial-gradient(1px 1px at 10% 85%, rgba(74, 158, 255, 0.2) 0%, transparent 100%);
  background-size: 250px 250px, 300px 300px, 200px 200px, 350px 350px, 180px 180px, 280px 280px;
  animation: nge-holo-drift 20s linear infinite;
  pointer-events: none;
  opacity: 0.6;
}

@keyframes nge-holo-drift {
  0%   { transform: translate(0, 0); }
  100% { transform: translate(-60px, -40px); }
}

/* ── Main modal ── */
.nge-login-modal {
  background:
    linear-gradient(165deg,
      rgba(10, 18, 35, 0.95) 0%,
      rgba(5, 10, 22, 0.98) 100%);
  border: 1px solid rgba(0, 180, 255, 0.18);
  border-radius: 2px;
  padding: 44px 48px 32px;
  text-align: center;
  max-width: 460px;
  width: 90%;
  position: relative;
  overflow: hidden;
  animation: nge-holo-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
  box-shadow:
    0 0 80px rgba(0, 150, 255, 0.08),
    0 0 200px rgba(0, 150, 255, 0.03),
    inset 0 0 80px rgba(0, 100, 200, 0.02),
    0 20px 60px rgba(0, 0, 0, 0.5);
}

/* Outer glow border effect */
.nge-login-modal::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 2px;
  background: linear-gradient(
    135deg,
    rgba(0, 180, 255, 0.4) 0%,
    rgba(0, 100, 200, 0.05) 25%,
    rgba(120, 0, 255, 0.15) 50%,
    rgba(0, 100, 200, 0.05) 75%,
    rgba(0, 220, 180, 0.3) 100%
  );
  background-size: 300% 300%;
  animation: nge-holo-border 6s ease-in-out infinite;
  z-index: -1;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  padding: 1px;
}

/* Inner ambient glow */
.nge-login-modal::after {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(
    ellipse at 50% 0%,
    rgba(0, 150, 255, 0.06) 0%,
    transparent 60%
  );
  pointer-events: none;
}

@keyframes nge-holo-materialize {
  0%   {
    opacity: 0;
    transform: scale(1.04) translateY(-10px);
    filter: blur(20px) brightness(3);
    box-shadow: 0 0 120px rgba(0, 180, 255, 0.5);
  }
  30%  {
    opacity: 0.6;
    filter: blur(3px) brightness(1.5);
  }
  60%  {
    opacity: 1;
    transform: scale(0.99);
    filter: blur(0) brightness(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
    filter: blur(0) brightness(1);
  }
}

@keyframes nge-holo-border {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* ── Glowing ring around icon ── */
.nge-holo-ring-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 130px;
  height: 130px;
  margin-bottom: 14px;
}

.nge-holo-ring {
  position: absolute;
  inset: 0;
  border: 1.5px solid rgba(0, 180, 255, 0.25);
  border-radius: 50%;
  border-top-color: rgba(0, 220, 255, 0.8);
  border-right-color: rgba(120, 0, 255, 0.4);
  animation: nge-holo-spin 3s linear infinite;
}

.nge-holo-ring--inner {
  inset: 10px;
  border-color: rgba(0, 150, 255, 0.1);
  border-bottom-color: rgba(0, 255, 200, 0.5);
  border-left-color: rgba(0, 200, 255, 0.3);
  animation-duration: 5s;
  animation-direction: reverse;
}

@keyframes nge-holo-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.nge-login-icon {
  position: relative;
  z-index: 2;
  width: 90px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 18px rgba(0, 180, 255, 0.5));
  animation: nge-holo-icon-breathe 3s ease-in-out infinite;
}

.nge-neuron-svg {
  width: 90px;
  height: 100px;
}

@keyframes nge-holo-icon-breathe {
  0%, 100% { filter: drop-shadow(0 0 12px rgba(0, 180, 255, 0.4)); }
  50%      { filter: drop-shadow(0 0 24px rgba(0, 200, 255, 0.7)); }
}

/* ── Eyebrow label ── */
.nge-holo-eyebrow {
  font-size: 0.58em;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(0, 200, 255, 0.5);
  margin-bottom: 6px;
  position: relative;
  z-index: 2;
}

.nge-login-title {
  font-size: 1.5em;
  font-weight: 300;
  color: rgba(200, 230, 255, 0.95);
  margin-bottom: 8px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  position: relative;
  z-index: 2;
  text-shadow: 0 0 30px rgba(0, 150, 255, 0.3);
}

.nge-login-desc {
  font-size: 0.78em;
  color: rgba(120, 160, 200, 0.6);
  line-height: 1.6;
  margin-bottom: 24px;
  letter-spacing: 0.02em;
  position: relative;
  z-index: 2;
}

/* ── Server list ── */
.nge-login-servers {
  margin-bottom: 24px;
  text-align: left;
  position: relative;
  z-index: 2;
}

.nge-login-server-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 1px;
  background: rgba(0, 120, 255, 0.04);
  border: 1px solid rgba(0, 180, 255, 0.1);
  border-left: 2px solid rgba(0, 200, 255, 0.3);
  margin-bottom: 6px;
  transition: all 0.3s;
}

.nge-login-server-row--done {
  border-left-color: rgba(0, 255, 150, 0.5);
  background: rgba(0, 255, 150, 0.03);
  border-color: rgba(0, 255, 150, 0.1);
  border-left-color: rgba(0, 255, 150, 0.5);
}

.nge-login-server-row--waiting {
  border-left-color: rgba(0, 200, 255, 0.6);
  animation: nge-holo-row-pulse 1.5s ease-in-out infinite;
}

@keyframes nge-holo-row-pulse {
  0%, 100% { background: rgba(0, 120, 255, 0.04); }
  50%      { background: rgba(0, 150, 255, 0.08); }
}

.nge-login-server-status {
  flex-shrink: 0;
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nge-holo-check {
  color: rgba(0, 255, 150, 0.9);
  font-weight: 700;
  font-size: 0.9em;
  text-shadow: 0 0 8px rgba(0, 255, 150, 0.5);
}

.nge-holo-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(0, 180, 255, 0.3);
  border: 1px solid rgba(0, 200, 255, 0.5);
  box-shadow: 0 0 6px rgba(0, 200, 255, 0.3);
}

.nge-holo-spinner {
  width: 14px;
  height: 14px;
  border: 1.5px solid rgba(0, 180, 255, 0.15);
  border-top-color: rgba(0, 220, 255, 0.9);
  border-radius: 50%;
  animation: nge-holo-spin 0.8s linear infinite;
}

.nge-login-server-url {
  flex: 1;
  font-size: 0.78em;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  color: rgba(0, 180, 255, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.03em;
}

.nge-login-server-btn {
  flex-shrink: 0;
  padding: 5px 16px;
  border: 1px solid rgba(0, 200, 255, 0.3);
  border-radius: 1px;
  background: rgba(0, 150, 255, 0.08);
  color: rgba(0, 220, 255, 0.9);
  font-size: 0.68em;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transition: all 0.2s;
}

.nge-login-server-btn:hover:not(:disabled) {
  background: rgba(0, 180, 255, 0.18);
  border-color: rgba(0, 220, 255, 0.6);
  box-shadow: 0 0 16px rgba(0, 200, 255, 0.2);
}

.nge-login-server-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.nge-login-server-ok {
  flex-shrink: 0;
  font-size: 0.68em;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(0, 255, 150, 0.8);
  text-shadow: 0 0 10px rgba(0, 255, 150, 0.3);
}

/* ── Main CTA button ── */
.nge-login-btn {
  display: block;
  width: 100%;
  padding: 14px 24px;
  border: 1px solid rgba(0, 180, 255, 0.3);
  border-radius: 2px;
  background: linear-gradient(135deg,
    rgba(0, 100, 255, 0.2) 0%,
    rgba(0, 60, 180, 0.3) 50%,
    rgba(80, 0, 200, 0.2) 100%
  );
  color: rgba(200, 230, 255, 0.95);
  font-size: 0.88em;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: all 0.3s;
  position: relative;
  z-index: 2;
  overflow: hidden;
}

.nge-login-btn-text {
  position: relative;
  z-index: 2;
}

.nge-login-btn-glow {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(0, 200, 255, 0.15) 50%,
    transparent 100%
  );
  animation: nge-holo-btn-sweep 3s ease-in-out infinite;
  pointer-events: none;
}

@keyframes nge-holo-btn-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.nge-login-btn:hover:not(:disabled) {
  border-color: rgba(0, 220, 255, 0.6);
  background: linear-gradient(135deg,
    rgba(0, 120, 255, 0.3) 0%,
    rgba(0, 80, 200, 0.4) 50%,
    rgba(100, 0, 255, 0.25) 100%
  );
  box-shadow:
    0 0 30px rgba(0, 180, 255, 0.15),
    inset 0 0 30px rgba(0, 150, 255, 0.05);
  transform: translateY(-1px);
}

.nge-login-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 0 40px rgba(0, 200, 255, 0.25);
}

.nge-login-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ── Skip/bypass ── */
.nge-login-skip {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding: 8px;
  background: none;
  border: none;
  color: rgba(100, 140, 180, 0.35);
  font-size: 0.65em;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  transition: color 0.15s;
  position: relative;
  z-index: 2;
}

.nge-login-skip:hover {
  color: rgba(0, 200, 255, 0.5);
}

/* ── Bottom data stream text ── */
.nge-holo-datastream {
  margin-top: 20px;
  font-size: 0.5em;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  color: rgba(0, 180, 255, 0.2);
  letter-spacing: 0.08em;
  position: relative;
  z-index: 2;
  animation: nge-holo-flicker 8s ease-in-out infinite;
}

@keyframes nge-holo-flicker {
  0%, 100% { opacity: 1; }
  92%      { opacity: 1; }
  93%      { opacity: 0.3; }
  94%      { opacity: 1; }
  96%      { opacity: 0.6; }
  97%      { opacity: 1; }
}

/* ── Transition ── */
.nge-login-modal-enter-active { transition: all 0.4s ease-out; }
.nge-login-modal-leave-active { transition: all 0.25s ease-in; }
.nge-login-modal-enter-from   { opacity: 0; }
.nge-login-modal-leave-to     { opacity: 0; filter: blur(8px) brightness(2); }
</style>
