<script setup lang="ts">
import {ref, onMounted, watch} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {useUserPreferencesStore, useProofreadingBackendStore} from '../store';

const prefsStore = useUserPreferencesStore();
const backend = useProofreadingBackendStore();

// ── Tabs: 'profile' or 'admin' ──
const activeTab = ref<'profile' | 'admin'>('profile');

// ── Admin sub-tab ──
const adminSubTab = ref<'notifications' | 'groups' | 'badges'>('notifications');

// ── Notification form ──
const notifTitle = ref('');
const notifBody = ref('');
const notifTargetType = ref<'all' | 'group' | 'user'>('all');
const notifTargetId = ref('');
const notifPostToChat = ref(false);
const notifImageFile = ref<File | null>(null);
const notifSending = ref(false);
const notifSent = ref(false);

async function sendNotification() {
  if (!notifTitle.value.trim() || !notifBody.value.trim()) return;
  notifSending.value = true;
  try {
    let imageUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    if (notifImageFile.value) {
      const urls = await backend.uploadAdminImage(notifImageFile.value, 'notifications');
      imageUrl = urls.fullUrl;
      thumbnailUrl = urls.thumbUrl;
    }
    await backend.createNotification({
      title: notifTitle.value.trim(),
      body: notifBody.value.trim(),
      target_type: notifTargetType.value,
      target_id: notifTargetType.value !== 'all' ? notifTargetId.value : undefined,
      post_to_chat: notifPostToChat.value,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
    });
    notifTitle.value = '';
    notifBody.value = '';
    notifImageFile.value = null;
    notifTargetType.value = 'all';
    notifTargetId.value = '';
    notifPostToChat.value = false;
    notifSent.value = true;
    setTimeout(() => { notifSent.value = false; }, 2000);
  } finally {
    notifSending.value = false;
  }
}

function onNotifImageChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) notifImageFile.value = input.files[0];
}

// ── Group management ──
const newGroupName = ref('');
const newGroupColor = ref('#4a9eff');
const groupMembers = ref<any[]>([]);
const selectedGroupId = ref<number | null>(null);
const memberSearch = ref('');
const memberSearchResults = ref<any[]>([]);
let searchTimeout: any = null;

async function createGroup() {
  if (!newGroupName.value.trim()) return;
  await backend.createGroup(newGroupName.value.trim(), newGroupColor.value);
  newGroupName.value = '';
  await backend.loadGroups();
}

async function selectGroup(gid: number) {
  selectedGroupId.value = gid;
  groupMembers.value = await backend.loadGroupMembers(gid);
}

function onMemberSearch() {
  clearTimeout(searchTimeout);
  if (memberSearch.value.length < 2) { memberSearchResults.value = []; return; }
  searchTimeout = setTimeout(async () => {
    memberSearchResults.value = await backend.searchUsers(memberSearch.value);
  }, 300);
}

async function addMember(userId: string) {
  if (!selectedGroupId.value) return;
  await backend.addGroupMembers(selectedGroupId.value, [userId]);
  groupMembers.value = await backend.loadGroupMembers(selectedGroupId.value);
  memberSearch.value = '';
  memberSearchResults.value = [];
}

async function removeMember(memberId: number) {
  await backend.removeGroupMember(memberId);
  if (selectedGroupId.value) {
    groupMembers.value = await backend.loadGroupMembers(selectedGroupId.value);
  }
}

// ── Special badge management ──
const badgeName = ref('');
const badgeDesc = ref('');
const badgeSlug = ref('');
const badgeImageFile = ref<File | null>(null);
const badgeCreating = ref(false);
const badgeError = ref('');
const badgeCreated = ref(false);
const awardBadgeId = ref<number | null>(null);
const awardUserSearch = ref('');
const awardUserResults = ref<any[]>([]);
const awardGroupId = ref<number | null>(null);
let awardSearchTimeout: any = null;

async function createBadge() {
  if (!badgeName.value.trim() || !badgeSlug.value.trim() || !badgeImageFile.value) return;
  badgeCreating.value = true;
  badgeError.value = '';
  badgeCreated.value = false;
  try {
    const urls = await backend.uploadAdminImage(badgeImageFile.value, 'badges');
    await backend.createSpecialBadge({
      name: badgeName.value.trim(),
      description: badgeDesc.value.trim(),
      slug: badgeSlug.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      image_url: urls.fullUrl,
      thumbnail_url: urls.thumbUrl,
    });
    badgeName.value = '';
    badgeDesc.value = '';
    badgeSlug.value = '';
    badgeImageFile.value = null;
    badgeCreated.value = true;
    setTimeout(() => { badgeCreated.value = false; }, 2500);
    await backend.loadSpecialBadges();
  } catch (e: any) {
    badgeError.value = e.message || 'Failed to create badge';
    console.error('[admin] createBadge failed:', e);
  } finally {
    badgeCreating.value = false;
  }
}

function onBadgeImageChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) badgeImageFile.value = input.files[0];
}

function onAwardUserSearch() {
  clearTimeout(awardSearchTimeout);
  if (awardUserSearch.value.length < 2) { awardUserResults.value = []; return; }
  awardSearchTimeout = setTimeout(async () => {
    awardUserResults.value = await backend.searchUsers(awardUserSearch.value);
  }, 300);
}

async function awardToUser(userId: string) {
  if (!awardBadgeId.value) return;
  await backend.awardBadge(awardBadgeId.value, userId);
  awardUserSearch.value = '';
  awardUserResults.value = [];
}

async function awardToGroup() {
  if (!awardBadgeId.value || !awardGroupId.value) return;
  await backend.awardBadgeToGroup(awardBadgeId.value, awardGroupId.value);
}

// Load admin data when switching to admin tab
watch(activeTab, (tab) => {
  if (tab === 'admin') {
    backend.loadGroups();
    backend.loadSpecialBadges();
    backend.loadNotifications();
  }
});

const draftFlag = ref('');
const draftBio  = ref('');
const draftToolbar = ref<string[]>([]);
const saved      = ref(false);

onMounted(() => {
  draftFlag.value = prefsStore.prefs.flag;
  draftBio.value  = prefsStore.prefs.bio;
  const current = prefsStore.prefs.toolbarIcons;
  draftToolbar.value = current.length > 0 ? [...current] : [...DEFAULT_ORDER];
});

function handleSave() {
  prefsStore.save({
    flag: draftFlag.value.trim(),
    bio:  draftBio.value.trim().slice(0, 280),
    toolbarIcons: draftToolbar.value,
  });
  saved.value = true;
  setTimeout(() => { saved.value = false; }, 1800);
}

// ── Toolbar icon choices ──────────────────────────────────────
const TOOLBAR_ICON_OPTIONS = [
  { id: 'split', emoji: '✂️', label: 'Split Mode' },
  { id: 'merge', emoji: '🔗', label: 'Merge Mode' },
  { id: 'recap', emoji: '📊', label: 'Weekly Recap' },
  { id: 'leaderboard', emoji: '🏆', label: 'Leaderboard' },
  { id: 'quest', emoji: '🧠', label: 'Brain Quest' },
  { id: 'cells', emoji: '🧬', label: 'Cell Library' },
  { id: 'help', emoji: '🔍', label: 'Help Requests' },
  { id: 'feed', emoji: '📡', label: 'Activity Feed' },
  { id: 'notif', emoji: '🔔', label: 'Notifications' },
  { id: 'chat', emoji: '💬', label: 'Chat' },
  { id: 'settings', emoji: '⚙️', label: 'Settings' },
];

const DEFAULT_ORDER = ['split', 'merge', 'recap', 'leaderboard', 'quest', 'help', 'feed', 'notif', 'chat', 'settings'];

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

const QUICK_FLAGS = ['🇺🇸','🇬🇧','🇨🇦','🇩🇪','🇫🇷','🇯🇵','🇰🇷','🇨🇳','🇧🇷','🇮🇳','🇦🇺','🇳🇬','🇹🇼','🇵🇹','🇩🇰','🇸🇦'];

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

      <!-- Tab bar -->
      <div class="nge-settings-tabs" v-if="backend.isAdmin">
        <button class="nge-settings-tab" :class="{ 'nge-settings-tab--active': activeTab === 'profile' }" @click="activeTab = 'profile'">Profile</button>
        <button class="nge-settings-tab" :class="{ 'nge-settings-tab--active': activeTab === 'admin' }" @click="activeTab = 'admin'">Admin Hub</button>
      </div>

      <!-- ═══ PROFILE TAB ═══ -->
      <div class="nge-settings-content" v-if="activeTab === 'profile'">
        <div class="nge-settings-section">
          <label class="nge-settings-label">Country / Flag</label>
          <p class="nge-settings-hint">Type or paste any flag emoji, or pick one below.</p>
          <input v-model="draftFlag" class="nge-settings-input" maxlength="8" placeholder="e.g. 🇺🇸" spellcheck="false" autocomplete="off" />
          <div class="nge-settings-flags">
            <button v-for="f in QUICK_FLAGS" :key="f" class="nge-settings-flag-btn" :class="{ 'nge-settings-flag-btn--active': draftFlag === f }" @click="draftFlag = f">{{ f }}</button>
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
              <span class="nge-settings-toolbar-emoji">{{ opt.emoji }}</span>
              <span class="nge-settings-toolbar-label">{{ opt.label }}</span>
            </button>
          </div>
          <button class="nge-settings-toolbar-reset" @click="resetToolbar">Reset to defaults</button>
        </div>

        <div class="nge-settings-actions">
          <button class="nge-settings-save" @click="handleSave">
            <span v-if="saved">✓ Saved!</span>
            <span v-else>Save</span>
          </button>
          <button class="nge-settings-cancel" @click="emit('hide')">Cancel</button>
        </div>
      </div>

      <!-- ═══ ADMIN TAB ═══ -->
      <div class="nge-settings-content nge-admin-content" v-if="activeTab === 'admin' && backend.isAdmin">
        <!-- Admin sub-tabs -->
        <div class="nge-admin-subtabs">
          <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'notifications' }" @click="adminSubTab = 'notifications'">Notifications</button>
          <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'groups' }" @click="adminSubTab = 'groups'">Groups</button>
          <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'badges' }" @click="adminSubTab = 'badges'">Special Badges</button>
        </div>

        <!-- ── Notifications sub-section ── -->
        <div v-if="adminSubTab === 'notifications'" class="nge-admin-section">
          <div class="nge-settings-section">
            <label class="nge-settings-label">Send Notification</label>
            <input v-model="notifTitle" class="nge-admin-input" placeholder="Title" />
            <textarea v-model="notifBody" class="nge-settings-textarea" rows="3" placeholder="Message body..."></textarea>
            <div class="nge-admin-row">
              <select v-model="notifTargetType" class="nge-admin-select">
                <option value="all">All Users</option>
                <option value="group">Group</option>
                <option value="user">Specific User</option>
              </select>
              <select v-if="notifTargetType === 'group'" v-model="notifTargetId" class="nge-admin-select">
                <option value="" disabled>Select group...</option>
                <option v-for="g in backend.groups" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
              </select>
              <input v-if="notifTargetType === 'user'" v-model="notifTargetId" class="nge-admin-input nge-admin-input--sm" placeholder="User ID" />
            </div>
            <div class="nge-admin-row">
              <label class="nge-admin-check"><input type="checkbox" v-model="notifPostToChat" /> Also post to chat</label>
              <label class="nge-admin-file-label">
                <input type="file" accept="image/*" @change="onNotifImageChange" class="nge-admin-file-input" />
                {{ notifImageFile ? notifImageFile.name : 'Attach image...' }}
              </label>
            </div>
            <button class="nge-settings-save" :disabled="notifSending || !notifTitle.trim() || !notifBody.trim()" @click="sendNotification">
              <span v-if="notifSent">✓ Sent!</span>
              <span v-else-if="notifSending">Sending...</span>
              <span v-else>Send Notification</span>
            </button>
          </div>

          <!-- Recent notifications -->
          <div class="nge-settings-section" v-if="backend.notifications.length > 0">
            <label class="nge-settings-label">Recent Notifications</label>
            <div v-for="n in backend.notifications.slice(0, 10)" :key="n.id" class="nge-admin-notif-row">
              <div class="nge-admin-notif-info">
                <strong>{{ n.title }}</strong>
                <span class="nge-admin-notif-meta">{{ n.target_type }} · {{ new Date(n.send_at).toLocaleDateString() }}</span>
              </div>
              <button class="nge-admin-delete-btn" @click="backend.deleteNotification(n.id)" title="Delete">×</button>
            </div>
          </div>
        </div>

        <!-- ── Groups sub-section ── -->
        <div v-if="adminSubTab === 'groups'" class="nge-admin-section">
          <div class="nge-settings-section">
            <label class="nge-settings-label">Create Group</label>
            <div class="nge-admin-row">
              <input v-model="newGroupName" class="nge-admin-input" placeholder="Group name (e.g. Scythes)" />
              <input v-model="newGroupColor" type="color" class="nge-admin-color" title="Group color" />
              <button class="nge-admin-action-btn" @click="createGroup" :disabled="!newGroupName.trim()">Create</button>
            </div>
          </div>

          <div class="nge-settings-section">
            <label class="nge-settings-label">Manage Groups</label>
            <div class="nge-admin-group-list">
              <button v-for="g in backend.groups" :key="g.id" class="nge-admin-group-chip" :class="{ 'nge-admin-group-chip--active': selectedGroupId === g.id }" :style="{ borderColor: g.color }" @click="selectGroup(g.id)">
                <span class="nge-admin-group-dot" :style="{ background: g.color }"></span>
                {{ g.name }}
              </button>
            </div>

            <!-- Group members -->
            <div v-if="selectedGroupId" class="nge-admin-members">
              <div class="nge-admin-row">
                <input v-model="memberSearch" @input="onMemberSearch" class="nge-admin-input" placeholder="Search users to add..." />
              </div>
              <div v-if="memberSearchResults.length > 0" class="nge-admin-search-results">
                <button v-for="u in memberSearchResults" :key="u.id" class="nge-admin-search-item" @click="addMember(u.id)">
                  + {{ u.username }}
                </button>
              </div>
              <div class="nge-admin-member-list">
                <div v-for="m in groupMembers" :key="m.id" class="nge-admin-member-row">
                  <span>{{ m.users?.username || m.user_id }}</span>
                  <button class="nge-admin-delete-btn" @click="removeMember(m.id)">×</button>
                </div>
                <div v-if="groupMembers.length === 0" class="nge-settings-hint">No members yet.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Special Badges sub-section ── -->
        <div v-if="adminSubTab === 'badges'" class="nge-admin-section">
          <div class="nge-settings-section">
            <label class="nge-settings-label">Create Special Badge</label>
            <input v-model="badgeName" class="nge-admin-input" placeholder="Badge name" />
            <input v-model="badgeSlug" class="nge-admin-input" placeholder="Slug (URL-safe, e.g. beta-tester)" />
            <textarea v-model="badgeDesc" class="nge-settings-textarea" rows="2" placeholder="Description..."></textarea>
            <label class="nge-admin-file-label">
              <input type="file" accept="image/*" @change="onBadgeImageChange" class="nge-admin-file-input" />
              {{ badgeImageFile ? badgeImageFile.name : 'Choose badge image...' }}
            </label>
            <button class="nge-settings-save" :disabled="badgeCreating || !badgeName.trim() || !badgeSlug.trim() || !badgeImageFile" @click="createBadge">
              <span v-if="badgeCreated">✓ Created!</span>
              <span v-else-if="badgeCreating">Creating...</span>
              <span v-else>Create Badge</span>
            </button>
            <div v-if="badgeError" class="nge-admin-error">⚠ {{ badgeError }}</div>
          </div>

          <div class="nge-settings-section" v-if="backend.specialBadges.length > 0">
            <label class="nge-settings-label">Award Badge</label>
            <select v-model="awardBadgeId" class="nge-admin-select">
              <option :value="null" disabled>Select badge...</option>
              <option v-for="b in backend.specialBadges" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>

            <div v-if="awardBadgeId" class="nge-admin-award-section">
              <p class="nge-settings-hint">Award to individual user:</p>
              <div class="nge-admin-row">
                <input v-model="awardUserSearch" @input="onAwardUserSearch" class="nge-admin-input" placeholder="Search username..." />
              </div>
              <div v-if="awardUserResults.length > 0" class="nge-admin-search-results">
                <button v-for="u in awardUserResults" :key="u.id" class="nge-admin-search-item" @click="awardToUser(u.id)">
                  Award to {{ u.username }}
                </button>
              </div>

              <p class="nge-settings-hint" style="margin-top:10px">Or award to entire group:</p>
              <div class="nge-admin-row">
                <select v-model="awardGroupId" class="nge-admin-select">
                  <option :value="null" disabled>Select group...</option>
                  <option v-for="g in backend.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
                <button class="nge-admin-action-btn" :disabled="!awardGroupId" @click="awardToGroup">Award to Group</button>
              </div>
            </div>
          </div>

          <!-- Existing badges list -->
          <div class="nge-settings-section" v-if="backend.specialBadges.length > 0">
            <label class="nge-settings-label">Existing Badges</label>
            <div class="nge-admin-badge-grid">
              <div v-for="b in backend.specialBadges" :key="b.id" class="nge-admin-badge-card">
                <img v-if="b.thumbnail_url" :src="b.thumbnail_url" class="nge-admin-badge-img" />
                <div class="nge-admin-badge-name">{{ b.name }}</div>
              </div>
            </div>
          </div>
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
  font-size: 1.1em;
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

/* ── Tab bar ── */
.nge-settings-tabs {
  display: flex;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 0 16px;
  flex-shrink: 0;
}
.nge-settings-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #667;
  font-size: 0.82em;
  font-family: inherit;
  padding: 10px 16px 8px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.nge-settings-tab:hover { color: #aab; }
.nge-settings-tab--active {
  color: #4a9eff;
  border-bottom-color: #4a9eff;
}

/* ── Admin content ── */
.nge-admin-content {
  max-height: 500px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74,158,255,0.15) transparent;
}

.nge-admin-subtabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}
.nge-admin-subtab {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: #667;
  font-size: 0.75em;
  font-family: inherit;
  padding: 5px 12px;
  cursor: pointer;
  transition: all 0.12s;
}
.nge-admin-subtab:hover { background: rgba(255,255,255,0.08); color: #aab; }
.nge-admin-subtab--active {
  background: rgba(74,158,255,0.1);
  border-color: rgba(74,158,255,0.3);
  color: #4a9eff;
}

.nge-admin-section { display: flex; flex-direction: column; gap: 14px; }

.nge-admin-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.88em;
  font-family: inherit;
  padding: 7px 10px;
  outline: none;
  flex: 1;
}
.nge-admin-input:focus { border-color: rgba(74,158,255,0.5); }
.nge-admin-input--sm { max-width: 180px; }

.nge-admin-select {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.82em;
  font-family: inherit;
  padding: 6px 8px;
  outline: none;
  flex: 1;
}
.nge-admin-select:focus { border-color: rgba(74,158,255,0.5); }

.nge-admin-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.nge-admin-check {
  font-size: 0.78em;
  color: #888;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.nge-admin-check input { accent-color: #4a9eff; }

.nge-admin-file-label {
  font-size: 0.78em;
  color: #4a9eff;
  cursor: pointer;
  padding: 4px 10px;
  border: 1px dashed rgba(74,158,255,0.3);
  border-radius: 6px;
  text-align: center;
  transition: background 0.12s;
}
.nge-admin-file-label:hover { background: rgba(74,158,255,0.06); }
.nge-admin-file-input { display: none; }

.nge-admin-color {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: none;
  padding: 0;
}

.nge-admin-action-btn {
  background: rgba(74,158,255,0.15);
  border: 1px solid rgba(74,158,255,0.3);
  border-radius: 6px;
  color: #4a9eff;
  font-size: 0.78em;
  font-family: inherit;
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}
.nge-admin-action-btn:hover { background: rgba(74,158,255,0.25); }
.nge-admin-action-btn:disabled { opacity: 0.4; cursor: default; }

.nge-admin-delete-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 1.1em;
  cursor: pointer;
  padding: 0 4px;
  transition: color 0.12s;
}
.nge-admin-delete-btn:hover { color: #e55; }

.nge-admin-notif-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.nge-admin-notif-info { display: flex; flex-direction: column; gap: 2px; }
.nge-admin-notif-info strong { font-size: 0.82em; color: #bbc; }
.nge-admin-notif-meta { font-size: 0.68em; color: #556; }

.nge-admin-group-list { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-admin-group-chip {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px;
  color: #aab;
  font-size: 0.78em;
  font-family: inherit;
  padding: 4px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.12s;
}
.nge-admin-group-chip:hover { background: rgba(255,255,255,0.08); }
.nge-admin-group-chip--active { background: rgba(74,158,255,0.08); border-color: rgba(74,158,255,0.3); color: #4a9eff; }
.nge-admin-group-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.nge-admin-members { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.nge-admin-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  max-height: 120px;
  overflow-y: auto;
}
.nge-admin-search-item {
  background: none;
  border: none;
  color: #4a9eff;
  font-size: 0.78em;
  font-family: inherit;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}
.nge-admin-search-item:hover { background: rgba(74,158,255,0.08); }

.nge-admin-member-list { display: flex; flex-direction: column; gap: 2px; }
.nge-admin-member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  font-size: 0.78em;
  color: #aab;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.nge-admin-award-section { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }

.nge-admin-badge-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.nge-admin-badge-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  width: 80px;
}
.nge-admin-badge-img {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 4px;
}
.nge-admin-badge-name {
  font-size: 0.68em;
  color: #889;
  text-align: center;
  word-break: break-word;
}

.nge-admin-error {
  font-size: 0.78em;
  color: #e55;
  background: rgba(255, 50, 50, 0.08);
  border: 1px solid rgba(255, 50, 50, 0.2);
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 4px;
}
</style>
