<script setup lang="ts">
import {ref, onMounted} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {useUserPreferencesStore} from '../store';

const prefsStore = useUserPreferencesStore();

const draftFlag = ref('');
const draftBio  = ref('');
const saved      = ref(false);

onMounted(() => {
  draftFlag.value = prefsStore.prefs.flag;
  draftBio.value  = prefsStore.prefs.bio;
});

function handleSave() {
  prefsStore.save({
    flag: draftFlag.value.trim(),
    bio:  draftBio.value.trim().slice(0, 280),
  });
  saved.value = true;
  setTimeout(() => { saved.value = false; }, 1800);
}

const QUICK_FLAGS = ['🇺🇸','🇬🇧','🇨🇦','🇩🇪','🇫🇷','🇯🇵','🇰🇷','🇨🇳','🇧🇷','🇮🇳','🇦🇺','🇳🇬','🇹🇼','🇵🇹','🇩🇰','🇸🇦'];

const emit = defineEmits({hide: null});
</script>

<template>
  <modal-overlay id="nge-settings-modal" class="nge-settings-modal" @hide="emit('hide')">
    <div class="nge-settings-shell">
      <!-- Top bar -->
      <div class="nge-settings-topbar">
        <span class="nge-settings-title">⚙️ Profile Settings</span>
        <button class="nge-settings-exit" @click="emit('hide')">×</button>
      </div>

      <div class="nge-settings-content">
        <!-- Flag emoji section -->
        <div class="nge-settings-section">
          <label class="nge-settings-label">Country / Flag</label>
          <p class="nge-settings-hint">Type or paste any flag emoji, or pick one below.</p>
          <input
            v-model="draftFlag"
            class="nge-settings-input"
            maxlength="8"
            placeholder="e.g. 🇺🇸"
            spellcheck="false"
            autocomplete="off"
          />
          <!-- Quick-pick flags -->
          <div class="nge-settings-flags">
            <button
              v-for="f in QUICK_FLAGS"
              :key="f"
              class="nge-settings-flag-btn"
              :class="{ 'nge-settings-flag-btn--active': draftFlag === f }"
              @click="draftFlag = f"
            >{{ f }}</button>
          </div>
        </div>

        <!-- Bio section -->
        <div class="nge-settings-section">
          <label class="nge-settings-label">Bio</label>
          <p class="nge-settings-hint">Share a little about yourself with the community.</p>
          <textarea
            v-model="draftBio"
            class="nge-settings-textarea"
            maxlength="280"
            rows="4"
            placeholder="e.g. PhD student at MIT. Loves connectomics and cold brew."
          ></textarea>
          <div class="nge-settings-charcount" :class="{ 'nge-settings-charcount--warn': draftBio.length > 250 }">
            {{ draftBio.length }} / 280
          </div>
        </div>

        <!-- Actions -->
        <div class="nge-settings-actions">
          <button class="nge-settings-save" @click="handleSave">
            <span v-if="saved">✓ Saved!</span>
            <span v-else>Save</span>
          </button>
          <button class="nge-settings-cancel" @click="emit('hide')">Cancel</button>
        </div>
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
  position: relative;
  overflow: hidden;
  animation: ngeSettingsMaterialize 0.52s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nge-settings-modal :deep(.nge-overlay::before) {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(74, 158, 255, 0.5) 15%,
    rgba(160, 220, 255, 1) 50%,
    rgba(74, 158, 255, 0.5) 85%,
    transparent 100%
  );
  animation: ngeSettingsScan 0.52s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  z-index: 100;
  pointer-events: none;
}

@keyframes ngeSettingsMaterialize {
  0% {
    opacity: 0; transform: translate(-50%, -50%) translateY(14px) scale(0.96);
    filter: blur(8px) brightness(2);
    box-shadow: 0 0 60px rgba(74, 158, 255, 0.5), 0 0 120px rgba(74, 158, 255, 0.15);
  }
  35% {
    opacity: 1; transform: translate(-50%, -50%);
    filter: blur(0.5px) brightness(1.15);
    box-shadow: 0 0 20px rgba(74, 158, 255, 0.15);
  }
  100% {
    opacity: 1; transform: translate(-50%, -50%);
    filter: blur(0px) brightness(1); box-shadow: none;
  }
}

@keyframes ngeSettingsScan {
  0%   { top: 0%;   opacity: 1; }
  85%  { opacity: 0.4; }
  100% { top: 100%; opacity: 0; }
}

/* ── Shell ── */
.nge-settings-shell {
  display: flex;
  flex-direction: column;
  width: 420px;
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
  font-size: 1.1em;
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
  padding: 20px 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.nge-settings-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nge-settings-label {
  font-size: 0.78em;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #888;
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
  margin-top: 4px;
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
</style>
