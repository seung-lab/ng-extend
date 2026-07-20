<script setup lang="ts">
import {ref, onMounted} from 'vue';
import {useProofreadingBackendStore} from '../store';

const backend = useProofreadingBackendStore();

// Sub-tab: 'notifications' | 'groups' | 'badges'
const adminSubTab = ref<'notifications' | 'groups' | 'badges'>('notifications');

// ── Notification form state ──
const notifTitle = ref('');
const notifBody = ref('');
const notifTargetType = ref<'all' | 'group' | 'user'>('all');
const notifTargetId = ref('');
const notifPostToChat = ref(false);
const notifSendAt = ref('');
const notifExpiresAt = ref('');
const notifImageFile = ref<File | null>(null);
const notifSending = ref(false);
const notifSent = ref(false);
const notifError = ref('');

async function sendNotification() {
  if (!notifTitle.value.trim() || !notifBody.value.trim()) return;
  notifSending.value = true;
  notifError.value = '';
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
      send_at: notifSendAt.value ? new Date(notifSendAt.value).toISOString() : undefined,
      expires_at: notifExpiresAt.value ? new Date(notifExpiresAt.value).toISOString() : undefined,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
    });
    notifTitle.value = '';
    notifBody.value = '';
    notifImageFile.value = null;
    notifTargetType.value = 'all';
    notifTargetId.value = '';
    notifPostToChat.value = false;
    notifSendAt.value = '';
    notifExpiresAt.value = '';
    notifSent.value = true;
    setTimeout(() => { notifSent.value = false; }, 2000);
  } catch (e: any) {
    notifError.value = e.message || 'Failed to send notification';
    console.error('[admin] sendNotification failed:', e);
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
  await backend.createGroup(newGroupName.value.trim(), '', newGroupColor.value);
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

async function removeMember(userId: string) {
  if (!selectedGroupId.value) return;
  await backend.removeGroupMember(selectedGroupId.value, userId);
  groupMembers.value = await backend.loadGroupMembers(selectedGroupId.value);
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
const awardSuccess = ref('');
let awardSearchTimeout: any = null;

async function createBadge() {
  if (!badgeName.value.trim()) { badgeError.value = 'Badge name is required'; return; }
  if (!badgeImageFile.value) { badgeError.value = 'Badge image is required'; return; }
  const slug = (badgeSlug.value.trim() || badgeName.value.trim())
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  badgeCreating.value = true;
  badgeError.value = '';
  badgeCreated.value = false;
  try {
    const urls = await backend.uploadAdminImage(badgeImageFile.value, 'badges');
    await backend.createSpecialBadge({
      name: badgeName.value.trim(),
      description: badgeDesc.value.trim(),
      slug,
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

async function awardToUser(uid: string, displayName: string) {
  if (!awardBadgeId.value) return;
  const badge = backend.specialBadges.find(b => b.id === awardBadgeId.value);
  await backend.awardBadge(awardBadgeId.value, [uid]);
  awardUserSearch.value = '';
  awardUserResults.value = [];
  awardSuccess.value = `✓ "${badge?.name}" awarded to ${displayName}!`;
  setTimeout(() => { awardSuccess.value = ''; }, 3500);

  if (badge) {
    try {
      await backend.createNotification({
        title: '✨ New Achievement!',
        body: `You earned the "${badge.name}" award!${badge.description ? ' — ' + badge.description : ''}`,
        image_url: badge.image_url || '',
        thumbnail_url: badge.thumbnail_url || '',
        target_type: 'user',
        target_id: uid,
        post_to_chat: false,
      });
    } catch (e) { console.warn('[admin] badge notification failed:', e); }
  }
}

async function awardToGroup() {
  if (!awardBadgeId.value || !awardGroupId.value) return;
  const badge = backend.specialBadges.find(b => b.id === awardBadgeId.value);
  const group = backend.groups.find(g => g.id === awardGroupId.value);
  await backend.awardBadgeToGroup(awardBadgeId.value, awardGroupId.value);
  awardSuccess.value = `✓ "${badge?.name}" awarded to group "${group?.name}"!`;
  setTimeout(() => { awardSuccess.value = ''; }, 3500);
}

function selectBadgeForAward(badgeId: number) {
  awardBadgeId.value = awardBadgeId.value === badgeId ? null : badgeId;
}

onMounted(() => {
  backend.loadGroups();
  backend.loadSpecialBadges();
  backend.loadNotifications();
});
</script>

<template>
  <div class="nge-admin-hub">
    <!-- Sub-tabs -->
    <div class="nge-admin-subtabs">
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'notifications' }" @click="adminSubTab = 'notifications'">Notifications</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'groups' }" @click="adminSubTab = 'groups'">Groups</button>
      <button class="nge-admin-subtab" :class="{ 'nge-admin-subtab--active': adminSubTab === 'badges' }" @click="adminSubTab = 'badges'">Special Badges</button>
    </div>

    <!-- ── Notifications ── -->
    <div v-if="adminSubTab === 'notifications'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">Send Notification</label>
        <input v-model="notifTitle" class="nge-admin-input" placeholder="Title" />
        <textarea v-model="notifBody" class="nge-admin-textarea" rows="3" placeholder="Message body..."></textarea>
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
        <div class="nge-admin-row nge-admin-row--dates">
          <label class="nge-admin-date-label">
            <span>Send at</span>
            <input type="datetime-local" v-model="notifSendAt" class="nge-admin-date-input" />
          </label>
          <label class="nge-admin-date-label">
            <span>Expires at</span>
            <input type="datetime-local" v-model="notifExpiresAt" class="nge-admin-date-input" />
          </label>
        </div>
        <p v-if="!notifSendAt" class="nge-admin-hint">Leave "Send at" empty to send immediately</p>
        <div class="nge-admin-row">
          <label class="nge-admin-check"><input type="checkbox" v-model="notifPostToChat" /> Also post to chat</label>
          <label class="nge-admin-file-label">
            <input type="file" accept="image/*" @change="onNotifImageChange" class="nge-admin-file-input" />
            {{ notifImageFile ? notifImageFile.name : 'Attach image...' }}
          </label>
        </div>
        <button class="nge-admin-primary-btn" :disabled="notifSending || !notifTitle.trim() || !notifBody.trim()" @click="sendNotification">
          <span v-if="notifSent">✓ Sent!</span>
          <span v-else-if="notifSending">Sending...</span>
          <span v-else>Send Notification</span>
        </button>
        <div v-if="notifError" class="nge-admin-error">⚠ {{ notifError }}</div>
      </div>

      <!-- Recent notifications -->
      <div class="nge-admin-block" v-if="backend.notifications.length > 0">
        <label class="nge-admin-label">Recent Notifications</label>
        <div v-for="n in backend.notifications.slice(0, 10)" :key="n.id" class="nge-admin-notif-row">
          <div class="nge-admin-notif-info">
            <strong>{{ n.title }}</strong>
            <span class="nge-admin-notif-meta">{{ n.target_type }} · {{ new Date(n.send_at).toLocaleDateString() }}</span>
          </div>
          <button class="nge-admin-delete-btn" @click="backend.deleteNotification(n.id)" title="Delete">×</button>
        </div>
      </div>
    </div>

    <!-- ── Groups ── -->
    <div v-if="adminSubTab === 'groups'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">Create Group</label>
        <div class="nge-admin-row">
          <input v-model="newGroupName" class="nge-admin-input" placeholder="Group name (e.g. Scythes)" />
          <input v-model="newGroupColor" type="color" class="nge-admin-color" title="Group color" />
          <button class="nge-admin-action-btn" @click="createGroup" :disabled="!newGroupName.trim()">Create</button>
        </div>
      </div>

      <div class="nge-admin-block">
        <label class="nge-admin-label">Manage Groups</label>
        <div class="nge-admin-group-list">
          <button v-for="g in backend.groups" :key="g.id" class="nge-admin-group-chip" :class="{ 'nge-admin-group-chip--active': selectedGroupId === g.id }" :style="{ borderColor: g.color }" @click="selectGroup(g.id)">
            <span class="nge-admin-group-dot" :style="{ background: g.color }"></span>
            {{ g.name }}
          </button>
        </div>

        <div v-if="selectedGroupId" class="nge-admin-members">
          <div class="nge-admin-row">
            <input v-model="memberSearch" @input="onMemberSearch" class="nge-admin-input" placeholder="Search users to add..." />
          </div>
          <div v-if="memberSearchResults.length > 0" class="nge-admin-search-results">
            <button v-for="u in memberSearchResults" :key="u.id" class="nge-admin-search-item" @click="addMember(u.id)">
              + {{ u.display_name || u.email }}
            </button>
          </div>
          <div class="nge-admin-member-list">
            <div v-for="m in groupMembers" :key="m.user_id" class="nge-admin-member-row">
              <span>{{ m.display_name || m.email || m.user_id }}</span>
              <button class="nge-admin-delete-btn" @click="removeMember(m.user_id)">×</button>
            </div>
            <div v-if="groupMembers.length === 0" class="nge-admin-hint">No members yet.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Special Badges ── -->
    <div v-if="adminSubTab === 'badges'" class="nge-admin-section">
      <div class="nge-admin-block">
        <label class="nge-admin-label">Create Special Badge</label>
        <input v-model="badgeName" class="nge-admin-input" placeholder="Badge name" />
        <textarea v-model="badgeDesc" class="nge-admin-textarea" rows="2" placeholder="Description..."></textarea>
        <label class="nge-admin-file-label">
          <input type="file" accept="image/*" @change="onBadgeImageChange" class="nge-admin-file-input" />
          {{ badgeImageFile ? badgeImageFile.name : 'Choose badge image...' }}
        </label>
        <button class="nge-admin-primary-btn" :disabled="badgeCreating || !badgeName.trim() || !badgeImageFile" @click="createBadge">
          <span v-if="badgeCreated">✓ Created!</span>
          <span v-else-if="badgeCreating">Creating...</span>
          <span v-else>Create Badge</span>
        </button>
        <div v-if="badgeError" class="nge-admin-error">⚠ {{ badgeError }}</div>
      </div>

      <div class="nge-admin-block" v-if="backend.specialBadges.length > 0">
        <label class="nge-admin-label">Award Badge <span class="nge-admin-hint" style="font-weight:normal; margin-left:6px">Click a badge to select it</span></label>
        <div class="nge-admin-badge-grid">
          <div v-for="b in backend.specialBadges" :key="b.id"
            class="nge-admin-badge-card" :class="{ 'nge-admin-badge-card--selected': awardBadgeId === b.id }"
            @click="selectBadgeForAward(b.id)" :title="b.description || b.name">
            <img v-if="b.thumbnail_url || b.image_url" :src="b.thumbnail_url || b.image_url" class="nge-admin-badge-img" />
            <div class="nge-admin-badge-name">{{ b.name }}</div>
          </div>
        </div>

        <div v-if="awardSuccess" class="nge-admin-success">{{ awardSuccess }}</div>

        <div v-if="awardBadgeId" class="nge-admin-award-section">
          <p class="nge-admin-hint">Award to individual user:</p>
          <div class="nge-admin-row">
            <input v-model="awardUserSearch" @input="onAwardUserSearch" class="nge-admin-input" placeholder="Search by name or email..." />
          </div>
          <div v-if="awardUserResults.length > 0" class="nge-admin-search-results">
            <button v-for="u in awardUserResults" :key="u.id" class="nge-admin-search-item" @click="awardToUser(u.id, u.display_name || u.email)">
              Award to {{ u.display_name || u.email }}
            </button>
          </div>

          <p class="nge-admin-hint" style="margin-top:10px">Or award to entire group:</p>
          <div class="nge-admin-row">
            <select v-model="awardGroupId" class="nge-admin-select">
              <option :value="null" disabled>Select group...</option>
              <option v-for="g in backend.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <button class="nge-admin-action-btn" :disabled="!awardGroupId" @click="awardToGroup">Award to Group</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nge-admin-hub {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 22px 22px;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.25) transparent;
}
.nge-admin-hub::-webkit-scrollbar { width: 6px; }
.nge-admin-hub::-webkit-scrollbar-track { background: transparent; }
.nge-admin-hub::-webkit-scrollbar-thumb { background: rgba(74, 158, 255, 0.25); border-radius: 3px; }
.nge-admin-hub::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.45); }

/* Sub-tabs */
.nge-admin-subtabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  padding-bottom: 0;
  margin-bottom: 4px;
}
.nge-admin-subtab {
  background: transparent;
  border: none;
  color: #889;
  font-size: 0.85em;
  padding: 6px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
  font-weight: 500;
}
.nge-admin-subtab:hover { background: rgba(255, 255, 255, 0.04); color: #cde; }
.nge-admin-subtab--active {
  color: #e0ecff;
  border-bottom-color: #4a9eff;
}

.nge-admin-section { display: flex; flex-direction: column; gap: 16px; }

.nge-admin-block { display: flex; flex-direction: column; gap: 6px; }

.nge-admin-label {
  font-size: 0.78em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9bb;
  font-weight: 700;
  margin-bottom: 4px;
}

.nge-admin-hint {
  font-size: 0.78em;
  color: #889;
  margin: 0 0 4px;
}

.nge-admin-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 8px 10px;
  outline: none;
  font-family: inherit;
}
.nge-admin-input:focus { border-color: rgba(74, 158, 255, 0.5); }
.nge-admin-input--sm { max-width: 180px; }

.nge-admin-textarea {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 8px 10px;
  resize: vertical;
  font-family: inherit;
  outline: none;
}
.nge-admin-textarea:focus { border-color: rgba(74, 158, 255, 0.5); }

.nge-admin-select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.92em;
  padding: 7px 10px;
  outline: none;
  flex: 1;
  font-family: inherit;
}
.nge-admin-select:focus { border-color: rgba(74, 158, 255, 0.5); }

.nge-admin-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.nge-admin-row--dates { gap: 12px; }

.nge-admin-date-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.74em;
  color: #889;
  flex: 1;
}
.nge-admin-date-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.86em;
  padding: 6px 8px;
  outline: none;
  font-family: inherit;
  /* Without this the browser paints the native calendar glyph (and the picker
     popup) in its light-theme colours — a black icon on our black input, i.e.
     invisible. `color-scheme: dark` switches the whole native widget to dark. */
  color-scheme: dark;
}
/* Belt-and-braces for Chromium: force the picker glyph light even if the UA
   ignores color-scheme on this control. */
.nge-admin-date-input::-webkit-calendar-picker-indicator {
  filter: invert(1) brightness(1.6);
  opacity: 0.75;
  cursor: pointer;
}
.nge-admin-date-input::-webkit-calendar-picker-indicator:hover { opacity: 1; }
.nge-admin-date-input:focus { border-color: rgba(74, 158, 255, 0.5); }

.nge-admin-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #aab;
  font-size: 0.85em;
  cursor: pointer;
}
.nge-admin-check input { accent-color: #4a9eff; }

.nge-admin-file-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(74, 158, 255, 0.04);
  border: 1px dashed rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  padding: 6px 10px;
  color: #aab;
  font-size: 0.85em;
  cursor: pointer;
  flex: 1;
}
.nge-admin-file-label:hover { background: rgba(74, 158, 255, 0.08); }
.nge-admin-file-input { display: none; }

.nge-admin-color {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  padding: 2px;
}

.nge-admin-primary-btn {
  background: rgba(74, 158, 255, 0.15);
  border: 1px solid rgba(74, 158, 255, 0.45);
  color: #e0ecff;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 0.92em;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-start;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
  font-family: inherit;
}
.nge-admin-primary-btn:hover:not(:disabled) {
  background: rgba(74, 158, 255, 0.25);
  border-color: rgba(74, 158, 255, 0.65);
}
.nge-admin-primary-btn:active:not(:disabled) { transform: translateY(1px); }
.nge-admin-primary-btn:disabled { opacity: 0.4; cursor: default; }

.nge-admin-action-btn {
  background: rgba(74, 158, 255, 0.12);
  border: 1px solid rgba(74, 158, 255, 0.35);
  color: #cde;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.85em;
  cursor: pointer;
  transition: background 0.15s;
  font-family: inherit;
}
.nge-admin-action-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.22); }
.nge-admin-action-btn:disabled { opacity: 0.4; cursor: default; }

.nge-admin-delete-btn {
  background: none;
  border: none;
  color: #889;
  font-size: 1.3em;
  cursor: pointer;
  line-height: 1;
  padding: 0 6px;
  transition: color 0.15s;
}
.nge-admin-delete-btn:hover { color: #e55; }

.nge-admin-notif-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  margin-bottom: 4px;
}
.nge-admin-notif-info { display: flex; flex-direction: column; gap: 2px; }
.nge-admin-notif-info strong { font-size: 0.88em; color: #cde; font-weight: 600; }
.nge-admin-notif-meta { font-size: 0.74em; color: #778; }

.nge-admin-group-list { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-admin-group-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  color: #cde;
  font-size: 0.84em;
  padding: 4px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s, border-color 0.15s;
  font-family: inherit;
}
.nge-admin-group-chip:hover { background: rgba(255, 255, 255, 0.08); }
.nge-admin-group-chip--active { background: rgba(74, 158, 255, 0.15); color: #e0ecff; }
.nge-admin-group-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.nge-admin-members { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.nge-admin-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  padding: 4px;
  max-height: 180px;
  overflow-y: auto;
}
.nge-admin-search-item {
  background: rgba(255, 255, 255, 0.04);
  border: none;
  color: #cde;
  font-size: 0.86em;
  padding: 6px 8px;
  border-radius: 4px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
  font-family: inherit;
}
.nge-admin-search-item:hover { background: rgba(74, 158, 255, 0.12); }

.nge-admin-member-list { display: flex; flex-direction: column; gap: 2px; }
.nge-admin-member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  font-size: 0.86em;
  color: #cde;
}

.nge-admin-award-section { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }

.nge-admin-badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
}
.nge-admin-badge-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.nge-admin-badge-card:hover {
  background: rgba(74, 158, 255, 0.08);
  border-color: rgba(74, 158, 255, 0.35);
  transform: translateY(-1px);
}
.nge-admin-badge-card--selected {
  background: rgba(74, 158, 255, 0.15);
  border-color: rgba(74, 158, 255, 0.65);
}
.nge-admin-badge-card--selected .nge-admin-badge-name {
  color: #e0ecff;
}
.nge-admin-badge-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
.nge-admin-badge-name {
  font-size: 0.78em;
  color: #aab;
  text-align: center;
  line-height: 1.2;
}

.nge-admin-success {
  background: rgba(127, 255, 136, 0.08);
  border: 1px solid rgba(127, 255, 136, 0.4);
  color: #aef;
  font-size: 0.86em;
  padding: 8px 10px;
  border-radius: 4px;
  margin-top: 4px;
}

.nge-admin-error {
  background: rgba(229, 85, 85, 0.08);
  border: 1px solid rgba(229, 85, 85, 0.4);
  color: #faa;
  font-size: 0.86em;
  padding: 6px 10px;
  border-radius: 4px;
}
</style>
