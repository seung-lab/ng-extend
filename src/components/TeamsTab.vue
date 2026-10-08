<script setup lang="ts">
/**
 * The Cell Library's Teams tab (util/teams.ts): invitations to answer, the
 * teams a player is on, and teams looking for teammates. A team is two to
 * four players on one cell, whenever each of them can.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { findDatasetByCanonical, canonicalDataset } from '../datasets';
import { team as live, teamAccess } from '../util/team_session';
import {
  teamsState, loadTeams, createTeamFromView, inviteToTeam, answerInvite, setTeamOpen, askToJoin, answerRequest,
  setPartDone, leaveSavedTeam, openTeam, cannotOpen, type SavedTeam,
} from '../util/teams';

const backend = useProofreadingBackendStore();
const myId = computed(() => String(backend.userId || ''));
const allowed = computed(() => teamAccess() !== false);

const invitations = computed(() => teamsState.teams.filter(t => t.mine === 'invited'));
const mine = computed(() => teamsState.teams.filter(t => t.mine === 'joined' && t.status === 'active'));
const asked = computed(() => teamsState.teams.filter(t => t.mine === 'requested'));

const note = ref('');
const noteBad = ref(false);
let noteTimer: any = null;
function say(text: string, bad = false) {
  note.value = text; noteBad.value = bad;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note.value = ''; }, 7000);
}
const busy = ref('');
async function run(key: string, fn: () => Promise<unknown>, done?: string) {
  if (busy.value) return;
  busy.value = key;
  try { await fn(); if (done) say(done); } catch (e: any) { say(e?.message || 'That did not work. Try again.', true); } finally { busy.value = ''; }
}

const datasetName = (t: SavedTeam) => { const d = findDatasetByCanonical(canonicalDataset(t.dataset)); return d ? (d.shortLabel || d.label) : t.dataset; };
const titleOf = (t: SavedTeam) => t.title || (t.segmentId ? 'Cell ' + t.segmentId : 'A cell');
const joined = (t: SavedTeam) => t.members.filter(m => m.state === 'joined');
const waiting = (t: SavedTeam) => t.members.filter(m => m.state !== 'joined');
const myPartDone = (t: SavedTeam) => !!t.members.find(m => m.id === myId.value)?.partDone;
const places = (t: SavedTeam) => Math.max(0, teamsState.max - t.members.length);
const others = (t: SavedTeam) => joined(t).filter(m => m.id !== myId.value).map(m => m.name);

// ── Starting a team on the cell in view ─────────────────────────────────
const newTitle = ref('');
function startFromView() {
  void run('new', async () => { await createTeamFromView(newTitle.value.trim()); newTitle.value = ''; }, 'Team made. Invite a player to begin.');
}

// ── Inviting by name ────────────────────────────────────────────────────
const invitingFor = ref('');
const query = ref('');
const found = ref<{ id: string; display_name: string; username: string }[]>([]);
let searchTimer: any = null;
watch(query, q => {
  clearTimeout(searchTimer);
  if (q.trim().length < 2) { found.value = []; return; }
  searchTimer = setTimeout(async () => {
    const list = await backend.searchUsers(q).catch(() => []);
    const t = teamsState.teams.find(x => x.id === invitingFor.value);
    found.value = list.filter((u: any) => u.id !== myId.value && !t?.members.some(m => m.id === u.id)).slice(0, 6);
  }, 250);
});
function invite(t: SavedTeam, u: { id: string; display_name: string; username: string }) {
  const name = u.username || u.display_name || 'Player';
  void run('invite' + t.id, async () => { await inviteToTeam(t.id, u.id); query.value = ''; found.value = []; invitingFor.value = ''; },
    `${name} is invited. They will see it when they next open the game.`);
}

function open(t: SavedTeam) {
  void run('open' + t.id, () => openTeam(t), 'You are on the team\'s cell. Its marks and chat are loaded.');
}
function leave(t: SavedTeam) {
  if (!window.confirm(`Leave ${titleOf(t)}? The team carries on without you.`)) return;
  void run('leave' + t.id, () => leaveSavedTeam(t.id), 'You left the team.');
}

let timer: any = null;
onMounted(() => { void loadTeams(); timer = setInterval(() => { if (!document.hidden) void loadTeams(); }, 120_000); });
onBeforeUnmount(() => { clearInterval(timer); clearTimeout(noteTimer); });
</script>

<template>
  <div class="nge-teams">
    <div class="nge-teams-intro">
      <div class="nge-teams-title">👥 Teams</div>
      <div class="nge-teams-sub">Two to {{ teamsState.max }} players on one cell, each working when they can. Marks and chat are kept for the team. When anyone completes the cell, everyone on the team gets it.</div>
    </div>

    <div v-if="!teamsState.installed" class="nge-teams-empty">Teams are not switched on yet. They will appear here soon.</div>
    <div v-else-if="!allowed" class="nge-teams-empty">Teams are for players with production access. Finish the Sandbox to get it.</div>
    <template v-else>
      <div v-if="note" class="nge-teams-note" :class="{ 'nge-teams-note--bad': noteBad }" role="status">{{ note }}</div>
      <div v-if="teamsState.error" class="nge-teams-note nge-teams-note--bad">{{ teamsState.error }}</div>

      <!-- Invitations to answer. -->
      <div v-if="invitations.length" class="nge-teams-group">
        <div class="nge-teams-group-label">Invitations</div>
        <div v-for="t in invitations" :key="t.id" class="nge-teams-card nge-teams-card--invite">
          <div class="nge-teams-card-title">{{ titleOf(t) }} <span class="nge-teams-ds">{{ datasetName(t) }}</span></div>
          <div class="nge-teams-line">{{ joined(t).map(m => m.name).join(', ') }} {{ joined(t).length === 1 ? 'invites' : 'invite' }} you to work on this cell together.</div>
          <div class="nge-teams-actions">
            <button type="button" class="nge-teams-btn nge-teams-btn--go" :disabled="!!busy" @click="run('yes' + t.id, () => answerInvite(t.id, true), 'You are on the team.')">Join the team</button>
            <button type="button" class="nge-teams-btn" :disabled="!!busy" @click="run('no' + t.id, () => answerInvite(t.id, false))">No thanks</button>
          </div>
        </div>
      </div>

      <!-- The teams this player is on. -->
      <div class="nge-teams-group">
        <div class="nge-teams-group-label">Your teams</div>
        <div v-if="teamsState.loaded && !mine.length" class="nge-teams-empty">You are not on a team yet. Start one below, or press Team up on a cell you have claimed.</div>
        <div v-for="t in mine" :key="t.id" class="nge-teams-card" :class="{ 'nge-teams-card--live': live.saved === t.id }">
          <div class="nge-teams-card-title">{{ titleOf(t) }} <span class="nge-teams-ds">{{ datasetName(t) }}</span>
            <span v-if="live.saved === t.id" class="nge-teams-tag nge-teams-tag--live">open now</span>
          </div>
          <ul class="nge-teams-members">
            <li v-for="m in joined(t)" :key="m.id" :title="m.partDone ? m.name + ' has marked their part done' : m.name + ' is still working'">
              <span class="nge-teams-tick" :class="{ 'nge-teams-tick--on': m.partDone }" aria-hidden="true">{{ m.partDone ? '✓' : '·' }}</span>
              <span class="nge-teams-name">{{ m.name }}</span>
              <span v-if="m.id === myId" class="nge-teams-tag">you</span>
              <span v-if="live.saved === t.id && m.id !== myId && live.members.some(x => x.id === m.id)" class="nge-teams-tag nge-teams-tag--live">here now</span>
            </li>
            <li v-for="m in waiting(t)" :key="'w' + m.id" class="nge-teams-waiting">
              <span class="nge-teams-tick" aria-hidden="true">…</span>
              <span class="nge-teams-name">{{ m.name }}</span>
              <span class="nge-teams-tag">{{ m.state === 'invited' ? 'invited' : 'asked to join' }}</span>
              <template v-if="m.state === 'requested'">
                <button type="button" class="nge-teams-mini" :disabled="!!busy" @click="run('ok' + t.id + m.id, () => answerRequest(t.id, m.id, true), m.name + ' is on the team.')">Let in</button>
                <button type="button" class="nge-teams-mini" :disabled="!!busy" @click="run('nok' + t.id + m.id, () => answerRequest(t.id, m.id, false))">Not now</button>
              </template>
            </li>
          </ul>
          <div class="nge-teams-actions">
            <button type="button" class="nge-teams-btn nge-teams-btn--go" :disabled="!!busy || !!cannotOpen(t)" :title="cannotOpen(t) || 'Go to the cell with the team\'s marks and chat. Teammates who are in the game now work with you live.'"
                    @click="open(t)">{{ busy === 'open' + t.id ? 'Opening…' : live.saved === t.id ? 'Go to the cell' : 'Open the cell' }}</button>
            <button type="button" class="nge-teams-btn" :class="{ 'nge-teams-btn--on': myPartDone(t) }" :aria-pressed="myPartDone(t) ? 'true' : 'false'" :disabled="!!busy"
                    title="Tells your teammates you have finished the part you were working on. It does not complete the cell."
                    @click="run('part' + t.id, () => setPartDone(t.id, !myPartDone(t)))">{{ myPartDone(t) ? '✓ My part is done' : 'My part is done' }}</button>
          </div>
          <div v-if="cannotOpen(t)" class="nge-teams-line nge-teams-line--dim">{{ cannotOpen(t) }}</div>
          <div class="nge-teams-line nge-teams-line--dim">To finish, any of you completes the cell the usual way. Everyone on the team is credited.</div>
          <div class="nge-teams-foot">
            <template v-if="places(t) > 0">
              <button v-if="invitingFor !== t.id" type="button" class="nge-teams-mini" @click="invitingFor = t.id; query = ''">+ Invite a player</button>
              <template v-else>
                <input v-model="query" class="nge-teams-input" placeholder="Player name" aria-label="Player to invite"
                       @keydown.stop @keyup.stop @keypress.stop @keydown.esc.stop="invitingFor = ''; query = ''" />
                <div v-if="found.length" class="nge-teams-found">
                  <button v-for="u in found" :key="u.id" type="button" class="nge-teams-mini" @click="invite(t, u)">{{ u.username || u.display_name }}</button>
                </div>
                <div v-else-if="query.trim().length >= 2" class="nge-teams-line nge-teams-line--dim">No player by that name.</div>
              </template>
              <label class="nge-teams-open" title="Shows this team under 'Teams looking for teammates', where any player with production access can ask to join. You choose who is let in.">
                <input type="checkbox" :checked="t.open" :disabled="!!busy" @change="run('open?' + t.id, () => setTeamOpen(t.id, !t.open))" />
                <span>Looking for teammates</span>
              </label>
            </template>
            <span v-else class="nge-teams-line nge-teams-line--dim">The team is full ({{ teamsState.max }} players).</span>
            <button type="button" class="nge-teams-mini nge-teams-mini--leave" :disabled="!!busy" @click="leave(t)">Leave</button>
          </div>
        </div>
        <div v-for="t in asked" :key="t.id" class="nge-teams-card nge-teams-card--asked">
          <div class="nge-teams-card-title">{{ titleOf(t) }} <span class="nge-teams-ds">{{ datasetName(t) }}</span></div>
          <div class="nge-teams-line nge-teams-line--dim">You asked to join. The team will answer when they are next in the game.</div>
          <div class="nge-teams-actions"><button type="button" class="nge-teams-mini" :disabled="!!busy" @click="run('undo' + t.id, () => leaveSavedTeam(t.id))">Take it back</button></div>
        </div>
      </div>

      <!-- Start one on the cell in view. -->
      <div class="nge-teams-group">
        <div class="nge-teams-group-label">Start a team</div>
        <div class="nge-teams-card nge-teams-card--new">
          <div class="nge-teams-line">Show the one cell you want to work on, then start a team on it. You can also press <b>Team up</b> on a cell you have claimed in My Cells.</div>
          <div class="nge-teams-new">
            <input v-model="newTitle" class="nge-teams-input" maxlength="80" placeholder="A name for it (optional)" aria-label="A name for the team"
                   @keydown.stop @keyup.stop @keypress.stop @keydown.enter.prevent.stop="startFromView" />
            <button type="button" class="nge-teams-btn nge-teams-btn--go" :disabled="!!busy" @click="startFromView">{{ busy === 'new' ? 'Starting…' : 'Team up on this cell' }}</button>
          </div>
        </div>
      </div>

      <!-- Teams anyone can ask to join. -->
      <div class="nge-teams-group">
        <div class="nge-teams-group-label">Teams looking for teammates</div>
        <div v-if="teamsState.loaded && !teamsState.open.length" class="nge-teams-empty">None right now.</div>
        <div v-for="t in teamsState.open" :key="t.id" class="nge-teams-card">
          <div class="nge-teams-card-title">{{ titleOf(t) }} <span class="nge-teams-ds">{{ datasetName(t) }}</span></div>
          <div class="nge-teams-line">{{ joined(t).map(m => m.name).join(', ') }} · {{ places(t) }} {{ places(t) === 1 ? 'place' : 'places' }} left</div>
          <div class="nge-teams-actions">
            <button type="button" class="nge-teams-btn nge-teams-btn--go" :disabled="!!busy" @click="run('ask' + t.id, () => askToJoin(t.id), 'Asked. The team will answer when they are next in the game.')">Ask to join</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
.nge-teams { padding: 4px 2px 10px; font-size: 12.5px; color: #dbe7f7; }
.nge-teams-intro { margin-bottom: 8px; }
.nge-teams-title { font-family: 'Orbitron', 'Inter', sans-serif; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #9fe8c0; margin-bottom: 3px; }
.nge-teams-sub { color: #9fb0c8; line-height: 1.4; }
.nge-teams-group { margin-top: 12px; }
.nge-teams-group-label { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #7f93b0; margin-bottom: 5px; }
.nge-teams-card { background: rgba(10, 16, 30, 0.75); border: 1px solid rgba(90, 170, 255, 0.22); border-radius: 8px; padding: 8px 9px; margin-bottom: 6px; }
.nge-teams-card--invite { border-color: rgba(93, 255, 160, 0.5); background: rgba(20, 44, 34, 0.5); }
.nge-teams-card--live { border-color: rgba(93, 255, 160, 0.6); }
.nge-teams-card--asked, .nge-teams-card--new { border-style: dashed; }
.nge-teams-card-title { font-weight: 600; color: #eaf4ff; margin-bottom: 4px; overflow-wrap: anywhere; }
.nge-teams-ds { font-weight: 400; font-size: 11px; color: #7f93b0; margin-left: 4px; }
.nge-teams-line { line-height: 1.4; margin: 3px 0; }
.nge-teams-line--dim { color: #8ea0ba; font-size: 11.5px; }
.nge-teams-members { list-style: none; margin: 2px 0 6px; padding: 0; }
.nge-teams-members li { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.nge-teams-waiting { color: #8ea0ba; }
.nge-teams-tick { width: 14px; text-align: center; color: #5a6c88; }
.nge-teams-tick--on { color: #5dffa0; }
.nge-teams-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-teams-tag { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: #8ea0ba; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 8px; padding: 0 5px; white-space: nowrap; }
.nge-teams-tag--live { color: #9fe8c0; border-color: rgba(93, 255, 160, 0.45); }
.nge-teams-actions { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0 3px; }
.nge-teams-btn, .nge-teams-mini { background: rgba(0, 0, 0, 0.28); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px; color: #cfdcef; font: inherit; font-size: 12px; padding: 4px 9px; cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s; }
.nge-teams-mini { font-size: 11px; padding: 2px 7px; }
.nge-teams-btn:hover:not(:disabled), .nge-teams-mini:hover:not(:disabled) { border-color: rgba(120, 190, 255, 0.6); }
.nge-teams-btn:focus-visible, .nge-teams-mini:focus-visible, .nge-teams-input:focus-visible { outline: 2px solid #6cf; outline-offset: 1px; }
.nge-teams-btn:disabled, .nge-teams-mini:disabled { opacity: 0.55; cursor: default; }
.nge-teams-btn--go { background: rgba(70, 160, 255, 0.2); border-color: rgba(120, 190, 255, 0.7); color: #eaf4ff; }
.nge-teams-btn--on { background: rgba(93, 255, 160, 0.16); border-color: rgba(93, 255, 160, 0.7); color: #d8ffe9; }
.nge-teams-mini--leave { margin-left: auto; color: #ffb3b3; border-color: rgba(255, 120, 120, 0.3); }
.nge-teams-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.07); }
.nge-teams-open { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #9fb0c8; cursor: pointer; }
.nge-teams-open input { accent-color: #4a9eff; margin: 0; }
.nge-teams-input { flex: 1; min-width: 110px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px; color: #eaf4ff; font: inherit; font-size: 12px; padding: 4px 7px; }
.nge-teams-found { display: flex; flex-wrap: wrap; gap: 4px; width: 100%; }
.nge-teams-new { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.nge-teams-empty { color: #8ea0ba; font-size: 12px; padding: 4px 2px; }
.nge-teams-note { background: rgba(93, 255, 160, 0.1); border: 1px solid rgba(93, 255, 160, 0.35); border-radius: 6px; color: #c9f7dd; padding: 5px 8px; margin: 6px 0; }
.nge-teams-note--bad { background: rgba(255, 120, 120, 0.1); border-color: rgba(255, 120, 120, 0.4); color: #ffd0d0; }
</style>
