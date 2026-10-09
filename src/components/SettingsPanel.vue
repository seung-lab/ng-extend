<script setup lang="ts">
import {ref, onMounted, onUnmounted, computed} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {useUserPreferencesStore, useLoginStore, useProofreadingBackendStore, useIssueTagStore, loginSession} from '../store';
import {COUNTRIES, EYEWIRE_FLAG, findCountryByCode} from '../data/countries';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';
import { DATASETS, segLayerName } from '../datasets';
import { startViewHash } from '../util/start_view';
import { ngePointScale, ngePointGem } from 'neuroglancer/annotation/point';

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
const draftToolbar = ref<string[]>([]);
const draftChatMuted = ref(false);
const draftChatFade = ref(true);
const draftShowNgControls = ref(false);
const draftKeepDisplay = ref(true);
const draftClassicLayers = ref(false);
const draftUndeleteCounter = ref(false);
const draftLibraryTab = ref<'mine' | 'available' | 'claimed' | 'all' | 'help' | 'links'>('mine');
const draftJumpAdds = ref(false);
const draftOfferRestore = ref(true);
/** Point annotation size (after EyeWire's "Annotation Resizer" addon). Applied
 *  live while you drag; kept when you save, put back if you close without. */
const draftAnnotationSize = ref(1);
const savedAnnotationSize = ref(1);
const draftAnnotationGems = ref(true);
const draftAnnotationSetupTabs = ref(false);
const draftSegSetupTabs = ref(false);
function previewAnnotationSize() {
  ngePointScale.value = draftAnnotationSize.value;
  try { (window as any).viewer?.display?.scheduleRedraw(); } catch { /* no viewer */ }
}
onUnmounted(() => {
  // Closed without saving: put the saved size back.
  if (ngePointScale.value !== savedAnnotationSize.value) {
    draftAnnotationSize.value = savedAnnotationSize.value;
    previewAnnotationSize();
  }
});
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
  draftShowNgControls.value = prefsStore.prefs.showNgControlsButton === true;
  draftKeepDisplay.value = prefsStore.prefs.keepDisplayOnJump !== false;
  draftClassicLayers.value = prefsStore.prefs.classicLayerClicks === true;
  draftUndeleteCounter.value = prefsStore.prefs.undeleteCounter === true;
  draftLibraryTab.value = prefsStore.prefs.cellLibraryStartTab || 'mine';
  draftJumpAdds.value = prefsStore.prefs.jumpAddsToView === true;
  draftOfferRestore.value = prefsStore.prefs.offerViewRestore !== false;
  draftAnnotationSize.value = savedAnnotationSize.value = ngePointScale.value;
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
  draftToolbar.value = resolveToolbarOrder(prefsStore.prefs.toolbarIcons, prefsStore.prefs.toolbarIconsInjected);
});

async function handleSave() {
  const flag = draftFlag.value.trim();
  const bio = draftBio.value.trim().slice(0, 280);
  // Local prefs (toolbar order, chat/help mute) stay in localStorage. Saving
  // also stamps the injected marker: every auto-inject icon has now been
  // offered in the grid, so absence from a future save means the user removed
  // it, and resolveToolbarOrder must not re-add it (Celia's report).
  prefsStore.save({
    flag, bio, toolbarIcons: draftToolbar.value,
    toolbarIconsInjected: markInjected(prefsStore.prefs.toolbarIconsInjected),
    chatMuted: draftChatMuted.value, helpMuted: draftHelpMuted.value, chatFadeAway: draftChatFade.value, showNgControlsButton: draftShowNgControls.value, keepDisplayOnJump: draftKeepDisplay.value, classicLayerClicks: draftClassicLayers.value, undeleteCounter: draftUndeleteCounter.value, cellLibraryStartTab: draftLibraryTab.value, jumpAddsToView: draftJumpAdds.value, offerViewRestore: draftOfferRestore.value, annotationSize: draftAnnotationSize.value, annotationGems: draftAnnotationGems.value, showAnnotationSetupTabs: draftAnnotationSetupTabs.value, showSegSetupTabs: draftSegSetupTabs.value,
    datasetBareSwitch: draftBareSwitch.value, datasetStartViews: draftStartViews.value,
    extraDatasets: draftExtra.value,
  });
  // Apply the ambient tag layer change immediately.
  useIssueTagStore().syncTagLayer();
  savedAnnotationSize.value = draftAnnotationSize.value;
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
  draftToolbar.value = [...DEFAULT_ORDER];
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

function openNgSettings() {
  const viewer = (window as any)['viewer'];
  if (viewer?.settingsPanelState) {
    viewer.settingsPanelState.location.watchableVisible.value = true;
  }
}

function openJsonEditor() {
  const viewer = (window as any)['viewer'];
  if (viewer?.editJsonState) viewer.editJsonState();
}

function toggleLayerListPanel() {
  const viewer = (window as any)['viewer'];
  if (viewer?.layerListPanelState?.location?.watchableVisible) {
    const vis = viewer.layerListPanelState.location.watchableVisible;
    vis.value = !vis.value;
  }
}

function toggleSelectionDetails() {
  const viewer = (window as any)['viewer'];
  if (viewer?.selectionDetailsState?.location?.watchableVisible) {
    const vis = viewer.selectionDetailsState.location.watchableVisible;
    vis.value = !vis.value;
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
          <div class="nge-settings-section nge-set-card--username">
            <label class="nge-settings-label">Username</label>
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

          <div class="nge-settings-section nge-set-card--flag">
            <label class="nge-settings-label">Country / Flag</label>
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

          <div class="nge-settings-section nge-set-card--bio">
            <label class="nge-settings-label">Bio</label>
            <p class="nge-settings-hint">Share a little about yourself with the community.</p>
            <textarea v-model="draftBio" class="nge-settings-textarea" maxlength="280" rows="4" placeholder="e.g. PhD student at MIT. Loves connectomics and cold brew."></textarea>
            <div class="nge-settings-charcount" :class="{ 'nge-settings-charcount--warn': draftBio.length > 250 }">{{ draftBio.length }} / 280</div>
          </div>

        </div>
        <div class="nge-set-col nge-set-col--topbar">
          <div class="nge-set-col-head"><span class="nge-set-col-title">Top bar</span><span class="nge-set-col-sub">what you see</span></div>
          <div class="nge-settings-section nge-set-card--toolbar">
            <label class="nge-settings-label">Toolbar Icons</label>
            <p class="nge-settings-hint">Toggle which actions appear in your top bar.</p>
            <div class="nge-settings-toolbar-grid">
              <button v-for="opt in TOOLBAR_ICON_OPTIONS" :key="opt.id" class="nge-settings-toolbar-item" :class="{ 'nge-settings-toolbar-item--active': isToolbarIconEnabled(opt.id) }" @click="toggleToolbarIcon(opt.id)">
                <span v-if="opt.svg" class="nge-settings-toolbar-emoji" v-html="opt.svg"></span>
                <img v-else-if="opt.img" :src="opt.img" class="nge-settings-toolbar-icon-img" :alt="opt.label" />
                <span v-else class="nge-settings-toolbar-emoji">{{ opt.emoji }}</span>
                <span class="nge-settings-toolbar-label">{{ opt.label }}</span>
              </button>
            </div>
            <button class="nge-settings-toolbar-reset" @click="resetToolbar">Reset to defaults</button>
          </div>

          <!-- How the game behaves, in a card of its own (Ames 2026-10-06).
               Annotation point size is not here: it is set on the annotation
               layer itself. -->
          <div class="nge-settings-section nge-set-card--ui">
            <label class="nge-settings-label">User Interface</label>
            <p class="nge-settings-hint">How layers, jumps and annotations behave.</p>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftAnnotationGems" />
              <span class="nge-settings-toggle-label">Show point annotations as Pyr gems in 3D</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftAnnotationSetupTabs" />
              <span class="nge-settings-toggle-label">Show Source and Rendering tabs on annotation layers</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftKeepDisplay" />
              <span class="nge-settings-toggle-label">Keep my display settings (opacity, layout) when jumping to cells</span>
            </label>
            <label class="nge-settings-toggle" title="Off: left click selects a layer, right click hides or shows it. On: the other way round, as in neuroglancer.">
              <input type="checkbox" v-model="draftClassicLayers" />
              <span class="nge-settings-toggle-label">Classic layer tabs: left click hides a layer, right click selects it</span>
            </label>
            <label class="nge-settings-toggle" title="Undelete brings back cells you removed from view. On: its icon shows how many steps it can bring back.">
              <input type="checkbox" v-model="draftUndeleteCounter" />
              <span class="nge-settings-toggle-label">Show a counter on the Undelete icon</span>
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
            <label class="nge-settings-toggle" title="Off: a jump shows only the cell you jumped to. On: each jump adds its cell to the ones already in your view.">
              <input type="checkbox" v-model="draftJumpAdds" />
              <span class="nge-settings-toggle-label">Jumping to a cell adds it to my view (off: it replaces my view)</span>
            </label>
            <label class="nge-settings-toggle" title="Your view is saved as you work. When a dataset opens, a small bar offers to bring it back. Never shown on the Sandbox.">
              <input type="checkbox" v-model="draftOfferRestore" />
              <span class="nge-settings-toggle-label">Offer to pick up where I left off when a dataset opens</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftShowNgControls" />
              <span class="nge-settings-toggle-label">Show the neuroglancer controls button (?)</span>
            </label>
          </div>

          <div class="nge-settings-section nge-set-card--notif">
            <label class="nge-settings-label">Notifications</label>
            <p class="nge-settings-hint">Control the badges on your toolbar icons.</p>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftChatMuted" />
              <span class="nge-settings-toggle-label">Mute chat unread badge</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftChatFade" />
              <span class="nge-settings-toggle-label">Fade chat when I click away</span>
            </label>
            <label class="nge-settings-toggle">
              <input type="checkbox" v-model="draftHelpMuted" />
              <span class="nge-settings-toggle-label">Mute help requests</span>
            </label>
          </div>

        </div>
        <div class="nge-set-col nge-set-col--viewer">
          <div class="nge-set-col-head"><span class="nge-set-col-title">Viewer</span><span class="nge-set-col-sub">how it opens</span></div>
          <div class="nge-settings-section nge-set-card--datasets">
            <label class="nge-settings-label">Switching datasets</label>
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

          <div class="nge-settings-section nge-set-card--advanced">
            <label class="nge-settings-label">Advanced</label>
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px;">
              <button class="nge-settings-advanced-btn" @click="openNgSettings">⚙ Viewer Settings</button>
              <button class="nge-settings-advanced-btn" @click="openJsonEditor">{} Edit JSON State</button>
              <button class="nge-settings-advanced-btn" @click="toggleLayerListPanel">☰ Layer List Panel</button>
              <button class="nge-settings-advanced-btn" @click="toggleSelectionDetails">◫ Selection Details</button>
            </div>
            <label class="nge-settings-toggle" style="margin-top: 10px;" title="Segmentation layers open on Seg. Turn this on to also see their Source and Graph tabs. Takes effect when the page reloads.">
              <input type="checkbox" v-model="draftSegSetupTabs" />
              <span class="nge-settings-toggle-label">Show Source and Graph tabs on segmentation layers</span>
            </label>

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
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 32px);
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
}

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

/* Notification mute toggle (Mute chat unread badge) */
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
</style>
