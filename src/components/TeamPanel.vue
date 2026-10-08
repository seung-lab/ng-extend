<script setup lang="ts">
/**
 * The on-screen part of Mentor mode and Team mode (util/team_session.ts):
 * the invitation a player answers, and a slim strip listing who is in the
 * session, with Jump to, Follow, Invite and Leave. Nothing shows while a
 * player is in no session and has no invitation.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { team, startTeamInbox, startTeam, invite, acceptInvite, declineInvite, leaveTeam, jumpTo, follow, sendTeamChat, TEAM_CHAT_MAX } from '../util/team_session';
import { findDatasetByCanonical } from '../datasets';
import { teamsState, startTeams, teamSeen, type SavedTeam } from '../util/teams';

const backend = useProofreadingBackendStore();
// Signed in: listen for invitations (and rejoin a session a reload interrupted).
watch(() => backend.userId, id => { if (id) { startTeamInbox(); startTeams(); } }, { immediate: true });

const myId = computed(() => String(backend.userId || ''));
const title = computed(() => team.mode === 'mentor' ? 'Mentor session' : 'Team');
const datasetName = (canon: string) => { const d = findDatasetByCanonical(canon); return d ? (d.shortLabel || d.label) : ''; };

// ── Invite a player by name ─────────────────────────────────────────────
const inviting = ref(false);
const query = ref('');
const found = ref<{ id: string; display_name: string; username: string }[]>([]);
let searchTimer: any = null;
watch(query, q => {
  clearTimeout(searchTimer);
  if (q.trim().length < 2) { found.value = []; return; }
  searchTimer = setTimeout(async () => {
    const list = await backend.searchUsers(q).catch(() => []);
    found.value = list.filter(u => u.id !== myId.value && !team.members.some(m => m.id === u.id)).slice(0, 6);
  }, 250);
});
async function inviteUser(u: { id: string; display_name: string; username: string }) {
  await invite({ id: u.id, name: u.username || u.display_name || 'Player' }, team.mode);
  query.value = ''; found.value = []; inviting.value = false;
}

// ── The team celebration ────────────────────────────────────────────────
// A saved team's cell was completed, by this player or by a teammate while
// this player was away. It shows once, to each member (Ames 2026-10-07:
// "offline player gets notif and special cell complete celebration for team").
const celebrating = computed<SavedTeam | null>(() => teamsState.teams.find(t => t.status === 'completed' && t.celebrate) || null);
const celebrationMates = computed(() => (celebrating.value?.members || []).filter(m => m.state === 'joined'));
const iCompletedIt = computed(() => !!celebrating.value && celebrating.value.completedBy === myId.value);
const completerName = computed(() => celebrationMates.value.find(m => m.id === celebrating.value?.completedBy)?.name || 'A teammate');
const closingCelebration = ref(false);
async function closeCelebration() {
  const t = celebrating.value;
  if (!t || closingCelebration.value) return;
  closingCelebration.value = true;
  try { await teamSeen(t.id); } catch { t.celebrate = false; } finally { closingCelebration.value = false; }
}

// ── Team chat: only the people in this session, nothing stored ──────────
const chatOpen = ref(true);
const chatText = ref('');
const chatList = ref<HTMLElement | null>(null);
function sayToTeam() {
  if (sendTeamChat(chatText.value)) chatText.value = '';
}
watch(() => team.chat.length, () => {
  if (chatOpen.value) team.unread = 0;
  void nextTick(() => { const el = chatList.value; if (el) el.scrollTop = el.scrollHeight; });
});
watch(chatOpen, open => { if (open) { team.unread = 0; void nextTick(() => { const el = chatList.value; if (el) el.scrollTop = el.scrollHeight; }); } });

// "Team up" elsewhere in the game opens a session with the invite box ready.
document.addEventListener('nge:team-start', (async () => {
  if (await startTeam()) inviting.value = true;
}) as EventListener);
</script>

<template>
  <Teleport to="body">
    <!-- An invitation waiting for an answer. -->
    <div v-if="team.invites.length" class="nge-team-invites" role="alertdialog" aria-label="Session invitations">
      <div v-for="inv in team.invites" :key="inv.room + inv.from.id" class="nge-team-invite">
        <div class="nge-team-invite-title">{{ inv.mode === 'mentor' ? 'Offer of help' : 'Team invitation' }}</div>
        <div class="nge-team-invite-text">
          <template v-if="inv.mode === 'mentor'"><b>{{ inv.from.name }}</b> would like to join your view and help.</template>
          <template v-else><b>{{ inv.from.name }}</b> invites you to work on a cell together<span v-if="datasetName(inv.dataset)"> in {{ datasetName(inv.dataset) }}</span>.</template>
        </div>
        <div v-if="inv.note" class="nge-team-invite-note">{{ inv.note }}</div>
        <div class="nge-team-invite-hint">
          {{ inv.mode === 'mentor' ? 'They will see the cell and the marks in your view, and where you are looking.' : 'Your view will change to the team\'s cell. Marks you draw are shared with the team.' }}
        </div>
        <div class="nge-team-invite-actions">
          <button type="button" class="nge-team-btn nge-team-btn--go" @click="acceptInvite(inv)">Accept</button>
          <button type="button" class="nge-team-btn" @click="declineInvite(inv)">Decline</button>
        </div>
      </div>
    </div>

    <!-- A saved team finished its cell. -->
    <div v-if="celebrating" class="nge-team-party" role="alertdialog" aria-label="Team cell complete" @keydown.esc="closeCelebration">
      <div class="nge-team-party-card">
        <div class="nge-team-party-burst" aria-hidden="true"><i v-for="n in 14" :key="n" :style="{ '--i': n }"></i></div>
        <div class="nge-team-party-kicker">Team cell complete</div>
        <div class="nge-team-party-title">{{ celebrating.title || 'You did it together' }}</div>
        <div class="nge-team-party-mates">
          <span v-for="m in celebrationMates" :key="m.id" class="nge-team-party-mate" :class="{ 'nge-team-party-mate--you': m.id === myId }">{{ m.id === myId ? 'You' : m.name }}</span>
        </div>
        <div class="nge-team-party-text">
          <template v-if="iCompletedIt">You completed the cell your team was working on. Everyone on the team gets it.</template>
          <template v-else>{{ completerName }} completed the cell your team was working on. It counts for you too.</template>
        </div>
        <button type="button" class="nge-team-btn nge-team-btn--go" :disabled="closingCelebration" @click="closeCelebration">For science</button>
      </div>
    </div>

    <!-- The session strip. -->
    <div v-if="team.room" class="nge-team-strip" role="region" :aria-label="title">
      <div class="nge-team-head">
        <span class="nge-team-live" aria-hidden="true"></span>
        <span class="nge-team-title">{{ title }}</span>
        <button type="button" class="nge-team-btn nge-team-btn--leave" title="Leave this session. Your own view stays as it is." @click="leaveTeam()">Leave</button>
      </div>
      <ul class="nge-team-members">
        <li v-for="m in team.members" :key="m.id" class="nge-team-member">
          <span class="nge-team-dot" :style="{ background: m.color }" aria-hidden="true"></span>
          <span class="nge-team-name" :title="m.name">{{ m.name }}</span>
          <span v-if="m.id === myId" class="nge-team-tag">you</span>
          <span v-else-if="m.id === team.leader && team.mode === 'mentor'" class="nge-team-tag">leading</span>
          <template v-if="m.id !== myId">
            <button type="button" class="nge-team-mini" :disabled="!m.pos" title="Move your view to where they are" @click="jumpTo(m.id)">Jump</button>
            <button type="button" class="nge-team-mini" :class="{ 'nge-team-mini--on': team.following === m.id }"
                    :aria-pressed="team.following === m.id ? 'true' : 'false'"
                    :title="team.following === m.id ? 'Stop following. Your view is yours again.' : 'Your view follows theirs as they move'"
                    @click="follow(m.id)">{{ team.following === m.id ? 'Following' : 'Follow' }}</button>
          </template>
        </li>
        <li v-for="w in team.waiting" :key="'w' + w.id" class="nge-team-member nge-team-member--waiting">
          <span class="nge-team-dot nge-team-dot--waiting" aria-hidden="true"></span>
          <span class="nge-team-name">{{ w.name }}</span>
          <span class="nge-team-tag">invited</span>
        </li>
      </ul>
      <div v-if="team.members.length < 2 && !team.waiting.length" class="nge-team-empty">Nobody else is here yet. Invite a player to begin.</div>
      <div class="nge-team-invitebox">
        <button v-if="!inviting" type="button" class="nge-team-btn" @click="inviting = true">+ Invite a player</button>
        <template v-else>
          <input v-model="query" class="nge-team-input" placeholder="Player name" aria-label="Player to invite"
                 @keydown.stop @keyup.stop @keypress.stop @keydown.esc.stop="inviting = false; query = ''" />
          <div v-if="found.length" class="nge-team-found">
            <button v-for="u in found" :key="u.id" type="button" class="nge-team-found-item" @click="inviteUser(u)">{{ u.username || u.display_name }}</button>
          </div>
          <div v-else-if="query.trim().length >= 2" class="nge-team-empty">No player by that name.</div>
        </template>
      </div>
      <!-- Team chat. -->
      <div class="nge-team-chat">
        <button type="button" class="nge-team-chat-head" :aria-expanded="chatOpen ? 'true' : 'false'" @click="chatOpen = !chatOpen">
          <span>{{ team.mode === 'mentor' ? 'Help chat' : 'Team chat' }}</span>
          <span v-if="!chatOpen && team.unread" class="nge-team-chat-unread">{{ team.unread }}</span>
          <span class="nge-team-chat-caret" aria-hidden="true">{{ chatOpen ? '▾' : '▸' }}</span>
        </button>
        <template v-if="chatOpen">
          <div ref="chatList" class="nge-team-chat-list" role="log" aria-live="polite">
            <div v-if="!team.chat.length" class="nge-team-empty">Only the people in this session see what is said here. Nothing is saved.</div>
            <div v-for="(c, i) in team.chat" :key="i" class="nge-team-chat-line">
              <b :style="{ color: c.color }">{{ c.by === myId ? 'You' : c.name }}</b> <span>{{ c.text }}</span>
            </div>
          </div>
          <input v-model="chatText" class="nge-team-input" :placeholder="team.mode === 'mentor' ? 'Message each other' : 'Message your team'" aria-label="Message this session" :maxlength="TEAM_CHAT_MAX"
                 enterkeyhint="send" @keydown.stop @keyup.stop @keypress.stop @keydown.enter.prevent.stop="sayToTeam" />
        </template>
      </div>
      <div class="nge-team-foot">The cell, every annotation layer and where you are looking are shared with this session.</div>
    </div>
  </Teleport>
</template>

<style>
.nge-team-invites {
  position: fixed; top: 64px; left: 50%; transform: translateX(-50%);
  z-index: 10050; display: flex; flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 32px));
}
.nge-team-invite, .nge-team-strip {
  background: rgba(8, 13, 26, 0.97);
  border: 1px solid rgba(90, 170, 255, 0.45);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  color: #dbe7f7;
  font-family: 'Inter', system-ui, sans-serif;
}
.nge-team-invite { padding: 12px 14px; }
.nge-team-invite-title { font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #7cc4ff; margin-bottom: 6px; }
.nge-team-invite-text { font-size: 13.5px; line-height: 1.4; }
.nge-team-invite-note { margin-top: 6px; font-size: 12px; color: #a9bbd3; border-left: 2px solid rgba(120, 190, 255, 0.4); padding-left: 8px; }
.nge-team-invite-hint { margin-top: 6px; font-size: 11.5px; color: #8fa3bf; line-height: 1.4; }
.nge-team-invite-actions { display: flex; gap: 8px; margin-top: 10px; }

.nge-team-strip {
  /* Top left of the viewer, clear of the chat and the coordinates at the bottom. */
  position: fixed; left: 12px; top: 112px; z-index: 900;
  width: 232px; padding: 9px 10px 8px;
}
.nge-team-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.nge-team-party { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; background: rgba(2, 6, 14, 0.62); }
.nge-team-party-card { position: relative; width: min(420px, calc(100vw - 32px)); padding: 26px 24px 20px; text-align: center; overflow: hidden;
  background: radial-gradient(120% 90% at 50% 0%, rgba(40, 110, 90, 0.55), rgba(8, 13, 26, 0) 62%), #080d1a; border: 1px solid rgba(93, 255, 160, 0.6); border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(93, 255, 160, 0.12), 0 18px 60px rgba(0, 0, 0, 0.7), 0 0 60px rgba(93, 255, 160, 0.18); color: #eaf4ff; font-family: 'Inter', system-ui, sans-serif;
  animation: nge-team-party-in 0.5s cubic-bezier(0.2, 1.3, 0.4, 1) both; }
.nge-team-party-kicker { font-family: 'Orbitron', 'Inter', sans-serif; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: #9fe8c0; }
.nge-team-party-title { font-size: 21px; font-weight: 700; margin: 8px 0 12px; overflow-wrap: anywhere; }
.nge-team-party-mates { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-bottom: 12px; }
.nge-team-party-mate { border: 1px solid rgba(93, 255, 160, 0.5); background: rgba(93, 255, 160, 0.12); color: #d8ffe9; border-radius: 999px; padding: 3px 11px; font-size: 13px;
  animation: nge-team-party-mate 0.45s ease-out both; }
.nge-team-party-mate:nth-child(2) { animation-delay: 0.12s; } .nge-team-party-mate:nth-child(3) { animation-delay: 0.24s; } .nge-team-party-mate:nth-child(4) { animation-delay: 0.36s; }
.nge-team-party-mate--you { border-color: rgba(120, 190, 255, 0.7); background: rgba(70, 160, 255, 0.18); color: #eaf4ff; }
.nge-team-party-text { color: #c6d5ea; font-size: 13.5px; line-height: 1.45; margin-bottom: 16px; }
.nge-team-party-burst { position: absolute; left: 50%; top: 34px; width: 0; height: 0; pointer-events: none; }
.nge-team-party-burst i { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: hsl(calc(140 + var(--i) * 14), 90%, 68%);
  transform: rotate(calc(var(--i) * 25.7deg)) translateY(0); opacity: 0; animation: nge-team-party-spark 1.1s ease-out 0.15s both; }
@keyframes nge-team-party-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes nge-team-party-mate { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes nge-team-party-spark { 0% { transform: rotate(calc(var(--i) * 25.7deg)) translateY(0); opacity: 1; } 100% { transform: rotate(calc(var(--i) * 25.7deg)) translateY(-150px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .nge-team-party-card, .nge-team-party-mate, .nge-team-party-burst i { animation: none; } .nge-team-party-burst { display: none; } }
.nge-team-chat { margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 6px; }
.nge-team-chat-head { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: 0; padding: 0 0 4px; color: #9fb3cc; font: inherit; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; }
.nge-team-chat-head:focus-visible { outline: 2px solid #6cf; outline-offset: 2px; }
.nge-team-chat-caret { margin-left: auto; opacity: 0.7; }
.nge-team-chat-unread { background: #ff7aa8; color: #1a0a12; border-radius: 9px; padding: 0 6px; font-size: 10.5px; }
.nge-team-chat-list { max-height: 150px; overflow-y: auto; margin-bottom: 5px; font-size: 12.5px; line-height: 1.35; }
.nge-team-chat-line { padding: 1px 0; overflow-wrap: anywhere; }
.nge-team-chat-line span { color: #dbe7f7; }
.nge-team-live { width: 7px; height: 7px; border-radius: 50%; background: #5dffa0; box-shadow: 0 0 6px #5dffa0; flex-shrink: 0; }
.nge-team-title { font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #7cc4ff; flex: 1; }
.nge-team-members { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.nge-team-member { display: flex; align-items: center; gap: 6px; font-size: 12.5px; min-height: 24px; }
.nge-team-member--waiting { opacity: 0.65; }
.nge-team-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.nge-team-dot--waiting { background: transparent; border: 1px dashed #8fa3bf; }
.nge-team-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-team-tag { font-size: 10px; color: #8fa3bf; border: 1px solid rgba(143, 163, 191, 0.35); border-radius: 8px; padding: 0 6px; flex-shrink: 0; }
.nge-team-btn, .nge-team-mini, .nge-team-found-item {
  background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px;
  color: #cfdcef; font: inherit; cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.nge-team-btn { font-size: 12px; padding: 5px 11px; }
.nge-team-btn--go { background: rgba(70, 160, 255, 0.25); border-color: rgba(120, 190, 255, 0.8); color: #eaf4ff; }
.nge-team-btn--leave { font-size: 11px; padding: 2px 8px; }
.nge-team-mini { font-size: 10.5px; padding: 1px 6px; flex-shrink: 0; }
.nge-team-mini:disabled { opacity: 0.4; cursor: default; }
.nge-team-mini--on { background: rgba(93, 255, 160, 0.18); border-color: rgba(93, 255, 160, 0.7); color: #d9ffe9; }
.nge-team-btn:hover, .nge-team-mini:not(:disabled):hover, .nge-team-found-item:hover { border-color: rgba(120, 190, 255, 0.7); }
.nge-team-btn:focus-visible, .nge-team-mini:focus-visible, .nge-team-found-item:focus-visible, .nge-team-input:focus-visible { outline: 2px solid #6cf; outline-offset: 1px; }
.nge-team-invitebox { margin-top: 7px; }
.nge-team-input {
  width: 100%; box-sizing: border-box; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px; color: #e6eefb; font: inherit; font-size: 12px; padding: 5px 8px;
}
.nge-team-found { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.nge-team-found-item { text-align: left; font-size: 12px; padding: 4px 8px; }
.nge-team-empty { font-size: 11.5px; color: #8fa3bf; margin-top: 5px; }
.nge-team-foot { margin-top: 7px; font-size: 10.5px; color: #7f92ad; line-height: 1.35; }
@media (max-width: 700px) { .nge-team-strip { left: 8px; top: 96px; width: 208px; } }
</style>
