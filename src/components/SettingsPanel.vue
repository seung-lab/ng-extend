<script setup lang="ts">
import {ref, onMounted, computed} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {useUserPreferencesStore, useLoginStore, useProofreadingBackendStore, loginSession} from '../store';
import {COUNTRIES, EYEWIRE_FLAG, findCountryByCode} from '../data/countries';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

const prefsStore = useUserPreferencesStore();

const backendStore = useProofreadingBackendStore();

// ── Username ────────────────────────────────────────────────────────────────
// Chat shows this instead of the display name, and @mentions match it. It's
// unique and space-free, so "@celia" resolves to exactly one person — display
// names are neither.
const draftUsername = ref('');
const usernameError = ref('');
const usernameOk = ref('');
const checkingUsername = ref(false);
let usernameTimer: ReturnType<typeof setTimeout> | null = null;

/** Open the username dialog (the same one shown after Tutorial 1). */
function openUsernameDialog() {
  document.dispatchEvent(new CustomEvent('nge:prompt-username', { detail: { force: true } }));
}

function onUsernameInput() {
  usernameError.value = '';
  usernameOk.value = '';
  if (usernameTimer) clearTimeout(usernameTimer);
  const value = draftUsername.value.trim();
  if (!value || value === backendStore.username) return;
  const invalid = backendStore.validateUsername(value);
  if (invalid) { usernameError.value = invalid; return; }
  // Debounced so we aren't querying on every keystroke.
  checkingUsername.value = true;
  usernameTimer = setTimeout(async () => {
    try {
      const free = await backendStore.isUsernameAvailable(value);
      if (draftUsername.value.trim() !== value) return;  // raced ahead
      if (free) usernameOk.value = `“${value}” is available.`;
      else usernameError.value = 'That username is taken.';
    } finally {
      checkingUsername.value = false;
    }
  }, 400);
}

const draftFlag = ref('');
const draftBio  = ref('');
const draftToolbar = ref<string[]>([]);
const draftChatMuted = ref(false);
const saved      = ref(false);

onMounted(() => {
  draftUsername.value = backendStore.username || '';
  draftFlag.value = prefsStore.prefs.flag;
  draftBio.value  = prefsStore.prefs.bio;
  draftChatMuted.value = !!prefsStore.prefs.chatMuted;
  const current = prefsStore.prefs.toolbarIcons;
  draftToolbar.value = current.length > 0 ? [...current] : [...DEFAULT_ORDER];
});

async function handleSave() {
  const flag = draftFlag.value.trim();
  const bio = draftBio.value.trim().slice(0, 280);
  // Local prefs (toolbar order, chat mute) stay in localStorage.
  prefsStore.save({ flag, bio, toolbarIcons: draftToolbar.value, chatMuted: draftChatMuted.value });
  saved.value = true;
  setTimeout(() => { saved.value = false; }, 1800);
  // Flag and bio are also part of the PUBLIC profile: the profile panel and
  // the leaderboard read users.flag / users.bio from Supabase. Writing only to
  // localStorage made a save look like it did nothing to anyone else (and to
  // you on another machine), so push those two fields as well.
  const backend = useProofreadingBackendStore();
  await backend.saveProfileFields({ flag, bio });
  // Username saves separately: it's unique, so it can legitimately fail (taken)
  // in a way flag/bio can't, and that must surface rather than fail silently.
  const wanted = draftUsername.value.trim();
  if (wanted && wanted !== backendStore.username) {
    try {
      await backendStore.saveUsername(wanted);
      usernameOk.value = `Username set to “${wanted}”.`;
      usernameError.value = '';
    } catch (e: any) {
      usernameError.value = e?.message || 'Could not save username.';
      usernameOk.value = '';
    }
  }
}

// ── Toolbar icon choices (shared with the actual top bar) ──────
import { TOOLBAR_ICON_DEFS } from '../data/toolbar-icons';

const TOOLBAR_ICON_OPTIONS = TOOLBAR_ICON_DEFS;

const DEFAULT_ORDER = [
  'split', 'merge', 'findPath', 'recap', 'leaderboard',
  'cells', 'batch', 'help', 'notif', 'chat', 'settings',
];

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
</script>

<template>
  <modal-overlay id="nge-settings-modal" class="nge-settings-modal" @hide="emit('hide')">
    <div class="nge-settings-shell">
      <!-- Top bar -->
      <div class="nge-settings-topbar">
        <span class="nge-settings-title">⚙️ Settings</span>
        <button class="nge-settings-exit" @click="emit('hide')">×</button>
      </div>

      <!-- Settings content -->
      <div class="nge-settings-content">
        <div class="nge-settings-section">
          <label class="nge-settings-label">Username</label>
          <p class="nge-settings-hint">
            How you appear in chat, and how others tag you: <strong>@{{ draftUsername || 'yourname' }}</strong>.
            3-20 characters, letters/numbers/underscore, no spaces.
          </p>
          <div class="nge-settings-username-row">
            <span class="nge-settings-username-at">@</span>
            <input
              v-model="draftUsername"
              class="nge-settings-username-input"
              maxlength="20"
              placeholder="yourname"
              spellcheck="false"
              autocomplete="off"
              @input="onUsernameInput"
            />
          </div>
          <div v-if="checkingUsername" class="nge-settings-username-note">Checking…</div>
          <div v-else-if="usernameError" class="nge-settings-username-note nge-settings-username-note--err">{{ usernameError }}</div>
          <div v-else-if="usernameOk" class="nge-settings-username-note nge-settings-username-note--ok">{{ usernameOk }}</div>
          <!-- Opens the same dialog the post-tutorial prompt uses. `force`
               bypasses its "only ask once" guards, so it works even when you
               already have a handle (and is the only way to see that flow
               again once you do). -->
          <button class="nge-settings-username-btn" @click="openUsernameDialog">
            {{ backendStore.username ? 'Change username…' : 'Pick a username…' }}
          </button>
        </div>

        <div class="nge-settings-section">
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

        <div class="nge-settings-section">
          <label class="nge-settings-label">Bio</label>
          <p class="nge-settings-hint">Share a little about yourself with the community.</p>
          <textarea v-model="draftBio" class="nge-settings-textarea" maxlength="280" rows="4" placeholder="e.g. PhD student at MIT. Loves connectomics and cold brew."></textarea>
          <div class="nge-settings-charcount" :class="{ 'nge-settings-charcount--warn': draftBio.length > 250 }">{{ draftBio.length }} / 280</div>
        </div>

        <div class="nge-settings-section">
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

        <div class="nge-settings-section">
          <label class="nge-settings-label">Notifications</label>
          <p class="nge-settings-hint">Control the green pip on the chat icon when new messages arrive.</p>
          <label class="nge-settings-toggle">
            <input type="checkbox" v-model="draftChatMuted" />
            <span class="nge-settings-toggle-label">Mute chat unread badge</span>
          </label>
        </div>

        <div class="nge-settings-section">
          <label class="nge-settings-label">Advanced</label>
          <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px;">
            <button class="nge-settings-advanced-btn" @click="openNgSettings">⚙ Viewer Settings</button>
            <button class="nge-settings-advanced-btn" @click="openJsonEditor">{} Edit JSON State</button>
            <button class="nge-settings-advanced-btn" @click="toggleLayerListPanel">☰ Layer List Panel</button>
            <button class="nge-settings-advanced-btn" @click="toggleSelectionDetails">◫ Selection Details</button>
          </div>

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

      <!-- Pinned footer: moved OUT of .nge-settings-content so Save stays
           reachable on short screens. Previously it scrolled with the body,
           and on a small laptop the whole panel simply overflowed the viewport
           with no scrollbar, putting Save off-screen entirely. -->
      <div class="nge-settings-actions">
        <button class="nge-settings-save" @click="handleSave">
          <span v-if="saved">✓ Saved!</span>
          <span v-else>Save</span>
        </button>
        <button class="nge-settings-cancel" @click="emit('hide')">Cancel</button>
      </div>

    </div>
  </modal-overlay>
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
.nge-settings-username-row {
  display: flex;
  align-items: center;
  gap: 0;
  max-width: 360px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  overflow: hidden;
}
.nge-settings-username-row:focus-within { border-color: rgba(74, 158, 255, 0.5); }
.nge-settings-username-at {
  padding: 0 2px 0 10px;
  color: rgba(150, 175, 215, 0.8);
  font-family: 'Consolas', 'Monaco', monospace;
}
.nge-settings-username-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: #e0e0e0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.92em;
  padding: 8px 10px 8px 2px;
}
.nge-settings-username-note {
  margin-top: 5px;
  font-size: 0.78em;
  color: #8b93a7;
}
.nge-settings-username-note--err { color: #ff9b9b; }
.nge-settings-username-note--ok { color: #7fe0a8; }

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

/* Notification mute toggle (Mute chat unread badge) */
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

</style>
