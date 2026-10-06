<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from "vue";
import VolumesOverlay from "components/VolumesOverlay.vue";
import DropdownList from "components/DropdownList.vue";
import UserProfilePanel from "components/UserProfilePanel.vue";
import LeaderboardPanel from "components/LeaderboardPanel.vue";
import DatasetStatsPanel from "components/DatasetStatsPanel.vue";
import SettingsPanel from "components/SettingsPanel.vue";
import AnnotationPanel from "components/AnnotationPanel.vue";
import LoginModal from "components/LoginModal.vue";
import ProofreadingQueuePanel from "components/ProofreadingQueuePanel.vue";
import CommandPalette from "components/CommandPalette.vue";
import AchievementToast from "components/AchievementToast.vue";
import ActivityFeedPanel from "components/ActivityFeedPanel.vue";
import CellLibraryPanel from "components/CellLibraryPanel.vue";
import ChatPanel from "components/ChatPanel.vue";
import AssistantDock from "components/AssistantDock.vue";
import { runSpotlight } from "../assistant/spotlight";
import { showDefaultCell } from "../widgets/widget_utils";
import BatchProcessorPanel from "components/BatchProcessorPanel.vue";
import TagModePanel from "components/TagModePanel.vue";
import HighlightModePanel from "components/HighlightModePanel.vue";
import DatasetTransition from "components/DatasetTransition.vue";
import FlightMode from "components/FlightMode.vue";
import { isShowcaseHash, showcaseOpened } from "../showcase";
import FeedbackModal from "components/FeedbackModal.vue";
import NurroProfile from "components/NurroProfile.vue";
import NotificationFeedPanel from "components/NotificationFeedPanel.vue";
import DatasetSelectorPanel from "components/DatasetSelectorPanel.vue";
import ScreenshotDialog from "components/ScreenshotDialog.vue";
import StreakChip from "components/StreakChip.vue";
import RadioPlayer from "components/RadioPlayer.vue";
import UsernamePrompt from "components/UsernamePrompt.vue";
import MobileWelcome from "components/MobileWelcome.vue";
import MobileTour from "components/MobileTour.vue";
import {isMobileRef, mobileWelcomeOpenRef} from '../util/mobile';
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

import {loginSession, useLoginStore, useVolumesStore, useUserStatsStore, useSegmentAnnotationStore, useHelpRequestStore, useProofreadingQueueStore, useProofreadingBackendStore, useUserPreferencesStore, useDropdownListStore, useChatStore, useLayersStore} from '../store';
import {currentSegLayerName, datasetDisplayName, datasetAbbrev, datasetSpeciesIcon, findDatasetBySegName, findDatasetByCanonical, canonicalDataset} from '../datasets';
import {useTutorialStore} from '../store-pyr';
import {storeToRefs as storeToRefsAnnot} from 'pinia';
import {storeToRefs} from 'pinia';

import logoImage from '../CaveLogo-clear.png';

const login = useLoginStore();
const tutorialStore = useTutorialStore();
const dropdownStore = useDropdownListStore();

/** Sync the first valid login session to Supabase so userId is set.
 *  Also captures the user's CAVE numeric id (cave_user_id) for the
 *  leaderboard's completions metric — see store.captureCaveUserId.
 *  CAVE token may not be present on first sync (initial load before user
 *  authenticates with daf-apis), so we run captureCaveUserId on every
 *  middleauthlogin event; the function itself is idempotent. */
async function syncFirstSession() {
  const session = login.sessions.find(s => s.status === undefined);
  if (session?.email) {
    const backend = useProofreadingBackendStore();
    if (!backend.userId) {
      await backend.syncUser(session.email, session.name || session.email.split('@')[0]);
      await backend.loadUserStats();
    }
    // Idempotent — early-returns if cave_user_id is already stored or
    // the daf-apis bearer token isn't available yet.
    backend.captureCaveUserId();
  }
}

// Merge and Cut start through the practice-cell gate in tutorial-3.ts.
// (Templates cannot reach `document`, so the dispatch lives here.)
function startTutorial(id: number) {
  document.dispatchEvent(new CustomEvent('nge:tutorial-start', { detail: { id } }));
}

// Toolbar icon click animations: .nge-pop for 0.8 s (styles above the
// burger's). Added on pointerdown so it plays even when the click opens a
// window that covers the bar.
document.addEventListener('pointerdown', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest?.('#extensionBar .nge-icon-btn, #extensionBar #ngFarRight > .neuroglancer-icon') as HTMLElement | null;
  if (!btn || e.button !== 0) return;
  btn.classList.remove('nge-pop');
  void btn.offsetWidth;
  btn.classList.add('nge-pop');
  setTimeout(() => btn.classList.remove('nge-pop'), 800);
}, true);

// Burger bounce on click (Ames 2026-09-29). Restart the animation each time.
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest?.('#hamburger > button');
  const svg = btn?.querySelector('svg.nge-burger');
  if (!svg) return;
  svg.classList.remove('nge-burger--bounce');
  void (svg as unknown as HTMLElement).getBoundingClientRect();
  svg.classList.add('nge-burger--bounce');
}, true);
document.addEventListener('animationend', (e) => {
  const t = e.target as Element | null;
  if (t?.classList?.contains('nge-burger--bounce') && e.animationName === 'nge-bb-hop') t.classList.remove('nge-burger--bounce');
}, true);

function closeHamburger() {
  dropdownStore.activeDropdowns['extension-bar-right'] = undefined;
}

/** Pyr-icon click: bypass the browser cache so a freshly-deployed bundle
 *  is picked up without the user hunting for Ctrl+F5. The standard
 *  `location.reload()` API stopped accepting `forceReload` years ago, so
 *  we cache-bust by appending a timestamp to the URL. */
function hardRefresh() {
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString());
  window.location.replace(url.toString());
}
window.addEventListener("middleauthlogin", () => {
  login.update().then(syncFirstSession);
});

// Also sync on initial load (user may already be logged in)
login.update().then(syncFirstSession);

const validLogins = computed(() => login.sessions.filter(x => x.status === undefined));
const invalidLogins = computed(() => login.sessions.filter(x => x.status !== undefined));

const {volumes} = useVolumesStore();

const shareCopied = ref(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
const showScreenshotDialog = ref(false);

/** Share-toast button handlers. The toast normally fades after 2.5s; clicking
 *  any of these cancels the fade, hides the toast immediately, and triggers
 *  the secondary flow. */
function dismissShareToast() {
  if (shareCopiedTimer) {
    clearTimeout(shareCopiedTimer);
    shareCopiedTimer = null;
  }
  shareCopied.value = false;
}
function shareActionScreenshot() {
  dismissShareToast();
  showScreenshotDialog.value = true;
}
function shareActionEmail() {
  dismissShareToast();
  const subject = 'Check out this neuron in EyeWire II';
  const body = `${window.location.href}\n`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function shareActionX() {
  dismissShareToast();
  const text = 'Check out this neuron in EyeWire II';
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`;
  window.open(url, '_blank', 'noopener,width=600,height=520');
}
function shareActionFacebook() {
  dismissShareToast();
  // quote= prefills the post text; the link preview comes from the page's
  // Open Graph tags (index.html).
  const quote = 'Check out this neuron in EyeWire II';
  const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(quote)}`;
  window.open(url, '_blank', 'noopener,width=600,height=520');
}

onMounted(() => {
  // Keep Pyr icon in top-left (don't overwrite with CaveLogo)
  // Clicking a chat announcement opens the notification feed and asks it to
  // surface that specific notification.
  document.addEventListener('nge:open-notification', ((e: CustomEvent) => {
    showNotifications.value = true;
    const id = e.detail?.id;
    if (id != null) {
      // Let the panel mount/refresh before asking it to open the detail view.
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('nge:show-notification-detail', { detail: { id } }));
      }, 150);
    }
  }) as EventListener);

  // Tag mode: global hotkey (Shift+T) and the palette command's event.
  document.addEventListener('nge:toggle-tag-mode', (() => {
    showTagMode.value = !showTagMode.value;
  }) as EventListener);
  // Capture phase: neuroglancer's key bindings (and tag mode's own T
  // swallow) must never eat the Shift+T toggle before it acts.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!typing && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showTagMode.value = !showTagMode.value;
    }
    if (!typing && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showFlightMode.value = !showFlightMode.value;
    }
    // The other way in is the old legend: up up down down left right left
    // right B A. Flight mode is an easter egg, it is FOUND, not labeled.
    if (!typing && !showFlightMode.value) {
      const K = ['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a'];
      konamiBuf.push(e.key.toLowerCase());
      if (konamiBuf.length > K.length) konamiBuf.shift();
      if (konamiBuf.length === K.length && konamiBuf.every((k, i) => k === K[i])) {
        konamiBuf.length = 0;
        showFlightMode.value = true;
      }
    }
  }, true);

  // Mobile post-login landing: LoginModal asks for the Cell Library so a
  // fresh login never stares at an empty forced-3D view.
  document.addEventListener('nge:close-cell-library', () => { showCellLibrary.value = false; });
  document.addEventListener('nge:open-cell-library', ((e: CustomEvent) => {
    cellLibraryInitialTab.value = e.detail?.tab;
    showCellLibrary.value = true;
  }) as EventListener);

  // "Ask for help" in the tutorial practice steps opens the community chat.
  document.addEventListener('nge:open-chat', (() => {
    showChat.value = true;
  }) as EventListener);

  document.addEventListener('nge:open-profile', ((e: CustomEvent) => {
    profileUserId.value = e.detail?.userId || null;
    // Optional deep-link tab ('triage' opens Admin Hub > Triage, etc.)
    if (e.detail?.tab) profileInitialTab.value = e.detail.tab;
    showProfile.value = true;
  }) as EventListener);

  // Detect Share button click → show "Link copied" toast
  const topBar = document.getElementById('insertNGTopBar');
  if (topBar) {
    topBar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const shareBtn = target.closest('[title*="hare"], [class*="share" i]');
      if (shareBtn) {
        if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
        shareCopied.value = true;
        shareCopiedTimer = setTimeout(() => { shareCopied.value = false; }, 2500);
      }
    });
  }
});

const statsStore = useUserStatsStore();
const { stats } = storeToRefs(statsStore);

// Label the Dataset button with the current dataset instead of the static word
// "Dataset". `activeLayers` (reactive) is touched so this recomputes when the
// user switches datasets; currentSegLayerName reads the non-reactive viewer.
const layersStoreForLabel = useLayersStore();
const currentDatasetName = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  return datasetDisplayName(currentSegLayerName()) || 'Dataset';
});
// Compact "Data: <abbrev>" label + species icon for the top-bar button.
const currentDatasetAbbrev = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  const a = datasetAbbrev(currentSegLayerName());
  return a ? `Data: ${a}` : 'Dataset';
});
/** Set when Highlight mode cannot work on the dataset on screen: the spray
 *  can is greyed out and says why. */
const highlightOff = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  return findDatasetBySegName(currentSegLayerName())?.highlightOff
    ?? findDatasetByCanonical(canonicalDataset(currentSegLayerName()))?.highlightOff ?? '';
});
// Switching to such a dataset with the box open closes it.
watch(highlightOff, (off) => { if (off) showHighlight.value = false; });
const currentDatasetIcon = computed(() => {
  void layersStoreForLabel.activeLayers.size;
  return datasetSpeciesIcon(currentSegLayerName());
});
const { activeSegId } = storeToRefsAnnot(useSegmentAnnotationStore());
const helpStore = useHelpRequestStore();
const chatStore = useChatStore();
const queueStore = useProofreadingQueueStore();

const showModal = ref(false);
const showProfile = ref(false);
const profileUserId = ref<string | null>(null);
// "Your Week in Science" now lives as a tab inside the profile rather than its
// own modal. This tells the profile which tab to open on mount.
const profileInitialTab = ref<string | undefined>(undefined);
function openWeekRecap() {
  profileUserId.value = null;
  profileInitialTab.value = 'weekInScience';
  showProfile.value = true;
}
const showRecap = ref(false);
const showFeedback = ref(false);
// Nurro's joke profile, opened from Nurro's name in chat.
const showNurroProfile = ref(false);
document.addEventListener('nge:open-nurro-profile', () => { showNurroProfile.value = true; });
const showLeaderboard = ref(false);
/** Opened by the arrival greeting: shown as a peek (no dim, clicks go through). */
const leaderboardPeek = ref(false);
// The leaderboard greets you once per visit, a moment after you're signed in
// (Ames 2026-09-28), unless you turned that off on the leaderboard, a
// tutorial is running, another window is open, or you're on a phone.
function maybeOpenLeaderboardOnArrival() {
  try {
    if (localStorage.getItem('nge-leaderboard-on-open') === '0') return;
    if (sessionStorage.getItem('nge-lb-greeted') === '1') return;
  } catch { return; }
  // Not over a showcase view like MEC's cell types (Ames 2026-09-29).
  if (isShowcaseHash() || showcaseOpened()) return;
  if (document.body.classList.contains('nge-mobile')) return;
  if (document.querySelector('.introductionStep, .nge-overlay-blocker')) return;
  try { sessionStorage.setItem('nge-lb-greeted', '1'); } catch { /* private mode */ }
  leaderboardPeek.value = true;
  showLeaderboard.value = true;
}
// Dataset Stats: what has been done on a dataset. It is a tab of the profile
// (toolbar icon, Switch Dataset panel, command list). This is the narrow
// panel: the leaderboard's link, and every way in on a phone.
const showDatasetStats = ref(false);
/** Its home is the profile's Dataset Stats tab. Phones have no room for
 *  that, so they get the narrow panel. */
function openDatasetStatsHome() {
  if (isMobileRef.value) { showDatasetStats.value = true; return; }
  profileUserId.value = null;
  profileInitialTab.value = 'datasetStats';
  showProfile.value = true;
}
// detail.panel asks for the narrow panel itself (the leaderboard's link).
document.addEventListener('nge:open-dataset-stats', (e) => {
  showLeaderboard.value = false; leaderboardPeek.value = false; showDatasetSelector.value = false;
  if ((e as CustomEvent).detail?.panel) { showProfile.value = false; showDatasetStats.value = true; }
  else openDatasetStatsHome();
});
const showSettings = ref(false);
const showQueue = ref(false);
const showFeed = ref(false);
/** Chat visibility persists across reloads so closing it stays closed.
 *  Default = open on first visit (key absent in localStorage). */
const CHAT_VISIBLE_KEY = 'nge_chat_visible_v1';
// Mobile: chat defaults CLOSED (it would cover half the viewer); it opens
// from the bottom nav or the welcome sheet. Desktop keeps default open.
const showChat = ref(isMobileRef.value
    ? localStorage.getItem(CHAT_VISIBLE_KEY) === '1'
    : localStorage.getItem(CHAT_VISIBLE_KEY) !== '0');
watch(showChat, (v) => {
  try { localStorage.setItem(CHAT_VISIBLE_KEY, v ? '1' : '0'); } catch {}
});
const showCellLibrary = ref(false);
const cellLibraryInitialTab = ref<string | undefined>(undefined);
const showBatchProcessor = ref(false);
const showTagMode = ref(false);
const showHighlight = ref(false);
/** The spray can sprays when clicked. The class lives in the template's own
 *  :class binding: the same click opens the Highlight box, which makes Vue
 *  rewrite the button's class list, and a class added by hand was wiped
 *  before the lid could move (Ames 2026-10-02). */
const spraying = ref(false);
let sprayTimer: ReturnType<typeof setTimeout> | undefined;
function sprayHighlightIcon() {
  if (sprayTimer) clearTimeout(sprayTimer);
  spraying.value = false;
  // Off for one frame, so a quick second click plays it again from the start.
  requestAnimationFrame(() => {
    spraying.value = true;
    sprayTimer = setTimeout(() => { spraying.value = false; }, 1000);
  });
}
const showFlightMode = ref(false);
const konamiBuf: string[] = [];
const showDatasetSelector = ref(false);
const showNotifications = ref(false);

// ── Mobile mode: welcome sheet + bottom nav ─────────────────────────────
// The sheet greets every mobile visit once per browser session; the Guide
// button in the bottom nav reopens it any time.
const MOBILE_WELCOME_SEEN_KEY = 'nge_mobile_welcome_seen_v1';
const showMobileWelcome = ref(
    isMobileRef.value && sessionStorage.getItem(MOBILE_WELCOME_SEEN_KEY) !== '1');
// LoginModal reads this shared ref: while the sheet is up, identity
// verification stays out of the way (the sheet IS the mobile landing page).
watch(showMobileWelcome, v => { mobileWelcomeOpenRef.value = v; }, {immediate: true});
// A LOGGED-OUT mobile visit always leads with the sheet, even when this
// browser session already saw it: without this, the seen-gate suppresses
// the sheet on a revisit and Identity Verification fronts uninvited —
// login should only pop after opting in from the sheet (Amy 2026-08-24).
// One-shot per load, and never over a dismissal the visitor already made.
let mobileWelcomeDismissedThisLoad = false;
let mobileWelcomeAutoReopened = false;
watch([() => login.checked, validLogins], ([checked, valid]) => {
  if (!checked || !isMobileRef.value) return;
  if (mobileWelcomeAutoReopened || mobileWelcomeDismissedThisLoad) return;
  if ((valid as loginSession[]).length > 0 || showMobileWelcome.value) return;
  mobileWelcomeAutoReopened = true;
  showMobileWelcome.value = true;
}, {immediate: true});
function hideMobileWelcome() {
  mobileWelcomeDismissedThisLoad = true;
  showMobileWelcome.value = false;
  try { sessionStorage.setItem(MOBILE_WELCOME_SEEN_KEY, '1'); } catch {}
}
/** Sheet dismissed in "just exploring" mode: also skip identity verification,
 *  same as tapping BYPASS on the login box. */
function exploreWithoutLogin() {
  hideMobileWelcome();
  document.dispatchEvent(new CustomEvent('nge:dismiss-login'));
  // Exploring without logging in used to land on the empty forced-3D view
  // — a black screen (Amy 2026-08-25). Show the dataset's showcase cell and
  // run the phone-sized tour, once per browser (the Guide's Take the tour
  // link replays it).
  setTimeout(() => showDefaultCell(), 400);
  try {
    if (localStorage.getItem(MOBILE_TOUR_SEEN_KEY) === '1') return;
    localStorage.setItem(MOBILE_TOUR_SEEN_KEY, '1');
  } catch { /* private mode: run it, better than a silent blank */ }
  setTimeout(() => { showMobileTour.value = true; }, 900);
}

const MOBILE_TOUR_SEEN_KEY = 'nge_mobile_tour_seen_v1';
const showMobileTour = ref(false);
/** Guide sheet's "Take the tour" — replay on demand. */
function startMobileTour() {
  hideMobileWelcome();
  document.dispatchEvent(new CustomEvent('nge:dismiss-login'));
  setTimeout(() => showDefaultCell(), 300);
  setTimeout(() => { showMobileTour.value = true; }, 700);
}
/** "Log in" on the sheet: close it and start auth right away. The dispatch
 *  is synchronous, so LoginModal's window.open still runs inside this tap's
 *  user gesture — the Google popup isn't blocked. If no auth prompt has
 *  surfaced yet, LoginModal simply takes the stage as before. */
function mobileWelcomeLogin() {
  hideMobileWelcome();
  document.dispatchEvent(new CustomEvent('nge:request-login'));
}
// Someone @mentioned you while chat was closed: the chat button glows amber
// until you open chat (Ames, 2026-09-28). With chat open, ChatPanel flashes.
const chatMentionPending = ref(false);
watch(() => chatStore.mentionPing, () => { if (!showChat.value) chatMentionPending.value = true; });
watch(showChat, (open) => { if (open) chatMentionPending.value = false; });

function mobileOpenPanel(panel: 'cells' | 'chat' | 'profile' | 'leaderboard') {
  switch (panel) {
    case 'cells':
      cellLibraryInitialTab.value = undefined;
      showCellLibrary.value = true;
      break;
    case 'chat':
      showChat.value = true;
      chatStore.markRead();
      break;
    case 'profile':
      profileUserId.value = null;
      profileInitialTab.value = undefined;
      showProfile.value = true;
      break;
    case 'leaderboard':
      showLeaderboard.value = true;
      break;
  }
}
/** Bottom nav taps toggle their panel so a second tap closes it. */
function mobileNavTap(panel: 'cells' | 'chat' | 'profile' | 'leaderboard') {
  const isOpen: Record<typeof panel, boolean> = {
    cells: showCellLibrary.value,
    chat: showChat.value,
    profile: showProfile.value,
    leaderboard: showLeaderboard.value,
  };
  if (isOpen[panel]) {
    switch (panel) {
      case 'cells': showCellLibrary.value = false; break;
      case 'chat': showChat.value = false; break;
      case 'profile': showProfile.value = false; break;
      case 'leaderboard': showLeaderboard.value = false; break;
    }
  } else {
    mobileOpenPanel(panel);
  }
}
const cmdPalette = ref<InstanceType<typeof CommandPalette> | null>(null);

/**
 * Bridge the headless command catalog into the Ask dock.
 *
 * CommandPalette stays mounted as the command PROVIDER (it owns buildActions(),
 * the neuroglancer keybinding ingestion and the emit wiring back to this
 * component); the dock is now the only UI. These wrappers are stable function
 * identities so the dock's props don't churn on every render.
 */
function searchCommands(q: string, limit = 6) {
  return (cmdPalette.value as any)?.searchCommands?.(q, limit) ?? [];
}
function runCommandById(id: string): boolean {
  return (cmdPalette.value as any)?.runCommandById?.(id) ?? false;
}

/**
 * Ctrl+K / Cmd+K opens the Ask dock (previously the command palette).
 * Registered in capture phase so it wins against neuroglancer's own keybinder,
 * matching how the Escape handler in main.ts is bound.
 */
function commandKeyHandler(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    e.stopPropagation();
    showAssistant.value = true;
  }
}
onMounted(() => document.addEventListener('keydown', commandKeyHandler, true));
// "Ask the AI guide" buttons elsewhere (split errors) open the dock; the dock
// itself sends the question (it listens for the same event).
const openGuideForQuestion = () => { showAssistant.value = true; };
onMounted(() => document.addEventListener('nge:ask-guide', openGuideForQuestion));
onUnmounted(() => document.removeEventListener('nge:ask-guide', openGuideForQuestion));
onUnmounted(() => document.removeEventListener('keydown', commandKeyHandler, true));

// ── EyeWire II Guide (AI assistant) ──────────────────────────────────────
const showAssistant = ref(false);
// Best-effort record of the tool mode the assistant last entered, sent back to
// the backend as context. (Direct keyboard tool switches aren't captured.)
const assistantToolMode = ref<'merge' | 'split' | 'findPath' | 'none'>('none');

// Snapshot of UI-only state the AssistantDock can't read itself: which panels
// are open and the current tool. Read fresh on each assistant message.
const assistantUiState = computed(() => {
  const openPanels: string[] = [];
  if (showCellLibrary.value) openPanels.push('cellLibrary');
  if (showLeaderboard.value) openPanels.push('leaderboard');
  if (showNotifications.value) openPanels.push('notifications');
  if (showSettings.value) openPanels.push('settings');
  if (showChat.value) openPanels.push('chat');
  if (showRecap.value) openPanels.push('recap');
  if (showBatchProcessor.value) openPanels.push('batch');
  if (showDatasetSelector.value) openPanels.push('datasetSelector');
  const commandCatalog = (cmdPalette.value as any)?.commandCatalog?.() || [];
  return { openPanels, toolMode: assistantToolMode.value, commandCatalog };
});

function setAssistantPanel(panel: string, open: boolean) {
  switch (panel) {
    case 'cellLibrary': showCellLibrary.value = open; break;
    case 'leaderboard': showLeaderboard.value = open; break;
    case 'notifications': showNotifications.value = open; break;
    case 'settings': showSettings.value = open; break;
    case 'chat': showChat.value = open; break;
    case 'recap': showRecap.value = open; break;
    case 'batch': showBatchProcessor.value = open; break;
    case 'datasetSelector': showDatasetSelector.value = open; break;
  }
}

// Clear the active tool (best-effort: send Escape to the viewer).
function clearToolMode() {
  const viewer: any = (window as any)['viewer'];
  const el = viewer?.element;
  if (el instanceof HTMLElement) {
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
}

// Add a segment to the visible set and recenter on it. Mirrors ChatPanel's
// #SegID pill. Read-only navigation — never edits.
function assistantGoToSegment(segId: string) {
  try {
    const viewer: any = (window as any)['viewer'];
    if (!viewer) return;
    const segLayer = viewer.layerManager?.managedLayers?.find((x: any) => {
      const layer = x.layer;
      if (!layer) return false;
      const cn = layer.constructor?.name || '';
      return cn.includes('Segmentation') || layer.type === 'segmentation';
    });
    if (!segLayer?.layer) return;
    const { Uint64 } = require('neuroglancer/util/uint64');
    const seg = Uint64.parseString(segId);
    const groupState = segLayer.layer.displayState?.segmentationGroupState?.value;
    if (groupState?.visibleSegments && !groupState.visibleSegments.has(seg)) {
      groupState.visibleSegments.add(seg);
    }
    // Recenter via the patched moveToSegment (move_to_segment_patch.ts).
    try { segLayer.layer.moveToSegment?.(seg); } catch { /* non-critical */ }
  } catch (e) {
    console.warn('[assistant] goToSegment failed:', e);
  }
}

// Single listener for allow-listed assistant actions (emitted by
// assistant/actions.ts). This is the only place assistant intent touches app
// state. All actions here are non-destructive.
function handleAssistantAction(e: Event) {
  const detail = (e as CustomEvent).detail || {};
  const { name, args } = detail;
  switch (name) {
    case 'openPanel': setAssistantPanel(args?.panel, true); break;
    case 'closePanel': setAssistantPanel(args?.panel, false); break;
    case 'setToolMode':
      if (args?.mode === 'merge') { activateTool('merge'); assistantToolMode.value = 'merge'; }
      else if (args?.mode === 'split') { activateTool('multicut'); assistantToolMode.value = 'split'; }
      else if (args?.mode === 'findPath') { activateTool('findPath'); assistantToolMode.value = 'findPath'; }
      else { clearToolMode(); assistantToolMode.value = 'none'; }
      break;
    case 'openCommandPalette': cmdPalette.value?.open(); break;
    case 'goToSegment': if (args?.segId) assistantGoToSegment(String(args.segId)); break;
    case 'spotlight': if (args?.target) runSpotlight(String(args.target), args?.note); break;
    case 'startTutorial':
      tutorialStore.activeTutorial = Number(args?.id) || 4;
      tutorialStore.setTutorialStep(Number(args?.step) || 0);
      break;
  }
}

onMounted(() => document.addEventListener('nge:assistant-action', handleAssistantAction as EventListener));
onUnmounted(() => document.removeEventListener('nge:assistant-action', handleAssistantAction as EventListener));
const backendStore = useProofreadingBackendStore();
// Signed in: give the page a moment to settle, then greet with the leaderboard.
watch(() => backendStore.userId, id => { if (id) setTimeout(maybeOpenLeaderboardOnArrival, 1800); }, { immediate: true });
const { tutorialStep } = storeToRefs(useTutorialStore());

function logout(session: loginSession) {
  login.logout(session);
}

// ── Toolbar icon definitions ──────────────────────────────────
interface ToolbarIcon {
  id: string;
  emoji: string;
  svg?: string;
  img?: string;
  label: string;
  action: () => void;
  badge?: () => number;
}

// ── Toolbar definitions ────────────────────────────────────────────
// Visual icon defs (id, label, emoji, svg, img) live in
// ../data/toolbar-icons so SettingsPanel can render the exact same
// set in its customization grid. Here we only attach the action
// handlers and (where relevant) badge counters.
import { TOOLBAR_ICON_DEFS, resolveToolbarOrder, markInjected, RESOURCES_MENU_SVG, LEADERBOARD_SVG } from '../data/toolbar-icons';

// ── Layers: the neuroglancer layer-list panel, driven from our toolbar ──
// The native top-row toggle is hidden in ng-override.css; this icon replaces it
// so it participates in the Settings toolbar prefs like everything else.
// `window['viewer']` is not reactive, so mirror the panel's visibility into a
// Vue ref (subscribing to the neuroglancer signal) to drive the active-state
// underline. The viewer may not exist at mount, so retry attaching.
const layerPanelOpen = ref(false);
let layerPanelWatchable: any = null;
const syncLayerPanelOpen = () => { layerPanelOpen.value = !!layerPanelWatchable?.value; };
function layerListWatchable(): any {
  return (window as any)['viewer']?.layerListPanelState?.location?.watchableVisible ?? null;
}
function toggleLayerListPanel() {
  const w = layerListWatchable();
  if (w) w.value = !w.value;
}
function wireLayerPanelState(attempt = 0) {
  const w = layerListWatchable();
  if (!w) { if (attempt < 12) setTimeout(() => wireLayerPanelState(attempt + 1), 500); return; }
  layerPanelWatchable = w;
  syncLayerPanelOpen();
  w.changed.add(syncLayerPanelOpen);
}
onMounted(() => wireLayerPanelState());
onUnmounted(() => { try { layerPanelWatchable?.changed.remove(syncLayerPanelOpen); } catch { /* ignore */ } });

interface ToolbarAction {
  action: () => void;
  badge?: () => number;
}

const toolbarActions: Record<string, ToolbarAction> = {
  split:       { action: () => activateTool('multicut') },
  merge:       { action: () => activateTool('merge') },
  findPath:    { action: () => activateTool('findPath') },
  layers:      { action: () => toggleLayerListPanel() },
  recap:       { action: () => { openWeekRecap(); } },
  leaderboard: { action: () => { showLeaderboard.value = true; } },
  datasetStats: { action: () => { if (showDatasetStats.value) showDatasetStats.value = false; else openDatasetStatsHome(); } },
  quest:       { action: () => { showQueue.value = !showQueue.value; }, badge: () => queueStore.pendingCount() },
  cells:       { action: () => { cellLibraryInitialTab.value = undefined; showCellLibrary.value = !showCellLibrary.value; } },
  batch:       { action: () => { showBatchProcessor.value = !showBatchProcessor.value; } },
  // Toolbar camera (Amy): the same Save screenshot dialog the palette opens.
  screenshot:  { action: () => { showScreenshotDialog.value = true; } },
  // Badge suppressed when the user mutes help requests (Settings → Notifications).
  help:        { action: () => { cellLibraryInitialTab.value = 'help'; showCellLibrary.value = true; }, badge: () => useUserPreferencesStore().prefs.helpMuted ? 0 : helpStore.pending.length },
  tags:        { action: () => { showTagMode.value = !showTagMode.value; } },
  highlight:   { action: () => { if (highlightOff.value) return; showHighlight.value = !showHighlight.value; sprayHighlightIcon(); } },
  flight:      { action: () => { showFlightMode.value = !showFlightMode.value; } },
  feed:        { action: () => { showFeed.value = true; } },
  notif:       { action: () => { showNotifications.value = !showNotifications.value; }, badge: () => backendStore.unreadNotificationCount },
  chat:        { action: () => { showChat.value = !showChat.value; if (showChat.value) chatStore.markRead(); }, badge: () => chatStore.unreadCount },
  settings:    { action: () => { profileInitialTab.value = 'settings'; showProfile.value = true; } },
};

const toolbarDefs = computed<ToolbarIcon[]>(() => {
  return TOOLBAR_ICON_DEFS
    .map(def => {
      const a = toolbarActions[def.id];
      if (!a) return null;
      return {
        id: def.id,
        emoji: def.emoji,
        svg: def.svg,
        img: def.img,
        label: def.label,
        action: a.action,
        badge: a.badge,
      } as ToolbarIcon;
    })
    .filter((x): x is ToolbarIcon => x !== null);
});

// Map icon IDs to their active (open) state
const iconActiveState: Record<string, () => boolean> = {
  layers: () => layerPanelOpen.value,
  recap: () => showProfile.value && profileInitialTab.value === 'weekInScience',
  leaderboard: () => showLeaderboard.value,
  datasetStats: () => showDatasetStats.value || (showProfile.value && profileInitialTab.value === 'datasetStats'),
  quest: () => showQueue.value,
  cells: () => showCellLibrary.value,
  batch: () => showBatchProcessor.value,
  feed: () => showFeed.value,
  notif: () => showNotifications.value,
  chat: () => showChat.value,
  tags: () => showTagMode.value,
  highlight: () => showHighlight.value,
  flight: () => showFlightMode.value,
  settings: () => showProfile.value && profileInitialTab.value === 'settings',
};
function isIconActive(id: string): boolean {
  return iconActiveState[id]?.() ?? false;
}

const visibleToolbar = computed(() => {
  const prefs = useUserPreferencesStore().prefs;
  // resolveToolbarOrder handles default-fallback, injecting icons added since
  // the prefs were saved, and dropping retired ids — shared with SettingsPanel
  // so the grid and the real toolbar can't disagree.
  const order = resolveToolbarOrder(prefs.toolbarIcons, prefs.toolbarIconsInjected);
  return order.map(id => toolbarDefs.value.find(d => d.id === id)).filter(Boolean) as ToolbarIcon[];
});

// ── Drag-to-reorder toolbar ─────────────────────────────────────────
// Persists order to `prefs.toolbarIcons` via the user-preferences store.
const dragId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onIconDragStart(e: DragEvent, id: string) {
  if (!e.dataTransfer) return;
  dragId.value = id;
  e.dataTransfer.effectAllowed = 'move';
  // Some browsers require non-empty data
  e.dataTransfer.setData('text/plain', id);
}
function onIconDragEnd() {
  dragId.value = null;
  dragOverId.value = null;
}
function onIconDragOver(e: DragEvent, id: string) {
  if (!dragId.value || dragId.value === id) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverId.value = id;
}
function onIconDragLeave(id: string) {
  if (dragOverId.value === id) dragOverId.value = null;
}
function onIconDrop(e: DragEvent, id: string) {
  e.preventDefault();
  const src = dragId.value;
  dragId.value = null;
  dragOverId.value = null;
  if (!src || src === id) return;
  const prefsStore = useUserPreferencesStore();
  const current = visibleToolbar.value.map(i => i.id);
  const fromIdx = current.indexOf(src);
  const toIdx = current.indexOf(id);
  if (fromIdx < 0 || toIdx < 0) return;
  const next = [...current];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, src);
  // Persist via save() so the injected marker rides along: from this point
  // every auto-inject icon has been offered, and future absence means the
  // user removed it (Celia's "icons don't get removed" bug).
  prefsStore.save({ toolbarIcons: next, toolbarIconsInjected: markInjected(prefsStore.prefs.toolbarIconsInjected) });
}

function activateTool(toolType: 'multicut' | 'merge' | 'findPath') {
  const viewer: any = (window as any)['viewer'];
  if (!viewer) return;

  // 1. Select the segmentation layer (required for tool keybindings)
  try {
    const segLayer = viewer.layerManager?.managedLayers?.find(
      (x: any) => x.layer?.constructor?.name?.includes('Segmentation'),
    );
    if (segLayer) {
      viewer.selectedLayer.layer = segLayer;
      viewer.selectedLayer.visible = true;
    }
  } catch { /* non-critical */ }

  // 2. Dispatch keyboard shortcut to the viewer element where ng binds handlers.
  // CUSTOM_BINDINGS map (in dev-server / build-prod): keyc → grapheneMulticutSegments,
  // keym → grapheneMergeSegments, keyf → grapheneFindPath.
  const keyMap = { multicut: 'c', merge: 'm', findPath: 'f' } as const;
  const codeMap = { multicut: 'KeyC', merge: 'KeyM', findPath: 'KeyF' } as const;
  const key = keyMap[toolType];
  const eventInit: KeyboardEventInit = {
    key, code: codeMap[toolType],
    bubbles: true, cancelable: true,
  };
  // Try viewer.element first (where global inputEventBindings live), then fallback
  const targets = [
    viewer.element,
    viewer.display?.container,
    document.getElementById('neuroglancer-container'),
  ].filter(Boolean);
  for (const el of targets) {
    if (el instanceof HTMLElement) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  }
}

</script>

<template>
  <login-modal />
  <!-- <annotation-panel /> --> <!-- Hidden: users pick cells from Cell Library instead -->
  <achievement-toast />
  <command-palette
    ref="cmdPalette"
    @open-profile="showProfile = true"
    @open-recap="openWeekRecap()"
    @open-leaderboard="showLeaderboard = true"
    @open-settings="profileInitialTab = 'settings'; showProfile = true"
    @open-help="cellLibraryInitialTab = 'help'; showCellLibrary = true"
    @open-queue="showQueue = true"
    @open-cells="showCellLibrary = true"
    @open-feed="showFeed = true"
    @open-dataset-selector="showDatasetSelector = true"
    @open-dataset-stats="openDatasetStatsHome()"
  />
  <activity-feed-panel v-if="showFeed" @hide="showFeed = false" />
  <!-- Help requests now live in Cell Library's Help tab -->
  <proofreading-queue-panel v-if="showQueue" @hide="showQueue = false" />
  <cell-library-panel v-if="showCellLibrary" :initial-tab="cellLibraryInitialTab" @hide="showCellLibrary = false; cellLibraryInitialTab = undefined" />
  <batch-processor-panel v-if="showBatchProcessor" @hide="showBatchProcessor = false" />
  <tag-mode-panel v-if="showTagMode" @hide="showTagMode = false" />
  <highlight-mode-panel v-if="showHighlight" @hide="showHighlight = false" />
  <flight-mode v-if="showFlightMode" @hide="showFlightMode = false" />
  <volumes-overlay v-visible="showModal" @hide="showModal = false" />
  <dataset-selector-panel v-if="showDatasetSelector" @hide="showDatasetSelector = false" />
  <user-profile-panel v-if="showProfile" :view-user-id="profileUserId" :initial-tab="profileInitialTab" @hide="showProfile = false; profileUserId = null; profileInitialTab = undefined" @open-settings="profileInitialTab = 'settings'; showProfile = true" />
  <feedback-modal v-if="showFeedback" @hide="showFeedback = false" />
  <nurro-profile v-if="showNurroProfile" @hide="showNurroProfile = false" />
  <!-- Always a peek on desktop (Ames 2026-09-30): no dim, the site stays usable, a click elsewhere puts it away. Phones keep the sheet. -->
  <leaderboard-panel v-if="showLeaderboard" :peek="leaderboardPeek || !isMobileRef" @hide="showLeaderboard = false; leaderboardPeek = false" />
  <dataset-stats-panel v-if="showDatasetStats" :peek="!isMobileRef" @hide="showDatasetStats = false" />
  <settings-panel v-if="showSettings" @hide="showSettings = false" />
  <notification-feed-panel :visible="showNotifications" @hide="showNotifications = false" @open-help="cellLibraryInitialTab = 'help'; showCellLibrary = true" />
  <chat-panel v-if="showChat" @hide="showChat = false" />
  <!-- The Ask dock is now the single command surface: it searches the same
       catalog CommandPalette builds (passed in headless) so navigation runs
       instantly, and only falls through to the model for real questions. -->
  <!-- Self-contained: listens for nge:prompt-username (fired after Tutorial 1)
       and no-ops if the user already has a handle or dismissed it before. -->
  <username-prompt />

  <assistant-dock
    :show="showAssistant"
    :ui-state="assistantUiState"
    :search-commands="searchCommands"
    :run-command-by-id="runCommandById"
    @hide="showAssistant = false"
  />
  <div id="extensionBar">
    <div class="ng-extend-logo">
      <!-- Click → hard refresh. Reloads the bundle from the server (skips
           the disk cache so a freshly-deployed JS hits the user without a
           manual Ctrl+F5). Tour step #2 explains this. -->
      <a href="#" title="EyeWire II — click to hard refresh"
         @click.prevent="hardRefresh">
        <img :src="pyrIcon" class="nge-pyr-logo" />
      </a>
    </div>
    <!-- AI guide + Dataset live on the left edge (Amy 2026-08-17). -->
    <button class="nge-ask-btn" :class="{ 'nge-ask-btn--active': showAssistant }"
            @click="showAssistant = !showAssistant"
            title="Nurro, your guide">
      <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">forum</span>
      <span class="nge-ask-label">AI</span>
    </button>
    <button class="nge-dataset-btn" @click="showDatasetSelector = !showDatasetSelector"
            :title="'Current dataset: ' + currentDatasetName + ' — click to switch'">
      <span v-if="currentDatasetIcon" class="nge-dataset-species">{{ currentDatasetIcon }}</span>
      <span v-else class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">database</span>
      <span class="nge-dataset-label">{{ currentDatasetAbbrev }}</span>
    </button>
    <div id="insertNGTopBar" class="flex-fill"></div>
    <transition name="nge-share-toast">
      <div v-if="shareCopied" class="nge-share-toast">
        <div class="nge-share-toast-icon">
          <!-- Back neuron (offset up-left) -->
          <svg class="nge-share-neuron nge-share-neuron--back" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="shareNeuronGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="b1"/>
                <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b2"/>
                <feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <radialGradient id="shareSomaGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#80f0ff" stop-opacity="1"/>
                <stop offset="60%" stop-color="#20d0ff" stop-opacity="0.8"/>
                <stop offset="100%" stop-color="#00a0e0" stop-opacity="0.2"/>
              </radialGradient>
            </defs>
            <g filter="url(#shareNeuronGlow)">
              <!-- Apical trunk + tuft -->
              <path d="M30 30 L29 22 L27 14 L24 6" stroke="#18cfff" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
              <path d="M27 14 L33 10 L40 7" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/>
              <path d="M27 14 L21 10 L14 8" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/>
              <path d="M24 6 L20 2" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.5"/>
              <path d="M24 6 L28 2" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.5"/>
              <!-- Basal dendrites -->
              <path d="M30 32 L24 38 L18 44" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.65"/>
              <path d="M30 32 L36 38 L42 44" stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.65"/>
              <path d="M30 32 L30 42 L30 52" stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>
              <path d="M18 44 L14 50" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.4"/>
              <path d="M42 44 L46 50" stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.4"/>
              <!-- Soma -->
              <circle cx="30" cy="30" r="4" fill="url(#shareSomaGrad)"/>
            </g>
          </svg>
          <!-- Front neuron (offset down-right, brighter) -->
          <svg class="nge-share-neuron nge-share-neuron--front" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
            <g filter="url(#shareNeuronGlow)">
              <path d="M30 30 L29 22 L27 14 L24 6" stroke="#5be3ff" stroke-width="1.8" stroke-linecap="round" opacity="1"/>
              <path d="M27 14 L33 10 L40 7" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
              <path d="M27 14 L21 10 L14 8" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
              <path d="M24 6 L20 2" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.65"/>
              <path d="M24 6 L28 2" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.65"/>
              <path d="M30 32 L24 38 L18 44" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>
              <path d="M30 32 L36 38 L42 44" stroke="#4dd8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>
              <path d="M30 32 L30 42 L30 52" stroke="#3acaee" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/>
              <path d="M18 44 L14 50" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.5"/>
              <path d="M42 44 L46 50" stroke="#3acaee" stroke-width="0.7" stroke-linecap="round" opacity="0.5"/>
              <circle cx="30" cy="30" r="4.5" fill="url(#shareSomaGrad)"/>
            </g>
          </svg>
        </div>
        <div class="nge-share-toast-text">Link copied to clipboard</div>
        <div class="nge-share-toast-actions">
          <button class="nge-share-action" title="Save screenshot"
                  @click="shareActionScreenshot">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/>
              <circle cx="12" cy="13.5" r="3.8"/>
            </svg>
          </button>
          <button class="nge-share-action" title="Email link"
                  @click="shareActionEmail">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="1.5"/>
              <path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>
            </svg>
          </button>
          <button class="nge-share-action" title="Post to X"
                  @click="shareActionX">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L4.7 21H1.5l7.5-8.5L1.2 3h6.6l4.5 6zm-1.1 16.2h1.8L7.7 4.7H5.8z"/>
            </svg>
          </button>
          <button class="nge-share-action" title="Share to Facebook"
                  @click="shareActionFacebook">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M14 7h3V4h-3c-1.93 0-3.5 1.57-3.5 3.5V10H8v3h2.5v8h3v-8H16l1-3h-3.5V7.5c0-.28.22-.5.5-.5z"/>
            </svg>
          </button>
        </div>
      </div>
    </transition>
    <screenshot-dialog :show="showScreenshotDialog" @close="showScreenshotDialog = false" />
    <button v-if="volumes.length" @click="showModal = true">Volumes ({{ volumes.length }})</button>
    <!-- 🔥 streak: its fire, its click and its card live in StreakChip.vue -->
    <!-- EyeWire Radio: bottom right, teleported to the body -->
    <RadioPlayer v-if="login.sessions.length > 0" />
    <StreakChip v-if="login.sessions.length > 0 && stats.currentStreak > 0" :current="stats.currentStreak" :best="stats.longestStreak" />
    <div class="nge-toolbar-icons" v-if="login.sessions.length > 0">
      <button class="nge-icon-btn nge-feedback-btn" title="Submit an issue or feedback"
              @click="showFeedback = true">
        <!-- A bug (Amy 2026-09-30), whose legs scurry on hover and click. -->
        <svg class="nge-bug" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#dfe6f2"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <g class="nge-bug-legs nge-bug-legs--l">
            <path d="M8.2 11 L4.6 9"/><path d="M7.9 14.2 H3.9"/><path d="M8.2 17.2 L4.6 19.4"/>
          </g>
          <g class="nge-bug-legs nge-bug-legs--r">
            <path d="M15.8 11 L19.4 9"/><path d="M16.1 14.2 H20.1"/><path d="M15.8 17.2 L19.4 19.4"/>
          </g>
          <path d="M10.4 6.2 L8.6 3.8 M13.6 6.2 L15.4 3.8"/>
          <circle cx="12" cy="7.9" r="2.3"/>
          <rect x="8" y="10.1" width="8" height="10.4" rx="4"/>
          <path d="M12 10.8 V19.6"/>
        </svg>
      </button>
      <button
        v-for="icon in visibleToolbar"
        :key="icon.id"
        :data-icon-id="icon.id"
        class="nge-icon-btn"
        :class="{
          'nge-icon-btn--badge': icon.badge && icon.badge() > 0,
          'nge-icon-btn--mention': icon.id === 'chat' && chatMentionPending,
          'nge-icon-btn--active': isIconActive(icon.id),
          'nge-icon-btn--off': icon.id === 'highlight' && !!highlightOff,
          'nge-spraying': icon.id === 'highlight' && spraying,
          'nge-icon-btn--dragging': dragId === icon.id,
          'nge-icon-btn--drag-over': dragOverId === icon.id && dragId !== icon.id,
        }"
        :title="icon.id === 'highlight' && highlightOff ? highlightOff : icon.label + ' — drag to reorder'"
        :aria-disabled="icon.id === 'highlight' && highlightOff ? 'true' : undefined"
        draggable="true"
        @dragstart="onIconDragStart($event, icon.id)"
        @dragend="onIconDragEnd"
        @dragover="onIconDragOver($event, icon.id)"
        @dragleave="onIconDragLeave(icon.id)"
        @drop="onIconDrop($event, icon.id)"
        @click="icon.action()"
      ><span v-if="icon.svg" v-html="icon.svg"></span><img v-else-if="icon.img" :src="icon.img" class="nge-toolbar-icon-img" /><template v-else>{{ icon.emoji }}</template><span v-if="icon.badge && icon.badge() > 0" class="nge-toolbar-badge" :class="{ 'nge-toolbar-badge--chat': icon.id === 'chat' }">{{ icon.badge() }}</span></button>
    </div>

    <button v-if="login.sessions.length > 0" class="nge-icon-btn" @click="profileUserId = null; showProfile = true" id="profileBtn" title="My Profile"><svg viewBox="2.6 1.6 10.8 13.2" fill="none" style="width:1em;height:1em;vertical-align:middle;color:#cfdcef"><circle cx="8" cy="5.4" r="2.9" stroke="currentColor" stroke-width="1.5"/><path d="M3.4 14c0-2.7 2.1-4.6 4.6-4.6s4.6 1.9 4.6 4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    <!-- Phones: the leaderboard, where the layer side panel's sliders used to
         sit (Ames 2026-10-05). The side panel is a desktop tool; on a phone
         its button is hidden (mobile.css). -->
    <button v-if="isMobileRef" class="nge-icon-btn" id="mobileLeaderboardBtn" title="Leaderboard" aria-label="Leaderboard"
            @click="mobileOpenPanel('leaderboard')"><span v-html="LEADERBOARD_SVG"></span></button>
    <dropdown-list dropdown-group="extension-bar-right" id="hamburger" class="rightMost" title="Resources and tutorials">
      <template #buttonTitle><span v-html="RESOURCES_MENU_SVG"></span></template>
      <template #listItems>
        <!-- Grouped (Amy 2026-09-25: "more structured organization"). Each
             tutorial appears once: the old list had a "Reset Tutorial N" AND a
             named entry for the same tutorial (both start it from step 0).
             The Merge / Split / Find path video links were dropped: those
             tools live in the top bar, and the Cut & Merge tutorial covers
             them (the Find Path video stays in the Ask dock / Ctrl+K). -->
        <li class="nge-menu-heading" @click.stop>Guided tour</li>
        <li>
          <div class="logoutButton button nge-tour-btn" @click="tutorialStore.activeTutorial = 4; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span>🧭 Site Tour</span>
          </div>
        </li>
        <li class="nge-menu-heading" @click.stop>Tutorials</li>
        <li>
          <div class="logoutButton button nge-menu-item" @click="tutorialStore.activeTutorial = 1; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span class="nge-menu-num">1</span><span>Get Started</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button nge-menu-item" @click="tutorialStore.activeTutorial = 2; tutorialStore.setTutorialStep(0); closeHamburger()">
            <span class="nge-menu-num">2</span><span>Advanced Interface</span>
          </div>
        </li>
        <li>
          <!-- Merge and Cut run on practice cells one learner at a time: the
               start goes through a gate (tutorial-3.ts) that offers a place in
               line when the cells are held. -->
          <div class="logoutButton button nge-menu-item" @click="startTutorial(3); closeHamburger()">
            <span class="nge-menu-num">3</span><span>Merge</span>
          </div>
        </li>
        <li>
          <div class="logoutButton button nge-menu-item" @click="startTutorial(5); closeHamburger()">
            <span class="nge-menu-num">4</span><span>Cut</span>
          </div>
        </li>
        <li class="nge-menu-heading" @click.stop>Learn more</li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" rel="noopener"
                href="https://blog.pyr.ai/2024/12/20/proofreading-101-climb-into-spelunker/">Proofreading Guide ↗</a></span>
          </div>
        </li>
        <li>
          <div class="logoutButton button">
            <span><a target="_blank" rel="noopener" href="https://forum.eyewire.org">Forum ↗</a></span>
          </div>
        </li>
      </template>
    </dropdown-list>
    <!-- Far-right slot: mergeTopBars() relocates NG's ? (help) and the
         layer side panel toggle here, toggle last so it hugs the panel it
         opens (Amy 2026-08-17). -->
    <div id="ngFarRight"></div>
  </div>

  <!-- ── Mobile only: welcome sheet + bottom nav (util/mobile.ts) ───────── -->
  <!-- logged-in gates the Guide's link mode on VALID sessions only: a stale
       token in localStorage must not hide the Log in button (Amy: the
       landing pop-up needs login until you are actually in). -->
  <mobile-welcome
    v-if="isMobileRef"
    :show="showMobileWelcome"
    :logged-in="validLogins.length > 0"
    :login-checked="login.checked"
    :user-name="validLogins[0]?.name"
    @hide="exploreWithoutLogin"
    @login="mobileWelcomeLogin"
    @tour="startMobileTour"
    @open="mobileOpenPanel"
  />
  <mobile-tour v-if="isMobileRef" :show="showMobileTour" :logged-in="validLogins.length > 0"
    @finish="showMobileTour = false" />
  <teleport to="body">
  <nav v-if="isMobileRef" class="nge-mobile-nav">
    <button :class="{ 'nge-mnav--active': showCellLibrary }" data-mnav="cells" @click="mobileNavTap('cells')">
      <span class="nge-mnav-icon"><img :src="neuronIcon" class="nge-mnav-neuron" alt="" /></span>
      <span class="nge-mnav-label">Cells</span>
    </button>
    <button :class="{ 'nge-mnav--active': showChat }" data-mnav="chat" @click="mobileNavTap('chat')">
      <span class="nge-mnav-icon">💬</span>
      <span class="nge-mnav-label">Chat</span>
      <span v-if="chatStore.unreadCount > 0" class="nge-mnav-badge">{{ chatStore.unreadCount }}</span>
    </button>
    <button :class="{ 'nge-mnav--active': showTagMode }" data-mnav="tags" @click="showTagMode = !showTagMode">
      <span class="nge-mnav-icon">📍</span>
      <span class="nge-mnav-label">Tags</span>
    </button>
    <button :class="{ 'nge-mnav--active': showNotifications }" data-mnav="alerts" @click="showNotifications = !showNotifications">
      <span class="nge-mnav-icon">🔔</span>
      <span class="nge-mnav-label">Notifs</span>
      <span v-if="backendStore.unreadNotificationCount > 0" class="nge-mnav-badge">{{ backendStore.unreadNotificationCount }}</span>
    </button>
    <button :class="{ 'nge-mnav--active': showMobileWelcome }" data-mnav="guide" @click="showMobileWelcome = true">
      <span class="nge-mnav-icon">✨</span>
      <span class="nge-mnav-label">Guide</span>
    </button>
  </nav>
  </teleport>
  <!-- "Now entering <dataset>" after a dataset switch (survives the reload). -->
  <DatasetTransition />
</template>

<style>
.dropdownList:last-child .dropdownMenu {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

#extensionBar button {
  font-size: 10pt;
}


/* The re-parented neuroglancer top row. It used to be stretched to 100%
   so its flex:1 mouse readout had room; that readout is now a fixed corner
   chip, and the stretch painted the row's own #222 background across the
   whole elastic zone: the "random black bar" after the ? button. Let it
   shrink to content and blend into the bar (the flex-fill absorbs slack). */
#insertNGTopBar > div {
  width: auto;
  background: transparent !important;
  margin-bottom: 0 !important;
}
/* Add spacing between neuroglancer native icons next to Share */
#insertNGTopBar .neuroglancer-icon,
#insertNGTopBar button,
#ngFarRight .neuroglancer-icon,
#ngFarRight button {
  margin: 0 2px;
}
/* Far-right home for NG's relocated ? and layer-side-panel toggles. */
#ngFarRight {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-right: 6px;
}
/* Hide selection details toggle from top bar (moved to Settings > Advanced) */
#insertNGTopBar .neuroglancer-icon[title*="election"],
#insertNGTopBar button[title*="election"] {
  display: none !important;
}

/* NG's Share button: the same pill as the AI and Data buttons on the left
   (height, radius, Orbitron caps, tint), so the three read as one family. */
#insertNGTopBar .neuroglancer-icon[title*="Share"],
#insertNGTopBar button[title*="hare"],
#insertNGTopBar .neuroglancer-share-button,
#insertNGTopBar [class*="share" i] {
  display: inline-flex !important;
  align-items: center !important;
  box-sizing: border-box !important;
  height: 30px !important;
  padding: 0 14px !important;
  background: rgba(74, 158, 255, 0.16) !important;
  border: 1px solid rgba(74, 158, 255, 0.5) !important;
  border-radius: 14px !important;
  color: #cfe0f5 !important;
  font-family: 'Orbitron', 'Inter', sans-serif !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  letter-spacing: 0.08em !important;
  cursor: pointer !important;
  opacity: 1 !important;
  transition: background 0.15s, border-color 0.15s, color 0.15s !important;
}
#insertNGTopBar .neuroglancer-icon[title*="Share"]:hover,
#insertNGTopBar button[title*="hare"]:hover,
#insertNGTopBar .neuroglancer-share-button:hover,
#insertNGTopBar [class*="share" i]:hover {
  background: rgba(74, 158, 255, 0.22) !important;
  border-color: rgba(74, 158, 255, 0.5) !important;
  color: #eaf2ff !important;
}

#extensionBar {
  display: flex;
  height: 40px;
  align-items: center;
  background-color: var(--color-dark-bg);
  z-index: 30;
}

#extensionBar > * {
  height: 100%;
  display: flex;
  align-items: center;
}

#loginsDropdown li.none {
  opacity: 0.5;
  padding: 0 10px;
}

#loginsDropdown li > div:last-child {
  border-bottom: none;
}

#loginsDropdown li > div {
  display: grid;
  grid-template-columns: auto min-content;
  border-bottom: 1px solid #4a4a4a;
}

#loginsDropdown .loginData {
  display: grid;
  white-space: nowrap;
  padding: 10px;
}

#loginsDropdown .logoutButton {
  display: grid;
  align-content: center;
  justify-content: center;
  padding-left: 10px;
  padding-right: 10px;
  opacity: 0;
}

#loginsDropdown .loginRow:hover .logoutButton {
 opacity: 0.25;
}

#loginsDropdown .loginRow:hover .logoutButton:hover {
  opacity: 1;
  background-color: #db4437;
  cursor: pointer;
}

#loginsDropdown li.header {
  padding: 5px;
  background-color: #ffffff1c;
}

#loginsDropdown .loginData.expired {
  opacity: 0.5;
}

.ng-extend-logo {
  display: flex;
  align-items: center;
  padding: 0 6px 0 8px;
}
.ng-extend-logo > a {
  display: flex;
  align-items: center;
}
.nge-pyr-logo {
  /* Sized to match the toolbar SVG icons (18px content) — was 28px and
     visibly outsized everything else. The blue glow gives it identity
     without needing the extra pixels. */
  width: 22px;
  height: 22px;
  object-fit: contain;
  opacity: 0.95;
  filter: drop-shadow(0 0 6px rgba(74, 158, 255, 0.35));
  transition: opacity 0.15s, filter 0.15s;
}
.nge-pyr-logo:hover {
  opacity: 1;
  filter: drop-shadow(0 0 10px rgba(74, 158, 255, 0.5));
}

/* ── Share toast (holographic mini-modal) ── */
/* `#extensionBar > *` sets height:100% on every direct child — override that
   here, otherwise the absolute toast resolves 100% against the viewport and
   becomes a full-page-tall bar. Also pin display so flex centering works. */
.nge-share-toast {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  height: auto !important;
  display: flex !important;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 26px 16px;
  min-width: 240px;
  background: linear-gradient(135deg,
    rgba(8, 28, 48, 0.92) 0%,
    rgba(12, 18, 38, 0.94) 50%,
    rgba(8, 28, 48, 0.92) 100%);
  border: 1px solid rgba(74, 200, 255, 0.35);
  border-radius: 14px;
  color: #cfeaff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  white-space: nowrap;
  z-index: 9999;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.45),
    0 0 24px rgba(74, 200, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: none;
  overflow: hidden;
}
.nge-share-toast::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  padding: 1px;
  background: linear-gradient(135deg,
    rgba(74, 220, 255, 0.5),
    rgba(120, 0, 255, 0.15) 50%,
    rgba(0, 220, 200, 0.4));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  animation: nge-share-border 4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nge-share-border {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1; }
}

.nge-share-toast-icon {
  position: relative;
  width: 56px;
  height: 56px;
}
.nge-share-neuron {
  position: absolute;
  width: 44px;
  height: 44px;
  filter: drop-shadow(0 0 6px rgba(74, 200, 255, 0.5));
}
.nge-share-neuron--back {
  top: 0;
  left: 0;
  opacity: 0.55;
  animation: nge-share-neuron-breathe 2.6s ease-in-out infinite;
}
.nge-share-neuron--front {
  bottom: 0;
  right: 0;
  opacity: 1;
  filter: drop-shadow(0 0 8px rgba(91, 227, 255, 0.7));
  animation: nge-share-neuron-breathe 2.6s ease-in-out infinite 0.4s;
}
@keyframes nge-share-neuron-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.05); }
}

.nge-share-toast-text {
  position: relative;
  z-index: 1;
  text-shadow: 0 0 10px rgba(74, 200, 255, 0.4);
}

/* Action button row inside the share toast. The toast itself is
   pointer-events: none so it doesn't block viewer interaction; buttons
   override with pointer-events: auto so they're still clickable. */
.nge-share-toast-actions {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.nge-share-action {
  pointer-events: auto;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 158, 255, 0.12);
  border: 1px solid rgba(74, 200, 255, 0.32);
  border-radius: 8px;
  color: #cfeaff;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.nge-share-action:hover {
  background: rgba(74, 200, 255, 0.28);
  border-color: rgba(74, 200, 255, 0.7);
  color: #ffffff;
  transform: translateY(-1px);
}
.nge-share-action:active {
  transform: translateY(0);
}

.nge-share-toast-enter-active { transition: opacity 0.28s ease-out, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-share-toast-leave-active { transition: opacity 0.32s ease-in, transform 0.32s ease-in; }
.nge-share-toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.94); }
.nge-share-toast-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.97); }

/* ── Dataset button: borderless to match the toolbar SVG icons.
   Same gentle hover wash as .nge-icon-btn. ── */
/* Ask and Dataset are the only labelled controls in a strip of icon buttons.
   They were 28px tall against the icons' 38px, with different horizontal
   padding from each other (8px vs 10px), so they sat short and unevenly
   spaced — the "weird padding". Both now match the icon buttons' height and
   share one padding value, so the whole bar sits on a single rhythm. */
#extensionBar .nge-dataset-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  /* Same pill as the AI button so the left cluster reads as one family
     (it was a bare 38px text row beside a 30px pill, which read as
     mashed-together labels — Amy's top-left spacing report). */
  height: 30px;
  padding: 0 14px;
  margin: 0 10px 0 5px;
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.42);
  border-radius: 14px;
  color: #cfdcef;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0.85;
  transition: background 0.15s, opacity 0.15s, color 0.15s;
}
.nge-dataset-label { padding-right: 2px; }
.nge-dataset-species { font-size: 14px; line-height: 1; }
#extensionBar .nge-dataset-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
  color: #e0ecff;
}
.nge-dataset-btn .material-symbols-outlined {
  color: rgba(150, 175, 215, 0.9);
}
.nge-dataset-btn:hover .material-symbols-outlined {
  color: #cfdcef;
}

/* ── Ask (EyeWire II Guide) button ── */
#extensionBar .nge-ask-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* Matches .nge-icon-btn height; the pill keeps its own inner height via
     border-radius so it still reads as a button, not an icon. */
  height: 30px;
  margin: 0 5px 0 14px;
  padding: 0 14px;
  /* Visible pill: the earlier 0.12/0.28 tints disappeared on the dark bar
     and the cluster still read as run-on text (Amy: "how the hell is this
     spacing fixed"). Match the Share button's presence. */
  background: rgba(74, 158, 255, 0.16);
  border: 1px solid rgba(74, 158, 255, 0.5);
  border-radius: 14px;
  color: #cfe0f5;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
#extensionBar .nge-ask-btn:hover {
  background: rgba(74, 158, 255, 0.22);
  border-color: rgba(74, 158, 255, 0.5);
  color: #eaf2ff;
}
#extensionBar .nge-ask-btn--active {
  background: rgba(74, 158, 255, 0.28);
  border-color: rgba(74, 158, 255, 0.6);
}
.nge-ask-btn .material-symbols-outlined {
  color: #6fb2ff;
}

/* ── Toolbar icon group ── */
.nge-toolbar-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 100%;
}

#extensionBar .nge-icon-btn {
  /* `font-size` controls SVG sizing (icons use width:1em/height:1em). The
     icon viewBoxes are cropped tight to their artwork (see toolbar-icons.ts),
     so the glyph now fills the box and font-size ≈ rendered glyph size.

     Scoped under #extensionBar (specificity 1,1,0) so it beats the blanket
     `#extensionBar button { font-size: 10pt }` rule above — otherwise the
     icons fall back to 13px on wide screens (the original bug). A FIXED size
     is deliberate: viewport-scaling (vw) grew the icons on big monitors,
     which read as comically large. Toolbar glyphs want one consistent,
     modest size at every width, not one that tracks the screen. */
  font-size: 20px;
  width: 34px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.78;
  transition: opacity 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
  line-height: 1;
}
/* Hover: a holo glow ring + slight lift, so the custom icons answer the
   cursor the way the neuroglancer natives do, but in the app's own accent. */
.nge-icon-btn:hover {
  opacity: 1;
  background: rgba(100, 200, 255, 0.1);
  box-shadow:
    0 0 0 1px rgba(100, 200, 255, 0.3),
    0 2px 12px rgba(100, 200, 255, 0.18);
  transform: translateY(-1px);
}
@media (prefers-reduced-motion: reduce) {
  .nge-icon-btn:hover { transform: none; }
}
.nge-icon-btn--active {
  opacity: 1;
  background: rgba(74, 158, 255, 0.12);
  box-shadow: 0 1px 0 0 #4a9eff;
}
/* Drag-to-reorder visuals */
.nge-icon-btn {
  position: relative;
}
.nge-icon-btn--dragging {
  opacity: 0.35;
  cursor: grabbing;
}
/* Vertical insertion bar shown to the LEFT of the drop target.
 * Replaces the old square box-shadow highlight — reads as a cursor
 * showing where the dragged icon will land. */
.nge-icon-btn--drag-over::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(120, 180, 255, 0.95) 22%,
    rgba(180, 215, 255, 1) 50%,
    rgba(120, 180, 255, 0.95) 78%,
    transparent 100%
  );
  border-radius: 1px;
  box-shadow: 0 0 8px rgba(120, 180, 255, 0.7);
  pointer-events: none;
  animation: nge-icon-drop-pulse 0.9s ease-in-out infinite;
}
@keyframes nge-icon-drop-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; }
}
.nge-icon-btn--badge { position: relative; }

.nge-toolbar-icon-img {
  /* Track the same em sizing as the SVG icons so the Cell Library PNG
     scales with the clamp() on .nge-icon-btn instead of staying a fixed
     24px while its neighbours shrink/grow. */
  width: 1em;
  height: 1em;
  object-fit: contain;
  vertical-align: middle;
  opacity: 0.9;
}
.nge-toolbar-badge {
  position: absolute;
  top: 1px;
  right: 0;
  background: #7c4dff;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  border-radius: 8px;
  min-width: 13px;
  height: 13px;
  line-height: 13px;
  text-align: center;
  padding: 0 3px;
  /* Soft entrance — pip pops in when a new unread arrives. */
  animation: nge-badge-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Chat unread pip is green to read as "live conversation" rather than
   the purple admin/notification accent. */
.nge-toolbar-badge--chat {
  background: #4ad07a;
  color: #06170d;
  box-shadow: 0 0 8px rgba(74, 208, 122, 0.55);
}

/* ── Right end of the bar: profile, burger, ? and the layer panel toggle ──
   These came from three places (our button, the dropdown, and neuroglancer's
   own icons moved into #ngFarRight) and each looked different: a filled
   profile glyph, a 13px burger, a 12px bold "?" in a 22x18 box, and NG's
   grey "checked" square (Ames 2026-09-29). They now match the left row. */
#extensionBar #profileBtn { margin-left: 12px; }
#extensionBar #hamburger > button,
#extensionBar #ngFarRight > .neuroglancer-icon {
  font-size: 20px;
  width: 34px;
  height: 38px;
  min-width: 34px;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none !important;
  border: none;
  border-radius: 4px;
  color: #cfdcef;
  opacity: 0.78;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
  line-height: 1;
}
#extensionBar #ngFarRight > .neuroglancer-icon { font-weight: 600; font-family: 'Inter', 'Roboto', sans-serif; }
@media (max-width: 1366px) {
  #extensionBar #hamburger > button,
  #extensionBar #ngFarRight > .neuroglancer-icon { height: 30px; }
}
#extensionBar #ngFarRight > .neuroglancer-icon svg { width: 0.95em; height: 0.95em; }
#extensionBar #hamburger > button:hover,
#extensionBar #ngFarRight > .neuroglancer-icon:hover {
  opacity: 1;
  background: rgba(100, 200, 255, 0.1) !important;
  box-shadow: 0 0 0 1px rgba(100, 200, 255, 0.3), 0 2px 12px rgba(100, 200, 255, 0.18);
  transform: translateY(-1px);
}
/* Open menu / panel showing: the same active underline as the left row. */
#extensionBar #hamburger.open > button,
#extensionBar #ngFarRight > .neuroglancer-icon[data-checked="true"] {
  opacity: 1;
  background: rgba(74, 158, 255, 0.12) !important;
  box-shadow: 0 1px 0 0 #4a9eff;
}

/* ══ Toolbar icon animations (Ames 2026-09-29: "I want them all!") ══════════
   The icons stay exactly as drawn; these only move them, or parts of them,
   on hover (a light loop or flourish) and on click (.nge-pop, added for
   0.8 s by the click hook). Parts are picked by their order inside each SVG
   in data/toolbar-icons.ts, so keep that order if an icon is redrawn. */
#extensionBar .nge-icon-btn svg,
#extensionBar .nge-icon-btn img,
#extensionBar #ngFarRight > .neuroglancer-icon > svg,
#extensionBar #ngFarRight > .neuroglancer-icon { transform-origin: center; }
#extensionBar .nge-icon-btn svg *,
#extensionBar #ngFarRight svg * { transform-box: fill-box; transform-origin: center; }
#extensionBar #ngFarRight > .neuroglancer-icon { position: relative; }

/* Shared click ripple (bell ding, camera flash use their own). */
@keyframes nge-ti-ring { from { opacity: 0.8; transform: scale(0.4); } to { opacity: 0; transform: scale(1.5); } }

/* Bug (Submit an issue): the legs scurry on hover, faster with a pop on click. */
#extensionBar .nge-feedback-btn .nge-bug-legs { transform-box: view-box; }
#extensionBar .nge-feedback-btn .nge-bug-legs--l { transform-origin: 8px 14px; }
#extensionBar .nge-feedback-btn .nge-bug-legs--r { transform-origin: 16px 14px; }
#extensionBar .nge-feedback-btn:hover .nge-bug-legs--l { animation: nge-bug-leg-l 0.22s ease-in-out infinite alternate; }
#extensionBar .nge-feedback-btn:hover .nge-bug-legs--r { animation: nge-bug-leg-r 0.22s ease-in-out infinite alternate; }
#extensionBar .nge-feedback-btn.nge-pop .nge-bug-legs--l { animation: nge-bug-leg-l 0.1s ease-in-out 6 alternate; }
#extensionBar .nge-feedback-btn.nge-pop .nge-bug-legs--r { animation: nge-bug-leg-r 0.1s ease-in-out 6 alternate; }
#extensionBar .nge-feedback-btn.nge-pop svg { animation: nge-ti-pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes nge-bug-leg-l { from { transform: rotate(-14deg); } to { transform: rotate(12deg); } }
@keyframes nge-bug-leg-r { from { transform: rotate(14deg); } to { transform: rotate(-12deg); } }
@keyframes nge-ti-alert { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(-12deg); } 40% { transform: rotate(10deg); } 60% { transform: rotate(-6deg); } 80% { transform: rotate(3deg); } }
@keyframes nge-ti-pop { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }

/* Cut: the two lower ends pull apart; click snaps them wide and back. */
/* A tool that cannot work on this dataset: grey, still, and it says why. */
#extensionBar .nge-icon-btn.nge-icon-btn--off { opacity: 0.32; filter: grayscale(1); cursor: not-allowed; }
#extensionBar .nge-icon-btn.nge-icon-btn--off * { animation: none !important; }
/* Highlight mode's spray can: lid on at rest; it shakes up and down on
   hover; on click the lid pops off, five dots spray from the nozzle, and
   the lid drops back on. */
#extensionBar [data-icon-id="highlight"] .nge-can-all,
#extensionBar [data-icon-id="highlight"] .nge-can-lid { transform-box: view-box; }
#extensionBar [data-icon-id="highlight"] .nge-can-lid { transform-origin: 8px 3.4px; }
#extensionBar [data-icon-id="highlight"] .nge-can-spray circle { opacity: 0; transform-box: fill-box; transform-origin: center; }
#extensionBar [data-icon-id="highlight"]:hover .nge-can-all { animation: nge-can-shake 0.3s ease-in-out infinite; }
#extensionBar [data-icon-id="highlight"].nge-spraying .nge-can-all { animation: none; }
#extensionBar [data-icon-id="highlight"].nge-spraying .nge-can-lid { animation: nge-can-lid 0.95s ease-out; }
#extensionBar [data-icon-id="highlight"].nge-spraying .nge-can-spray circle { animation: nge-can-spray 0.6s ease-out 0.16s both; }
#extensionBar [data-icon-id="highlight"].nge-spraying .nge-can-spray circle:nth-child(1) { --sx: -5.6px; --sy: 0.3px; }
#extensionBar [data-icon-id="highlight"].nge-spraying .nge-can-spray circle:nth-child(2) { --sx: -5.2px; --sy: -3.2px; animation-delay: 0.22s; }
#extensionBar [data-icon-id="highlight"].nge-spraying .nge-can-spray circle:nth-child(3) { --sx: -4.8px; --sy: 3.6px; animation-delay: 0.28s; }
@keyframes nge-can-shake {
  0%, 100% { transform: translateY(-1.3px); }
  50% { transform: translateY(1.3px); }
}
/* The lid flips up and off to the right, hangs there while it sprays, then
   drops back on. */
@keyframes nge-can-lid {
  0% { transform: translate(0, 0) rotate(0deg); }
  16% { transform: translate(5.6px, -3px) rotate(52deg); }
  74% { transform: translate(5.6px, -3px) rotate(52deg); }
  100% { transform: translate(0, 0) rotate(0deg); }
}
/* Each dot starts at the nozzle and flies out along its own direction. */
@keyframes nge-can-spray {
  0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
  15% { opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translate(var(--sx), var(--sy)) scale(1.35); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  #extensionBar [data-icon-id="highlight"] .nge-can-all, #extensionBar [data-icon-id="highlight"] .nge-can-lid,
  #extensionBar [data-icon-id="highlight"] .nge-can-spray circle { animation: none !important; }
}
#extensionBar [data-icon-id="split"]:hover svg > :nth-child(4) { animation: nge-ti-split-l 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="split"]:hover svg > :nth-child(5) { animation: nge-ti-split-r 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="split"].nge-pop svg { animation: nge-ti-snip 0.5s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes nge-ti-split-l { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-1.2px, 0.6px); } }
@keyframes nge-ti-split-r { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(1.2px, 0.6px); } }
@keyframes nge-ti-snip { 0% { transform: scaleX(1); } 35% { transform: scaleX(1.3) scaleY(0.9); } 70% { transform: scaleX(0.94); } 100% { transform: scaleX(1); } }

/* Merge: the two top ends lean in; click snaps them together, the join flashes. */
#extensionBar [data-icon-id="merge"]:hover svg > :nth-child(2) { animation: nge-ti-merge-l 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="merge"]:hover svg > :nth-child(3) { animation: nge-ti-merge-r 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="merge"].nge-pop svg > :nth-child(2) { animation: nge-ti-merge-snap-l 0.55s ease-in-out; }
#extensionBar [data-icon-id="merge"].nge-pop svg > :nth-child(3) { animation: nge-ti-merge-snap-r 0.55s ease-in-out; }
#extensionBar [data-icon-id="merge"].nge-pop svg > :nth-child(4) { animation: nge-ti-flash 0.55s ease-out; }
@keyframes nge-ti-merge-l { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(1.2px); } }
@keyframes nge-ti-merge-r { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-1.2px); } }
@keyframes nge-ti-merge-snap-l { 0%, 100% { transform: translateX(0); } 45% { transform: translateX(3.6px); } }
@keyframes nge-ti-merge-snap-r { 0%, 100% { transform: translateX(0); } 45% { transform: translateX(-3.6px); } }
@keyframes nge-ti-flash { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.9); filter: brightness(1.8); } }

/* Find Path: the dotted path marches; click runs it fast and the ends pulse. */
#extensionBar [data-icon-id="findPath"]:hover svg > :nth-child(3) { animation: nge-ti-march 0.8s linear infinite; }
#extensionBar [data-icon-id="findPath"].nge-pop svg > :nth-child(3) { animation: nge-ti-march 0.25s linear 3; }
#extensionBar [data-icon-id="findPath"].nge-pop svg > circle { animation: nge-ti-flash 0.6s ease-out; }
@keyframes nge-ti-march { to { stroke-dashoffset: -6.4; } }

/* Leaderboard: the cup wiggles; click hops it with a sparkle burst. */
#extensionBar [data-icon-id="leaderboard"]:hover svg { animation: nge-ti-wiggle 0.6s ease-in-out; }
#extensionBar [data-icon-id="leaderboard"].nge-pop svg { animation: nge-ti-hop 0.6s cubic-bezier(0.3, 1.5, 0.5, 1); }
#extensionBar [data-icon-id="leaderboard"].nge-pop::after {
  content: ''; position: absolute; left: 50%; top: 45%; width: 3px; height: 3px; border-radius: 50%;
  background: #ffe29a; pointer-events: none;
  box-shadow: -11px -8px 0 #ffd27a, 11px -9px 0 #fff3c4, -13px 4px 0 #ffe29a, 13px 3px 0 #ffd27a, 0 -14px 0 #fff3c4;
  animation: nge-ti-sparkle 0.6s ease-out forwards;
}
@keyframes nge-ti-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-9deg); } 60% { transform: rotate(7deg); } 85% { transform: rotate(-3deg); } }
@keyframes nge-ti-hop { 0% { transform: translateY(0) scale(1); } 20% { transform: translateY(1px) scale(1.1, 0.88); } 50% { transform: translateY(-5px) scale(0.95, 1.08); } 80% { transform: translateY(0) scale(1.05, 0.95); } 100% { transform: none; } }
@keyframes nge-ti-sparkle { from { opacity: 1; transform: translate(-50%, -50%) scale(0.4); } to { opacity: 0; transform: translate(-50%, -50%) scale(1.5); } }

/* Second Opinion (magnifier): sweeps side to side; click zooms in. */
#extensionBar [data-icon-id="help"]:hover svg { animation: nge-ti-sweep 1.1s ease-in-out infinite; }
#extensionBar [data-icon-id="help"].nge-pop svg { animation: nge-ti-zoom 0.5s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes nge-ti-sweep { 0%, 100% { transform: translateX(0) rotate(0); } 30% { transform: translateX(-1.6px) rotate(-8deg); } 70% { transform: translateX(1.6px) rotate(8deg); } }
@keyframes nge-ti-zoom { 0% { transform: scale(1); } 40% { transform: scale(1.4); } 100% { transform: scale(1); } }

/* Tags (pin): bobs; click drops it in and it sticks with a squash. */
#extensionBar [data-icon-id="tags"]:hover svg { animation: nge-ti-bob 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="tags"].nge-pop svg { animation: nge-ti-drop 0.55s cubic-bezier(0.5, 0, 0.5, 1); }
@keyframes nge-ti-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
@keyframes nge-ti-drop { 0% { transform: translateY(-9px); opacity: 0.4; } 55% { transform: translateY(0) scale(1.12, 0.82); opacity: 1; } 78% { transform: translateY(-1.5px) scale(0.96, 1.05); } 100% { transform: none; } }

/* Layer side panel: the divider slides open; click slides it across. */
#extensionBar [data-icon-id="layers"]:hover svg > :nth-child(2),
#extensionBar [data-icon-id="layers"]:hover svg > :nth-child(3) { animation: nge-ti-panel 1s ease-in-out infinite; }
#extensionBar [data-icon-id="layers"].nge-pop svg > :nth-child(2),
#extensionBar [data-icon-id="layers"].nge-pop svg > :nth-child(3) { animation: nge-ti-panel-go 0.55s ease-in-out; }
@keyframes nge-ti-panel { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(1.4px); } }
@keyframes nge-ti-panel-go { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(5px); } }

/* Week in Science: the trend line redraws; click bounces it. */
#extensionBar [data-icon-id="recap"]:hover svg > :nth-child(4) { stroke-dasharray: 12; animation: nge-ti-draw 0.8s ease-out; }
#extensionBar [data-icon-id="recap"].nge-pop svg { animation: nge-ti-hop 0.55s cubic-bezier(0.3, 1.5, 0.5, 1); }
@keyframes nge-ti-draw { from { stroke-dashoffset: 12; } to { stroke-dashoffset: 0; } }

/* Brain Quest (bulb): flickers on; click glows. */
#extensionBar [data-icon-id="quest"]:hover svg { animation: nge-ti-flicker 0.7s steps(1); }
#extensionBar [data-icon-id="quest"].nge-pop svg { animation: nge-ti-glow 0.6s ease-out; }
@keyframes nge-ti-flicker { 0%, 30%, 60%, 100% { opacity: 1; } 15%, 45% { opacity: 0.35; } }
@keyframes nge-ti-glow { 0%, 100% { filter: none; } 40% { filter: drop-shadow(0 0 5px #ffe9a8) brightness(1.6); } }

/* Cell Library (neuron): a slow sway with a glow; click fires it. */
/* Cell Library: bold (a thicker-stroked neuron) and bright, with a soft glow. */
.nge-cells-icon { filter: drop-shadow(0 0 3px rgba(79, 207, 255, 0.5)); }
#extensionBar [data-icon-id="cells"] { opacity: 1; }
#extensionBar [data-icon-id="cells"]:hover .nge-cells-icon { animation: nge-ti-neuron 1.2s ease-in-out infinite; }
#extensionBar [data-icon-id="cells"].nge-pop .nge-cells-icon { animation: nge-ti-fire 0.6s ease-out; }
@keyframes nge-ti-neuron { 0%, 100% { transform: rotate(0); filter: drop-shadow(0 0 0 rgba(126, 232, 255, 0)); } 50% { transform: rotate(8deg); filter: drop-shadow(0 0 4px rgba(126, 232, 255, 0.8)); } }
@keyframes nge-ti-fire { 0% { transform: scale(1); filter: none; } 30% { transform: scale(1.25); filter: brightness(2.2) drop-shadow(0 0 8px #7ee8ff); } 100% { transform: scale(1); filter: none; } }

/* Batch Processor: a real 3D cube (Amy 2026-09-29). It rests still at a 3D
   angle and only turns on hover, or spins once when clicked, so nothing
   animates in the toolbar while you work. */
.nge-cube3d { display: inline-block; width: 1em; height: 1em; vertical-align: middle; perspective: 4em; }
.nge-cube3d-inner {
  display: block;  /* an inline span can't be 3D-transformed */
  position: relative; width: 100%; height: 100%;
  transform-style: preserve-3d;
  transform: rotateX(-22deg) rotateY(35deg);
}
.nge-cube3d i {
  position: absolute; left: 0.19em; top: 0.19em; width: 0.62em; height: 0.62em;
  box-sizing: border-box;
  border: 1.3px solid currentColor;
  border-radius: 1px;
  background: rgba(207, 220, 239, 0.07);
}
.nge-cube3d i:nth-child(1) { transform: translateZ(0.31em); }
.nge-cube3d i:nth-child(2) { transform: rotateY(180deg) translateZ(0.31em); }
.nge-cube3d i:nth-child(3) { transform: rotateY(90deg) translateZ(0.31em); }
.nge-cube3d i:nth-child(4) { transform: rotateY(-90deg) translateZ(0.31em); }
.nge-cube3d i:nth-child(5) { transform: rotateX(90deg) translateZ(0.31em); }
.nge-cube3d i:nth-child(6) { transform: rotateX(-90deg) translateZ(0.31em); }
@keyframes nge-cube-turn {
  from { transform: rotateX(-22deg) rotateY(35deg); }
  to   { transform: rotateX(-22deg) rotateY(395deg); }
}
#extensionBar [data-icon-id="batch"]:hover .nge-cube3d-inner { animation: nge-cube-turn 2.4s linear infinite; }
#extensionBar [data-icon-id="batch"].nge-pop .nge-cube3d-inner { animation: nge-cube-turn 0.6s cubic-bezier(0.5, 0, 0.3, 1); }
@media (prefers-reduced-motion: reduce) {
  #extensionBar [data-icon-id="batch"]:hover .nge-cube3d-inner,
  #extensionBar [data-icon-id="batch"].nge-pop .nge-cube3d-inner { animation: none; }
}

/* Screenshot (camera): the lens glints; click is a shutter flash. */
#extensionBar [data-icon-id="screenshot"]:hover svg > :nth-child(2) { animation: nge-ti-lens 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="screenshot"].nge-pop svg > :nth-child(2) { animation: nge-ti-iris 0.45s ease-in-out; }
#extensionBar [data-icon-id="screenshot"].nge-pop::after {
  content: ''; position: absolute; inset: 4px; border-radius: 6px; background: #fff; pointer-events: none;
  animation: nge-ti-shutter 0.35s ease-out forwards;
}
@keyframes nge-ti-lens { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
@keyframes nge-ti-iris { 0%, 100% { transform: scale(1); } 40% { transform: scale(0.35); } }
@keyframes nge-ti-shutter { from { opacity: 0.85; } to { opacity: 0; } }

/* Activity Feed: the waves pulse out. */
#extensionBar [data-icon-id="feed"]:hover svg > :nth-child(2) { animation: nge-ti-waves 0.9s ease-in-out infinite; }
#extensionBar [data-icon-id="feed"].nge-pop svg { animation: nge-ti-pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes nge-ti-waves { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* Notifications (bell): swings from its top; click rings it with a ripple. */
#extensionBar [data-icon-id="notif"] svg { transform-origin: 50% 12%; }
#extensionBar [data-icon-id="notif"]:hover svg { animation: nge-ti-swing 0.9s ease-in-out; }
#extensionBar [data-icon-id="notif"].nge-pop svg { animation: nge-ti-ding 0.7s ease-out; }
#extensionBar [data-icon-id="notif"].nge-pop::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px;
  border-radius: 50%; border: 1.5px solid rgba(207, 220, 239, 0.8); pointer-events: none;
  animation: nge-ti-ring 0.6s ease-out forwards;
}
@keyframes nge-ti-swing { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(14deg); } 45% { transform: rotate(-10deg); } 70% { transform: rotate(6deg); } 88% { transform: rotate(-2deg); } }
@keyframes nge-ti-ding { 0%, 100% { transform: rotate(0); } 12% { transform: rotate(22deg); } 30% { transform: rotate(-18deg); } 50% { transform: rotate(12deg); } 70% { transform: rotate(-6deg); } }

/* Chat: typing dots appear in the bubble; click pops it. */
#extensionBar [data-icon-id="chat"]:hover::before {
  content: '• • •'; position: absolute; left: 0; right: 0; top: 50%; margin-top: -0.62em;
  font-size: 7px; line-height: 1; letter-spacing: -0.5px; text-align: center; color: #cfdcef; pointer-events: none;
  animation: nge-ti-typing 1s steps(1) infinite;
}
#extensionBar [data-icon-id="chat"].nge-pop svg { animation: nge-ti-pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes nge-ti-typing { 0% { opacity: 0.3; } 33% { opacity: 0.65; } 66% { opacity: 1; } }

/* Settings gear: spins on hover; click gives a half turn. */
#extensionBar [data-icon-id="settings"]:hover svg { animation: nge-ti-gear 2.4s linear infinite; }
#extensionBar [data-icon-id="settings"].nge-pop svg { animation: nge-ti-halfturn 0.5s cubic-bezier(0.3, 1.4, 0.5, 1); }
@keyframes nge-ti-gear { to { transform: rotate(360deg); } }
@keyframes nge-ti-halfturn { to { transform: rotate(180deg); } }

/* Profile: a nod; click waves (tilts side to side). */
#extensionBar #profileBtn:hover svg > :nth-child(1) { animation: nge-ti-nod 0.7s ease-in-out; }
#extensionBar #profileBtn.nge-pop svg { animation: nge-ti-wave 0.6s ease-in-out; }
@keyframes nge-ti-nod { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(1.3px); } 70% { transform: translateY(-0.4px); } }
@keyframes nge-ti-wave { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-12deg); } 50% { transform: rotate(10deg); } 75% { transform: rotate(-5deg); } }

/* ? and the layer panel toggle (neuroglancer's icons). */
/* One small tilt (Amy 2026-09-30: the four-swing wiggle was too much). */
#extensionBar #ngFarRight > .neuroglancer-icon:first-child:hover { animation: nge-ti-tilt 0.45s ease-out; }
@keyframes nge-ti-tilt { 0%, 100% { transform: translateY(-1px) rotate(0); } 45% { transform: translateY(-1px) rotate(-6deg); } }
#extensionBar #ngFarRight > .neuroglancer-icon:first-child.nge-pop { animation: nge-ti-hop 0.55s cubic-bezier(0.3, 1.5, 0.5, 1); }
#extensionBar #ngFarRight > .neuroglancer-icon:last-child:hover svg > :nth-child(odd) { animation: nge-ti-knob-a 0.9s ease-in-out infinite; }
#extensionBar #ngFarRight > .neuroglancer-icon:last-child:hover svg > :nth-child(even) { animation: nge-ti-knob-b 0.9s ease-in-out infinite; }
#extensionBar #ngFarRight > .neuroglancer-icon:last-child.nge-pop svg { animation: nge-ti-pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes nge-ti-knob-a { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(1.6px); } }
@keyframes nge-ti-knob-b { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-1.6px); } }

@media (prefers-reduced-motion: reduce) {
  #extensionBar .nge-icon-btn *, #extensionBar .nge-icon-btn::before, #extensionBar .nge-icon-btn::after,
  #extensionBar #ngFarRight *, #extensionBar #ngFarRight > .neuroglancer-icon { animation: none !important; }
}

/* Burger bounce: on click it hops and its layers pull apart, then stack. */
.nge-burger [class^="nge-bb-"] { transform-box: fill-box; transform-origin: center; }
.nge-burger.nge-burger--bounce { animation: nge-bb-hop 0.62s cubic-bezier(0.3, 1.5, 0.5, 1); }
.nge-burger--bounce .nge-bb-top { animation: nge-bb-top 0.62s cubic-bezier(0.3, 1.5, 0.5, 1); }
.nge-burger--bounce .nge-bb-lettuce { animation: nge-bb-lettuce 0.62s cubic-bezier(0.3, 1.5, 0.5, 1); }
.nge-burger--bounce .nge-bb-patty { animation: nge-bb-patty 0.62s cubic-bezier(0.3, 1.5, 0.5, 1); }
@keyframes nge-bb-hop {
  0% { transform: translateY(0) scale(1, 1); }
  18% { transform: translateY(1px) scale(1.08, 0.9); }
  45% { transform: translateY(-4px) scale(0.97, 1.05); }
  78% { transform: translateY(0) scale(1.04, 0.96); }
  100% { transform: translateY(0) scale(1, 1); }
}
@keyframes nge-bb-top { 0%, 18% { transform: translateY(0); } 45% { transform: translateY(-3.2px) rotate(-4deg); } 80%, 100% { transform: translateY(0); } }
@keyframes nge-bb-lettuce { 0%, 18% { transform: translateY(0); } 45% { transform: translateY(-1.9px); } 80%, 100% { transform: translateY(0); } }
@keyframes nge-bb-patty { 0%, 18% { transform: translateY(0); } 45% { transform: translateY(-0.9px); } 80%, 100% { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .nge-burger.nge-burger--bounce, .nge-burger--bounce [class^="nge-bb-"] { animation: none; }
}

/* The leaderboard just zipped into its button: a quick catch. */
.nge-icon-btn.nge-icon-btn--caught {
  animation: nge-lb-caught 0.7s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes nge-lb-caught {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 196, 80, 0); }
  30% { transform: scale(1.35); box-shadow: 0 0 0 3px rgba(245, 196, 80, 0.85), 0 0 22px rgba(245, 196, 80, 0.7); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 196, 80, 0); }
}

/* You were @mentioned while chat was closed. */
.nge-icon-btn.nge-icon-btn--mention {
  animation: nge-chat-btn-mention 1.1s ease-in-out infinite;
  border-radius: 8px;
}
.nge-icon-btn--mention .nge-toolbar-badge--chat {
  background: #f5a623;
  color: #1a1204;
  box-shadow: 0 0 10px rgba(245, 166, 35, 0.8);
}
@keyframes nge-chat-btn-mention {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 166, 35, 0); background-color: transparent; }
  50% { box-shadow: 0 0 0 2px rgba(245, 166, 35, 0.9), 0 0 18px rgba(245, 166, 35, 0.6); background-color: rgba(245, 166, 35, 0.18); }
}

@keyframes nge-badge-pop {
  0%   { opacity: 0; transform: scale(0.4); }
  60%  { opacity: 1; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}

/* (The ⌘K trigger chip and its styles are gone: the button was removed from
   the toolbar, and the command palette it opened is now folded into the Ask
   dock. Ctrl/Cmd+K opens that dock instead — see commandKeyHandler.) */

/* ── Hamburger menu ── */
#hamburger li {
  padding: 10px 14px;
  cursor: pointer;
  display: grid;
  justify-content: center;
  align-content: center;
  white-space: nowrap;
  font-size: 14px;
}

#hamburger li .logoutButton {
  font-size: 14px;
}

/* Hover treatment matches the Seg side-panel tab hover so the menu and
   the right panel read as one design language. */
#hamburger li:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

/* Site Tour entry uses the same "selected tab" treatment as the Seg
   panel: the rgba(74,158,255,0.1) fill + a 2px accent line on the
   leading edge (left for a vertical menu, top for horizontal tabs). */
#hamburger li .nge-tour-btn {
  color: rgba(220, 235, 255, 0.98);
  font-weight: 500;
  letter-spacing: 0.3px;
  background: rgba(74, 158, 255, 0.1);
  border-left: 2px solid rgba(74, 158, 255, 0.5);
}
#hamburger li:hover .nge-tour-btn {
  background: rgba(74, 158, 255, 0.18);
  border-left-color: rgba(74, 158, 255, 0.8);
}

#hamburger li a {
  color: unset;
  text-decoration: unset;
  font-size: inherit;
}

/* Section headings: labels, not buttons. */
#hamburger li.nge-menu-heading {
  justify-content: start;
  padding: 12px 14px 4px;
  cursor: default;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(120, 180, 255, 0.7);
}
#hamburger li.nge-menu-heading:hover { background: none; }
#hamburger li.nge-menu-heading:not(:first-child) {
  margin-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
#hamburger li .nge-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}
.nge-menu-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(74, 158, 255, 0.45);
  color: #9cc8ff;
  font-size: 10.5px;
  font-weight: 600;
}
</style>
