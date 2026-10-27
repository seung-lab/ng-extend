<script setup lang="ts">
import { pumpkinSeason } from '../util/pumpkin';
import {ref, onMounted, onUnmounted, computed} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {useUserPreferencesStore, useLoginStore, useProofreadingBackendStore, useIssueTagStore, loginSession} from '../store';
import {COUNTRIES, EYEWIRE_FLAG, findCountryByCode} from '../data/countries';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';
import { DATASETS, segLayerName } from '../datasets';
import { startViewHash } from '../util/start_view';
import { automaticRegion, imageRegionLabel } from '../util/image_source';
import { ngePointGem } from 'neuroglancer/annotation/point';
import { ngeHoverStyle } from 'neuroglancer/segmentation_display_state/frontend';

const prefsStore = useUserPreferencesStore();

const backendStore = useProofreadingBackendStore();

// ── Username ────────────────────────────────────────────────────────────────
// Chat shows this instead of the display name, and @mentions match it. It's
// unique and space-free, so "@celia" resolves to exactly one person — display
// names are neither. Changing it is a deliberate action routed through the
// dedicated dialog (validation + availability + save all live there), not an
// always-live text field in this panel.

/** Open the username dialog (the same one shown after Tutorial 1). */
function openUsernameDialog() {
  document.dispatchEvent(new CustomEvent('nge:prompt-username', { detail: { force: true } }));
}

const draftFlag = ref('');
const draftBio  = ref('');
// Boxes folded shut by clicking their title (Ames 2026-10-21), remembered in this browser.
const FOLD_KEY = 'nge-settings-folded';
const folded = ref<string[]>((() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); } catch { return []; } })());
function isFolded(key: string) { return folded.value.includes(key); }
function toggleFold(key: string) {
  folded.value = isFolded(key) ? folded.value.filter(k => k !== key) : [...folded.value, key];
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded.value)); } catch { /* no storage */ }
}
const draftToolbar = ref<string[]>([]);
// What the grid showed on opening, and whether Reset was pressed (top bar staging).
let toolbarShownAtOpen: string[] = [];
let toolbarReset = false;
/** A pill shows the name only. A label may go on to explain itself after a
 *  colon (the Lantern's ran out of the panel, Krzysztof Kruk 2026-10-11);
 *  the whole label is the pill's tooltip. */
const pillName = (label: string) => label.split(':')[0].trim();
const draftChatMuted = ref(false);
const draftChatFade = ref(true);
const draftChatMarkMine = ref(true);
const draftShowNgControls = ref(false);
const draftShowXyz = ref(false);
const draftKeepDisplay = ref(true);
/** "Cell & Quest celebration" (Ames 2026-10-25): a switch, on unless set
 *  off. Kept in cellCompleteMessage, so a player who had picked the small
 *  note keeps it while the switch is on. */
const draftCellCelebration = ref(true);
let savedCellMessage: 'full' | 'small' | 'off' = 'full';
const draftAchievementCelebration = ref(true);
const draftNotifOneList = ref(false);
const draftDailyDigest = ref(true);
/** How the cell under the mouse is shown (wolfryder101 #181): the classic fade (default), halo or pulse. */
const draftHoverStyle = ref<'outline' | 'halo' | 'pulse' | 'hologram' | 'metallic' | 'saturate' | 'spotlight' | 'fade' | 'none'>('fade');
/** The pulse's colour (Nseraf): '' a light tint of the cell's own. */
const draftPulseColor = ref('');
const PULSE_COLORS = [
  { value: '', label: "Each cell's own colour: a blue cell pulses light blue" }, { value: '#59d8ff', label: 'Electric blue' },
  { value: '#ffffff', label: 'White' }, { value: '#ffd34d', label: 'Gold' }, { value: '#ff6fd8', label: 'Pink' },
  { value: '#6dff8a', label: 'Green' }, { value: '#b48cff', label: 'Purple' }, { value: '#ff5a4f', label: 'Red' },
];
/** A colour from the picker, not one of the swatches. */
const isCustomPulseColor = computed(() => !!draftPulseColor.value && !PULSE_COLORS.some(c => c.value === draftPulseColor.value));
function onPulseColorPick(e: Event) {
  draftPulseColor.value = (e.target as HTMLInputElement).value;
}
const draftImageDetail = ref<1 | 2 | 4>(1);
const draftImageSource = ref<'auto' | 'americas' | 'asia'>('auto');
/** What Automatic means on this computer right now, shown in its option. */
const autoImageRegion = computed(() => imageRegionLabel(automaticRegion()));
const draftClassicLayers = ref(false);
const draftUndeleteCounter = ref(false);
const draftShowRadio = ref(true);
const draftPumpkin = ref(true);
const draftSegShowId = ref(false);
const draftCalm = ref(false);
const draftCursorXL = ref(false);
const draftLargeText = ref(false);
const draftHideTopBar = ref(false);
const draftImageLayerPanel = ref(false);
const draftLibraryTab = ref<'mine' | 'available' | 'claimed' | 'all' | 'help' | 'links'>('mine');
const draftJumpAdds = ref(false);
const draftOfferRestore = ref(true);
const draftAnnotationGems = ref(true);
const draftAnnotationSetupTabs = ref(false);
const draftSegSetupTabs = ref(false);
const draftHelpMuted = ref(false);
const saved      = ref(false);

// ── Switching datasets ─────────────────────────────────────────────────────
const draftBareSwitch = ref(false);
/** Optional datasets shown in the dataset selector (same choice as the
 *  profile's Datasets tab). */
const draftExtra = ref<string[]>([]);
const OPTIONAL_DATASETS = DATASETS.filter(d => d.optional && !d.hidden);
function toggleDraftExtra(id: string, ev: Event) {
  const set = new Set(draftExtra.value);
  if ((ev.target as HTMLInputElement).checked) set.add(id); else set.delete(id);
  draftExtra.value = [...set];
}
const draftStartViews = ref<Record<string, string>>({});
const svDataset = ref(segLayerName(DATASETS[0]));
const svLink = ref('');
const svError = ref('');
const labelFor = (seg: string) => DATASETS.find(d => segLayerName(d) === seg)?.label || seg;
function pickStartViewDataset() {
  svLink.value = draftStartViews.value[svDataset.value] || '';
  svError.value = '';
}
function setStartView() {
  const link = svLink.value.trim();
  if (!startViewHash(link)) {
    svError.value = 'That is not a share link we can open. Use Share in the top bar while in this dataset, then paste the link it copies.';
    return;
  }
  draftStartViews.value = { ...draftStartViews.value, [svDataset.value]: link };
  svError.value = '';
}
function clearStartView(seg: string) {
  const next = { ...draftStartViews.value };
  delete next[seg];
  draftStartViews.value = next;
  if (seg === svDataset.value) svLink.value = '';
}

onMounted(() => {
  draftFlag.value = prefsStore.prefs.flag;
  draftBio.value  = prefsStore.prefs.bio;
  draftChatMuted.value = !!prefsStore.prefs.chatMuted;
  draftChatFade.value = prefsStore.prefs.chatFadeAway !== false;
  draftChatMarkMine.value = prefsStore.prefs.chatMarkMine !== false;
  draftShowNgControls.value = prefsStore.prefs.showNgControlsButton === true;
  draftShowXyz.value = prefsStore.prefs.showXyzCorner === true;
  draftKeepDisplay.value = prefsStore.prefs.keepDisplayOnJump !== false;
  savedCellMessage = prefsStore.prefs.cellCompleteMessage || 'full';
  draftCellCelebration.value = savedCellMessage !== 'off';
  draftAchievementCelebration.value = prefsStore.prefs.achievementCelebration !== false;
  draftNotifOneList.value = prefsStore.prefs.notifOneList === true;
  draftDailyDigest.value = prefsStore.prefs.showDailyDigest !== false;
  draftHoverStyle.value = ngeHoverStyle.value;
  draftPulseColor.value = prefsStore.prefs.pulseColor || '';
  draftImageDetail.value = prefsStore.prefs.imageDetail === 2 || prefsStore.prefs.imageDetail === 4 ? prefsStore.prefs.imageDetail : 1;
  draftImageSource.value = prefsStore.prefs.imageSource === 'americas' || prefsStore.prefs.imageSource === 'asia' ? prefsStore.prefs.imageSource : 'auto';
  draftClassicLayers.value = prefsStore.prefs.classicLayerClicks === true;
  draftUndeleteCounter.value = prefsStore.prefs.undeleteCounter === true;
  draftShowRadio.value = prefsStore.prefs.hideRadio !== true;
  draftPumpkin.value = prefsStore.prefs.hidePumpkin !== true;
  draftSegShowId.value = prefsStore.prefs.segShowId === true;
  draftCalm.value = prefsStore.prefs.calmScreen === true;
  draftCursorXL.value = prefsStore.prefs.cursorXL === true;
  draftLargeText.value = prefsStore.prefs.largeText === true;
  draftHideTopBar.value = prefsStore.prefs.hideTopBar === true;
  draftImageLayerPanel.value = prefsStore.prefs.imageLayerPanel === true;
  draftLibraryTab.value = prefsStore.prefs.cellLibraryStartTab || 'mine';
  draftJumpAdds.value = prefsStore.prefs.jumpAddsToView === true;
  draftOfferRestore.value = prefsStore.prefs.offerViewRestore !== false;
  draftAnnotationGems.value = prefsStore.prefs.annotationGems !== false;
  draftAnnotationSetupTabs.value = prefsStore.prefs.showAnnotationSetupTabs === true;
  draftSegSetupTabs.value = prefsStore.prefs.showSegSetupTabs === true;
  draftHelpMuted.value = !!prefsStore.prefs.helpMuted;
  draftBareSwitch.value = !!prefsStore.prefs.datasetBareSwitch;
  draftExtra.value = [...(prefsStore.prefs.extraDatasets || [])];
  draftStartViews.value = { ...(prefsStore.prefs.datasetStartViews || {}) };
  pickStartViewDataset();
  // Seed via the same resolver the toolbar uses, so the grid reflects exactly
  // what's in the top bar — including icons auto-injected into older prefs.
  // A new player's icons that have not arrived yet show as off (util/toolbar_staging.ts).
  draftToolbar.value = resolveToolbarOrder(prefsStore.prefs.toolbarIcons, prefsStore.prefs.toolbarIconsInjected).filter(id => iconArrived(id));
  toolbarShownAtOpen = [...draftToolbar.value];
});

// "Restore all settings to default" (Ames 2026-10-15), behind a warning.
const confirmReset = ref(false);
const resetting = ref(false);
const resetError = ref('');
async function restoreDefaults() {
  resetting.value = true;
  resetError.value = '';
  try {
    await prefsStore.resetToDefaults();
    // The viewer's loading settings also live in the view in the address bar,
    // so a reload alone would bring them back: put Pyr's defaults in it first
    // (the values src/store.ts initializeWithViewer and neuroglancer start with).
    try {
      const q = (window as any).viewer?.dataContext?.chunkQueueManager;
      if (q) {
        q.enablePrefetch.value = true;
        q.capacities.download.itemLimit.value = 100;
        q.capacities.gpuMemory.sizeLimit.value = 2e9;
        q.capacities.systemMemory.sizeLimit.value = 3e9;
      }
    } catch { /* the reload still resets the rest */ }
    // The address bar follows the view a moment later.
    await new Promise(r => setTimeout(r, 600));
    window.location.reload();
  } catch (e: any) {
    resetError.value = `Your account copy could not be reset, so nothing was reloaded: ${e?.message || e}. Try again in a moment.`;
    resetting.value = false;
  }
}

async function handleSave() {
  const flag = draftFlag.value.trim();
  const bio = draftBio.value.trim().slice(0, 280);
  // Local prefs (toolbar order, chat/help mute) stay in localStorage. Saving
  // also stamps the injected marker: every auto-inject icon has now been
  // offered in the grid, so absence from a future save means the user removed
  // it, and resolveToolbarOrder must not re-add it (Celia's report).
  // While a new player's icons are held back (util/toolbar_staging.ts): an
  // icon switched on here has arrived, early, and only the switches change the
  // saved order, so icons still on their way keep their places. Reset gives
  // the default order, in which those icons stay hidden until they arrive.
  let savedToolbar = draftToolbar.value;
  if (isStaged()) {
    const fullToolbar = resolveToolbarOrder(prefsStore.prefs.toolbarIcons, prefsStore.prefs.toolbarIconsInjected);
    const shownBefore = toolbarShownAtOpen;
    reveal(draftToolbar.value.filter(id => !iconArrived(id)));
    savedToolbar = toolbarReset
      ? [...DEFAULT_ORDER.filter(id => !iconArrived(id) || draftToolbar.value.includes(id)), ...draftToolbar.value.filter(id => !DEFAULT_ORDER.includes(id))]
      : togglesInFull(fullToolbar, shownBefore, draftToolbar.value);
  }
  prefsStore.save({
    flag, bio, toolbarIcons: savedToolbar,
    toolbarIconsInjected: markInjected(prefsStore.prefs.toolbarIconsInjected),
    chatMuted: draftChatMuted.value, helpMuted: draftHelpMuted.value, chatFadeAway: draftChatFade.value, chatMarkMine: draftChatMarkMine.value, showNgControlsButton: draftShowNgControls.value, showXyzCorner: draftShowXyz.value, keepDisplayOnJump: draftKeepDisplay.value, cellCompleteMessage: draftCellCelebration.value ? (savedCellMessage === 'small' ? 'small' : 'full') : 'off', achievementCelebration: draftAchievementCelebration.value, notifOneList: draftNotifOneList.value, showDailyDigest: draftDailyDigest.value, imageDetail: draftImageDetail.value, imageSource: draftImageSource.value, classicLayerClicks: draftClassicLayers.value, hideRadio: !draftShowRadio.value, undeleteCounter: draftUndeleteCounter.value, hidePumpkin: !draftPumpkin.value, segShowId: draftSegShowId.value, calmScreen: draftCalm.value, cursorXL: draftCursorXL.value, largeText: draftLargeText.value, hideTopBar: draftHideTopBar.value, imageLayerPanel: draftImageLayerPanel.value, cellLibraryStartTab: draftLibraryTab.value, jumpAddsToView: draftJumpAdds.value, offerViewRestore: draftOfferRestore.value, annotationSize: undefined, annotationGems: draftAnnotationGems.value, showAnnotationSetupTabs: draftAnnotationSetupTabs.value, showSegSetupTabs: draftSegSetupTabs.value,
    datasetBareSwitch: draftBareSwitch.value, datasetStartViews: draftStartViews.value,
    extraDatasets: draftExtra.value,
    hoverStyle: draftHoverStyle.value, hoverStyleAuto: false, pulseColor: draftPulseColor.value,
  });
  // Apply the ambient tag layer change immediately.
  useIssueTagStore().syncTagLayer();
  ngePointGem.value = draftAnnotationGems.value;
  try { (window as any).viewer?.display?.scheduleRedraw(); } catch { /* no viewer */ }
  // Show or hide the "?" controls button right away.
  try { (window as any).viewer.uiConfiguration.showHelpButton.value = draftShowNgControls.value; } catch { /* no viewer yet */ }
  saved.value = true;
  setTimeout(() => { saved.value = false; }, 1800);
  // Flag and bio are also part of the PUBLIC profile: the profile panel and
  // the leaderboard read users.flag / users.bio from Supabase. Writing only to
  // localStorage made a save look like it did nothing to anyone else (and to
  // you on another machine), so push those two fields as well.
  const backend = useProofreadingBackendStore();
  await backend.saveProfileFields({ flag, bio });
  // Username is NOT saved here. It changes only through the dedicated dialog
  // (opened from the read-only Username row below), which owns its own
  // validation, availability check, and save. Saving it from here as well would
  // let a stale draft — e.g. if you renamed via the dialog with Settings still
  // open — clobber the new name on Save.
}

// ── Toolbar icon choices (shared with the actual top bar) ──────
import { TOOLBAR_ICON_DEFS, RETIRED_TOOLBAR_ICON_IDS, DEFAULT_TOOLBAR_ORDER, resolveToolbarOrder, markInjected } from '../data/toolbar-icons';
import { iconArrived, isStaged, reveal, togglesInFull } from '../util/toolbar_staging';

// Only offer icons the top bar can actually show — exclude retired ones so this
// grid matches the real toolbar rather than listing dead toggles.
const TOOLBAR_ICON_OPTIONS = TOOLBAR_ICON_DEFS.filter(d => !RETIRED_TOOLBAR_ICON_IDS.includes(d.id));

// Same default as the toolbar itself, imported so the two can't drift.
const DEFAULT_ORDER = DEFAULT_TOOLBAR_ORDER;

function isToolbarIconEnabled(id: string) {
  return draftToolbar.value.includes(id);
}

function toggleToolbarIcon(id: string) {
  const idx = draftToolbar.value.indexOf(id);
  if (idx >= 0) {
    draftToolbar.value.splice(idx, 1);
  } else {
    draftToolbar.value.push(id);
  }
}

function resetToolbar() {
  draftToolbar.value = DEFAULT_ORDER.filter(id => iconArrived(id));
  toolbarReset = true;
}

// ── Country dropdown state ──
const countrySearch = ref('');
const showCountryList = ref(false);
const filteredCountries = computed(() => {
  const q = countrySearch.value.trim().toLowerCase();
  if (!q) return COUNTRIES;
  return COUNTRIES.filter(c => c.name.toLowerCase().includes(q));
});
const selectedCountry = computed(() => findCountryByCode(draftFlag.value));

function selectCountry(code: string) {
  draftFlag.value = code;
  countrySearch.value = '';
  showCountryList.value = false;
}

/** Image URL for a flag emoji (cross-platform via flagcdn). */
function flagImgUrl(emoji: string): string {
  if (!emoji || emoji === EYEWIRE_FLAG) return '';
  const pts = [...emoji];
  if (pts.length < 2) return '';
  const code = pts.slice(0, 2).map(c => String.fromCharCode((c.codePointAt(0)! - 0x1F1E6) + 97)).join('');
  if (!code || code.length !== 2) return '';
  return `https://flagcdn.com/w40/${code}.png`;
}

// Close country dropdown when clicking outside
function handleCountryGlobalClick(e: MouseEvent) {
  const el = document.getElementById('nge-settings-country-wrap');
  if (el && !el.contains(e.target as Node)) showCountryList.value = false;
}
onMounted(() => document.addEventListener('click', handleCountryGlobalClick, true));

// The Neuroglancer box's (i): a click opens a short note on what neuroglancer
// is (Ames 2026-10-25: "make a popup with info bc it's long for a tooltip").
// A click anywhere else or Escape closes it.
const ngInfoOpen = ref(false);
function closeNgInfo(e: Event) {
  if (!ngInfoOpen.value) return;
  if (e instanceof KeyboardEvent) { if (e.key !== 'Escape') return; e.stopPropagation(); }
  else if ((e.target as HTMLElement | null)?.closest?.('.nge-set-info, .nge-set-info-pop')) return;
  ngInfoOpen.value = false;
}
onMounted(() => { document.addEventListener('click', closeNgInfo, true); document.addEventListener('keydown', closeNgInfo, true); });
onUnmounted(() => { document.removeEventListener('click', closeNgInfo, true); document.removeEventListener('keydown', closeNgInfo, true); });

// These four open something in the viewer itself, which sits BEHIND this
// panel (and behind the profile it may be shown in). The button seemed to do
// nothing until the panel was closed by hand (M Sorek 2026-10-09). So the
// panel gets out of the way once the thing has been opened.
function openNgSettings() {
  const viewer = (window as any)['viewer'];
  if (viewer?.settingsPanelState) {
    viewer.settingsPanelState.location.watchableVisible.value = true;
    emit('hide');
  }
}

function openJsonEditor() {
  const viewer = (window as any)['viewer'];
  if (!viewer?.editJsonState) return;
  // Close first: the editor is a dialog of the viewer's own.
  emit('hide');
  viewer.editJsonState();
}

function toggleLayerListPanel() {
  const viewer = (window as any)['viewer'];
  if (viewer?.layerListPanelState?.location?.watchableVisible) {
    const vis = viewer.layerListPanelState.location.watchableVisible;
    vis.value = !vis.value;
    if (vis.value) emit('hide');
  }
}

function toggleSelectionDetails() {
  const viewer = (window as any)['viewer'];
  if (viewer?.selectionDetailsState?.location?.watchableVisible) {
    const vis = viewer.selectionDetailsState.location.watchableVisible;
    vis.value = !vis.value;
    if (vis.value) emit('hide');
  } else if (viewer?.selectedStatePanel) {
    // Alternative API path
    viewer.selectedStatePanel.visible = !viewer.selectedStatePanel.visible;
  }
}

const loginStore = useLoginStore();

function logoutSession(session: loginSession) {
  loginStore.logout(session);
}

const emit = defineEmits({hide: null});
// When embedded (inside the profile's Settings tab) we drop the modal
// wrapper plus the ×/Cancel affordances — the profile owns closing.
// Same pattern as WeeklyRecapPanel.
const props = defineProps<{ embedded?: boolean }>();
</script>

<template>
  <component
    :is="props.embedded ? 'div' : ModalOverlay"
    :id="props.embedded ? undefined : 'nge-settings-modal'"
    :class="props.embedded ? 'nge-settings-embedded' : 'nge-settings-modal'"
    @hide="emit('hide')"
  >
    <div class="nge-settings-shell" :class="{ 'nge-settings-shell--embedded': props.embedded }">
      <!-- Top bar -->
      <div v-if="!props.embedded" class="nge-settings-topbar">
        <span class="nge-settings-title">⚙️ Settings</span>
        <button class="nge-settings-exit" @click="emit('hide')">×</button>
      </div>

      <!-- Settings content -->
      <div class="nge-settings-content">
        <!-- Admins: see the game as a player does (Ames 2026-10-25). Display
             only and instant, so no Save: admin powers stay, and the
             "Player view" chip in the top bar switches back. -->
        <div v-if="backendStore.isAdmin" class="nge-set-viewas">
          <span class="nge-set-viewas-label">See the game as</span>
          <div class="nge-set-viewas-seg" role="radiogroup" aria-label="See the game as">
            <button type="button" role="radio" :aria-checked="!backendStore.playerView" :class="{ 'is-on': !backendStore.playerView }" @click="backendStore.setPlayerView(false)">Admin</button>
            <button type="button" role="radio" :aria-checked="backendStore.playerView" :class="{ 'is-on': backendStore.playerView }" @click="backendStore.setPlayerView(true)">Player</button>
          </div>
          <span class="nge-set-viewas-hint">Player view hides admin buttons and tabs, so you see Pyr as players do. It works straight away, with no Save, and your admin powers stay. Waiting admin notifications show as a red dot on the Player view label in the top bar; click that label to come back.</span>
        </div>
        <!-- Three columns in the profile (Ames 2026-09-29: "larger, full profile
             size, a cool layout, keep it scifi"). In the stand-alone window
             the column wrappers are display: contents, so it stays one list. -->
        <div class="nge-set-col nge-set-col--identity">
          <div class="nge-set-col-head"><span class="nge-set-col-title">Identity</span><span class="nge-set-col-sub">who you are</span></div>
          <!-- Username lives at the bottom and is deliberately NOT an always-live
               text field: it's how everyone tags you, so changing it should be a
               deliberate act. Show the current handle read-only; the actual edit
               happens in the dedicated dialog (validation + availability check),
               opened by the button. `force` bypasses the dialog's "ask once"
               guards so it works when you already have a handle. -->
          <div class="nge-settings-section nge-set-card--username" :class="{ 'nge-set-folded': isFolded('username') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('username')" title="Fold or unfold this box" @click.prevent="toggleFold('username')" @keydown.enter.prevent="toggleFold('username')" @keydown.space.prevent="toggleFold('username')">Username<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">
              How you appear in chat, and how others tag you. 3-20 characters, letters/numbers/underscore, no spaces.
            </p>
            <div class="nge-settings-username-display">
              <span class="nge-settings-username-current" :class="{ 'nge-settings-username-current--empty': !backendStore.username }">
                {{ backendStore.username ? '@' + backendStore.username : 'No username set yet' }}
              </span>
              <button class="nge-settings-username-btn" @click="openUsernameDialog">
                {{ backendStore.username ? 'Change username…' : 'Pick a username…' }}
              </button>
            </div>
          </div>

          <div class="nge-settings-section nge-set-card--flag" :class="{ 'nge-set-folded': isFolded('flag') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('flag')" title="Fold or unfold this box" @click.prevent="toggleFold('flag')" @keydown.enter.prevent="toggleFold('flag')" @keydown.space.prevent="toggleFold('flag')">Country / Flag<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">Pick your country or the EyeWire logo.</p>
            <div id="nge-settings-country-wrap" class="nge-settings-country-wrap" @click.stop>
              <button class="nge-settings-country-btn" @click="showCountryList = !showCountryList">
                <span class="nge-settings-country-flag-cell">
                  <img v-if="draftFlag === 'eyewire'" :src="pyrIcon" class="nge-settings-country-flag-img nge-settings-country-flag-img--logo" />
                  <img v-else-if="flagImgUrl(draftFlag)" :src="flagImgUrl(draftFlag)" class="nge-settings-country-flag-img" />
                  <span v-else class="nge-settings-country-flag-placeholder">🌐</span>
                </span>
                <span class="nge-settings-country-name">{{ selectedCountry?.name || 'Choose a country' }}</span>
                <span class="nge-settings-country-caret">▾</span>
              </button>
              <div v-if="showCountryList" class="nge-settings-country-dropdown">
                <input
                  v-model="countrySearch"
                  type="text"
                  class="nge-settings-country-search"
                  placeholder="Search country..."
                  autocomplete="off"
                  spellcheck="false"
                  @click.stop
                />
                <div class="nge-settings-country-list">
                  <button
                    v-for="c in filteredCountries"
                    :key="c.code"
                    class="nge-settings-country-opt"
                    :class="{ 'nge-settings-country-opt--active': draftFlag === c.code }"
                    @click="selectCountry(c.code)"
                  >
                    <span class="nge-settings-country-opt-flag">
                      <img v-if="c.code === 'eyewire'" :src="pyrIcon" class="nge-settings-country-flag-img nge-settings-country-flag-img--logo" />
                      <img v-else-if="flagImgUrl(c.code)" :src="flagImgUrl(c.code)" class="nge-settings-country-flag-img" />
                    </span>
                    <span class="nge-settings-country-opt-name">{{ c.name }}</span>
                  </button>
                  <div v-if="filteredCountries.length === 0" class="nge-settings-country-empty">No matches</div>
                </div>
              </div>
            </div>
          </div>

          <div class="nge-settings-section nge-set-card--bio" :class="{ 'nge-set-folded': isFolded('bio') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('bio')" title="Fold or unfold this box" @click.prevent="toggleFold('bio')" @keydown.enter.prevent="toggleFold('bio')" @keydown.space.prevent="toggleFold('bio')">Bio<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">Share a little about yourself with the community.</p>
            <textarea v-model="draftBio" class="nge-settings-textarea" maxlength="280" rows="4" placeholder="e.g. PhD student at MIT. Loves connectomics and cold brew."></textarea>
            <div class="nge-settings-charcount" :class="{ 'nge-settings-charcount--warn': draftBio.length > 250 }">{{ draftBio.length }} / 280</div>
          </div>

          <div class="nge-settings-section nge-set-card--notif" :class="{ 'nge-set-folded': isFolded('notif') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('notif')" title="Fold or unfold this box" @click.prevent="toggleFold('notif')" @keydown.enter.prevent="toggleFold('notif')" @keydown.space.prevent="toggleFold('notif')">Chat and notifications<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">Chat, help requests and the counts on your top bar icons.</p>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftChatMuted" />
              <span class="nge-settings-toggle-label">Mute the chat unread count</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftChatFade" />
              <span class="nge-settings-toggle-label">Fade chat when I click away</span>
            </label>
            <label class="nge-settings-toggle" title="A thin bar marks your own messages in chat, so they are easy to find when you scroll back. Switch off to hide it.">
              <input type="checkbox" v-model="draftChatMarkMine" />
              <span class="nge-settings-toggle-label">Mark my own messages in chat</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftHelpMuted" />
              <span class="nge-settings-toggle-label">Mute help requests</span>
            </label>
            <label class="nge-settings-toggle" title="Undelete brings back cells you removed from view. On: its icon shows how many steps it can bring back.">
              <input type="checkbox" v-model="draftUndeleteCounter" />
              <span class="nge-settings-toggle-label">Show a counter on the Undelete icon</span>
            </label>
          </div>
        </div>
        <div class="nge-set-col nge-set-col--topbar">
          <div class="nge-set-col-head"><span class="nge-set-col-title">Display</span><span class="nge-set-col-sub">what you see</span></div>
          <div class="nge-settings-section nge-set-card--toolbar" :class="{ 'nge-set-folded': isFolded('toolbar') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('toolbar')" title="Fold or unfold this box" @click.prevent="toggleFold('toolbar')" @keydown.enter.prevent="toggleFold('toolbar')" @keydown.space.prevent="toggleFold('toolbar')">Toolbar Icons<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">Toggle which actions appear in your top bar.</p>
            <div class="nge-settings-toolbar-grid">
              <button v-for="opt in TOOLBAR_ICON_OPTIONS" :key="opt.id" class="nge-settings-toolbar-item" :class="{ 'nge-settings-toolbar-item--active': isToolbarIconEnabled(opt.id) }" :title="opt.label" @click="toggleToolbarIcon(opt.id)">
                <span v-if="opt.svg" class="nge-settings-toolbar-emoji" v-html="opt.svg"></span>
                <img v-else-if="opt.img" :src="opt.img" class="nge-settings-toolbar-icon-img" :alt="opt.label" />
                <span v-else class="nge-settings-toolbar-emoji">{{ opt.emoji }}</span>
                <span class="nge-settings-toolbar-label">{{ pillName(opt.label) }}</span>
              </button>
            </div>
            <button class="nge-settings-toolbar-reset" @click="resetToolbar">Reset to defaults</button>
          </div>

          <!-- The old User Interface card, split into small cards by topic
               (Ames 2026-10-24: "need to better organize these"). Annotation
               point size is not here: it is set on the annotation layer itself. -->
          <div class="nge-settings-section nge-set-card--look" :class="{ 'nge-set-folded': isFolded('look') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('look')" title="Fold or unfold this box" @click.prevent="toggleFold('look')" @keydown.enter.prevent="toggleFold('look')" @keydown.space.prevent="toggleFold('look')">3D looks<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">How cells look in 3D.</p>
            <label class="nge-settings-toggle nge-settings-pick" title="How the cell under your mouse stands out in 3D. Saturate: the cell's colour turns richer and it is lit from within, so even a bright colour stands out. Spotlight: the cell turns a little richer and the other cells in 3D dim, so it stands out gently. Fade: the original look, the cell turns pale. Halo: a slim glowing line around its edges. Pulse: when you point at it, a ring of light runs out along it from your mouse, like a signal firing. Hologram: the cell turns into cyan light (or your pulse colour), glowing brightest at its edges, with a soft glow around it. Metallic: a dark, shiny cell with bright edges. None: nothing marks it. In 2D the cell keeps its own colour, at your Render opacity. Highlight on hover itself is switched on and off in the Render tab of the 3D layer.">
              <span class="nge-settings-toggle-label">3D Hover</span>
              <select v-model="draftHoverStyle" class="nge-sv-select">
                <option value="halo">Halo</option>
                <option value="saturate">Saturate</option>
                <option value="spotlight">Spotlight</option>
                <option value="fade">Fade (original)</option>
                <option value="pulse">Pulse</option>
                <option value="hologram">Hologram</option>
                <option value="metallic">Metallic</option>
                <option value="none">None</option>
              </select>
            </label>
            <div class="nge-settings-toggle nge-settings-pick nge-pulse-color" title="The colour of the light that runs along the cell, with the Pulse look and with the P key.">
              <span class="nge-settings-toggle-label">Pulse colour</span>
              <div class="nge-pulse-swatches">
                <button v-for="c in PULSE_COLORS" :key="c.value" type="button" class="nge-pulse-swatch"
                        :class="{ 'nge-pulse-swatch--own': !c.value, 'nge-pulse-swatch--on': draftPulseColor === c.value }"
                        :style="c.value ? { background: c.value } : undefined" :title="c.label" :aria-label="c.label"
                        @click="draftPulseColor = c.value"></button>
                <label class="nge-pulse-swatch nge-pulse-swatch--pick" :class="{ 'nge-pulse-swatch--on': isCustomPulseColor }"
                       :style="isCustomPulseColor ? { background: draftPulseColor } : undefined" title="Any colour">
                  <input type="color" :value="draftPulseColor || '#59d8ff'" @input="onPulseColorPick" />
                </label>
              </div>
            </div>
            <p class="nge-settings-hint nge-pulse-hint">Press <b>P</b> with your mouse over a cell in 3D to send a pulse along it, whichever look you choose.</p>
            <label v-if="pumpkinSeason()" class="nge-settings-toggle" title="For Halloween, the Sandbox's starting cell wears a jack o' lantern over its cell body. Off: no pumpkin.">
              <input type="checkbox" v-model="draftPumpkin" />
              <span class="nge-settings-toggle-label">Show the Halloween pumpkin on the Sandbox cell</span>
            </label>
          </div>

          <div class="nge-settings-section nge-set-card--screen" :class="{ 'nge-set-folded': isFolded('screen') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('screen')" title="Fold or unfold this box" @click.prevent="toggleFold('screen')" @keydown.enter.prevent="toggleFold('screen')" @keydown.space.prevent="toggleFold('screen')">Screen<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">Celebrations, motion, and what else shows on screen.</p>
            <label class="nge-settings-toggle" title="On: completing a cell or submitting a Quest brings up the congratulations, with confetti. Off: nothing comes up; the cell still shows as Proofread in its menu and in the segment list, and a Quest still counts.">
              <input type="checkbox" v-model="draftCellCelebration" />
              <span class="nge-settings-toggle-label">Cell &amp; Quest celebration</span>
            </label>
            <label class="nge-settings-toggle" title="On: an achievement you earn comes up as a card in the middle of the screen, with confetti. Off: nothing comes up; it is still in your Trophy Case and in the bell.">
              <input type="checkbox" v-model="draftAchievementCelebration" />
              <span class="nge-settings-toggle-label">Achievement celebration</span>
            </label>
            <label class="nge-settings-toggle" title="On: every notification in one list, as before. Off: two tabs in the bell, My Pyr for what was sent to you and Pyr Updates for what went to everyone.">
              <input type="checkbox" v-model="draftNotifOneList" />
              <span class="nge-settings-toggle-label">Show all notifications in one list</span>
            </label>
            <label class="nge-settings-toggle" title="Today in Pyr is the short note each afternoon on what changed in Pyr that day. Off: it no longer comes to your bell. Other announcements still do.">
              <input type="checkbox" v-model="draftDailyDigest" />
              <span class="nge-settings-toggle-label">Show Today in Pyr daily updates</span>
            </label>
            <label class="nge-settings-toggle" title="Stops the animations and takes away the glows around text, buttons and panels, for a quieter screen. The cells and the 3D view stay as they are. A few small animations follow after a reload.">
              <input type="checkbox" v-model="draftCalm" />
              <span class="nge-settings-toggle-label">Calm screen: no animations or glows</span>
            </label>
            <label class="nge-settings-toggle" title="A bigger target cursor over the 2D and 3D views, easier to find on a large screen.">
              <input type="checkbox" v-model="draftCursorXL" />
              <span class="nge-settings-toggle-label">Extra large cursor</span>
            </label>
            <label class="nge-settings-toggle" title="Makes the text in Pyr's windows (your profile, Settings, the Cell Library, the bell, the leaderboard) and in the layer side panel a fifth bigger, with everything around it, so it is easier to read. The 2D and 3D views stay as they are.">
              <input type="checkbox" v-model="draftLargeText" />
              <span class="nge-settings-toggle-label">Large text</span>
            </label>
            <label class="nge-settings-toggle" title="The top bar tucks away, so the views get the whole window. Move the mouse to the top edge to bring it back, or press the \ key. Your unread notifications show as a small bell in the corner of the 3D view. It stays put on a touch screen, during a tutorial, and while new icons are still arriving.">
              <input type="checkbox" v-model="draftHideTopBar" />
              <span class="nge-settings-toggle-label">Magic Top Bar</span>
            </label>
            <label class="nge-settings-toggle" title="A cell with a cell type shows the type in the segment list. On: its segment ID is written under the type too. Off: the type alone; the ID is in the hover tip and on the copy button.">
              <input type="checkbox" v-model="draftSegShowId" />
              <span class="nge-settings-toggle-label">Show the segment ID under a cell's label</span>
            </label>
            <label class="nge-settings-toggle" title="The speaker in the bottom right corner plays EyeWire Radio. Off: no speaker.">
              <input type="checkbox" v-model="draftShowRadio" />
              <span class="nge-settings-toggle-label">Show the sound icon (EyeWire Radio)</span>
            </label>
          </div>

        </div>
        <div class="nge-set-col nge-set-col--viewer">
          <div class="nge-set-col-head"><span class="nge-set-col-title">Viewer</span><span class="nge-set-col-sub">how it works</span></div>
          <div class="nge-settings-section nge-set-card--jump" :class="{ 'nge-set-folded': isFolded('jump') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('jump')" title="Fold or unfold this box" @click.prevent="toggleFold('jump')" @keydown.enter.prevent="toggleFold('jump')" @keydown.space.prevent="toggleFold('jump')">Jumping and views<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">What happens when you jump to a cell or come back.</p>
            <label class="nge-settings-toggle" title="Off: a jump shows only the cell you jumped to. On: each jump adds its cell to the ones already in your view.">
              <input type="checkbox" v-model="draftJumpAdds" />
              <span class="nge-settings-toggle-label">Jumping to a cell adds it to my view (off: it replaces my view)</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftKeepDisplay" />
              <span class="nge-settings-toggle-label">Keep my display settings (opacity, layout, highlight on hover) when jumping to cells</span>
            </label>
            <label class="nge-settings-toggle" title="Your view is saved as you work. When a dataset opens, a small bar offers to bring it back. Never shown on the Sandbox.">
              <input type="checkbox" v-model="draftOfferRestore" />
              <span class="nge-settings-toggle-label">Offer to pick up where I left off when a dataset opens</span>
            </label>
            <label class="nge-settings-toggle nge-settings-pick" title="The tab the Cell Library shows first each time you open it. Shift+L opens and closes the library.">
              <span class="nge-settings-toggle-label">Cell Library opens on</span>
              <select v-model="draftLibraryTab" class="nge-sv-select">
                <option value="mine">My Cells</option>
                <option value="available">Available</option>
                <option value="claimed">Claimed</option>
                <option value="all">All</option>
                <option value="help">Help</option>
                <option value="links">My Links</option>
              </select>
            </label>
          </div>

          <div class="nge-settings-section nge-set-card--images" :class="{ 'nge-set-folded': isFolded('images') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('images')" title="Fold or unfold this box" @click.prevent="toggleFold('images')" @keydown.enter.prevent="toggleFold('images')" @keydown.space.prevent="toggleFold('images')">2D images<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">How sharp the 2D images are, and where they load from.</p>
            <label class="nge-settings-toggle nge-settings-pick" title="How sharp the 2D images are drawn. Half loads about a quarter of the data and Quarter about a sixteenth, so they load much faster on a slow connection, but the images stay that blurry until you set Full again.">
              <span class="nge-settings-toggle-label">2D image detail</span>
              <select v-model.number="draftImageDetail" class="nge-sv-select">
                <option :value="1">Full (sharpest)</option>
                <option :value="2">Half (faster loading)</option>
                <option :value="4">Quarter (fastest, blurry)</option>
              </select>
            </label>
            <label class="nge-settings-toggle nge-settings-pick" title="Where the 2D images come from. Copies hosted in Asia exist for EyeWire II Retina, MEC and the Sandbox; other datasets always load from the Americas. Automatic times both copies once and uses the faster one for you. Shared links and saved views open on your choice.">
              <span class="nge-settings-toggle-label">2D images load from</span>
              <select v-model="draftImageSource" class="nge-sv-select">
                <option value="auto">Automatic ({{ autoImageRegion }})</option>
                <option value="americas">Americas</option>
                <option value="asia">Asia</option>
              </select>
            </label>
          </div>

          <div class="nge-settings-section nge-set-card--datasets" :class="{ 'nge-set-folded': isFolded('datasets') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('datasets')" title="Fold or unfold this box" @click.prevent="toggleFold('datasets')" @keydown.enter.prevent="toggleFold('datasets')" @keydown.space.prevent="toggleFold('datasets')">Switching datasets<span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <p class="nge-settings-hint">What opens when you switch to a dataset.</p>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftBareSwitch" />
              <span class="nge-settings-toggle-label">Open datasets without the starter cells (loads faster)</span>
            </label>
            <p class="nge-settings-hint nge-sv-hint">Show in the dataset selector: extra datasets to explore. There is nothing to proofread or claim in them.</p>
          <label v-for="ds in OPTIONAL_DATASETS" :key="ds.id" class="nge-settings-toggle nge-sv-extra">
            <input type="checkbox" :checked="draftExtra.includes(ds.id)" @change="toggleDraftExtra(ds.id, $event)" />
            <span class="nge-settings-toggle-label">{{ ds.label }}</span>
          </label>
          <p class="nge-settings-hint nge-sv-hint">Your own start view: pick a dataset and paste a share link made in it. It opens instead of the starter view whenever you switch there.</p>
            <div class="nge-sv-row">
              <select v-model="svDataset" class="nge-sv-select" @change="pickStartViewDataset">
                <option v-for="ds in DATASETS" :key="ds.id" :value="segLayerName(ds)">{{ ds.label }}</option>
              </select>
            </div>
            <div class="nge-sv-row">
              <input v-model="svLink" class="nge-sv-input" type="url" placeholder="Paste a share link" @keydown.stop @keyup.stop />
              <button class="nge-sv-btn" type="button" @click="setStartView">Use this view</button>
            </div>
            <p v-if="svError" class="nge-sv-error">{{ svError }}</p>
            <ul v-if="Object.keys(draftStartViews).length" class="nge-sv-list">
              <li v-for="(link, seg) in draftStartViews" :key="seg">
                <span class="nge-sv-name">{{ labelFor(String(seg)) }}</span>
                <span class="nge-sv-link" :title="link">{{ link }}</span>
                <button class="nge-sv-clear" type="button" @click="clearStartView(String(seg))">Remove</button>
              </li>
            </ul>
            <p class="nge-settings-hint">Click Save below to keep these.</p>
          </div>

          <!-- Everything that brings back neuroglancer's own way of working, in
               one place for players who know it from before (Ames 2026-10-25).
               Took over the Advanced card. Named Neuroglancer, with an (i)
               saying what that is (Ames 2026-10-25). -->
          <div class="nge-settings-section nge-set-card--classic" :class="{ 'nge-set-folded': isFolded('classic') }">
            <label class="nge-settings-label nge-set-fold" role="button" tabindex="0" :aria-expanded="!isFolded('classic')" title="Fold or unfold this box" @click.prevent="toggleFold('classic')" @keydown.enter.prevent="toggleFold('classic')" @keydown.space.prevent="toggleFold('classic')">Neuroglancer<button type="button" class="nge-set-info" :class="{ 'nge-set-info--on': ngInfoOpen }" aria-label="What is neuroglancer?" :aria-expanded="ngInfoOpen" title="What is neuroglancer?" @click.stop.prevent="ngInfoOpen = !ngInfoOpen" @keydown.enter.stop @keydown.space.stop>i</button><span class="nge-set-fold-chev" aria-hidden="true">▾</span></label>
            <div v-if="ngInfoOpen" class="nge-set-info-pop" role="dialog" aria-label="What is neuroglancer?" @click.stop>
              <button type="button" class="nge-set-info-x" aria-label="Close" @click="ngInfoOpen = false">×</button>
              <p class="nge-set-info-title">What is neuroglancer?</p>
              <p>Neuroglancer is a connectomics proofreading platform made by Google that Pyr is built on. It draws the 2D images and the 3D cells you work on. Scientists also use it (without the fancy Pyr interface).</p>
              <p>Settings here bring back its original, and dare we say unintuitive, user interface elements. This section brings back legacy neuroglancer elements and advanced settings.</p>
            </div>
            <p class="nge-settings-hint">Neuroglancer's own controls and panels.</p>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftAnnotationGems" />
              <span class="nge-settings-toggle-label">Show point annotations as Pyr gems in 3D</span>
            </label>
            <label class="nge-settings-toggle" title="Off: a click on a layer tab, or its number key (1 to 9), makes it the active layer; a right click, or Shift + the number, hides or shows it. On: a click or the number hides or shows it, as in neuroglancer.">
              <input type="checkbox" v-model="draftClassicLayers" />
              <span class="nge-settings-toggle-label">Classic Layers (Click to hide)</span>
            </label>
            <label class="nge-settings-toggle" title="Off: clicking the 2D EM layer's tab shows or hides the 2D view. On: it opens the layer's side panel (Source, Rendering, Annotations), as in neuroglancer.">
              <input type="checkbox" v-model="draftImageLayerPanel" />
              <span class="nge-settings-toggle-label">Clicking the 2D image layer opens its side panel</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftAnnotationSetupTabs" />
              <span class="nge-settings-toggle-label">Show Source and Rendering tabs on annotation layers</span>
            </label>
            <label class="nge-settings-toggle" title="Segmentation layers open on Segments. Turn this on to also see their Source and Graph tabs. Takes effect when the page reloads.">
              <input type="checkbox" v-model="draftSegSetupTabs" />
              <span class="nge-settings-toggle-label">Show Source and Graph tabs on segmentation layers</span>
            </label>
            <label class="nge-settings-toggle" title="The round (?) button at the top right of the viewer opens neuroglancer's own list of keyboard and mouse controls. Many of them are out of date and do not match Pyr. For Pyr's own keys, open Keyboard shortcuts in the menu at the top right, or press Ctrl+K and type keys.">
              <input type="checkbox" v-model="draftShowNgControls" />
              <span class="nge-settings-toggle-label">Show the neuroglancer controls button (?)</span>
            </label>
            <label class="nge-settings-toggle" title="The x y z letters in the top left of each view. Point at them for neuroglancer's scale and depth panel.">
              <input type="checkbox" v-model="draftShowXyz" />
              <span class="nge-settings-toggle-label">xyz top left</span>
            </label>
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px;">
              <button class="nge-settings-advanced-btn" @click="openNgSettings">⚙ Viewer Settings</button>
              <button class="nge-settings-advanced-btn" @click="openJsonEditor">{} Edit JSON State</button>
              <button class="nge-settings-advanced-btn" @click="toggleLayerListPanel">☰ Layer List Panel</button>
              <button class="nge-settings-advanced-btn" @click="toggleSelectionDetails">◫ Selection Details</button>
            </div>
            <div style="height: 4px;"></div>
            <!-- Logins management -->
            <div v-if="loginStore.sessions.length > 0" style="margin-top: 10px;">
              <p class="nge-settings-hint">Active logins:</p>
              <div v-for="session in loginStore.sessions" :key="session.hostname" class="nge-settings-login-row">
                <div class="nge-settings-login-info">
                  <span class="nge-settings-login-email">{{ session.email || 'Unknown' }}</span>
                  <span class="nge-settings-login-host">{{ session.hostname }}</span>
                </div>
                <button class="nge-settings-logout-btn" @click="logoutSession(session)">Logout</button>
              </div>
            </div>
          </div>

        </div>

      </div>

      <!-- Pinned footer: moved OUT of .nge-settings-content so Save stays
           reachable on short screens. Previously it scrolled with the body,
           and on a small laptop the whole panel simply overflowed the viewport
           with no scrollbar, putting Save off-screen entirely. -->
      <div class="nge-settings-actions">
        <button class="nge-settings-save" @click="handleSave">
          <span v-if="saved">✓ Saved!</span>
          <span v-else>Save</span>
        </button>
        <button v-if="!props.embedded" class="nge-settings-cancel" @click="emit('hide')">Cancel</button>
      </div>
      <div class="nge-settings-reset-row">
        <button class="nge-settings-reset" type="button" @click="confirmReset = true">Restore all settings to default</button>
      </div>

      <Teleport to="body">
        <div v-if="confirmReset" class="nge-settings-reset-backdrop" @click.self="!resetting && (confirmReset = false)">
          <div class="nge-settings-reset-dlg" role="alertdialog" aria-modal="true" aria-labelledby="nge-reset-title" aria-describedby="nge-reset-what">
            <div id="nge-reset-title" class="nge-settings-reset-title">⚠ Restore all settings to default?</div>
            <div id="nge-reset-what" class="nge-settings-reset-text">
              <p>Every setting goes back to how Pyr starts, on this computer and on your account, so on your other computers too. This includes:</p>
              <ul>
                <li>your toolbar icons and their order</li>
                <li>chat, music and notification choices</li>
                <li>your Highlight colors</li>
                <li>viewer settings and 2D image detail</li>
                <li>extra datasets you turned on, and your own start views</li>
              </ul>
              <p>Your flag, your bio, your cells and your progress are not touched. Pyr reloads afterwards. This cannot be undone.</p>
            </div>
            <div v-if="resetError" class="nge-settings-reset-error">{{ resetError }}</div>
            <div class="nge-settings-reset-btns">
              <button class="nge-settings-cancel" type="button" :disabled="resetting" @click="confirmReset = false">Keep my settings</button>
              <button class="nge-settings-reset nge-settings-reset--go" type="button" :disabled="resetting" @click="restoreDefaults">
                {{ resetting ? 'Restoring…' : 'Restore defaults' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>

    </div>
  </component>
</template>

<style scoped>
.nge-settings-modal {
  font-size: 0.9em;
}

/* ── Sci-fi materialize (shared pattern) ── */
.nge-settings-modal :deep(.nge-overlay) {
  overflow: hidden;
  animation: ngeSettingsMaterialize 0.52s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Scanline removed — holographic border glow handled by ModalOverlay */

@keyframes ngeSettingsMaterialize {
  0% {
    opacity: 0; transform: translate(-50%, -50%) translateY(14px) scale(0.96);
    filter: blur(10px) brightness(2.5);
    box-shadow: 0 0 80px rgba(0, 180, 255, 0.5), 0 0 160px rgba(0, 180, 255, 0.15);
  }
  30% {
    opacity: 0.8; transform: translate(-50%, -50%);
    filter: blur(1px) brightness(1.2);
    box-shadow: 0 0 30px rgba(0, 180, 255, 0.15);
  }
  60% {
    opacity: 1; transform: translate(-50%, -50%) scale(0.998);
    filter: blur(0) brightness(1.05);
  }
  100% {
    opacity: 1; transform: translate(-50%, -50%);
    filter: blur(0) brightness(1); box-shadow: none;
  }
}

/* (scanline keyframe removed — using ModalOverlay holographic effects) */

/* ── Shell ── */
.nge-settings-shell {
  display: flex;
  flex-direction: column;
  width: 460px;
  /* Never exceed the viewport. Without this the panel grew to its natural
     height and simply ran off the bottom of a small laptop screen, taking the
     Save button with it. */
  max-width: calc(100 * var(--nge-vw, 1vw) - 24px);
  max-height: calc(100 * var(--nge-vh, 1vh) - 32px);
}

/* Embedded in the profile's Settings tab: the profile shell owns size and
   scrolling, so the panel just fills the tab body. */
.nge-settings-embedded {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.nge-settings-shell--embedded {
  width: auto;
  max-width: none;
  max-height: none;
  flex: 1;
  min-height: 0;
}

.nge-settings-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px 10px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}

.nge-settings-title {
  font-size: 1.35em;
  font-weight: 600;
  color: #e0e0e0;
}

.nge-settings-exit {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.6em;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.nge-settings-exit:hover { color: #fff; }

/* ── Content ── */
.nge-settings-content {
  padding: 20px 22px 12px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* The scrolling region. `min-height: 0` is required: a flex child defaults to
     min-height:auto, which refuses to shrink below its content and would keep
     the panel taller than the viewport no matter the max-height above. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.nge-settings-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nge-settings-label {
  font-size: 0.88em;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #999;
  font-weight: 600;
}

.nge-settings-hint {
  font-size: 0.78em;
  color: #666;
  margin: 0 0 4px;
}

.nge-settings-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 1.5em;
  padding: 6px 10px;
  width: 80px;
  outline: none;
  text-align: center;
}

.nge-settings-input:focus {
  border-color: rgba(74,158,255,0.5);
}

/* Quick-pick flag buttons */
.nge-settings-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.nge-settings-flag-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  font-size: 1.3em;
  padding: 4px 6px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, transform 0.12s;
  line-height: 1;
}

.nge-settings-flag-btn:hover {
  background: rgba(255,255,255,0.12);
  transform: scale(1.15);
}

.nge-settings-flag-btn--active {
  border-color: rgba(74,158,255,0.65);
  background: rgba(74,158,255,0.12);
}

/* ── Country dropdown ── */
.nge-settings-country-wrap {
  position: relative;
  width: 100%;
  max-width: 360px;
}

.nge-settings-country-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.95em;
  padding: 8px 10px;
  cursor: pointer;
  outline: none;
  text-align: left;
}

.nge-settings-country-btn:hover {
  border-color: rgba(74,158,255,0.45);
}

.nge-settings-country-flag-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  flex-shrink: 0;
}

.nge-settings-country-flag-img {
  width: 24px;
  height: 18px;
  object-fit: cover;
  border-radius: 2px;
}

.nge-settings-country-flag-img--logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 0;
}

.nge-settings-country-flag-placeholder {
  font-size: 1.2em;
  opacity: 0.5;
}

.nge-settings-country-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nge-settings-country-caret {
  color: #aaa;
  font-size: 0.85em;
  flex-shrink: 0;
}

/* Dropdown — white background per user spec */
.nge-settings-country-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 200;
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.18);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.35);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.nge-settings-country-search {
  background: #ffffff;
  color: #222;
  border: none;
  border-bottom: 1px solid rgba(0,0,0,0.1);
  padding: 8px 10px;
  font-size: 0.95em;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.nge-settings-country-search::placeholder { color: #888; }

.nge-settings-country-list {
  max-height: 280px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.25) #fff;
}

.nge-settings-country-list::-webkit-scrollbar { width: 6px; }
.nge-settings-country-list::-webkit-scrollbar-track { background: #f4f4f4; }
.nge-settings-country-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.25); border-radius: 3px; }

.nge-settings-country-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: #ffffff;
  border: none;
  color: #222;
  font-size: 0.92em;
  padding: 7px 12px;
  cursor: pointer;
  text-align: left;
}

.nge-settings-country-opt:hover {
  background: rgba(74,158,255,0.12);
}

.nge-settings-country-opt--active {
  background: rgba(74,158,255,0.18);
  font-weight: 600;
}

.nge-settings-country-opt-flag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  flex-shrink: 0;
}

.nge-settings-country-opt-name { flex: 1; }

.nge-settings-country-empty {
  padding: 10px 12px;
  color: #888;
  font-size: 0.88em;
  text-align: center;
}

/* Bio textarea */
.nge-settings-textarea {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 8px 10px;
  resize: vertical;
  font-family: inherit;
  outline: none;
  line-height: 1.5;
}

.nge-settings-textarea:focus {
  border-color: rgba(74,158,255,0.5);
}

.nge-settings-charcount {
  font-size: 0.72em;
  color: #666;
  text-align: right;
}

.nge-settings-charcount--warn { color: #e09050; }

/* Action buttons */
.nge-settings-actions {
  display: flex;
  gap: 10px;
  /* Pinned footer — never scrolls away, never shrinks. */
  flex-shrink: 0;
  padding: 12px 22px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  background: inherit;
}

.nge-settings-save {
  flex: 1;
  padding: 8px 0;
  background: rgba(74,158,255,0.18);
  border: 1px solid rgba(74,158,255,0.4);
  border-radius: 6px;
  color: rgba(160,220,255,0.95);
  font-size: 0.9em;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.nge-settings-save:hover {
  background: rgba(74,158,255,0.28);
}

.nge-settings-cancel {
  padding: 8px 18px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #888;
  font-size: 0.9em;
  cursor: pointer;
  transition: background 0.15s;
}

.nge-settings-cancel:hover {
  background: rgba(255,255,255,0.1);
  color: #ccc;
}

.nge-settings-advanced-btn {
  padding: 7px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  color: #888;
  font-size: 0.82em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex: 1;
}
.nge-settings-advanced-btn:hover {
  background: rgba(74,158,255,0.08);
  color: #bbc;
  border-color: rgba(74,158,255,0.25);
}

.nge-settings-login-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 6px;
  margin-bottom: 4px;
}
.nge-settings-login-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nge-settings-login-email {
  font-size: 0.78em;
  color: #aab;
}
.nge-settings-login-host {
  font-size: 0.68em;
  color: #667;
}
.nge-settings-logout-btn {
  font-size: 0.65em;
  padding: 2px 10px;
  background: rgba(200, 60, 60, 0.12);
  border: 1px solid rgba(200, 60, 60, 0.25);
  color: rgba(220, 100, 100, 0.8);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.nge-settings-logout-btn:hover {
  background: rgba(200, 60, 60, 0.2);
  border-color: rgba(200, 60, 60, 0.4);
  color: rgba(240, 120, 120, 0.95);
}

/* Toolbar customization */
.nge-settings-toolbar-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nge-settings-toolbar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #667;
  font-family: inherit;
  font-size: 0.82em;
  cursor: pointer;
  transition: all 0.12s;
  opacity: 0.5;
}

.nge-settings-toolbar-item:hover {
  opacity: 0.8;
  background: rgba(255, 255, 255, 0.06);
}

.nge-settings-toolbar-item--active {
  opacity: 1;
  border-color: rgba(74, 158, 255, 0.35);
  background: rgba(74, 158, 255, 0.08);
  color: #acd;
}

.nge-settings-toolbar-emoji {
  /* SVG icons use 1em sizing, so `font-size` here controls render size.
     14px matches the original Settings list density; the actual top
     bar uses 18px. */
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.nge-settings-toolbar-icon-img {
  width: 16px;
  height: 16px;
  object-fit: contain;
  vertical-align: middle;
}

.nge-settings-toolbar-label {
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* No pill is ever wider than the panel it sits in. */
.nge-settings-toolbar-item { max-width: 100%; min-width: 0; }

.nge-settings-toolbar-reset {
  margin-top: 6px;
  background: none;
  border: none;
  color: #556;
  font-size: 0.72em;
  font-family: inherit;
  cursor: pointer;
  padding: 2px 0;
  transition: color 0.12s;
}
.nge-settings-toolbar-reset:hover { color: #889; }

/* Username field */
.nge-settings-username-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 360px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
}
.nge-settings-username-current {
  color: #e0e0e0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.95em;
}
.nge-settings-username-current--empty {
  color: rgba(150, 175, 215, 0.6);
  font-style: normal;
}
/* Inside the read-only display the button sits inline, so drop the stacked
   top margin the standalone button used. */
.nge-settings-username-display .nge-settings-username-btn {
  margin-top: 0;
  flex-shrink: 0;
}

.nge-settings-username-btn {
  margin-top: 8px;
  padding: 6px 12px;
  background: none;
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  color: rgba(180, 200, 230, 0.9);
  font-size: 0.78em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.nge-settings-username-btn:hover {
  background: rgba(74, 158, 255, 0.12);
  border-color: rgba(74, 158, 255, 0.55);
  color: #e0ecff;
}

/* Switching datasets: dataset picker, share link box, saved list */
.nge-sv-extra { display: flex; }
.nge-sv-hint { margin-top: 8px; }
.nge-sv-row { display: flex; gap: 8px; margin-top: 6px; }
.nge-sv-select, .nge-sv-input {
  flex: 1; min-width: 0;
  background: rgba(8, 14, 28, 0.7);
  border: 1px solid rgba(74, 158, 255, 0.18);
  border-radius: 6px;
  color: rgba(220, 230, 245, 0.92);
  font: inherit; font-size: 0.9em;
  padding: 7px 9px;
  color-scheme: dark;
}
.nge-sv-select option { background: #0b1424; color: rgba(220, 230, 245, 0.95); }
.nge-sv-select:focus, .nge-sv-input:focus { outline: none; border-color: rgba(74, 158, 255, 0.55); }
.nge-sv-btn, .nge-sv-clear {
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.35);
  border-radius: 6px;
  color: #cfe3ff;
  font: inherit; font-size: 0.85em;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.nge-sv-btn:hover, .nge-sv-clear:hover { background: rgba(74, 158, 255, 0.2); }
.nge-sv-error { color: #ff9a8a; font-size: 0.85em; margin: 6px 0 0; }
.nge-sv-list { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.nge-sv-list li { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: 0.86em; }
.nge-sv-name { color: #e6eefc; font-weight: 600; }
.nge-sv-link { color: rgba(170, 190, 220, 0.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Notification mute toggle (Mute the chat unread count) */
.nge-settings-slider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 0.92em;
}
.nge-settings-slider input[type="range"] { flex: 1; max-width: 180px; accent-color: #35b5ff; }
.nge-settings-slider-val { min-width: 2.4em; color: #9fdcff; font-weight: 600; }
.nge-settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
  font-size: 0.92em;
  color: #cde;
}
/* Custom checkbox rather than the native control, which rendered as a stock
   OS box and was the only un-themed element in the panel. Same treatment as
   the render-tab checkboxes: square, blue accent, drawn tick. */
.nge-settings-toggle input {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.nge-settings-toggle input:hover { border-color: rgba(74, 158, 255, 0.55); }
.nge-settings-toggle input:checked {
  background: rgba(74, 158, 255, 0.9);
  border-color: #4a9eff;
}
.nge-settings-toggle input:checked::after {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #08121f;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.nge-settings-toggle input:focus-visible {
  outline: 1px solid rgba(74, 158, 255, 0.7);
  outline-offset: 2px;
}
.nge-settings-toggle-label {
  user-select: none;
}


/* ══ Settings in the profile: three sci-fi columns (Ames 2026-09-29) ════════
   In the stand-alone window the column wrappers vanish (display: contents)
   and everything below stays exactly as before. */
.nge-set-col { display: contents; }
.nge-set-col-head { display: none; }

.nge-settings-shell--embedded .nge-settings-content {
  display: grid;
  grid-template-columns: minmax(250px, 0.9fr) minmax(320px, 1.2fr) minmax(260px, 1fr);
  gap: 16px;
  align-items: start;
  padding: 18px 20px 14px;
  counter-reset: nge-set-card;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(74, 158, 255, 0.07), transparent 60%),
    repeating-linear-gradient(0deg, rgba(126, 202, 255, 0.025) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(90deg, rgba(126, 202, 255, 0.025) 0 1px, transparent 1px 28px);
}
@media (max-width: 1000px) {
  .nge-settings-shell--embedded .nge-settings-content { grid-template-columns: 1fr 1fr; }
  .nge-settings-shell--embedded .nge-set-col--viewer { grid-column: 1 / -1; }
}
@media (max-width: 680px) {
  .nge-settings-shell--embedded .nge-settings-content { grid-template-columns: 1fr; }
}
/* See the game as (admins only): a strip across the top. */
.nge-set-viewas {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 8px 12px;
  border: 1px solid rgba(126, 224, 255, 0.3);
  border-radius: 8px;
  background: rgba(126, 224, 255, 0.06);
}
.nge-set-viewas-label { color: #dce6f5; font-weight: 600; font-size: 13px; }
.nge-set-viewas-seg { display: inline-flex; border: 1px solid rgba(126, 224, 255, 0.45); border-radius: 999px; overflow: hidden; }
.nge-set-viewas-seg button {
  padding: 3px 14px;
  border: 0;
  background: transparent;
  color: #9fb3cc;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.nge-set-viewas-seg button.is-on { background: rgba(126, 224, 255, 0.22); color: #fff; font-weight: 600; }
.nge-set-viewas-hint { flex: 1 1 260px; color: #8ea2bd; font-size: 12px; line-height: 1.4; }
.nge-settings-shell--embedded .nge-set-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.nge-settings-shell--embedded .nge-set-col-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 2px 6px;
  border-bottom: 1px solid rgba(126, 202, 255, 0.16);
}
.nge-settings-shell--embedded .nge-set-col-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #7ee8ff;
  text-shadow: 0 0 10px rgba(126, 232, 255, 0.35);
}
.nge-settings-shell--embedded .nge-set-col-sub {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(160, 190, 225, 0.5);
}

/* Each setting is a holo panel with corner brackets and a numbered label. */
.nge-settings-shell--embedded .nge-settings-section {
  position: relative;
  counter-increment: nge-set-card;
  padding: 13px 14px 12px;
  border-radius: 10px;
  background: linear-gradient(160deg, rgba(14, 22, 40, 0.78), rgba(6, 10, 22, 0.7));
  border: 1px solid rgba(74, 158, 255, 0.16);
  box-shadow: inset 0 1px 0 rgba(160, 210, 255, 0.05), 0 6px 18px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.nge-settings-shell--embedded .nge-settings-section:hover {
  border-color: rgba(74, 158, 255, 0.34);
  box-shadow: inset 0 1px 0 rgba(160, 210, 255, 0.07), 0 0 18px rgba(74, 158, 255, 0.08), 0 6px 18px rgba(0, 0, 0, 0.25);
}
.nge-settings-shell--embedded .nge-settings-section::before,
.nge-settings-shell--embedded .nge-settings-section::after {
  content: '';
  position: absolute;
  width: 10px;
  height: 10px;
  pointer-events: none;
  opacity: 0.8;
}
.nge-settings-shell--embedded .nge-settings-section::before {
  top: -1px; left: -1px;
  border-top: 2px solid #4a9eff; border-left: 2px solid #4a9eff;
  border-top-left-radius: 10px;
}
.nge-settings-shell--embedded .nge-settings-section::after {
  bottom: -1px; right: -1px;
  border-bottom: 2px solid #4a9eff; border-right: 2px solid #4a9eff;
  border-bottom-right-radius: 10px;
}
.nge-settings-shell--embedded .nge-settings-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  letter-spacing: 0.16em;
  color: #cfe0ff;
}
.nge-settings-shell--embedded .nge-settings-label::before {
  content: counter(nge-set-card, decimal-leading-zero);
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: #4a9eff;
  padding: 1px 5px;
  border: 1px solid rgba(74, 158, 255, 0.4);
  border-radius: 3px;
  background: rgba(74, 158, 255, 0.08);
}
.nge-settings-shell--embedded .nge-settings-hint { color: #7f93ad; }

/* A box folds shut from its title: only the title stays (Ames 2026-10-21). */
.nge-set-fold { cursor: pointer; user-select: none; }
.nge-set-fold:focus-visible { outline: 1px solid rgba(74, 158, 255, 0.7); outline-offset: 3px; border-radius: 3px; }
.nge-set-fold-chev { margin-left: auto; font-size: 13px; color: #7ecaff; transition: transform 0.2s ease; }
.nge-set-folded .nge-set-fold-chev { transform: rotate(-90deg); }
/* (i) beside a box title: hover (or focus) for what the title means (Ames 2026-10-25). */
.nge-set-card--classic { position: relative; }
.nge-set-info {
  padding: 0; background: none;
  display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; margin-left: -2px;
  border-radius: 50%; border: 1px solid rgba(126, 202, 255, 0.55); color: #9fdcff; cursor: help;
  font: italic 700 10px/1 Georgia, 'Times New Roman', serif; letter-spacing: 0; text-transform: none;
}
.nge-set-info:hover, .nge-set-info:focus-visible, .nge-set-info--on { background: rgba(74, 158, 255, 0.18); color: #fff; outline: none; }
.nge-set-info-pop {
  position: absolute; z-index: 5; top: 36px; left: 10px; right: 10px; box-sizing: border-box;
  padding: 12px 30px 4px 14px; border-radius: 10px; font-size: 13px; line-height: 1.5; color: #cfe0ff;
  background: linear-gradient(160deg, rgba(16, 28, 52, 0.98), rgba(8, 14, 30, 0.98));
  border: 1px solid rgba(74, 158, 255, 0.45); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 18px rgba(74, 158, 255, 0.12);
}
.nge-set-info-pop p { margin: 0 0 8px; }
.nge-set-info-title { font-weight: 700; color: #9fdcff; letter-spacing: 0.02em; }
.nge-set-info-x {
  position: absolute; top: 6px; right: 8px; padding: 0 4px; font-size: 18px; line-height: 1;
  color: #8fa6c6; background: none; border: 0; cursor: pointer;
}
.nge-set-info-x:hover { color: #fff; }
.nge-set-folded > :not(.nge-settings-label) { display: none !important; }
.nge-settings-shell--embedded .nge-set-folded { padding-bottom: 13px; }

/* The toolbar picker gets the room it needs in the middle column. */
.nge-settings-shell--embedded .nge-set-card--toolbar .nge-settings-toolbar-grid { gap: 7px; }

/* Save rides along the bottom like a console command bar. */
.nge-settings-shell--embedded .nge-settings-actions {
  justify-content: flex-end;
  align-items: center;
  padding: 10px 20px 14px;
  border-top: 1px solid rgba(126, 202, 255, 0.14);
  background: linear-gradient(0deg, rgba(8, 14, 28, 0.95), rgba(8, 14, 28, 0.75));
}
.nge-settings-shell--embedded .nge-settings-actions::before {
  content: 'Changes apply when you save';
  margin-right: auto;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(160, 190, 225, 0.5);
}
.nge-settings-shell--embedded .nge-settings-save {
  flex: 0 0 auto;
  min-width: 190px;
  padding: 9px 22px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 11.5px;
  box-shadow: 0 0 16px rgba(74, 158, 255, 0.18);
}
/* a toggle row that carries a menu, not a checkbox */
.nge-settings-pick { justify-content: space-between; gap: 12px; cursor: default; }
.nge-settings-pick .nge-sv-select { flex: 0 0 auto; min-width: 130px; }
.nge-settings-reset-row { display: flex; justify-content: center; padding: 2px 0 10px; }
.nge-settings-reset {
  padding: 6px 14px; border-radius: 6px; font: inherit; font-size: 12.5px; cursor: pointer;
  background: rgba(255, 90, 90, 0.06); border: 1px solid rgba(255, 120, 120, 0.35); color: #e8a0a0;
}
.nge-settings-reset:hover:not(:disabled) { background: rgba(255, 90, 90, 0.14); color: #ffc2c2; }
.nge-settings-reset:disabled { opacity: 0.6; cursor: default; }
.nge-settings-reset--go { background: rgba(255, 80, 80, 0.2); border-color: rgba(255, 120, 120, 0.7); color: #ffd6d6; font-weight: 700; }
.nge-settings-reset-backdrop {
  position: fixed; inset: 0; z-index: 100050; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55); padding: 16px; box-sizing: border-box;
}
.nge-settings-reset-dlg {
  width: 420px; max-width: 100%; box-sizing: border-box; padding: 18px 20px 16px; border-radius: 12px;
  background: #0b1220; border: 1px solid rgba(255, 120, 120, 0.45); color: #dbe6f5;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6), 0 0 22px rgba(255, 90, 90, 0.12); font-family: 'Inter', system-ui, sans-serif;
}
.nge-settings-reset-title { font-weight: 700; font-size: 15px; color: #ffb3b3; margin-bottom: 8px; }
.nge-settings-reset-text { font-size: 13px; line-height: 1.45; color: #c3d2e6; }
.nge-settings-reset-text p { margin: 0 0 8px; }
.nge-settings-reset-text ul { margin: 0 0 8px; padding-left: 18px; }
.nge-settings-reset-error { margin: 4px 0 8px; font-size: 12.5px; color: #ff9d9d; }
.nge-settings-reset-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

/* Pulse colour: swatches and a picker (Ames 2026-10-20: "make this an actual color picker") */
.nge-pulse-color { align-items: center; }
.nge-pulse-swatches { display: flex; flex-wrap: nowrap; gap: 5px; justify-content: flex-end; align-items: center; }
.nge-pulse-swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.18); padding: 0; cursor: pointer; position: relative; flex: none; }
.nge-pulse-swatch--on { border-color: #fff; box-shadow: 0 0 0 2px rgba(120, 180, 255, 0.6); }
/* Each cell's own colour: a dark middle in a ring of colours. */
.nge-pulse-swatch--own { background: radial-gradient(circle, #141a26 0 42%, transparent 44%), conic-gradient(#59d8ff, #6dff8a, #ffd34d, #ff6fd8, #b48cff, #59d8ff); }
.nge-pulse-swatch--pick { background: #1c2333; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; }
.nge-pulse-swatch--pick::after { content: '+'; color: #cfe0ff; font-size: 15px; line-height: 1; pointer-events: none; }
.nge-pulse-swatch--pick.nge-pulse-swatch--on::after { content: ''; }
.nge-pulse-swatch--pick input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: 0; padding: 0; }
.nge-pulse-hint { margin: 2px 0 8px; }
</style>
