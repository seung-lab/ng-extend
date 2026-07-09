// assistant/spotlight.ts — the `spotlight` action's implementation. Rings a
// specific UI control with the same pulsing cyan glow the Site Tour uses
// (`.nge-tour-target`, an unscoped class in TutorialStep.vue) and shows an
// optional note beside it. Purely visual and ephemeral — it never clicks,
// edits, or changes app state.
//
// The model may only spotlight a KNOWN target key from SPOTLIGHT_TARGETS; it
// cannot pass an arbitrary CSS selector. Add new targets here (and to the
// backend tool enum) as the UI grows.

export const SPOTLIGHT_TARGETS: Record<string, string> = {
  // Always-present chrome
  pyrLogo:        ".nge-pyr-logo",
  shareButton:    '[title="Share State"]',
  datasetButton:  ".nge-dataset-btn",
  askButton:      ".nge-ask-btn",
  commandPalette: ".nge-cmd-trigger",
  profileButton:  "#profileBtn",
  // Toolbar icons (logged-in). Selected by the data-icon-id ExtensionBar sets.
  splitTool:      '[data-icon-id="split"]',
  mergeTool:      '[data-icon-id="merge"]',
  findPathTool:   '[data-icon-id="findPath"]',
  leaderboard:    '[data-icon-id="leaderboard"]',
  cellLibrary:    '[data-icon-id="cells"]',
  batchProcessor: '[data-icon-id="batch"]',
  secondOpinion:  '[data-icon-id="help"]',
  activityFeed:   '[data-icon-id="feed"]',
  notifications:  '[data-icon-id="notif"]',
  chat:           '[data-icon-id="chat"]',
  settings:       '[data-icon-id="settings"]',
  weeklyRecap:    '[data-icon-id="recap"]',
  brainQuest:     '[data-icon-id="quest"]',
};

const GLOW_CLASS = "nge-tour-target";
const NOTE_ID = "nge-guide-spotlight-note";
const DURATION_MS = 6000;

let activeEl: Element | null = null;
let timer: number | null = null;

async function waitForElement(selector: string, timeout = 3000): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return existing;
  return new Promise((resolve) => {
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.querySelector(selector);
      if (el || Date.now() - start > timeout) {
        window.clearInterval(iv);
        resolve(el);
      }
    }, 100);
  });
}

export function clearSpotlight() {
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
  if (activeEl) { activeEl.classList.remove(GLOW_CLASS); activeEl = null; }
  document.getElementById(NOTE_ID)?.remove();
  document.removeEventListener("mousedown", onDocClick, true);
}

function onDocClick() { clearSpotlight(); }

function showNote(el: Element, note: string) {
  const rect = el.getBoundingClientRect();
  const bubble = document.createElement("div");
  bubble.id = NOTE_ID;
  bubble.textContent = note;
  bubble.style.cssText = [
    "position:fixed",
    "max-width:220px",
    "padding:7px 10px",
    "background:rgba(6,10,20,0.96)",
    "border:1px solid rgba(0,200,255,0.55)",
    "border-radius:8px",
    "color:#dbe4f0",
    "font:500 12px/1.45 'Inter','Roboto',sans-serif",
    "box-shadow:0 6px 20px rgba(0,0,0,0.5)",
    "z-index:9500",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(bubble);
  // Prefer below the element; flip above if it would run off the bottom.
  const bh = bubble.offsetHeight;
  const bw = bubble.offsetWidth;
  let top = rect.bottom + 10;
  if (top + bh > window.innerHeight - 8) top = Math.max(8, rect.top - bh - 10);
  let left = rect.left + rect.width / 2 - bw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
  bubble.style.top = top + "px";
  bubble.style.left = left + "px";
}

/**
 * Ring a known target with the tour glow and (optionally) show a note. Resolves
 * silently if the target key is unknown or the element never appears (e.g. a
 * logged-out user with no toolbar).
 */
export async function runSpotlight(targetKey: string, note?: string): Promise<void> {
  const selector = SPOTLIGHT_TARGETS[targetKey];
  if (!selector) return;
  clearSpotlight();

  const el = await waitForElement(selector, 3000);
  if (!el) return;

  el.classList.add(GLOW_CLASS);
  try { el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); } catch { /* older browsers */ }
  activeEl = el;

  if (note && note.trim()) showNote(el, note.trim());

  // Auto-clear after a few seconds, or on the next click anywhere.
  timer = window.setTimeout(clearSpotlight, DURATION_MS);
  // Defer adding the click-to-dismiss listener so the current click (if any)
  // that triggered the spotlight doesn't immediately clear it.
  window.setTimeout(() => document.addEventListener("mousedown", onDocClick, true), 0);
}
