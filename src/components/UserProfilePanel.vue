<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted, watch, nextTick} from 'vue';
import {supabase} from '../supabase';
import {pendingAnnotations, sentAnnotations, loadAnnotationTotal} from '../util/annotation_counter';
import {listQuests, nameKey as questNameKey} from '../annotation_quests';
import {nextDayMilestone} from '../util/day_milestones';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';
import AdminHub from 'components/AdminHub.vue';
import BlogEditor from 'components/BlogEditor.vue';
import { startDatasetTransition } from '../util/dataset_transition';
import { loadContribution, showsAllStats, datasetTagVariants as sharedTagVariants } from '../util/dataset_contribution';
import { datasetKey } from '../util/completion_rule';
import WeeklyRecapPanel from 'components/WeeklyRecapPanel.vue';
import DatasetStatsPanel from 'components/DatasetStatsPanel.vue';
import SettingsPanel from 'components/SettingsPanel.vue';
import RollUp from 'components/RollUp.vue';
import EffortCurve from 'components/EffortCurve.vue';
import {loadRepoStats, BUILDER_USER_ID, type RepoStats} from '../util/repo_stats';
import {getToolbarIconDef} from '../data/toolbar-icons';
// The same drawing the top bar uses for Week in Science (Ames 2026-10-05).
const recapIconSvg = getToolbarIconDef('recap')?.svg || '';
import MyCellsTab from 'components/MyCellsTab.vue';
import { isMobileRef } from '../util/mobile';

import {useLoginStore, useUserStatsStore, useUserPreferencesStore, useCellHistoryStore, useProofreadingBackendStore, useHelpRequestStore, CellHistoryEntry} from '../store';
import {BADGE_DEFINITIONS, BUILDING_BADGES, EXPLORATION_BADGES, LOYALTY_BADGES, BadgeDefinition, BadgeTrack, statKeyForTrack, unitForTrack} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {DATASETS, DatasetEntry, SPECIES_ICONS, segLayerName, canonicalDataset, currentSegLayerName, switchToDataset, isDatasetShown} from '../datasets';
import {useIssueTagStore, type IssueTag} from '../store';
import {EYEWIRE_FLAG} from '../data/countries';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';
import goldCup from '../../static/images/champions/gold-cup.png';
import silverCup from '../../static/images/champions/silver-cup.png';
import bronzeCup from '../../static/images/champions/bronze-cup.png';
import goldAward from '../../static/images/champions/gold-award.png';
import silverAward from '../../static/images/champions/silver-award.png';
import bronzeAward from '../../static/images/champions/bronze-award.png';
import goldYearAward from '../../static/images/champions/gold-year-award.png';
import silverYearAward from '../../static/images/champions/silver-year-award.png';
import bronzeYearAward from '../../static/images/champions/bronze-year-award.png';
import goldYearTrophy from '../../static/images/champions/gold-year-trophy.png';
import silverYearTrophy from '../../static/images/champions/silver-year-trophy.png';
import bronzeYearTrophy from '../../static/images/champions/bronze-year-trophy.png';

// ── Props ─────────────────────────────────────────────────────────────────────
const props = defineProps<{
  viewUserId?: string | null;
  initialTab?: string | null;
}>();

// ── Stores ────────────────────────────────────────────────────────────────────
const {sessions} = storeToRefs(useLoginStore());
const statsStore  = useUserStatsStore();
const {stats}     = storeToRefs(statsStore);
const prefsStore  = useUserPreferencesStore();
const {prefs}     = storeToRefs(prefsStore);
const historyStore = useCellHistoryStore();
const {cells: cellHistory} = storeToRefs(historyStore);

const backendStore = useProofreadingBackendStore();

// ── Viewing another user's profile ────────────────────────────────────────────
const viewingOtherUser = computed(() => !!props.viewUserId && props.viewUserId !== backendStore.userId);

// ── More datasets: optional volumes this player turned on ───────────────────
const extraOn = (id: string) => (prefsStore.prefs.extraDatasets || []).includes(id);
function toggleExtra(id: string, ev: Event) {
  const on = (ev.target as HTMLInputElement).checked;
  const set = new Set(prefsStore.prefs.extraDatasets || []);
  if (on) set.add(id); else set.delete(id);
  prefsStore.save({ extraDatasets: [...set] });  // saved to the account too
}
const otherUserProfile = ref<any>(null);
// ── Building Pyr: commits and deploys, on Ames's own profile (2026-10-10) ──
const repoStats = ref<RepoStats | null>(null);
const showsBuilding = computed(() => (props.viewUserId || backendStore.userId) === BUILDER_USER_ID);
watch(showsBuilding, on => { if (on && !repoStats.value) void loadRepoStats().then(s => { repoStats.value = s; }); }, { immediate: true });
// ── Days track: total days shown up, the streaks, and the milestone ladder ──
const otherDays = ref<number | null>(null);
const totalDays = computed(() => viewingOtherUser.value ? (otherDays.value ?? 0) : (stats.value.totalDays || 0));
const dayStreak = computed(() => viewingOtherUser.value ? (otherUserProfile.value?.current_streak || 0) : (stats.value.currentStreak || 0));
const bestDayStreak = computed(() => viewingOtherUser.value ? (otherUserProfile.value?.longest_streak || 0) : (stats.value.longestStreak || 0));
const nextDay = computed(() => nextDayMilestone(totalDays.value));
// Quests completed (Ames 2026-10-13: "I don't see Quests in Profile"): the
// quest sheet's rows that carry this player's name and a status, read
// through the quest sheet function. The sheet is the only record of a quest
// so far, so this is a count from it, not a game table; null means it could
// not be read, and the profile then says so rather than showing 0.
const questsCompleted = ref<number | null>(null);
async function loadQuestsCompleted(who?: string | null) {
  questsCompleted.value = null;
  try {
    const r = await listQuests();
    const key = questNameKey(who ?? r.you);
    questsCompleted.value = key ? r.rows.filter(x => x.status && questNameKey(x.annotator) === key).length : 0;
  } catch { questsCompleted.value = null; }
}
// Annotations placed: their total, or mine plus what this browser has yet to send.
const otherAnnotations = ref<number | null>(null);
const annotationsPlaced = computed(() => viewingOtherUser.value ? (otherAnnotations.value ?? 0) : sentAnnotations.value + pendingAnnotations.value);

// Declared before loadOtherUser runs: for a signed out visitor loadPodium
// reaches these with no wait in between, and they did not exist yet.
const podium = ref<{ gold: number; silver: number; bronze: number }>({ gold: 0, silver: 0, bronze: 0 });
const podiumCompletions = ref<{ gold: number; silver: number; bronze: number }>({ gold: 0, silver: 0, bronze: 0 });
async function loadOtherUser() {
  if (viewingOtherUser.value && props.viewUserId) {
    // Going from one player's profile to another: the first one's numbers
    // must not stand in while the second loads.
    if (otherUserProfile.value && otherUserProfile.value.id !== props.viewUserId) otherUserProfile.value = null;
    otherUserProfile.value = await backendStore.loadUserProfile(props.viewUserId);
    void backendStore.loadSavedAwards([props.viewUserId]);
    otherSilver.value = [];
    void backendStore.loadSilverBadges(props.viewUserId).then(l => { otherSilver.value = l; });
    otherBronze.value = [];
    void backendStore.loadBronzeBadges(props.viewUserId).then(l => { otherBronze.value = l; });
    otherTrophyOrder.value = [];
    void backendStore.loadTrophyOrder(props.viewUserId).then(l => { otherTrophyOrder.value = l; });
    otherAnnotations.value = null;
    void loadAnnotationTotal(props.viewUserId).then(n => { otherAnnotations.value = n; });
    otherDays.value = null;
    void backendStore.loadDayTotal(props.viewUserId).then(n => { otherDays.value = n; });
    void loadQuestsCompleted(otherUserProfile.value?.display_name || null);
  } else {
    otherUserProfile.value = null;
    backendStore.loadUserStats();
    if (backendStore.userId) void loadQuestsCompleted();
  }
  // Load podium counts for whichever user we're showing
  await loadPodium();
}
loadOtherUser();
// Clicking another name while a profile is open swaps the profile shown.
watch(() => props.viewUserId, () => { void loadOtherUser(); });
// Your own awards are read again each time the profile opens: they were read
// once at sign in, so one given during the session (a group award included)
// stayed hidden until a reload (Ames 2026-10-16, Alpha 20).
onMounted(() => { if (!props.viewUserId) void backendStore.loadMySpecialBadges(); });

// ── Weekly podium counts (🥇/🥈/🥉) ─────────────────────────────────
// Two podiums: edits (split+merge wins) and completions (cell-mark wins).
// loadPodium fetches both metrics in parallel; the UI tile is hidden when
// a metric has no podium history.
async function loadPodium() {
  const id = (viewingOtherUser.value ? props.viewUserId : backendStore.userId) || '';
  if (!id) {
    podium.value = { gold: 0, silver: 0, bronze: 0 };
    podiumCompletions.value = { gold: 0, silver: 0, bronze: 0 };
    return;
  }
  const [edits, completions] = await Promise.all([
    backendStore.loadWeeklyPodium(id, 'edits'),
    backendStore.loadWeeklyPodium(id, 'completions'),
  ]);
  podium.value = edits;
  podiumCompletions.value = completions;
}
const podiumTotal = computed(() => podium.value.gold + podium.value.silver + podium.value.bronze);
const podiumCompletionsTotal = computed(() =>
  podiumCompletions.value.gold + podiumCompletions.value.silver + podiumCompletions.value.bronze);
const anyPodium = computed(() => podiumTotal.value + podiumCompletionsTotal.value > 0);

// Profile display name & email — works for both self and other users
const profileName = computed(() => {
  if (viewingOtherUser.value && otherUserProfile.value) return otherUserProfile.value.display_name || 'Anonymous';
  if (viewingOtherUser.value) return '';   // still loading: never the reader's own name
  return backendStore.userName || sessions.value?.[0]?.name || 'Researcher';
});
// NOTE: a `profileEmail` computed used to live here and was rendered on the
// profile. Removed rather than merely hidden — it resolved the email of
// whichever user's profile was open, so clicking a name in chat revealed that
// person's address. The username is the public identifier now.
/** Chat handle. Empty until the user sets one — the row is hidden in that case. */
const profileUsername = computed(() => {
  if (viewingOtherUser.value && otherUserProfile.value) return otherUserProfile.value.username || '';
  if (viewingOtherUser.value) return '';
  return backendStore.username || '';
});
const profileFlag = computed(() => {
  if (viewingOtherUser.value && otherUserProfile.value) return otherUserProfile.value.flag || '';
  if (viewingOtherUser.value) return '';
  return prefs.value.flag || '';
});
const profileStats = computed(() => {
  if (viewingOtherUser.value && otherUserProfile.value) {
    const u = otherUserProfile.value;
    return {
      editsAllTime: u.total_edits || 0, mergesAllTime: u.total_merges || 0, splitsAllTime: u.total_splits || 0,
      cellsSubmitted: u.cells_completed || 0, currentStreak: u.current_streak || 0, longestStreak: u.longest_streak || 0,
      // Weekly/monthly/today not available for other users — show 0
      editsThisWeek: 0, mergesThisWeek: 0, splitsThisWeek: 0,
      editsThisMonth: 0, mergesThisMonth: 0, splitsThisMonth: 0,
      editsToday: 0, mergesToday: 0, splitsToday: 0,
    };
  }
  // Someone else's profile that has not arrived yet: nothing, never the
  // reader's own numbers. They used to show for a moment (Ames saw her own
  // ~600 on Nseraf's profile before his 235 rolled in, 2026-10-07).
  if (viewingOtherUser.value) {
    return {
      editsAllTime: 0, mergesAllTime: 0, splitsAllTime: 0, cellsSubmitted: 0, currentStreak: 0, longestStreak: 0,
      editsThisWeek: 0, mergesThisWeek: 0, splitsThisWeek: 0,
      editsThisMonth: 0, mergesThisMonth: 0, splitsThisMonth: 0,
      editsToday: 0, mergesToday: 0, splitsToday: 0,
    };
  }
  return stats.value;
});
const profileSpecialBadges = computed(() => {
  if (viewingOtherUser.value && otherUserProfile.value) return otherUserProfile.value.specialBadges || [];
  if (viewingOtherUser.value) return [];
  return backendStore.mySpecialBadges;
});

// Assists (Ames 2026-10-24): other players' help requests you replied to,
// one each however many replies you wrote; your own requests do not count.
// It used to count requests solved under your NAME among the 200 newest.
// Read from help_responses, per account, a number only, for whichever
// player's profile is open (Ames: "I see it in my profile but not in Nik's").
const assistRequests = ref<{ id: string; dataset: string | null }[]>([]);
async function loadAssists(uid: string) {
  const { data: replies } = await supabase.from('help_responses').select('request_id').eq('user_id', uid).limit(5000);
  const ids = [...new Set((replies ?? []).map((r: any) => r.request_id).filter(Boolean))] as string[];
  const out: { id: string; dataset: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('help_requests').select('id,user_id,dataset').in('id', ids.slice(i, i + 100));
    for (const r of (data ?? []) as any[]) if (r.user_id !== uid) out.push({ id: r.id, dataset: r.dataset ?? null });
  }
  if (assistsFor.value === uid) assistRequests.value = out;
}
const assistsFor = computed(() => props.viewUserId || backendStore.userId || '');
watch(assistsFor, uid => {
  assistRequests.value = [];
  if (uid) void loadAssists(uid).catch(() => { /* stays empty */ });
}, { immediate: true });
/** Every dataset, on your profile and on anyone else's, like the
 *  annotations beside it. */
const playerAssists = computed(() => assistRequests.value.length);

// ── Local state ───────────────────────────────────────────────────────────────
const closing        = ref(false);
const selectedBadge  = ref<BadgeDefinition | null>(null);
const selectedSpecialBadge = ref<any | null>(null);
const showFlagPicker = ref(false);
const showAllBuilding    = ref(false);
const showAllExploration = ref(false);
const showAllSpecialModal = ref(false);
const BADGE_PREVIEW_LIMIT = 5;  // one row of five (Ames 2026-10-01: no scrolling)
const BADGE_PREVIEW_WITH_VIEWALL = 4; // four + the View all tile
const SPECIAL_PREVIEW_LIMIT = 5;

// ── Profile tabs ─────────────────────────────────────────────────────────────
const activeTab = ref<'overview' | 'trophyCase' | 'myCells' | 'datasets' | 'datasetStats' | 'weekInScience' | 'adminHub' | 'blog' | 'settings'>('overview');

function openWeekInScience() {
  activeTab.value = 'weekInScience';
  // No notification from here any more: the Sunday recap (scripts/
  // weekly-recap.mjs) is the one Week in Science card, counted the same way
  // for everyone. This one counted the week in progress, so the numbers
  // never matched.
}

// ── Scout Report: your tag activity on the dataset on screen ─────────────────
const issueTagStore = useIssueTagStore();
const myTagsPlaced = computed(() =>
  issueTagStore.tags.filter((t: IssueTag) =>
    t.userId && t.userId === backendStore.userId && inScope(t.dataset)));
const myTagsFixed = computed(() =>
  myTagsPlaced.value.filter((t: IssueTag) => t.status === 'resolved'));
const tagsIFixed = computed(() =>
  issueTagStore.tags.filter((t: IssueTag) =>
    t.status === 'resolved' && t.resolvedById && t.resolvedById === backendStore.userId && inScope(t.dataset)));

const shellEl = ref<HTMLElement | null>(null);

/**
 * NEVER-CLIPPED WATCHDOG (Amy: "why do I have to ask every day").
 * CSS clamps have failed in the wild more than once (overlay stacking,
 * status bar, specificity fights), so this measures the ACTUAL rendered
 * rects and force-fixes them inline, which no stylesheet can override.
 * If it ever has to intervene it logs the measurements, so the next
 * report comes with data instead of another round of guessing.
 */
function clampProfile() {
  const shell = shellEl.value;
  if (!shell) return;
  const overlay = shell.closest('.overlay-content') as HTMLElement | null;
  const vh = window.innerHeight, vw = window.innerWidth;
  const target = overlay ?? shell;
  const r = target.getBoundingClientRect();
  // a frame that fills the window is full screen by design, not clipped; it
  // is read while its open animation still scales it (0.97), and before its
  // first layout its rect is empty, so neither of those may count as clipped
  if (!r.width || !r.height) return;
  if (r.width >= vw * 0.95 && r.height >= vh * 0.95) return;
  const clipped = r.bottom > vh - 4 || r.top < 4 || r.right > vw - 4 || r.left < 4;
  if (!clipped) return;
  console.warn('[profile] clip watchdog engaged:', {
    overlay: overlay?.getBoundingClientRect(), shell: shell.getBoundingClientRect(),
    vh, vw, shellMaxH: getComputedStyle(shell).maxHeight,
    overlayTransform: overlay ? getComputedStyle(overlay).transform : null,
  });
  shell.style.maxHeight = (vh - 56) + 'px';
  shell.style.maxWidth = (vw - 48) + 'px';
  if (overlay) {
    overlay.style.maxHeight = (vh - 24) + 'px';
    overlay.style.maxWidth = (vw - 24) + 'px';
    overlay.style.top = '50%';
    overlay.style.left = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    // visible, never auto (scrollbars) or hidden (clips the edge glow at the
    // rounded corners). The shell is clamped above and every tab body scrolls
    // internally, so nothing needs the overlay to scroll or clip.
    overlay.style.overflow = 'visible';
  }
}
let clampTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  // Re-check as the open animation settles, on every resize, and briefly on
  // an interval to catch late layout (fonts, images, tab content).
  requestAnimationFrame(clampProfile);
  setTimeout(clampProfile, 350);
  window.addEventListener('resize', clampProfile);
  clampTimer = setInterval(clampProfile, 700);
  setTimeout(() => { if (clampTimer) { clearInterval(clampTimer); clampTimer = null; } }, 4000);
});
onUnmounted(() => {
  window.removeEventListener('resize', clampProfile);
  if (clampTimer) clearInterval(clampTimer);
});
watch(() => shellEl.value, () => requestAnimationFrame(clampProfile));
watch(() => activeTab.value, () => { requestAnimationFrame(clampProfile); setTimeout(clampProfile, 320); });

// The arc of light that ran the frame's edge once on open (util/holo_trace)
// is gone with the orbiting border light: the frame fills the window now
// (Ames 2026-10-17: "we don't need the light bar trace around the edge").

// Deep-link: open directly on a given tab (e.g. from the toolbar/command palette
// "Your Week in Science" action).
onMounted(() => {
  if (props.initialTab === 'weekInScience' && !viewingOtherUser.value) {
    openWeekInScience();
  } else if (props.initialTab === 'trophyCase') {
    activeTab.value = 'trophyCase';
  } else if (props.initialTab === 'datasets') {
    activeTab.value = 'datasets';
  } else if (props.initialTab === 'datasetStats') {
    activeTab.value = 'datasetStats';
  } else if (props.initialTab === 'settings' && !viewingOtherUser.value) {
    activeTab.value = 'settings';
  } else if (props.initialTab === 'triage' && !viewingOtherUser.value) {
    // Deep-link from a 🗂 triage notification: straight to the review queue.
    activeTab.value = 'adminHub';
    adminInitialSubTab.value = 'triage';
  } else if (props.initialTab === 'tests' && !viewingOtherUser.value) {
    // Back from a Proofreading Test try in the view (TestReviewBar).
    activeTab.value = 'adminHub';
    adminInitialSubTab.value = 'tests';
  } else if (props.initialTab === 'hunts' && !viewingOtherUser.value) {
    // Back from checking a Hunt's places in the view (HuntPlacesBox).
    activeTab.value = 'adminHub';
    adminInitialSubTab.value = 'hunts';
  } else if (props.initialTab === 'access' && !viewingOtherUser.value) {
    // Back from reviewing an access request in the view (AccessReviewBar).
    activeTab.value = 'adminHub';
    adminInitialSubTab.value = 'access';
  } else if (props.initialTab === 'pilot' && !viewingOtherUser.value) {
    // From a "🔑 Beta access request" notification: Beta requests, Let them in.
    activeTab.value = 'adminHub';
    adminInitialSubTab.value = 'pilot';
  } else if (props.initialTab === 'tutorialEdits' && !viewingOtherUser.value) {
    // From a "Tutorial edit to approve" notification.
    activeTab.value = 'adminHub';
    adminInitialSubTab.value = 'tutorialEdits';
  }
});

// An achievement line in chat was clicked: bring that achievement to the
// front of this player's Trophy Case (Ames 2026-10-08, to show them off).
function onShowAchievement(e: Event) {
  const { slug, specialId } = (e as CustomEvent).detail || {};
  if (specialId != null) {
    // A special award: this player's awards may still be loading, so look a few times.
    activeTab.value = 'trophyCase';
    let tries = 0;
    const pick = () => {
      const award = profileSpecialBadges.value.find((a: any) => Number(a.badge_id ?? a.badge?.id) === Number(specialId));
      if (award) { selectedBadge.value = null; selectedSpecialBadge.value = award; }
      else if (++tries < 12) setTimeout(pick, 300);
    };
    pick();
    return;
  }
  const def = BADGE_DEFINITIONS.find(b => b.slug === slug);
  if (!def) return;
  activeTab.value = 'trophyCase';
  selectedSpecialBadge.value = null;
  selectedBadge.value = def;
}
onMounted(() => document.addEventListener('nge:profile-show-achievement', onShowAchievement));
onUnmounted(() => document.removeEventListener('nge:profile-show-achievement', onShowAchievement));

/** Sub-tab AdminHub should open on; set by the triage deep-link. */
const adminInitialSubTab = ref<string | undefined>(undefined);

// ── Datasets tab: per-dataset contributions + switcher ───────────────────────
// One card per known dataset with this user's contribution counts, doubling as
// the dataset switcher (same switchToDataset the top-bar selector uses).
interface DatasetContribution { edits: number; completions: number; helpRequests: number; outside?: number; }
const datasetStats = ref<Record<string, DatasetContribution>>({});
const datasetStatsLoading = ref(false);
const activeDatasetCanon = ref('');
const switchingDatasetId = ref<string | null>(null);

function refreshActiveDatasetCanon() {
  activeDatasetCanon.value = canonicalDataset(currentSegLayerName());
}

/** All dataset-tag variants that rows for this dataset may carry. edit_log and
 *  help_requests are canonicalised, but cave_completions_mirror stamps the
 *  sync config's own name (e.g. 'pinky_sandbox' where canonical is
 *  'pinky_nf_v2'), so count with .in() across the variants. */
// Shared with the "Now entering" card (util/dataset_contribution.ts).
const datasetTagVariants = sharedTagVariants;

// Whose contributions: the profile being viewed (Ames 2026-09-28: someone
// else's profile shows their Datasets tab too), else your own.
let datasetStatsFor: string | null = null;
async function loadDatasetStats() {
  const uid = viewingOtherUser.value ? props.viewUserId! : backendStore.userId;
  if (datasetStatsLoading.value && datasetStatsFor === uid) return;
  if (datasetStatsFor !== uid) datasetStats.value = {};
  datasetStatsFor = uid;
  datasetStatsLoading.value = true;
  refreshActiveDatasetCanon();
  try {
    if (!uid) return;
    const out: Record<string, DatasetContribution> = {};
    await Promise.all(DATASETS.map(async ds => {
      out[canonicalDataset(segLayerName(ds))] = await loadContribution(ds, uid);
    }));
    if (datasetStatsFor === uid) datasetStats.value = out;
  } catch (e) {
    console.warn('[profile] loadDatasetStats failed:', e);
  } finally {
    datasetStatsLoading.value = false;
  }
}

watch(activeTab, tab => { if (tab === 'datasets') loadDatasetStats(); });
watch(() => props.viewUserId, () => { if (activeTab.value === 'datasets') loadDatasetStats(); });

/** Whose part the Dataset Stats strip shows: the person whose profile this
 *  is. Undefined on your own profile (the panel uses the signed-in player);
 *  null while someone else's profile is still loading, so no strip is shown
 *  rather than the reader's own numbers. */
const datasetStatsPerson = computed(() => {
  if (!viewingOtherUser.value) return undefined;
  const p = otherUserProfile.value;
  if (!p || !props.viewUserId) return null;
  return { id: props.viewUserId, names: [p.display_name || '', p.username || ''], label: p.display_name || p.username || 'This player' };
});
/** The whole dataset's numbers: the Dataset Stats tab here, or on a phone
 *  the narrow panel (ExtensionBar listens, closes the profile and opens it). */
function openDatasetProgress() {
  if (!isMobileRef.value) { activeTab.value = 'datasetStats'; return; }
  document.dispatchEvent(new CustomEvent('nge:open-dataset-stats', { detail: { panel: true } }));
}
async function switchProfileDataset(ds: DatasetEntry) {
  const canon = canonicalDataset(segLayerName(ds));
  if (canon === activeDatasetCanon.value || switchingDatasetId.value) return;
  switchingDatasetId.value = ds.id;
  startDatasetTransition(ds);
  await new Promise(r => setTimeout(r, 60));
  const ok = await switchToDataset(ds);
  if (ok) refreshActiveDatasetCanon();
  switchingDatasetId.value = null;
}

function datasetContribution(ds: DatasetEntry): DatasetContribution | undefined {
  return datasetStats.value[canonicalDataset(segLayerName(ds))];
}

// The Datasets tab lists only the datasets this player has contributed to
// (Ames 2026-10-07). One whose numbers have not arrived yet stays until they
// do, so the list never flickers empty while it loads.
const contributedDatasets = computed(() => DATASETS.filter(isDatasetShown).filter(ds => !datasetContribution(ds) || hasContributed(ds)));
function hasContributed(ds: DatasetEntry): boolean {
  const c = datasetContribution(ds);
  return !!c && (c.edits > 0 || c.completions > 0 || c.helpRequests > 0 || (c.outside ?? 0) > 0);
}

// ── Inline flag picker ────────────────────────────────────────────────────────
// All country flags A-Z (ISO 3166-1 alpha-2, sorted alphabetically)
const ALL_FLAGS = [
  '🇦🇫','🇦🇱','🇩🇿','🇦🇸','🇦🇩','🇦🇴','🇦🇬','🇦🇷','🇦🇲','🇦🇺',
  '🇦🇹','🇦🇿','🇧🇸','🇧🇭','🇧🇩','🇧🇧','🇧🇾','🇧🇪','🇧🇿','🇧🇯',
  '🇧🇹','🇧🇴','🇧🇦','🇧🇼','🇧🇷','🇧🇳','🇧🇬','🇧🇫','🇧🇮','🇰🇭',
  '🇨🇲','🇨🇦','🇨🇻','🇨🇫','🇹🇩','🇨🇱','🇨🇳','🇨🇴','🇰🇲','🇨🇬',
  '🇨🇩','🇨🇷','🇭🇷','🇨🇺','🇨🇾','🇨🇿','🇩🇰','🇩🇯','🇩🇲','🇩🇴',
  '🇪🇨','🇪🇬','🇸🇻','🇬🇶','🇪🇷','🇪🇪','🇸🇿','🇪🇹','🇫🇯','🇫🇮',
  '🇫🇷','🇬🇦','🇬🇲','🇬🇪','🇩🇪','🇬🇭','🇬🇷','🇬🇩','🇬🇹','🇬🇳',
  '🇬🇼','🇬🇾','🇭🇹','🇭🇳','🇭🇺','🇮🇸','🇮🇳','🇮🇩','🇮🇷','🇮🇶',
  '🇮🇪','🇮🇱','🇮🇹','🇨🇮','🇯🇲','🇯🇵','🇯🇴','🇰🇿','🇰🇪','🇰🇮',
  '🇰🇵','🇰🇷','🇰🇼','🇰🇬','🇱🇦','🇱🇻','🇱🇧','🇱🇸','🇱🇷','🇱🇾',
  '🇱🇮','🇱🇹','🇱🇺','🇲🇬','🇲🇼','🇲🇾','🇲🇻','🇲🇱','🇲🇹','🇲🇭',
  '🇲🇷','🇲🇺','🇲🇽','🇫🇲','🇲🇩','🇲🇨','🇲🇳','🇲🇪','🇲🇦','🇲🇿',
  '🇲🇲','🇳🇦','🇳🇷','🇳🇵','🇳🇱','🇳🇿','🇳🇮','🇳🇪','🇳🇬','🇲🇰',
  '🇳🇴','🇴🇲','🇵🇰','🇵🇼','🇵🇦','🇵🇬','🇵🇾','🇵🇪','🇵🇭','🇵🇱',
  '🇵🇹','🇶🇦','🇷🇴','🇷🇺','🇷🇼','🇰🇳','🇱🇨','🇻🇨','🇼🇸','🇸🇲',
  '🇸🇹','🇸🇦','🇸🇳','🇷🇸','🇸🇨','🇸🇱','🇸🇬','🇸🇰','🇸🇮','🇸🇧',
  '🇸🇴','🇿🇦','🇸🇸','🇪🇸','🇱🇰','🇸🇩','🇸🇷','🇸🇪','🇨🇭','🇸🇾',
  '🇹🇼','🇹🇯','🇹🇿','🇹🇭','🇹🇱','🇹🇬','🇹🇴','🇹🇹','🇹🇳','🇹🇷',
  '🇹🇲','🇹🇻','🇺🇬','🇺🇦','🇦🇪','🇬🇧','🇺🇸','🇺🇾','🇺🇿','🇻🇺',
  '🇻🇪','🇻🇳','🇾🇪','🇿🇲','🇿🇼',
];

/** Convert flag emoji to ISO 3166-1 alpha-2 code (🇺🇸 → 'us'). */
function emojiToCode(emoji: string): string {
  const pts = [...emoji];
  if (pts.length < 2) return '';
  return pts.slice(0, 2).map(c => String.fromCharCode((c.codePointAt(0)! - 0x1F1E6) + 97)).join('');
}

/** Get a flag image URL from an emoji flag. Returns '' for non-flag emoji like 🌐. */
function flagImgUrl(emoji: string): string {
  if (!emoji || emoji === EYEWIRE_FLAG) return '';
  const code = emojiToCode(emoji);
  if (!code || code.length !== 2) return '';
  return `https://flagcdn.com/w40/${code}.png`;
}

function isEyewireFlag(flag: string): boolean {
  return flag === EYEWIRE_FLAG;
}

function setFlag(f: string) {
  prefsStore.save({flag: f});
  showFlagPicker.value = false;
}

// Close the flag picker when clicking anywhere outside it
function handleGlobalClick(e: MouseEvent) {
  const el = document.getElementById('nge-profile-flag-wrap');
  if (el && !el.contains(e.target as Node)) showFlagPicker.value = false;
}
onMounted(()  => document.addEventListener('click', handleGlobalClick, true));
onUnmounted(() => document.removeEventListener('click', handleGlobalClick, true));

// ── Canvas cell-dot visualization ─────────────────────────────────────────────
// A player with no edits used to get a made-up demo player's stats here (892
// cells) until the real ones loaded. That was read as the count jumping, and
// saved 25 cell Achievements for one player on 2026-10-01. Removed 2026-10-11:
// a profile only ever shows the player's own numbers.

// ── Badge helpers ─────────────────────────────────────────────────────────────
function getBadgeUrl(imageKey: string): string {
  return BADGE_IMAGE_MAP[imageKey] ?? '';
}

/** Get the player's current count for a given track. */
function statForTrack(track: BadgeTrack): number {
  const s = profileStats.value;
  if (track === 'loyalty') return totalDays.value;
  return track === 'building'
    ? (s.editsAllTime ?? 0)
    : (s.cellsSubmitted ?? 0);
}

function isBadgeEarned(badge: BadgeDefinition): boolean {
  if (badge.threshold === 0) return false;
  if (statForTrack(badge.track) >= badge.threshold) return true;
  // Saved earn: once earned, an Achievement stays earned, even if the count
  // later drops or the tier's number is raised. True on anyone's profile.
  return backendStore.holdsSaved(props.viewUserId || backendStore.userId, badge.track, badge.id);
}

function onBadgeClick(badge: BadgeDefinition) {
  if (!isBadgeEarned(badge)) return;
  selectedSpecialBadge.value = null;
  // Toggle: click same badge again to dismiss detail
  selectedBadge.value = selectedBadge.value?.id === badge.id ? null : badge;
}

function onSpecialBadgeClick(award: any) {
  selectedBadge.value = null;
  selectedSpecialBadge.value = selectedSpecialBadge.value?.id === award.id ? null : award;
}

// ── Earned badges + 1 upcoming "next" badge per track ────────────────────────
const earnedBuildingBadges = computed(() => {
  const earned = BUILDING_BADGES.filter(b => isBadgeEarned(b)).reverse();
  const nextLocked = BUILDING_BADGES.find(b => !isBadgeEarned(b));
  return { earned, next: nextLocked ?? null };
});

const earnedExplorationBadges = computed(() => {
  const earned = EXPLORATION_BADGES.filter(b => isBadgeEarned(b)).reverse();
  const nextLocked = EXPLORATION_BADGES.find(b => !isBadgeEarned(b));
  return { earned, next: nextLocked ?? null };
});

// Loyalty: every achievement earned, newest first, and the next one to reach.
const earnedLoyaltyBadges = computed(() => {
  const earned = LOYALTY_BADGES.filter(b => isBadgeEarned(b)).reverse();
  const nextLocked = LOYALTY_BADGES.find(b => !isBadgeEarned(b));
  return { earned, next: nextLocked ?? null };
});

/** Most recently earned badge (highest threshold among earned). Loyalty is
 *  left out: its thresholds are days, not edits or cells, so they do not
 *  compare. */
/** Short screens (laptops): the rows draw smaller so the list under them
 *  is reachable (Ames 2026-10-11: "did you leave room for the my cells list
 *  on laptop screens?"). */
const compactMq = window.matchMedia('(max-height: 960px)');
const tinyMq = window.matchMedia('(max-height: 760px)');
const compactRows = ref(compactMq.matches);
const tinyRows = ref(tinyMq.matches);
const onCompactChange = (e: MediaQueryListEvent) => { compactRows.value = e.matches; };
const onTinyChange = (e: MediaQueryListEvent) => { tinyRows.value = e.matches; };
compactMq.addEventListener('change', onCompactChange);
tinyMq.addEventListener('change', onTinyChange);
onUnmounted(() => { compactMq.removeEventListener('change', onCompactChange); tinyMq.removeEventListener('change', onTinyChange); });

/** The latest Achievement of each track, featured beside that track's
 *  numbers in the left column (Ames 2026-10-11). Each list is newest first. */
const latestLoyaltyBadge = computed<BadgeDefinition | null>(() => earnedLoyaltyBadges.value.earned[0] ?? null);
const latestExplorationBadge = computed<BadgeDefinition | null>(() => earnedExplorationBadges.value.earned[0] ?? null);
const latestBuildingBadge = computed<BadgeDefinition | null>(() => earnedBuildingBadges.value.earned[0] ?? null);

const latestEarnedBadge = computed(() => {
  const allEarned = BADGE_DEFINITIONS.filter(b => b.track !== 'loyalty' && isBadgeEarned(b));
  if (allEarned.length === 0) return null;
  return allEarned.reduce((a, b) => a.threshold > b.threshold ? a : b);
});

// ── Favorite badge (persisted in localStorage) ────────────────────────────────
/** Favorite badge slug — synced to Supabase via store. */
// Someone else's profile shows THEIR favorite, not yours.
const favoriteBadgeSlug = computed(() => viewingOtherUser.value ? String(otherUserProfile.value?.favorite_badge || '') : backendStore.favoriteBadgeSlug);
const favoriteBadge = computed<BadgeDefinition | null>(() => {
  if (favoriteBadgeSlug.value) {
    const found = BADGE_DEFINITIONS.find(b => b.slug === favoriteBadgeSlug.value);
    if (found && isBadgeEarned(found)) return found;
  }
  return null;
});
/** Check if the favorite is a special badge (not a regular track badge). */
const favoriteSpecialBadge = computed(() => {
  if (!favoriteBadgeSlug.value || favoriteBadge.value) return null;
  return profileSpecialBadges.value.find(
    (a: any) => (a.badge?.slug || `special-${a.id}`) === favoriteBadgeSlug.value
  ) || null;
});
/** Badge shown in the Trophy Case featured banner. */
const featuredBadge = computed(() => selectedBadge.value ?? favoriteBadge.value ?? latestEarnedBadge.value);

/** Mobile: tapping the featured badge art opens it fullscreen with a
 *  simplified award animation (Amy 2026-08-18: the banner cannot do the
 *  badge justice on a phone). Desktop taps are inert. */
const badgeZoom = ref<{ img: string; name: string; desc?: string; meta?: string } | null>(null);
function zoomBadge(img?: string | null, name?: string | null, desc?: string | null, meta?: string | null) {
  if (!isMobileRef.value || !img) return;
  badgeZoom.value = { img, name: name || 'Award', desc: desc || undefined, meta: meta || undefined };
}
function toggleFavoriteBadge(badge: BadgeDefinition) {
  const newSlug = favoriteBadgeSlug.value === badge.slug ? '' : badge.slug;
  backendStore.saveFavoriteBadge(newSlug);
}
function toggleFavoriteSpecialBadge(award: any) {
  const slug = award.badge?.slug || `special-${award.id}`;
  const newSlug = favoriteBadgeSlug.value === slug ? '' : slug;
  backendStore.saveFavoriteBadge(newSlug);
}

// ── Favorites: one gold, a silver strip, a bronze strip ─────────────────────
// Gold and silver are Ames 2026-10-01; bronze is 2026-10-09 (players asked to
// show more). An achievement holds one star: giving it another takes the
// first away.
const specialSlug = (a: any): string => a?.badge?.slug || `special-${a?.id}`;
const otherSilver = ref<string[]>([]);
const otherBronze = ref<string[]>([]);
const silverSlugs = computed<string[]>(() => viewingOtherUser.value ? otherSilver.value : backendStore.silverBadgeSlugs);
const bronzeSlugs = computed<string[]>(() => viewingOtherUser.value ? otherBronze.value : backendStore.bronzeBadgeSlugs);
type FavTier = 'gold' | 'silver' | 'bronze';
interface FavItem { slug: string; name: string; img: string; gold: boolean; tier: FavTier; def?: BadgeDefinition; award?: any }
function favItem(slug: string, tier: FavTier): FavItem | null {
  const gold = tier === 'gold';
  const def = BADGE_DEFINITIONS.find(b => b.slug === slug);
  if (def) return isBadgeEarned(def) ? { slug, name: def.name, img: getBadgeUrl(def.imageKey), gold, tier, def } : null;
  const award = profileSpecialBadges.value.find((a: any) => specialSlug(a) === slug);
  const img = award?.badge?.thumbnail_url || award?.badge?.image_url;
  return award && img ? { slug, name: award.badge?.name || 'Award', img, gold, tier, award } : null;
}
const goldSlug = computed(() => favoriteBadge.value?.slug || (favoriteSpecialBadge.value ? specialSlug(favoriteSpecialBadge.value) : ''));
const favoriteRow = computed<FavItem[]>(() => {
  const out: (FavItem | null)[] = [];
  const seen = new Set<string>();
  const add = (sl: string, tier: FavTier) => { if (sl && !seen.has(sl)) { seen.add(sl); out.push(favItem(sl, tier)); } };
  add(goldSlug.value, 'gold');
  for (const sl of silverSlugs.value) add(sl, 'silver');
  for (const sl of bronzeSlugs.value) add(sl, 'bronze');
  return out.filter((x): x is FavItem => !!x);
});
const silverRow = computed(() => favoriteRow.value.filter(f => f.tier === 'silver'));
const bronzeRow = computed(() => favoriteRow.value.filter(f => f.tier === 'bronze'));
/** The badge the Trophy Case is showing large (same order as its template). */
const featuredSlug = computed(() => {
  if (selectedSpecialBadge.value) return specialSlug(selectedSpecialBadge.value);
  if (favoriteSpecialBadge.value && !selectedBadge.value) return specialSlug(favoriteSpecialBadge.value);
  return featuredBadge.value?.slug || '';
});
const featuredIsGold = computed(() => !!featuredSlug.value && featuredSlug.value === favoriteBadgeSlug.value);
const featuredIsSilver = computed(() => silverSlugs.value.includes(featuredSlug.value));
const featuredIsBronze = computed(() => bronzeSlugs.value.includes(featuredSlug.value));
// A strip is full when it SHOWS its limit. A saved slug that no longer shows
// (an achievement that was withdrawn, such as the first Loyalty set) used to
// keep its place and count against the limit, so a player could be stopped
// at one or two favorites with room apparently left (Nik 2026-10-09). Such
// slugs are dropped the next time the strip is saved.
const silverFull = computed(() => silverRow.value.length >= backendStore.MAX_SILVER_BADGES);
const bronzeFull = computed(() => bronzeRow.value.length >= backendStore.MAX_BRONZE_BADGES);
const shownSilver = () => silverRow.value.map(f => f.slug);
const shownBronze = () => bronzeRow.value.map(f => f.slug);
function toggleGoldFeatured() {
  const sl = featuredSlug.value;
  if (!sl) return;
  if (featuredIsGold.value) { backendStore.saveFavoriteBadge(''); return; }
  // Gold outranks the others: a badge holds one star.
  if (featuredIsSilver.value) backendStore.saveSilverBadges(shownSilver().filter(x => x !== sl));
  if (featuredIsBronze.value) backendStore.saveBronzeBadges(shownBronze().filter(x => x !== sl));
  backendStore.saveFavoriteBadge(sl);
}
function toggleSilverFeatured() {
  const sl = featuredSlug.value;
  if (!sl) return;
  if (featuredIsSilver.value) { backendStore.saveSilverBadges(shownSilver().filter(x => x !== sl)); return; }
  if (silverFull.value) return;
  if (featuredIsGold.value) backendStore.saveFavoriteBadge('');
  if (featuredIsBronze.value) backendStore.saveBronzeBadges(shownBronze().filter(x => x !== sl));
  backendStore.saveSilverBadges([...shownSilver().filter(x => x !== sl), sl]);
}
function toggleBronzeFeatured() {
  const sl = featuredSlug.value;
  if (!sl) return;
  if (featuredIsBronze.value) { backendStore.saveBronzeBadges(shownBronze().filter(x => x !== sl)); return; }
  if (bronzeFull.value) return;
  if (featuredIsGold.value) backendStore.saveFavoriteBadge('');
  if (featuredIsSilver.value) backendStore.saveSilverBadges(shownSilver().filter(x => x !== sl));
  backendStore.saveBronzeBadges([...shownBronze().filter(x => x !== sl), sl]);
}

// ── Favorites in the player's own order, within a strip ────────────────────
// Drag a silver favorite among the silver ones, a bronze among the bronze
// (Ames 2026-10-10). Gold is one, so it has nowhere to go.
const draggingFav = ref<FavItem | null>(null);
const dropFav = ref<string>('');
const favDraggable = (f: FavItem) => !viewingOtherUser.value && f.tier !== 'gold';
function favDragStart(f: FavItem, e: DragEvent) {
  if (!favDraggable(f)) { e.preventDefault(); return; }
  draggingFav.value = f;
  try { e.dataTransfer?.setData('text/plain', f.slug); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; } catch { /* some browsers */ }
}
function favDragOver(f: FavItem, e: DragEvent) {
  const from = draggingFav.value;
  if (!from || from.slug === f.slug || from.tier !== f.tier) return;
  e.preventDefault();
  dropFav.value = f.slug;
}
function favDrop(f: FavItem) {
  const from = draggingFav.value;
  draggingFav.value = null; dropFav.value = '';
  if (!from || from.slug === f.slug || from.tier !== f.tier) return;
  const list = (from.tier === 'silver' ? shownSilver() : shownBronze()).filter(x => x !== from.slug);
  list.splice(list.indexOf(f.slug), 0, from.slug);   // lands where the one it was dropped on stood
  if (from.tier === 'silver') backendStore.saveSilverBadges(list); else backendStore.saveBronzeBadges(list);
}
function favDragEnd() { draggingFav.value = null; dropFav.value = ''; }

// ── Trophy Case sections in the player's own order ─────────────────────────
// Drag a section by its heading (Ames 2026-10-09). The order is saved with
// the profile, so visitors see the case the way its owner arranged it.
const TROPHY_SECTIONS = ['cells', 'editor', 'loyalty', 'competitions', 'special'] as const;
type TrophySection = typeof TROPHY_SECTIONS[number];
const otherTrophyOrder = ref<string[]>([]);
const trophyOrder = computed<TrophySection[]>(() => {
  const saved = (viewingOtherUser.value ? otherTrophyOrder.value : backendStore.trophyOrder)
    .filter((x): x is TrophySection => (TROPHY_SECTIONS as readonly string[]).includes(x));
  return [...new Set([...saved, ...TROPHY_SECTIONS])];
});
const sectionOrder = (k: TrophySection) => ({ order: trophyOrder.value.indexOf(k) });
const draggingSection = ref<TrophySection | null>(null);
const dropSection = ref<TrophySection | null>(null);
function sectionDragStart(k: TrophySection, e: DragEvent) {
  if (viewingOtherUser.value) { e.preventDefault(); return; }
  draggingSection.value = k;
  try { e.dataTransfer?.setData('text/plain', k); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; } catch { /* some browsers */ }
}
function sectionDragOver(k: TrophySection, e: DragEvent) {
  if (!draggingSection.value || draggingSection.value === k) return;
  e.preventDefault();
  dropSection.value = k;
}
function sectionDrop(k: TrophySection) {
  const from = draggingSection.value;
  draggingSection.value = null; dropSection.value = null;
  if (!from || from === k) return;
  const order = trophyOrder.value.filter(x => x !== from);
  order.splice(order.indexOf(k), 0, from);       // lands where the one it was dropped on stood
  backendStore.saveTrophyOrder(order);
}
function sectionDragEnd() { draggingSection.value = null; dropSection.value = null; }
/** For the keyboard, and for touch where dragging is awkward. */
function moveSection(k: TrophySection, by: number) {
  const order = [...trophyOrder.value];
  const i = order.indexOf(k), j = i + by;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  backendStore.saveTrophyOrder(order);
}
function openFavorite(item: FavItem) {
  if (item.def) { selectedSpecialBadge.value = null; selectedBadge.value = item.def; }
  else { selectedBadge.value = null; selectedSpecialBadge.value = item.award; }
}
function openFavoriteInCase(item: FavItem) {
  openFavorite(item);
  activeTab.value = 'trophyCase';
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The latest of each track is featured beside its numbers in the left
// column, so these rows start with the one before it (Ames 2026-10-11).
const displayedBuildingBadges = computed(() => {
  const all = earnedBuildingBadges.value.earned.slice(1);
  if (showAllBuilding.value) return all;
  return all.length >= BADGE_PREVIEW_LIMIT ? all.slice(0, BADGE_PREVIEW_WITH_VIEWALL) : all.slice(0, BADGE_PREVIEW_LIMIT);
});
const displayedExplorationBadges = computed(() => {
  const all = earnedExplorationBadges.value.earned.slice(1);
  if (showAllExploration.value) return all;
  return all.length >= BADGE_PREVIEW_LIMIT ? all.slice(0, BADGE_PREVIEW_WITH_VIEWALL) : all.slice(0, BADGE_PREVIEW_LIMIT);
});
const showBuildingViewAll = computed(() => earnedBuildingBadges.value.earned.length - 1 >= BADGE_PREVIEW_LIMIT);
const showExplorationViewAll = computed(() => earnedExplorationBadges.value.earned.length - 1 >= BADGE_PREVIEW_LIMIT);

// ── Competitions (Ames 2026-10-21): "a separate section in profile for Competitions ... the
// gold / silver / bronze are special badges that count up, so user can win gold multiple times
// and it shows the # times, not repeating the same badge". Each Hunt gives its own Achievements
// (slug hunt-<id>-<medal>); here they are one tile per medal, with how many times it was won.
const HUNT_MEDAL = /^hunt-(\d+)-(gold|silver|bronze|fastest|laser)$/;
// Monthly Champions places (scripts/monthly-champions.mjs, Ames 2026-10-26):
// slug month-YYYY-MM-<edits|cells>-<place>; cups for edits, neuron awards for cells.
const MONTH_MEDAL = /^month-\d{4}-\d{2}-(edits|cells)-(gold|silver|bronze)$/;
// Pyr Year Champions (every Sep 28): slug year-<n>-<edits|cells>-<place>.
const YEAR_MEDAL = /^year-\d+-(edits|cells)-(gold|silver|bronze)$/;
type MonthMedal = `${'month' | 'year'}-${'edits' | 'cells'}-${'gold' | 'silver' | 'bronze'}`;
type HuntMedal = 'gold' | 'silver' | 'bronze' | 'fastest' | 'laser' | MonthMedal;
const MEDAL_ORDER: HuntMedal[] = ['year-edits-gold', 'year-cells-gold', 'year-edits-silver', 'year-cells-silver', 'year-edits-bronze', 'year-cells-bronze',
  'month-edits-gold', 'month-cells-gold', 'month-edits-silver', 'month-cells-silver', 'month-edits-bronze', 'month-cells-bronze',
  'gold', 'silver', 'bronze', 'fastest', 'laser'];
const MEDAL_WORD: Record<HuntMedal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', fastest: 'Speed', laser: 'Laser Eyes',
  'month-edits-gold': 'Gold', 'month-edits-silver': 'Silver', 'month-edits-bronze': 'Bronze',
  'month-cells-gold': 'Gold', 'month-cells-silver': 'Silver', 'month-cells-bronze': 'Bronze',
  'year-edits-gold': 'Gold', 'year-edits-silver': 'Silver', 'year-edits-bronze': 'Bronze',
  'year-cells-gold': 'Gold', 'year-cells-silver': 'Silver', 'year-cells-bronze': 'Bronze' };
/** Under a medal in the Trophy Case: what it is for, when the picture alone does not say. */
const MEDAL_SUB: Record<HuntMedal, string> = { gold: '', silver: '', bronze: '', fastest: 'the fastest', laser: 'what the key missed',
  'month-edits-gold': 'monthly edits', 'month-edits-silver': 'monthly edits', 'month-edits-bronze': 'monthly edits',
  'month-cells-gold': 'monthly cells', 'month-cells-silver': 'monthly cells', 'month-cells-bronze': 'monthly cells',
  'year-edits-gold': 'Pyr year, edits', 'year-edits-silver': 'Pyr year, edits', 'year-edits-bronze': 'Pyr year, edits',
  'year-cells-gold': 'Pyr year, cells', 'year-cells-silver': 'Pyr year, cells', 'year-cells-bronze': 'Pyr year, cells' };
const MONTH_ART: Record<string, string> = {
  'month-edits-gold': goldCup, 'month-edits-silver': silverCup, 'month-edits-bronze': bronzeCup,
  'month-cells-gold': goldAward, 'month-cells-silver': silverAward, 'month-cells-bronze': bronzeAward,
  'year-edits-gold': goldYearAward, 'year-edits-silver': silverYearAward, 'year-edits-bronze': bronzeYearAward,
  'year-cells-gold': goldYearTrophy, 'year-cells-silver': silverYearTrophy, 'year-cells-bronze': bronzeYearTrophy };
function huntMedalOf(a: any): HuntMedal | null {
  const slug = String(a?.badge?.slug || '');
  const mm = MONTH_MEDAL.exec(slug);
  if (mm) return `month-${mm[1]}-${mm[2]}` as HuntMedal;
  const ym = YEAR_MEDAL.exec(slug);
  if (ym) return `year-${ym[1]}-${ym[2]}` as HuntMedal;
  const m = HUNT_MEDAL.exec(slug);
  return m ? (m[2] as HuntMedal) : null;
}
/** The Special Awards that are not Hunt medals (those are under Competitions). */
const plainSpecialBadges = computed(() => profileSpecialBadges.value.filter((a: any) => !huntMedalOf(a)));
interface MedalTile { tier: HuntMedal; count: number; awards: any[]; latest: any }
const competitionMedals = computed<MedalTile[]>(() => MEDAL_ORDER.map((tier) => {
  const awards = profileSpecialBadges.value.filter((a: any) => huntMedalOf(a) === tier)
    .sort((x: any, y: any) => (Date.parse(y.awarded_at) || 0) - (Date.parse(x.awarded_at) || 0));
  return { tier, count: awards.length, awards, latest: awards[0] ?? null };
}).filter((m) => m.count > 0));
/** The Hunt (or month) a medal was won in: its Achievement is named "<Hunt title>: Gold"
 *  or "October 2026 Top Editors: Gold". */
function huntTitleOf(a: any): string {
  return String(a?.badge?.name || '').replace(/:\s*(Gold|Silver|Bronze|Fastest|Laser Eyes)\s*$/i, '').trim() || 'a Hunt';
}
function medalTooltip(m: MedalTile): string {
  const head = `${MEDAL_WORD[m.tier]}${MEDAL_SUB[m.tier] ? `, ${MEDAL_SUB[m.tier]}` : ''}: won ${m.count === 1 ? 'once' : `${m.count} times`}`;
  const lines = m.awards.slice(0, 12).map((a: any) => `${huntTitleOf(a)}, ${formatDate(a.awarded_at)}`);
  const more = m.awards.length > 12 ? [`and ${m.awards.length - 12} more`] : [];
  return [head, ...lines, ...more].join('\n');
}
/** Ames's medal art, the same for every Hunt (the cheetah for Speed). */
const medalArt = (m: MedalTile) => MONTH_ART[m.tier] ?? `hunt/${m.tier}-128.png`;
const medalSelected = (m: MedalTile) => !!selectedSpecialBadge.value && m.awards.some((a: any) => a.id === selectedSpecialBadge.value.id);
function onMedalClick(m: MedalTile) { if (m.latest) onSpecialBadgeClick(m.latest); }
/** For a medal won more than once, the Hunts it was won in, under its picture. */
function medalWins(a: any): string {
  const tier = huntMedalOf(a); if (!tier) return '';
  const m = competitionMedals.value.find((x) => x.tier === tier);
  if (!m || m.count < 2) return '';
  const names = m.awards.slice(0, 5).map(huntTitleOf);
  const more = m.count > 5 ? `, and ${m.count - 5} more` : '';
  return `${MEDAL_WORD[tier]} ${m.count} times: ${names.join(', ')}${more}.`;
}

// ── Special Awards "View all" preview ───────────────────────────────────────
const displayedSpecialBadges = computed(() => {
  const all = plainSpecialBadges.value;
  if (all.length > SPECIAL_PREVIEW_LIMIT) return all.slice(0, SPECIAL_PREVIEW_LIMIT - 1); // leave one slot for tile
  return all.slice(0, SPECIAL_PREVIEW_LIMIT);
});
const showSpecialViewAll = computed(() => plainSpecialBadges.value.length > SPECIAL_PREVIEW_LIMIT);

// ── Tooltip helpers for badges ───────────────────────────────────────────────
function badgeTooltip(badge: BadgeDefinition): string {
  // Loyalty (Ames 2026-10-06): "Earned for n days of science", on its own line.
  if (badge.track === 'loyalty') return `${badge.name}\nEarned for ${badge.threshold.toLocaleString()} ${unitForTrack('loyalty', badge.threshold)}`;
  return `${badge.name}, earned for ${badge.threshold.toLocaleString()} ${unitForTrack(badge.track, badge.threshold)}`;
}
function specialBadgeTooltip(award: any): string {
  const name = award.badge?.name || 'Award';
  const reason = award.reason ? String(award.reason).trim() : '';
  if (reason) return `${name} — ${reason}`;
  if (award.badge?.description) return `${name} — ${award.badge.description}`;
  return `${name} — special award`;
}

/** Label for the threshold in badge detail. */
function thresholdLabel(badge: BadgeDefinition): string {
  return unitForTrack(badge.track, badge.threshold);
}

// ── Per-track achievement countdowns ─────────────────────────────────────────
function nextForTrack(badges: BadgeDefinition[], current: number) {
  const sorted = [...badges].filter(b => b.threshold > 0).sort((a, b) => a.threshold - b.threshold);
  // The next one not held: a saved Achievement can sit above the count.
  const next = sorted.find(b => current < b.threshold && !isBadgeEarned(b));
  if (!next) return null;
  // The last step the count has passed, not a saved Achievement above it (annkri #180).
  const prev = sorted.slice(0, sorted.indexOf(next)).filter(b => b.threshold <= current).pop()?.threshold ?? 0;
  const remaining = next.threshold - current;
  const pct = Math.max(0, Math.min(100, Math.round(((current - prev) / (next.threshold - prev)) * 100)));
  return { name: next.name, threshold: next.threshold, remaining, pct, track: next.track as BadgeTrack };
}

const nextBuildingAchievement = computed(() =>
  nextForTrack(BUILDING_BADGES, profileStats.value.editsAllTime ?? 0)
);
const nextExplorationAchievement = computed(() =>
  nextForTrack(EXPLORATION_BADGES, profileStats.value.cellsSubmitted ?? 0)
);
// Loyalty counts total days toward the next achievement.
const nextLoyaltyAchievement = computed(() => {
  const next = earnedLoyaltyBadges.value.next;
  if (!next) return null;
  const cur = Math.min(totalDays.value, next.threshold - 1);
  // The last step passed, not a held Achievement above the count (annkri #180).
  const prev = LOYALTY_BADGES.filter(b => b.threshold < next.threshold && b.threshold <= cur).reduce((m, b) => Math.max(m, b.threshold), 0);
  const remaining = next.threshold - cur;
  return { name: next.name, threshold: next.threshold, remaining, pct: Math.max(0, Math.round((cur - prev) / Math.max(1, next.threshold - prev) * 100)) };
});

// ── Overview scope: the dataset on screen ──────────────────────────────────
// The Overview's left column (Edits, Cells, Scout Report, Recent Cells) is
// scoped to the dataset currently loaded, so working on MEC shows MEC numbers
// (Amy 2026-09-25). Achievements, streak and awards stay career-wide.
// Everything compares CANONICAL tags: cell history stores raw layer names
// ('pinky_training6', 'pni_mec_seg'...) while Supabase rows are canonical.
onMounted(refreshActiveDatasetCanon);

/** DATASETS entry for the dataset on screen, if it is a known one. */
const scopeDataset = computed<DatasetEntry | null>(() =>
  DATASETS.find(ds => canonicalDataset(segLayerName(ds)) === activeDatasetCanon.value) ?? null);
const scopeLabel = computed(() => scopeDataset.value?.label || activeDatasetCanon.value);
function inScope(tag: string | null | undefined): boolean {
  return !activeDatasetCanon.value || canonicalDataset(tag) === activeDatasetCanon.value;
}

// Per-dataset edit counts come from edit_log (one row per edit, tagged with a
// canonical dataset). Verified 2026-09-25: its merge + split rows sum exactly
// to users.total_edits, so the per-dataset numbers add up to the career total.
interface EditWindow { edits: number; merges: number; splits: number; }
const scopedEdits = ref<{ today: EditWindow; week: EditWindow; all: EditWindow } | null>(null);
const scopedEditsFailed = ref(false);
let scopedEditsReq = 0;

// The same rows as a line (Ames 2026-10-11): one entry per day from the
// first edit on this dataset to today, for the curve under the numbers.
interface EffortDay { date: string; n: number }
const scopedEditDays = ref<EffortDay[] | null>(null);

// Cells completed on this dataset, the same three windows as edits, read
// from the completions list (ew_cell_completions, one row per cell with the
// moment it was completed, by the completed cell rule). Only the game's own
// log: cells marked in other tools never count (Ames 2026-10-07).
const scopedCells = ref<{ today: number; week: number; all: number } | null>(null);
const scopedCellDays = ref<EffortDay[] | null>(null);
/** The matched completion rows, newest first, for the recent cells list. */
const scopedCompletionRows = ref<Array<{ cell: string; done_at: string; dataset: string }> | null>(null);
const scopedCellsFailed = ref(false);

// The curves' range: one choice for both curves (Ames 2026-10-12: "a way for
// me to set the date range"), kept in this browser. 0 is the whole record.
const CURVE_SPANS = [0, 90, 30, 7];
const CURVE_SPAN_KEY = 'nge-profile-curve-span';
function loadCurveSpan(): number {
  try { const v = Number(localStorage.getItem(CURVE_SPAN_KEY)); return CURVE_SPANS.includes(v) ? v : 0; } catch { return 0; }
}
const curveSpan = ref<number>(loadCurveSpan());
function setCurveSpan(days: number) {
  curveSpan.value = days;
  try { localStorage.setItem(CURVE_SPAN_KEY, String(days)); } catch { /* private mode */ }
}

// Cells identified: the cells whose type this player set in Pyr (the game's
// own log, 'set_cell_type' rows stamped by the server), on its real
// datasets; the Sandbox does not count. A cell counts once, by the type it
// was given last; Unknown or Unsure does not count. Open text types count
// for now. (Ames's rules for the planned Identification track, 2026-10-07;
// the count on the profile, 2026-10-12.) Not annotation points.
const scopedIdentified = ref<number | null>(null);
const scopedIdentifiedFailed = ref(false);
let scopedIdentifiedReq = 0;
const SANDBOX_CANON = new Set(DATASETS.filter(d => d.section === 'sandbox').map(d => canonicalDataset(d.id)));
const NOT_A_TYPE = /^\s*$|unknown|unsure|not sure|unclear/i;
async function loadScopedIdentifications() {
  const uid = viewingOtherUser.value ? props.viewUserId : backendStore.userId;
  const req = ++scopedIdentifiedReq;
  scopedIdentifiedFailed.value = false;
  if (!uid) { scopedIdentified.value = null; return; }
  try {
    const { supabase } = await import('../supabase');
    const rows: Array<{ segment_after: string | null; dataset: string | null; success: boolean | null; metadata: any }> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('edit_log')
        .select('segment_after, dataset, success, metadata')
        .eq('user_id', uid).eq('operation', 'set_cell_type')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (req !== scopedIdentifiedReq) return;
    const latest = new Map<string, string>();  // oldest first, so the last word on a cell wins
    for (const r of rows) {
      if (r.success === false) continue;
      if (SANDBOX_CANON.has(canonicalDataset(r.dataset))) continue;
      const cell = String(r.metadata?.root_id ?? r.segment_after ?? '');
      if (!cell) continue;
      latest.set(cell, String(r.metadata?.cell_type ?? ''));
    }
    let n = 0;
    for (const t of latest.values()) if (!NOT_A_TYPE.test(t)) n++;
    scopedIdentified.value = n;
  } catch (e) {
    if (req !== scopedIdentifiedReq) return;
    console.warn('[profile] cells identified unavailable', e);
    scopedIdentified.value = null;
    scopedIdentifiedFailed.value = true;
  }
}
let scopedCellsReq = 0;
/** Zeros while loading, never another dataset's numbers. */
const overviewCells = computed(() => scopedCells.value ?? { today: 0, week: 0, all: 0 });

/** 'yyyy-mm-dd' on the player's own calendar: the day boundary the Today
 *  window uses (start of today, local). */
function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** A dense run of days from the first stamp to today, zeros where nothing happened. */
function denseDays(stamps: number[]): EffortDay[] {
  if (!stamps.length) return [];
  const counts = new Map<string, number>();
  let first = Infinity;
  for (const t of stamps) {
    first = Math.min(first, t);
    const k = localDay(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: EffortDay[] = [];
  const d = new Date(first); d.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(0, 0, 0, 0);
  for (; d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const k = localDay(d.getTime());
    out.push({ date: k, n: counts.get(k) ?? 0 });
  }
  return out;
}

async function loadScopedEdits() {
  refreshActiveDatasetCanon();
  const uid = viewingOtherUser.value ? props.viewUserId : backendStore.userId;
  const canon = activeDatasetCanon.value;
  const req = ++scopedEditsReq;
  scopedEditsFailed.value = false;
  // Every Pyr dataset (Ames 2026-10-11: the profile is your work in Pyr,
  // not the dataset on screen; her 118 cells were on other datasets and the
  // Sandbox profile said 0). Only the game's own log, as before.
  void canon;
  if (!uid) { scopedEdits.value = null; scopedEditDays.value = null; return; }
  try {
    const { supabase } = await import('../supabase');
    const rows: Array<{ operation: string; timestamp: string; success: boolean | null }> = [];
    const PAGE = 1000;  // PostgREST's default row cap per request
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('edit_log')
        .select('operation, timestamp, success')
        .eq('user_id', uid).in('operation', ['merge', 'split'])
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (req !== scopedEditsReq) return;  // a newer load superseded this one
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 86400000;
    const blank = (): EditWindow => ({ edits: 0, merges: 0, splits: 0 });
    const out = { today: blank(), week: blank(), all: blank() };
    const stamps: number[] = [];
    for (const r of rows) {
      if (r.success === false) continue;  // failed edits never counted toward users.total_edits
      const t = new Date(r.timestamp).getTime();
      stamps.push(t);
      const wins = [out.all];
      if (t >= weekAgo) wins.push(out.week);
      if (t >= startOfToday.getTime()) wins.push(out.today);
      for (const w of wins) {
        w.edits++;
        if (r.operation === 'merge') w.merges++; else w.splits++;
      }
    }
    scopedEdits.value = out;
    scopedEditDays.value = denseDays(stamps);
  } catch (e) {
    if (req !== scopedEditsReq) return;
    console.warn('[profile] per-dataset edits failed, showing all datasets:', e);
    scopedEdits.value = null;
    scopedEditDays.value = null;
    scopedEditsFailed.value = true;
  }
}
/** Cells completed on this dataset, in the game, in the same windows as the
 *  edits above, with one row per day for the curve. The list is the view the
 *  leaderboard and the career counter are built on, so the three numbers
 *  here can not disagree with them. */
async function loadScopedCompletions() {
  refreshActiveDatasetCanon();
  const uid = viewingOtherUser.value ? props.viewUserId : backendStore.userId;
  const canon = activeDatasetCanon.value;
  const req = ++scopedCellsReq;
  scopedCellsFailed.value = false;
  void canon;
  if (!uid) { scopedCells.value = null; scopedCellDays.value = null; scopedCompletionRows.value = null; return; }
  try {
    const { supabase } = await import('../supabase');
    const rows: Array<{ dataset: string; cell: string; done_at: string }> = [];
    const PAGE = 1000;  // PostgREST's default row cap per request
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('ew_cell_completions').select('dataset,cell,done_at')
        .eq('user_id', uid).order('cell', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (req !== scopedCellsReq) return;  // a newer load superseded this one
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 86400000;
    const out = { today: 0, week: 0, all: 0 };
    const stamps: number[] = [];
    const kept: Array<{ cell: string; done_at: string; dataset: string; t: number }> = [];
    for (const r of rows) {
      const t = new Date(r.done_at).getTime();
      if (!Number.isFinite(t)) continue;
      stamps.push(t);
      kept.push({ cell: String(r.cell), done_at: r.done_at, dataset: String(r.dataset ?? ''), t });
      out.all++;
      if (t >= weekAgo) out.week++;
      if (t >= startOfToday.getTime()) out.today++;
    }
    scopedCells.value = out;
    scopedCellDays.value = denseDays(stamps);
    scopedCompletionRows.value = kept.sort((a, b) => b.t - a.t).map(r => ({ cell: r.cell, done_at: r.done_at, dataset: r.dataset }));
  } catch (e) {
    if (req !== scopedCellsReq) return;
    console.warn('[profile] per-dataset completions failed:', e);
    scopedCells.value = null;
    scopedCellDays.value = null;
    scopedCompletionRows.value = null;
    scopedCellsFailed.value = true;
  }
}

loadScopedEdits();
loadScopedCompletions();
loadScopedIdentifications();
watch(() => backendStore.userId, () => { loadScopedEdits(); loadScopedCompletions(); loadScopedIdentifications(); });
// Re-scope when coming back to Overview (the Datasets tab can switch datasets).
watch(activeTab, tab => { if (tab === 'overview') { loadScopedEdits(); loadScopedCompletions(); loadScopedIdentifications(); } });

/** Edits section numbers: this dataset's, or career-wide if edit_log failed. */
const overviewEdits = computed(() => {
  const s = scopedEdits.value;
  if (s) return s;
  const p = profileStats.value;
  if (scopedEditsFailed.value) {
    return {
      today: { edits: p.editsToday, merges: p.mergesToday, splits: p.splitsToday },
      week:  { edits: p.editsThisWeek, merges: p.mergesThisWeek, splits: p.splitsThisWeek },
      all:   { edits: p.editsAllTime, merges: p.mergesAllTime, splits: p.splitsAllTime },
    };
  }
  // Still loading: zeros, never another dataset's numbers.
  const z = { edits: 0, merges: 0, splits: 0 };
  return { today: z, week: z, all: z };
});
/** True when the Edits numbers really are this dataset's. */
const editsScoped = computed(() => !!scopedEdits.value || (!scopedEditsFailed.value && !!activeDatasetCanon.value));

// Amy's untagged history is all MICrONS work from before cells carried a
// dataset tag (864691... roots, minnie65), so file it there for her (Amy
// 2026-09-25). Nobody else's untagged cells are guessed at: theirs could be
// any dataset, and they stay out of every per-dataset list.
const AMY_USER_ID = '146a3fec-ee5c-46f9-b1ac-b1ea57501f81';
watch(() => backendStore.userId, uid => {
  if (uid !== AMY_USER_ID) return;
  const n = historyStore.assignUntagged('minnie65_public');
  if (n) console.info(`[profile] filed ${n} untagged cells under MICrONS`);
}, { immediate: true });

// ── Cell history helpers ──────────────────────────────────────────────────────
/** This dataset's cells. Untagged legacy entries predate dataset tagging and
 *  can't be attributed to any dataset, so they no longer leak into every one
 *  (they showed MICrONS cells on the MEC profile). */
const filteredCellHistory = computed(() => {
  if (!activeDatasetCanon.value) return cellHistory.value;
  return cellHistory.value.filter(c => !!c.dataset && inScope(c.dataset));
});


/** Recent cells: the cells THIS PLAYER completed, from the server's list,
 *  the same rows as the Cells completed numbers. The list used to come from a
 *  history kept in the browser, which belongs to no player: a new player on a
 *  computer someone else had used, or anyone looking at another player's
 *  profile, saw that other person's cells (Ames 2026-10-14: a new player
 *  showing her cells under Recently completed). The browser's history now
 *  only adds what it knows about a cell (its type, the name you gave it, a
 *  star) on your own profile, and only for cells in your server list. */
const recentCells = computed<Array<CellHistoryEntry & { serverOnly?: boolean }>>(() => {
  const rows = scopedCompletionRows.value ?? [];
  const known = viewingOtherUser.value ? new Map<string, CellHistoryEntry>() : new Map(cellHistory.value.map(c => [c.segId, c]));
  const list = rows.map(r => {
    const cell = taskSegments.value[r.cell] ?? r.cell;
    const mine = known.get(cell);
    return mine
      ? { ...mine, segId: cell, isComplete: true, updatedAt: r.done_at, dataset: r.dataset }
      : { segId: cell, isComplete: true, cellType: '', position: [0, 0, 0] as [number, number, number],
          updatedAt: r.done_at, dataset: r.dataset, serverOnly: true };
  });
  // Starred cells first, then the newest; a cell finished twice (or by two
  // tasks) is listed once, at its latest.
  const seen = new Set<string>();
  return list
    .sort((x, y) => Number(!!y.isFavorite) - Number(!!x.isFavorite) || String(y.updatedAt).localeCompare(String(x.updatedAt)))
    .filter(c => !seen.has(c.segId) && !!seen.add(c.segId));
});

/** How many recently completed cells the overview shows; the rest are in
 *  My cells (Ames 2026-10-14: "profile should only load a small number here
 *  and if you want more go to 'my cells'"). */
const RECENT_SHOWN = 10;

/** A cell finished from the Cell Library is recorded as `task:<id>`, the
 *  proofreading task, not as a segment ID (Ames 2026-10-14: rows read
 *  "task:12659"). The task's segment, its final one when the task recorded
 *  one, is looked up for the rows shown. */
const taskSegments = ref<Record<string, string>>({});
const taskLookupsAsked = new Set<string>();
watch(() => (scopedCompletionRows.value ?? [])
    .slice().sort((x, y) => String(y.done_at).localeCompare(String(x.done_at)))
    .map(r => r.cell).filter(c => c.startsWith('task:') && !taskLookupsAsked.has(c)).slice(0, 60),
  async (cells) => {
    if (!cells.length) return;
    cells.forEach(c => taskLookupsAsked.add(c));
    const ids = cells.map(c => Number(c.slice(5))).filter(Number.isFinite);
    try {
      const { data, error } = await supabase.from('proofreading_tasks')
        .select('id, segment_id, final_segment_id').in('id', ids);
      if (error) throw error;
      const found: Record<string, string> = {};
      for (const t of data ?? []) {
        const seg = String(t.final_segment_id || t.segment_id || '');
        if (seg) found['task:' + t.id] = seg;
      }
      taskSegments.value = { ...taskSegments.value, ...found };
    } catch (e) {
      console.warn('[profile] task segments unavailable', e);
    }
  }, { immediate: true });

// ── 14-day activity chart data ───────────────────────────────────────────────
const last14Days = computed(() => {
  const days: Array<{ date: string; label: string; edits: number; completions: number; total: number }> = [];
  const log = statsStore.dailyLog;
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = log.find((e: {date: string}) => e.date === dateStr);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'narrow' });
    days.push({
      date: dateStr,
      label: i === 0 ? 'Today' : dayLabel,
      edits: entry?.edits ?? 0,
      completions: entry?.cellsCompleted ?? 0,
      total: (entry?.edits ?? 0) + (entry?.cellsCompleted ?? 0),
    });
  }
  return days;
});

const chartMax = computed(() => Math.max(1, ...last14Days.value.map(d => d.total)));

function truncateId(id: string): string {
  return id.length > 12 ? id.slice(0, 5) + '…' + id.slice(-5) : id;
}

function cellStatusIcon(cell: CellHistoryEntry): string {
  if (cell.isComplete && cell.cellType) return '✓';
  if (cell.isComplete) return '✓';
  if (cell.cellType) return '🏷';
  return '○';
}

function cellStatusClass(cell: CellHistoryEntry): string {
  if (cell.isComplete) return 'nge-cell-status--complete';
  if (cell.cellType) return 'nge-cell-status--typed';
  return 'nge-cell-status--pending';
}

function handleJumpToCell(segId: string) {
  historyStore.jumpToCell(segId);
  handleClose();
}

function promptNickname(segId: string) {
  const cell = cellHistory.value.find(c => c.segId === segId);
  const current = cell?.nickname ?? '';
  const name = window.prompt('Name this cell:', current);
  if (name !== null) {
    historyStore.setNickname(segId, name);
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Close animation ───────────────────────────────────────────────────────────
function handleClose() {
  if (closing.value) return;
  closing.value = true;
  setTimeout(() => emit('hide'), 165);
}

const emit = defineEmits({hide: null, 'open-settings': null});
// ── The row heads end above the Achievements' last tile ──────────────────
// The arrow to the Trophy Case (or the last tile shown) is the row's right
// edge, not the frame's (Ames 2026-10-13: "82 to go, 21 to go etc should
// sit above the arrow"). The arrow's column belongs to the tile grid, so
// each head's width is measured from it: the count's centre lands on the
// arrow's centre, and the bar ends just before the count.
let headsRo: ResizeObserver | null = null;
let headsTimer = 0;
function layoutTrackHeads() {
  const root = shellEl.value;
  if (!root) return;
  const mobile = document.body.classList.contains('nge-mobile');
  for (const row of Array.from(root.querySelectorAll<HTMLElement>('.nge-track-row'))) {
    const head = row.querySelector<HTMLElement>('.nge-track-head');
    if (!head) continue;
    const tiles = row.querySelectorAll<HTMLElement>('.nge-track-achievements .nge-profile-badge');
    const last = tiles[tiles.length - 1];
    if (!last || mobile) { head.style.removeProperty('--head-end'); continue; }
    const art = last.querySelector<HTMLElement>('.nge-profile-badge-img') ?? last;
    const r = row.getBoundingClientRect(), a = art.getBoundingClientRect();
    const count = head.querySelector<HTMLElement>('.nge-track-count');
    const end = a.left + a.width / 2 - r.left + (count ? count.offsetWidth / 2 : 0);
    head.style.setProperty('--head-end', `${Math.round(end)}px`);
  }
}
function scheduleTrackHeads() {
  void nextTick(layoutTrackHeads);
  // the count rolls up for a moment after a load: measure again once it has settled
  clearTimeout(headsTimer);
  headsTimer = window.setTimeout(layoutTrackHeads, 1800);
}
onMounted(() => {
  scheduleTrackHeads();
  if (typeof ResizeObserver !== 'undefined' && shellEl.value) {
    headsRo = new ResizeObserver(() => layoutTrackHeads());
    headsRo.observe(shellEl.value);
  }
});
onUnmounted(() => { headsRo?.disconnect(); headsRo = null; clearTimeout(headsTimer); });
watch([activeTab, compactRows, tinyRows, overviewEdits, overviewCells,
       () => displayedExplorationBadges.value.length, () => displayedBuildingBadges.value.length,
       () => earnedLoyaltyBadges.value.earned.length], scheduleTrackHeads);
// ── The Overview builds top to bottom (Ames 2026-10-17: "load one section
// at a time, top to bottom") ────────────────────────────────────────────────
// A row is live once its data is in and the row above has had its turn: its
// head trace, count, numbers, curve and tiles then appear together, instead
// of each piece landing whenever its answer arrives (the head's line was
// re-fitted after its count rolled, the curve drew seconds after the
// numbers). The first open of a session plays the build at full pace (the
// first row 0.3 s in, then 0.26 s apart), later opens at half that, and
// reduced motion and Calm screen skip the gaps (Ames 2026-10-17: "do you
// think it loads too slowly?").
const revealStage = ref(0);  // 0 none, 1 cells, 2 edits, 3 days, 4 the rest
const cellsReady = computed(() => scopedCells.value !== null || scopedCellsFailed.value);
const editsReady = computed(() => scopedEdits.value !== null || scopedEditsFailed.value);
const quickBuild = (() => { try { const seen = sessionStorage.getItem('nge-profile-built'); sessionStorage.setItem('nge-profile-built', '1'); return !!seen; } catch { return false; } })();
const STAGE_GAP = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : quickBuild ? 130 : 260;
const FIRST_AT = STAGE_GAP ? (quickBuild ? 150 : 300) : 0;  // just after the frame's 0.28 s open, so the first head is fitted to a still frame
let stageTimer = 0;
let stageAt = 0;
function stageReady(k: number): boolean { return k === 1 ? cellsReady.value : k === 2 ? editsReady.value : true; }
function advanceStage() {
  clearTimeout(stageTimer);
  const next = revealStage.value + 1;
  if (next > 4 || !stageReady(next)) return;  // the data watcher calls again
  const wait = Math.max(0, stageAt + STAGE_GAP - performance.now());
  stageTimer = window.setTimeout(() => {
    if (!stageReady(next)) return;
    revealStage.value = next;
    stageAt = performance.now();
    void nextTick(layoutTrackHeads);
    advanceStage();
  }, wait);
}
onMounted(() => { stageAt = performance.now() - STAGE_GAP + FIRST_AT; advanceStage(); });  // the first row as the frame's open ends
watch([cellsReady, editsReady], () => advanceStage());
onUnmounted(() => clearTimeout(stageTimer));
</script>

<template>
  <modal-overlay
    id="nge-profile-modal"
    class="nge-profile-modal"
    :class="{ 'nge-profile-closing': closing }"
    @hide="handleClose"
  >
    <div ref="shellEl" class="nge-profile-shell" :class="{ 'nge-profile-shell--trophy': activeTab === 'trophyCase', 'nge-profile-shell--admin': activeTab === 'adminHub', 'nge-profile-shell--week': activeTab === 'weekInScience', 'nge-profile-shell--datasets': activeTab === 'datasets', 'nge-profile-shell--dstats': activeTab === 'datasetStats', 'nge-profile-shell--settings': activeTab === 'settings' }">

      <!-- The "Researcher profile" bar went (Ames 2026-10-22: "the top bar can go, put X on same line
           as Overview"): the × closes from the end of the tab row. -->
      <!-- ── Tab bar ─────────────────────────────────────────── -->
      <div class="nge-profile-tabbar">
        <button
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'overview' }"
          @click="activeTab = 'overview'"
        >Overview</button>
        <button
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'trophyCase' }"
          @click="activeTab = 'trophyCase'"
        >🏆 Trophy Case</button>
        <button
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'myCells' }"
          @click="activeTab = 'myCells'"
        >🔬 {{ viewingOtherUser ? 'Cells' : 'My Cells' }}</button>
        <button
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'datasets' }"
          @click="activeTab = 'datasets'"
        >🧬 Datasets</button>
        <!-- The whole dataset, not this person (Ames 2026-10-06). Phones use
             the narrow panel instead, from the Datasets tab or the leaderboard. -->
        <button
          v-if="!isMobileRef"
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'datasetStats' }"
          @click="activeTab = 'datasetStats'"
        >📊 Dataset Stats</button>
        <!-- Hidden by default (Amy 2026-08-11): the tab button only appears
             while you're ON it, i.e. arrived via the toolbar Week icon or a
             recap notification deep-link. -->
        <button
          v-if="!viewingOtherUser && activeTab === 'weekInScience'"
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': true }"
          @click="openWeekInScience()"
        ><span class="nge-profile-tab-svg" v-html="recapIconSvg"></span> My Week in Science</button>
        <button
          v-if="!viewingOtherUser"
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'settings' }"
          @click="activeTab = 'settings'"
        >⚙️ Settings</button>
        <button
          v-if="!viewingOtherUser && backendStore.showAdminUi"
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'adminHub' }"
          @click="activeTab = 'adminHub'"
        >🛠 Admin Hub</button>
        <button
          v-if="!viewingOtherUser && backendStore.isBlogAuthor"
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'blog' }"
          @click="activeTab = 'blog'"
        >✍️ Blog</button>
        <button class="nge-profile-exit nge-profile-exit--tabs" title="Close" aria-label="Close the profile" @click="handleClose">×</button>
      </div>

      <!-- ── Three-column body (Overview tab) ────────────────── -->
      <div v-if="activeTab === 'overview'" class="nge-profile-body nge-profile-body--overview">

        <!-- LEFT: stats + recent cells -->
        <!-- MAIN: the old left and middle columns as one area of rows, one per
             track, so the rows line up across: a track's stats and curve beside
             its Achievements (Ames 2026-10-11, "make sure the rows are aligned,
             like across cells, edits, loyalty"). The last row holds the rest. -->
        <div class="nge-profile-col nge-profile-col--left nge-profile-col--main" :class="{ 'is-compact': compactRows, 'is-tiny': tinyRows }">

          <!-- Header -->
          <div class="nge-profile-header" v-if="sessions.length > 0 || viewingOtherUser">
            <div class="nge-profile-header-main">
            <div class="nge-profile-name-row">

              <!-- Flag (editable only for own profile) -->
              <div v-if="!viewingOtherUser" id="nge-profile-flag-wrap" class="nge-profile-flag-wrap" @click.stop>
                <button
                  class="nge-profile-flag"
                  :class="{ 'nge-profile-flag--active': showFlagPicker }"
                  @click="showFlagPicker = !showFlagPicker"
                  title="Click to change flag"
                >
                  <img v-if="isEyewireFlag(profileFlag)" :src="pyrIcon" class="nge-flag-img nge-pyr-icon" />
                  <img v-else-if="flagImgUrl(profileFlag)" :src="flagImgUrl(profileFlag)" class="nge-flag-img" />
                  <img v-else :src="pyrIcon" class="nge-flag-img nge-pyr-icon" />
                </button>
                <Transition name="nge-flag-picker">
                  <div v-if="showFlagPicker" class="nge-profile-flag-picker">
                    <button
                      v-for="f in ALL_FLAGS" :key="f"
                      class="nge-profile-flag-opt"
                      :class="{ 'nge-profile-flag-opt--active': prefs.flag === f }"
                      @click="setFlag(f)"
                    ><img :src="flagImgUrl(f)" class="nge-flag-img nge-flag-img--picker" /></button>
                  </div>
                </Transition>
              </div>
              <div v-else class="nge-profile-flag-wrap">
                <img v-if="isEyewireFlag(profileFlag)" :src="pyrIcon" class="nge-flag-img nge-pyr-icon" style="width:24px;height:24px;" />
                <img v-else-if="flagImgUrl(profileFlag)" :src="flagImgUrl(profileFlag)" class="nge-flag-img" style="width:28px;height:20px;" />
              </div>

              <!-- The username, when there is one: it is the name players know
                   you by in chat (Ames 2026-10-11). The display name is the tooltip. -->
              <div class="nge-profile-name" :title="profileUsername ? profileName : undefined">{{ profileUsername || profileName }}</div>

              <button v-if="!viewingOtherUser" class="nge-profile-edit-btn"
                      @click="activeTab = 'settings'"
                      title="Edit Profile — set bio, flag, and more">⚙</button>
            </div>


            <!-- Email is deliberately NOT shown. It was rendered for whoever's
                 profile was open, which exposed other users' addresses to
                 anyone who clicked their name in chat. The username is the
                 public identifier; the address stays private. -->


            <template v-if="!viewingOtherUser">
              <div class="nge-profile-bio" v-if="prefs.bio">{{ prefs.bio }}</div>
              <button v-else class="nge-profile-bio-add" @click="activeTab = 'settings'">
                + Add a bio
              </button>
            </template>
            </div>
            <!-- Special Awards and, for the builder, Building Pyr sit beside the
                 name (Ames 2026-10-11: "special awards are too far down", "move
                 building Pyr to the top row"). -->
            <div class="nge-profile-header-side">
          <!-- Special Awards (admin-awarded badges) -->
          <template v-if="plainSpecialBadges.length > 0 || competitionMedals.length > 0">
            <div class="nge-profile-section nge-profile-section--badges nge-profile-section--special">
              <div v-if="plainSpecialBadges.length > 0" class="nge-profile-section-label">★ Special Awards</div>
              <div class="nge-profile-badges-grid">
                <div
                  v-for="award in displayedSpecialBadges"
                  :key="award.id"
                  class="nge-profile-badge"
                  :class="{ 'nge-profile-badge--selected': selectedSpecialBadge?.id === award.id }"
                  :title="specialBadgeTooltip(award)"
                  @click="onSpecialBadgeClick(award)"
                >
                  <div class="nge-profile-badge-img">
                    <img :src="award.badge?.thumbnail_url || award.badge?.image_url" :alt="award.badge?.name" class="nge-profile-badge-icon" />
                  </div>
                  <div class="nge-profile-badge-name">{{ award.badge?.name || 'Award' }}</div>
                </div>
                <!-- The Hunt medals, each once with how many times it was won (Ames 2026-10-21) -->
                <span v-if="plainSpecialBadges.length > 0 && competitionMedals.length > 0" class="nge-profile-medal-gap" aria-hidden="true"></span>
                <div
                  v-for="m in competitionMedals"
                  :key="m.tier"
                  class="nge-profile-badge nge-profile-badge--medal"
                  :class="{ 'nge-profile-badge--selected': medalSelected(m) }"
                  :title="medalTooltip(m)"
                  @click="onMedalClick(m)"
                >
                  <div class="nge-profile-badge-img">
                    <img :src="medalArt(m)" :alt="MEDAL_WORD[m.tier]" class="nge-profile-badge-icon" />
                    <span v-if="m.count > 1" class="nge-medal-count" :aria-label="`won ${m.count} times`">×{{ m.count }}</span>
                  </div>
                  <div class="nge-profile-badge-name">{{ MEDAL_WORD[m.tier] }}</div>
                </div>
                <!-- View All tile when overflow -->
                <div
                  v-if="showSpecialViewAll"
                  class="nge-profile-badge nge-profile-badge--viewall"
                  title="View all special awards"
                  @click="showAllSpecialModal = true"
                >
                  <div class="nge-profile-badge-img">
                    <svg class="nge-profile-badge-viewall-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div class="nge-profile-badge-name">View all</div>
                </div>
              </div>
            </div>
          </template>
          <!-- Cells identified: cells whose type this player set, each once.
               Beside the name until the Identification track has a row of
               its own (Ames 2026-10-12: "put cells identified where Building
               Pyr is; eventually it will be a new row"). -->
          <div class="nge-profile-section nge-profile-section--identified">
            <div class="nge-profile-section-label">▌ Cells identified</div>
            <div class="nge-profile-stat-row nge-profile-stat-row--tiles">
              <div class="nge-profile-stat-col nge-profile-stat-tile nge-profile-stat-tile--identified" :title="(viewingOtherUser ? 'Cells whose type this player set' : 'Cells whose type you set') + ' in Pyr, on its real datasets (the Sandbox does not count). A cell counts once, by its latest type; Unknown or Unsure does not count. Not annotation points.'">
                <div class="nge-profile-stat-label">All time</div>
                <div v-if="scopedIdentifiedFailed" class="nge-profile-stat-val nge-profile-stat-val--na" title="Not available right now">n/a</div>
                <div v-else class="nge-profile-stat-val nge-profile-stat-val--hero"><RollUp :value="scopedIdentified ?? 0" /></div>
              </div>
            </div>
          </div>
            </div>
          </div>


          <div class="nge-track-rows">

            <div class="nge-track-row nge-track-row--cells" :class="{ 'is-live': revealStage >= 1 }">
              <!-- One head for the row (Ames 2026-10-11): the label, a circuit
                   trace to a pad, a second pad the same small distance away in
                   every row, and from it the bar toward the next Achievement,
                   lit as far as the count has come, with how many to go at its
                   end. The layer tabs' language, where a trace breaks at a
                   component; the break lands where each label ends. -->
              <div class="nge-track-head" :style="{ '--frac': (nextExplorationAchievement) ? (nextExplorationAchievement).pct / 100 : 1 }">
                <div class="nge-profile-section-label" title="Cells proofread all the way to completion in Pyr, on any of its datasets; a cell completed again after an edit counts once. Cells marked in other tools are not counted. At the right, your Cell Completion Achievements.">▌ Cells completed</div>
                <div class="nge-track-wire" aria-hidden="true"></div>
                <div class="nge-track-pads" aria-hidden="true"></div>
                <div class="nge-track-bar" :title="(nextExplorationAchievement) ? (nextExplorationAchievement).pct + '% of the way to your next Achievement' : 'Every Achievement on this track is yours'"></div>
                <div v-if="nextExplorationAchievement" class="nge-track-count" :title="(nextExplorationAchievement).remaining.toLocaleString() + ' more cells to your next Achievement'">{{ (nextExplorationAchievement).remaining.toLocaleString() }} to go</div>
              </div>
              <div class="nge-track-stats">
          <!-- Cells completed on this dataset, in the game, by the completed
               cell rule: the same three windows as edits, from the completions
               list with each cell's completion moment, and the same curve
               under them (Ames 2026-10-11). Shown on every profile. -->
          <div class="nge-profile-section nge-profile-section--completions nge-profile-section--windows">
            <div v-if="scopedCellsFailed" class="nge-profile-stat-unavailable">Not available right now</div>
            <div v-else class="nge-profile-feature-row">
              <!-- the latest Cell Completions Achievement; its name is the tooltip -->
              <div v-if="latestExplorationBadge" class="nge-profile-feature" :title="badgeTooltip(latestExplorationBadge)" @click="onBadgeClick(latestExplorationBadge)">
                <img :src="getBadgeUrl(latestExplorationBadge.imageKey)" :alt="latestExplorationBadge.name" class="nge-profile-feature-icon" :class="`nge-badge--${latestExplorationBadge.slug}`" />
              </div>
            <div class="nge-profile-windows">
              <!-- No curve on the compact layout (a laptop, or a small screen
                   zoomed in): the draw stuttered and the sliver it had there
                   was not worth the room (Ames 2026-10-16, Annkri's profile). -->
              <EffortCurve v-if="!compactRows" :active="revealStage >= 1" :days="scopedCellDays ?? []" color="144 255 242" unit="cells" :span="curveSpan" :spans="CURVE_SPANS" @update:span="setCurveSpan" />
              <div class="nge-profile-stat-row">
                <div class="nge-profile-stat-col" :class="{ 'nge-profile-stat-col--all': i === 2 }" v-for="(col, i) in [
                  {label:'Today',    val:overviewCells.today},
                  {label:'Past 7d',  val:overviewCells.week},
                  {label:'All Time', val:overviewCells.all},
                ]" :key="i">
                  <div class="nge-profile-stat-label">{{ col.label }}</div>
                  <div class="nge-profile-stat-val"><RollUp :value="revealStage >= 1 ? col.val : 0" /></div>
                </div>
              </div>
            </div>
            </div>
          </div>

              </div>
              <div class="nge-track-achievements">
          <!-- Cell Completions (exploration track): first, above Editor
               Achievements (Ames 2026-10-08) -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in displayedExplorationBadges"
                :key="badge.id"
                class="nge-profile-badge nge-profile-badge--exploration"
                :class="{
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                  'nge-profile-badge--latest': latestEarnedBadge?.id === badge.id,
                }"
                :title="badgeTooltip(badge)"
                @click="onBadgeClick(badge)"
              >
                <div class="nge-profile-badge-img">
                  <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-profile-badge-icon" :class="`nge-badge--${badge.slug}`" />
                </div>
                <div class="nge-profile-badge-name">{{ badge.name }}</div>
              </div>
              <!-- Next locked badge teaser -->
              <div
                v-if="earnedExplorationBadges.next && !showExplorationViewAll"
                class="nge-profile-badge nge-profile-badge--locked"
                :title="'Next: complete more cells to unlock!'"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-mystery">
                    <span class="nge-profile-badge-mystery-q">?</span>
                  </div>
                </div>
              </div>
              <!-- "View All" tile at end of row 2 -->
              <div
                v-if="showExplorationViewAll && !showAllExploration"
                class="nge-profile-badge nge-profile-badge--viewall"
                title="View all Achievements in the Trophy Case"
                @click="activeTab = 'trophyCase'"
              >
                <div class="nge-profile-badge-img">
                  <svg class="nge-profile-badge-viewall-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="nge-profile-badge-name">View all</div>
              </div>
            </div>
            <div v-if="earnedExplorationBadges.earned.length === 0" class="nge-profile-badges-empty">
              Complete your first cell to earn an Achievement!
            </div>
          </div>

          <!-- Divider between achievement tracks -->
              </div>
            </div>

            <div class="nge-track-row nge-track-row--edits" :class="{ 'is-live': revealStage >= 2 }">
              <!-- One head for the row (Ames 2026-10-11): the label, a circuit
                   trace to a pad, a second pad the same small distance away in
                   every row, and from it the bar toward the next Achievement,
                   lit as far as the count has come, with how many to go at its
                   end. The layer tabs' language, where a trace breaks at a
                   component; the break lands where each label ends. -->
              <div class="nge-track-head" :style="{ '--frac': (nextBuildingAchievement) ? (nextBuildingAchievement).pct / 100 : 1 }">
                <div class="nge-profile-section-label" title="Splits and merges you made in Pyr, on any of its datasets; edits made in other tools, or before you joined, are not counted. At the right, your Editor Achievements.">▌ Edits in Pyr</div>
                <div class="nge-track-wire" aria-hidden="true"></div>
                <div class="nge-track-pads" aria-hidden="true"></div>
                <div class="nge-track-bar" :title="(nextBuildingAchievement) ? (nextBuildingAchievement).pct + '% of the way to your next Achievement' : 'Every Achievement on this track is yours'"></div>
                <div v-if="nextBuildingAchievement" class="nge-track-count" :title="(nextBuildingAchievement).remaining.toLocaleString() + ' more edits to your next Achievement'">{{ (nextBuildingAchievement).remaining.toLocaleString() }} to go</div>
              </div>
              <div class="nge-track-stats">
          <!-- Edits stats -->
          <div class="nge-profile-section nge-profile-section--edits nge-profile-section--windows">
            <!-- Ames 2026-10-05: these count edits made in the game only.
                 A player with months of earlier work elsewhere read a small
                 number here as their work having gone missing. -->
            <div class="nge-profile-feature-row">
              <!-- the latest Editor Achievement; its name is the tooltip -->
              <div v-if="latestBuildingBadge" class="nge-profile-feature" :title="badgeTooltip(latestBuildingBadge)" @click="onBadgeClick(latestBuildingBadge)">
                <img :src="getBadgeUrl(latestBuildingBadge.imageKey)" :alt="latestBuildingBadge.name" class="nge-profile-feature-icon" :class="`nge-badge--${latestBuildingBadge.slug}`" />
              </div>
            <div class="nge-profile-windows">
            <!-- The same rows as the three numbers, as a line from the first
                 day to today (Ames 2026-10-11). Nothing while they load, and
                 nothing for the career fallback, which has no days. -->
            <EffortCurve v-if="!compactRows" :active="revealStage >= 2" :days="scopedEditDays ?? []" color="255 208 138" unit="edits" :span="curveSpan" :spans="CURVE_SPANS" @update:span="setCurveSpan" />
            <div class="nge-profile-stat-row">
              <div class="nge-profile-stat-col" :class="{ 'nge-profile-stat-col--all': i === 2 }" v-for="(col, i) in [
                {label:'Today',    val:overviewEdits.today.edits, merges:overviewEdits.today.merges, splits:overviewEdits.today.splits},
                {label:'Past 7d',  val:overviewEdits.week.edits,  merges:overviewEdits.week.merges,  splits:overviewEdits.week.splits},
                {label:'All Time', val:overviewEdits.all.edits,   merges:overviewEdits.all.merges,   splits:overviewEdits.all.splits},
              ]" :key="i">
                <div class="nge-profile-stat-label">{{ col.label }}</div>
                <div class="nge-profile-stat-val"><RollUp :value="revealStage >= 2 ? col.val : 0" /></div>
                <div class="nge-profile-stat-breakdown">
                  <span class="nge-profile-stat-bp" title="Merges">
                    <svg class="nge-profile-stat-icon nge-profile-stat-icon--merge" viewBox="0 0 16 16" fill="none">
                      <path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <circle cx="4" cy="2.5" r="1.5" fill="currentColor"/>
                      <circle cx="12" cy="2.5" r="1.5" fill="currentColor"/>
                      <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
                      <path d="M8 11v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                    {{ col.merges }}
                  </span>
                  <span class="nge-profile-stat-bp" title="Splits">
                    <svg class="nge-profile-stat-icon nge-profile-stat-icon--split" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <circle cx="8" cy="2.5" r="1.5" fill="currentColor"/>
                      <circle cx="4" cy="13" r="1.5" fill="currentColor"/>
                      <circle cx="12" cy="13" r="1.5" fill="currentColor"/>
                      <path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                    {{ col.splits }}
                  </span>
                </div>
              </div>
            </div>
            </div>
            </div>
          </div>

              </div>
              <div class="nge-track-achievements">
          <!-- Editor Achievements (building track) -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in displayedBuildingBadges"
                :key="badge.id"
                class="nge-profile-badge nge-profile-badge--building"
                :class="{
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                  'nge-profile-badge--latest': latestEarnedBadge?.id === badge.id,
                }"
                :title="badgeTooltip(badge)"
                @click="onBadgeClick(badge)"
              >
                <div class="nge-profile-badge-img">
                  <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-profile-badge-icon" :class="`nge-badge--${badge.slug}`" />
                </div>
                <div class="nge-profile-badge-name">{{ badge.name }}</div>
              </div>
              <!-- Next locked badge teaser -->
              <div
                v-if="earnedBuildingBadges.next && !showBuildingViewAll"
                class="nge-profile-badge nge-profile-badge--locked"
                :title="'Next: keep editing to unlock!'"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-mystery">
                    <span class="nge-profile-badge-mystery-q">?</span>
                  </div>
                </div>
              </div>
              <!-- "View All" tile at end of row 2 -->
              <div
                v-if="showBuildingViewAll && !showAllBuilding"
                class="nge-profile-badge nge-profile-badge--viewall"
                title="View all Achievements in the Trophy Case"
                @click="activeTab = 'trophyCase'"
              >
                <div class="nge-profile-badge-img">
                  <svg class="nge-profile-badge-viewall-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="nge-profile-badge-name">View all</div>
              </div>
            </div>
            <div v-if="earnedBuildingBadges.earned.length === 0" class="nge-profile-badges-empty">
              Make your first edit to earn an Achievement!
            </div>
          </div>

              </div>
            </div>

            <div v-if="totalDays > 0 || LOYALTY_BADGES.length" class="nge-track-row nge-track-row--days" :class="{ 'is-live': revealStage >= 3 }">
              <!-- One head for the row (Ames 2026-10-11): the label, a circuit
                   trace to a pad, a second pad the same small distance away in
                   every row, and from it the bar toward the next Achievement,
                   lit as far as the count has come, with how many to go at its
                   end. The layer tabs' language, where a trace breaks at a
                   component; the break lands where each label ends. -->
              <div class="nge-track-head" :style="{ '--frac': (nextLoyaltyAchievement) ? (nextLoyaltyAchievement).pct / 100 : 1 }">
                <div class="nge-profile-section-label" title="Every day you have shown up, ever. At the right, your Days Achievements.">▌ Days helping science in Pyr</div>
                <div class="nge-track-wire" aria-hidden="true"></div>
                <div class="nge-track-pads" aria-hidden="true"></div>
                <div class="nge-track-bar" :title="(nextLoyaltyAchievement) ? (nextLoyaltyAchievement).pct + '% of the way to your next Achievement' : 'Every Achievement on this track is yours'"></div>
                <div v-if="nextLoyaltyAchievement" class="nge-track-count" :title="(nextLoyaltyAchievement).remaining.toLocaleString() + ' more days to your next Achievement'">{{ (nextLoyaltyAchievement).remaining.toLocaleString() }} to go</div>
              </div>
              <div class="nge-track-stats">
          <!-- Days: total days shown up (never resets), the streaks, and the
               ladder of milestones (Ames 2026-10-06). Three plain columns, no
               boxes (Ames 2026-10-11). -->
          <div v-if="totalDays > 0" class="nge-profile-section nge-profile-section--days">
            <div class="nge-profile-days-row">
              <!-- The latest Days Achievement, at the left. Streak and best
                   streak are not repeated here: they sit on the right under
                   Streak (Ames 2026-10-11). -->
              <div v-if="latestLoyaltyBadge" class="nge-profile-feature" :title="badgeTooltip(latestLoyaltyBadge)" @click="onBadgeClick(latestLoyaltyBadge)">
                <img :src="getBadgeUrl(latestLoyaltyBadge.imageKey)" :alt="latestLoyaltyBadge.name" class="nge-profile-feature-icon" :class="`nge-badge--${latestLoyaltyBadge.slug}`" />
              </div>
              <div class="nge-profile-stat-col" title="Every day you have shown up, ever. This never resets.">
                <div class="nge-profile-stat-label">Total days</div>
                <div class="nge-profile-stat-val nge-profile-stat-val--hero"><RollUp :value="revealStage >= 3 ? totalDays : 0" /></div>
                <!-- no pills and no bar (Ames 2026-10-06: "unnecessary", "too much"): the count says it -->
                <div class="nge-days-next" :title="`Next milestone: day ${nextDay}`">{{ (nextDay - totalDays).toLocaleString() }} {{ nextDay - totalDays === 1 ? 'day' : 'days' }} to day {{ nextDay.toLocaleString() }}</div>
              </div>
            </div>
          </div>

              </div>
              <div class="nge-track-achievements">
          <!-- Loyalty Achievements: total days, not in a row (Ames 2026-10-06).
               Hidden while the set is switched off (LOYALTY_ENABLED). -->
          <div v-if="LOYALTY_BADGES.length" class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in earnedLoyaltyBadges.earned.slice(1, 5)"
                :key="badge.id"
                class="nge-profile-badge nge-profile-badge--loyalty"
                :class="{ 'nge-profile-badge--selected': selectedBadge?.id === badge.id }"
                :title="badgeTooltip(badge)"
                @click="onBadgeClick(badge)"
              >
                <div class="nge-profile-badge-img">
                  <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-profile-badge-icon" :class="`nge-badge--${badge.slug}`" />
                </div>
                <div class="nge-profile-badge-name">{{ badge.name }}</div>
              </div>
              <div
                v-if="earnedLoyaltyBadges.next && earnedLoyaltyBadges.earned.length < 5"
                class="nge-profile-badge nge-profile-badge--locked"
                :title="`Next: ${earnedLoyaltyBadges.next.threshold} days of science`"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-mystery">
                    <span class="nge-profile-badge-mystery-q">?</span>
                  </div>
                </div>
              </div>
              <div
                v-if="earnedLoyaltyBadges.earned.length >= 5"
                class="nge-profile-badge nge-profile-badge--viewall"
                title="View all achievements in Trophy Case"
                @click="activeTab = 'trophyCase'"
              >
                <div class="nge-profile-badge-img">
                  <svg class="nge-profile-badge-viewall-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="nge-profile-badge-name">View all</div>
              </div>
            </div>
            <div v-if="earnedLoyaltyBadges.earned.length === 0" class="nge-profile-badges-empty">
              Make an edit on two different days to earn your first Loyalty achievement!
            </div>
          </div>

              </div>
            </div>

            <div class="nge-track-row nge-track-row--rest" :class="{ 'is-live': revealStage >= 4 }">
              <div class="nge-track-stats">
          <!-- Your recently completed cells: the browser's own history, or,
               when that is empty, the server's completions (recentCells). The
               row takes the height left under the three above and the list
               scrolls inside it, so the profile never scrolls as a whole
               (Ames 2026-10-11). -->
          <div class="nge-profile-section nge-profile-section--cells">
            <div class="nge-cell-list" v-if="recentCells.length > 0">
              <div class="nge-cell-list-header">
                <span class="nge-cell-list-title">{{ viewingOtherUser ? 'Recently completed cells' : 'My recently completed cells' }}</span>
                <button class="nge-cell-list-all" @click="activeTab = 'myCells'" title="Every cell, by dataset">{{ viewingOtherUser ? 'All cells' : 'My cells' }} →</button>
              </div>
              <div class="nge-cell-list-columns">
                <span class="nge-cell-col-label nge-cell-col-label--id">Segment</span>
                <span class="nge-cell-col-label nge-cell-col-label--type">Type</span>
                <span class="nge-cell-col-label nge-cell-col-label--time">When</span>
              </div>
              <div class="nge-cell-list-scroll">
                <div
                  v-for="cell in recentCells.slice(0, RECENT_SHOWN)"
                  :key="cell.segId"
                  class="nge-cell-row"
                  :title="cell.nickname ? `${cell.nickname} (${cell.segId})` : `Jump to ${cell.segId}`"
                >
                  <button
                    v-if="!cell.serverOnly"
                    class="nge-cell-fav"
                    :class="{ 'nge-cell-fav--active': cell.isFavorite }"
                    @click.stop="historyStore.toggleFavorite(cell.segId)"
                    title="Toggle favorite"
                  >{{ cell.isFavorite ? '★' : '☆' }}</button>
                  <span class="nge-cell-pip" :class="cellStatusClass(cell)">{{ cellStatusIcon(cell) }}</span>
                  <span class="nge-cell-id" @click="handleJumpToCell(cell.segId)">
                    {{ cell.nickname || truncateId(cell.segId) }}
                  </span>
                  <span class="nge-cell-type" v-if="cell.cellType" @click="handleJumpToCell(cell.segId)">{{ cell.cellType }}</span>
                  <span class="nge-cell-time" @click="handleJumpToCell(cell.segId)">{{ relativeTime(cell.updatedAt) }}</span>
                  <button
                    v-if="!cell.serverOnly"
                    class="nge-cell-rename"
                    @click.stop="promptNickname(cell.segId)"
                    title="Rename this cell"
                  >✎</button>
                </div>
              </div>
              <button v-if="recentCells.length > RECENT_SHOWN" class="nge-cell-list-more" @click="activeTab = 'myCells'">{{ (recentCells.length - RECENT_SHOWN).toLocaleString() }} more in {{ viewingOtherUser ? 'All cells' : 'My cells' }} →</button>
            </div>
            <div class="nge-cell-empty" v-else>
No cells completed yet. <template v-if="!viewingOtherUser">Your recently completed cells will show here.</template>
            </div>
          </div>
              </div>
              <div class="nge-track-achievements nge-track-achievements--rest">
          <!-- the Scout report (your tags), or another player's annotations -->
          <div class="nge-profile-section nge-profile-section--scout">
            <template v-if="!viewingOtherUser">
            <!-- Scout Report: tags placed and fixed -->
            <div class="nge-profile-section-label">▌ Scout Report</div>
            <div class="nge-profile-stat-row nge-profile-stat-row--scout" style="margin-bottom: 12px;">
              <div class="nge-profile-stat-col" title="Tags you placed for others to fix">
                <div class="nge-profile-stat-label">Tags Placed</div>
                <div class="nge-profile-stat-val" style="color: #f5d142;"><RollUp :value="myTagsPlaced.length" /></div>
              </div>
              <div class="nge-profile-stat-col" title="Tags of yours that someone fixed">
                <div class="nge-profile-stat-label">Confirmed</div>
                <div class="nge-profile-stat-val"><RollUp :value="myTagsFixed.length" /></div>
              </div>
              <div class="nge-profile-stat-col" title="Tags you fixed for others">
                <div class="nge-profile-stat-label">You Fixed</div>
                <div class="nge-profile-stat-val" style="color: #9d9;"><RollUp :value="tagsIFixed.length" /></div>
              </div>
              <div class="nge-profile-stat-col" title="Other players' help requests you replied to, one each, on every dataset">
                <div class="nge-profile-stat-label">Assists</div>
                <div class="nge-profile-stat-val" style="color: #7f8;"><RollUp :value="playerAssists" /></div>
              </div>
              <!-- Annotations placed, on every dataset: a column here rather than
                   a row of its own (Ames 2026-10-11). -->
              <div class="nge-profile-stat-col" title="Points, lines and boxes you placed in annotation layers, on every dataset">
                <div class="nge-profile-stat-label">Annotations</div>
                <div class="nge-profile-stat-val" style="color: #c9a0ff; text-shadow: 0 0 14px rgba(201, 160, 255, 0.35);"><RollUp :value="annotationsPlaced" /></div>
              </div>
              <!-- Annotation quests completed, from the quest sheet (2026-10-13). -->
              <div class="nge-profile-stat-col" title="Annotation quests you completed: cells whose cilia you marked and sent to the lab's sheet">
                <div class="nge-profile-stat-label">Quests</div>
                <div class="nge-profile-stat-val" style="color: #7fe0ff; text-shadow: 0 0 14px rgba(127, 224, 255, 0.35);">
                  <RollUp v-if="questsCompleted !== null" :value="questsCompleted" />
                  <span v-else class="nge-profile-stat-na" title="The quest sheet could not be read just now">not available</span>
                </div>
              </div>
            </div>
            </template>
            <template v-else>
            <div class="nge-profile-section-label">▌ Annotations and Assists</div>
            <div class="nge-profile-stat-row" style="margin-bottom: 12px;">
              <div class="nge-profile-stat-col" title="Points, lines and boxes this player has placed in annotation layers, on every dataset">
                <div class="nge-profile-stat-label">Annotations</div>
                <div class="nge-profile-stat-val" style="color: #c9a0ff; text-shadow: 0 0 14px rgba(201, 160, 255, 0.35);"><RollUp :value="annotationsPlaced" /></div>
              </div>
              <div class="nge-profile-stat-col" title="Other players' help requests this player replied to, one each, on every dataset">
                <div class="nge-profile-stat-label">Assists</div>
                <div class="nge-profile-stat-val" style="color: #7f8;"><RollUp :value="playerAssists" /></div>
              </div>
            </div>
            </template>
          </div>
          <!-- Building Pyr: how much has been built, from GitHub. Only on
               the profile of the person building it (Ames 2026-10-10). Under
               the Scout report since the count of cells identified took its
               place beside the name (Ames 2026-10-12). -->
          <div v-if="showsBuilding && repoStats" class="nge-profile-section nge-profile-section--building">
            <div class="nge-profile-section-label">▌ Building Pyr</div>
            <div class="nge-profile-stat-row nge-profile-stat-row--tiles">
              <div class="nge-profile-stat-col nge-profile-stat-tile nge-profile-stat-tile--build" title="Changes saved to Pyr's code">
                <div class="nge-profile-stat-label">Commits</div>
                <div class="nge-profile-stat-val nge-profile-stat-val--hero"><RollUp :value="repoStats.commits" /></div>
              </div>
              <div class="nge-profile-stat-col nge-profile-stat-tile nge-profile-stat-tile--build" title="Times a new version of Pyr has gone live">
                <div class="nge-profile-stat-label">Deploys</div>
                <div class="nge-profile-stat-val nge-profile-stat-val--hero"><RollUp :value="repoStats.deploys" /></div>
              </div>
            </div>
          </div>
              </div>
            </div>

          </div>
        </div><!-- end main area -->

        <!-- RIGHT: latest badge highlight  <->  badge detail -->
        <div class="nge-profile-col nge-profile-col--right">
          <Transition name="nge-viz-swap" mode="out-in">

            <!-- Special badge detail view -->
            <div v-if="selectedSpecialBadge" key="special" class="nge-profile-viz-panel nge-profile-viz-badge nge-profile-viz-badge--detail">
              <img
                :src="selectedSpecialBadge.badge?.image_url || selectedSpecialBadge.badge?.thumbnail_url"
                :alt="selectedSpecialBadge.badge?.name"
                class="nge-profile-viz-badge-icon nge-profile-viz-badge-icon--large"
              />
              <div class="nge-profile-viz-badge-name">{{ selectedSpecialBadge.badge?.name || 'Award' }}</div>
              <div v-if="selectedSpecialBadge.badge?.description" class="nge-profile-viz-badge-desc">{{ selectedSpecialBadge.badge.description }}</div>
              <div v-if="medalWins(selectedSpecialBadge)" class="nge-profile-viz-badge-desc nge-medal-wins">{{ medalWins(selectedSpecialBadge) }}</div>
              <div class="nge-profile-viz-badge-threshold">
                Awarded {{ relativeTime(selectedSpecialBadge.awarded_at) }}
              </div>
              <button class="nge-profile-viz-badge-back" @click="selectedSpecialBadge = null">
                ← Back
              </button>
            </div>

            <!-- Default view: favorite badge → favorite special badge → latest earned -->
            <div v-else-if="!selectedBadge" key="latest" class="nge-profile-viz-panel nge-profile-viz-badge">
              <template v-if="favoriteBadge">
                <div class="nge-profile-viz-title">⭐ Favorite Achievement</div>
                <img
                  :src="getBadgeUrl(favoriteBadge.imageKey)"
                  :alt="favoriteBadge.name"
                  class="nge-profile-viz-badge-icon"
                  :class="`nge-badge--${favoriteBadge.slug}`"
                />
                <div class="nge-profile-viz-badge-name">{{ favoriteBadge.name }}</div>
                <div class="nge-profile-viz-badge-desc">{{ favoriteBadge.description }}</div>
                <div class="nge-profile-viz-badge-threshold">
                  Unlocked at <strong>{{ favoriteBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(favoriteBadge) }}
                </div>
              </template>
              <template v-else-if="favoriteSpecialBadge">
                <div class="nge-profile-viz-title">⭐ Favorite Achievement</div>
                <img
                  :src="favoriteSpecialBadge.badge?.image_url || favoriteSpecialBadge.badge?.thumbnail_url"
                  :alt="favoriteSpecialBadge.badge?.name"
                  class="nge-profile-viz-badge-icon nge-profile-viz-badge-icon--large"
                />
                <div class="nge-profile-viz-badge-name">{{ favoriteSpecialBadge.badge?.name || 'Award' }}</div>
                <div v-if="favoriteSpecialBadge.badge?.description" class="nge-profile-viz-badge-desc">{{ favoriteSpecialBadge.badge.description }}</div>
                <div class="nge-profile-viz-badge-threshold">
                  Won on <strong>{{ formatDate(favoriteSpecialBadge.awarded_at) }}</strong>
                </div>
              </template>
              <template v-else-if="latestEarnedBadge">
                <div class="nge-profile-viz-title">▌ Latest Achievement</div>
                <img
                  :src="getBadgeUrl(latestEarnedBadge.imageKey)"
                  :alt="latestEarnedBadge.name"
                  class="nge-profile-viz-badge-icon"
                  :class="`nge-badge--${latestEarnedBadge.slug}`"
                />
                <div class="nge-profile-viz-badge-name">{{ latestEarnedBadge.name }}</div>
                <div class="nge-profile-viz-badge-desc">{{ latestEarnedBadge.description }}</div>
                <div class="nge-profile-viz-badge-threshold">
                  Earned at <strong>{{ latestEarnedBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(latestEarnedBadge) }}
                </div>
              </template>
              <template v-else>
                <div class="nge-profile-viz-title">▌ Achievements</div>
                <div class="nge-profile-viz-badge-desc" style="margin-top: 40px;">
                  Make edits and complete cells to earn Achievements!
                </div>
              </template>
            </div>

            <!-- Badge detail view (when a badge is clicked) -->
            <div v-else key="badge" class="nge-profile-viz-panel nge-profile-viz-badge nge-profile-viz-badge--detail">
              <img
                :src="getBadgeUrl(selectedBadge.imageKey)"
                :alt="selectedBadge.name"
                class="nge-profile-viz-badge-icon nge-profile-viz-badge-icon--large"
                :class="`nge-badge--${selectedBadge.slug}`"
              />
              <div class="nge-profile-viz-badge-name">{{ selectedBadge.name }}</div>
              <div class="nge-profile-viz-badge-desc">{{ selectedBadge.description }}</div>
              <div class="nge-profile-viz-badge-threshold">
                Unlocked at <strong>{{ selectedBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(selectedBadge) }}
              </div>
              <button class="nge-profile-viz-badge-back" @click="selectedBadge = null">
                ← {{ favoriteBadge || favoriteSpecialBadge ? 'Back to favorite' : 'Back' }}
              </button>
            </div>

          </Transition>

          <!-- Silver favorites, under the gold one -->
          <div v-if="silverRow.length" class="nge-profile-silvers">
            <button v-for="f in silverRow" :key="f.slug" class="nge-trophy-fav"
                    :title="f.name + ', silver favorite'" @click="openFavoriteInCase(f)">
              <img :src="f.img" :alt="f.name" />
              <span class="nge-trophy-fav-star">★</span>
            </button>
          </div>
          <!-- Bronze favorites, a smaller strip under those -->
          <div v-if="bronzeRow.length" class="nge-profile-silvers nge-profile-bronzes">
            <button v-for="f in bronzeRow" :key="f.slug" class="nge-trophy-fav nge-trophy-fav--bronze"
                    :title="f.name + ', bronze favorite'" @click="openFavoriteInCase(f)">
              <img :src="f.img" :alt="f.name" />
              <span class="nge-trophy-fav-star">★</span>
            </button>
          </div>

          <!-- Divider between badge and streak -->
          <div class="nge-profile-right-divider"></div>

          <!-- Weekly podium counts (🥇 × N etc.) — one row per metric -->
          <div v-if="anyPodium" class="nge-profile-section nge-profile-section--podium">
            <div class="nge-profile-section-label nge-profile-section-label--amber">▌ Top of the Week</div>

            <!-- Edits podium -->
            <div v-if="podiumTotal > 0" class="nge-profile-podium-metric">
              <div class="nge-profile-podium-metric-label">Edits</div>
              <div class="nge-profile-podium-row">
                <div v-if="podium.gold > 0" class="nge-profile-podium-tile nge-profile-podium-tile--gold" :title="`Finished 1st place in edits ${podium.gold} week${podium.gold === 1 ? '' : 's'}`">
                  <span class="nge-profile-podium-medal">🥇</span>
                  <span class="nge-profile-podium-count">× {{ podium.gold }}</span>
                </div>
                <div v-if="podium.silver > 0" class="nge-profile-podium-tile nge-profile-podium-tile--silver" :title="`Finished 2nd place in edits ${podium.silver} week${podium.silver === 1 ? '' : 's'}`">
                  <span class="nge-profile-podium-medal">🥈</span>
                  <span class="nge-profile-podium-count">× {{ podium.silver }}</span>
                </div>
                <div v-if="podium.bronze > 0" class="nge-profile-podium-tile nge-profile-podium-tile--bronze" :title="`Finished 3rd place in edits ${podium.bronze} week${podium.bronze === 1 ? '' : 's'}`">
                  <span class="nge-profile-podium-medal">🥉</span>
                  <span class="nge-profile-podium-count">× {{ podium.bronze }}</span>
                </div>
              </div>
            </div>

            <!-- Completions podium -->
            <div v-if="podiumCompletionsTotal > 0" class="nge-profile-podium-metric">
              <div class="nge-profile-podium-metric-label">Cells</div>
              <div class="nge-profile-podium-row">
                <div v-if="podiumCompletions.gold > 0" class="nge-profile-podium-tile nge-profile-podium-tile--gold" :title="`Finished 1st place in cells ${podiumCompletions.gold} week${podiumCompletions.gold === 1 ? '' : 's'}`">
                  <span class="nge-profile-podium-medal">🥇</span>
                  <span class="nge-profile-podium-count">× {{ podiumCompletions.gold }}</span>
                </div>
                <div v-if="podiumCompletions.silver > 0" class="nge-profile-podium-tile nge-profile-podium-tile--silver" :title="`Finished 2nd place in cells ${podiumCompletions.silver} week${podiumCompletions.silver === 1 ? '' : 's'}`">
                  <span class="nge-profile-podium-medal">🥈</span>
                  <span class="nge-profile-podium-count">× {{ podiumCompletions.silver }}</span>
                </div>
                <div v-if="podiumCompletions.bronze > 0" class="nge-profile-podium-tile nge-profile-podium-tile--bronze" :title="`Finished 3rd place in cells ${podiumCompletions.bronze} week${podiumCompletions.bronze === 1 ? '' : 's'}`">
                  <span class="nge-profile-podium-medal">🥉</span>
                  <span class="nge-profile-podium-count">× {{ podiumCompletions.bronze }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Streak + Activity Chart -->
          <div class="nge-profile-section nge-profile-section--streak">
            <div class="nge-profile-section-label nge-profile-section-label--amber">▌ Streak</div>
            <div class="nge-profile-streak-row" v-if="profileStats.currentStreak > 0 || profileStats.longestStreak > 0">
              <div class="nge-profile-streak-current">
                <span class="nge-profile-streak-flame">🔥</span>
                <span class="nge-profile-streak-count">{{ profileStats.currentStreak }}</span>
                <span class="nge-profile-streak-unit">day{{ profileStats.currentStreak === 1 ? '' : 's' }} current</span>
              </div>
              <div class="nge-profile-streak-best" v-if="profileStats.longestStreak > 0">
                <span class="nge-profile-streak-best-label">Best</span>
                <span class="nge-profile-streak-best-val">{{ profileStats.longestStreak }}d</span>
              </div>
            </div>

            <!-- 14-day activity chart -->
            <div class="nge-profile-activity-chart">
              <div class="nge-profile-chart-label">Last 14 Days</div>
              <div class="nge-profile-chart-bars">
                <div
                  v-for="day in last14Days"
                  :key="day.date"
                  class="nge-profile-chart-col"
                  :title="`${day.date}: ${day.edits} edits, ${day.completions} completions`"
                >
                  <div class="nge-profile-chart-bar-wrap">
                    <div
                      v-if="day.completions > 0"
                      class="nge-profile-chart-bar nge-profile-chart-bar--completion"
                      :style="{ height: Math.max(2, (day.completions / chartMax) * 48) + 'px' }"
                    ></div>
                    <div
                      v-if="day.edits > 0"
                      class="nge-profile-chart-bar nge-profile-chart-bar--edit"
                      :style="{ height: Math.max(2, (day.edits / chartMax) * 48) + 'px' }"
                    ></div>
                  </div>
                  <div class="nge-profile-chart-day">{{ day.label }}</div>
                </div>
              </div>
              <div class="nge-profile-chart-legend">
                <span class="nge-profile-chart-legend-item">
                  <span class="nge-profile-chart-legend-dot nge-profile-chart-legend-dot--edit"></span> Edits
                </span>
                <span class="nge-profile-chart-legend-item">
                  <span class="nge-profile-chart-legend-dot nge-profile-chart-legend-dot--completion"></span> Completions
                </span>
              </div>
            </div>
          </div>

        </div><!-- end right column -->

      </div><!-- end .nge-profile-body (Overview) -->

      <!-- ── Trophy Case tab ─────────────────────────────────── -->
      <div v-else-if="activeTab === 'trophyCase'" class="nge-profile-body nge-profile-body--trophy">
        <div class="nge-trophy-scroll">
          <div class="nge-trophy-side">

          <!-- ── Featured badge banner ── -->
          <div v-if="selectedSpecialBadge" class="nge-trophy-featured">
            <div class="nge-trophy-featured-effects">
              <div class="nge-trophy-ring nge-trophy-ring--1"></div>
              <div class="nge-trophy-ring nge-trophy-ring--2"></div>
              <div class="nge-trophy-ring nge-trophy-ring--3"></div>
              <div class="nge-trophy-ring nge-trophy-ring--4"></div>
              <div class="nge-trophy-ring nge-trophy-ring--5"></div>
              <span v-for="i in 12" :key="i" class="nge-trophy-orbit-dot" :style="{ '--j': i }"></span>
              <div class="nge-trophy-aura"></div>
            </div>
            <img
              :src="selectedSpecialBadge.badge?.image_url || selectedSpecialBadge.badge?.thumbnail_url"
              :alt="selectedSpecialBadge.badge?.name"
              class="nge-trophy-featured-icon nge-trophy-featured-icon--animated"
              @click="zoomBadge(selectedSpecialBadge.badge?.image_url || selectedSpecialBadge.badge?.thumbnail_url, selectedSpecialBadge.badge?.name, selectedSpecialBadge.badge?.description, 'Won on ' + formatDate(selectedSpecialBadge.awarded_at))"
            />
            <div class="nge-trophy-featured-info">
              <div class="nge-trophy-featured-name nge-trophy-featured-name--scifi">{{ selectedSpecialBadge.badge?.name || 'Award' }}</div>
              <div v-if="selectedSpecialBadge.badge?.description" class="nge-trophy-featured-desc">{{ selectedSpecialBadge.badge.description }}</div>
              <div v-if="medalWins(selectedSpecialBadge)" class="nge-trophy-featured-desc nge-medal-wins">{{ medalWins(selectedSpecialBadge) }}</div>
              <div class="nge-trophy-featured-desc" style="font-style: italic; opacity: 0.7;">Won for being awesome</div>
              <div class="nge-trophy-featured-threshold">
                Won on <strong>{{ formatDate(selectedSpecialBadge.awarded_at) }}</strong>
              </div>
              <div v-if="favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`)" class="nge-trophy-featured-fav-label">★ Your favorite badge</div>
            </div>
            <button
              class="nge-trophy-featured-star"
              :class="{ 'nge-trophy-featured-star--active': favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`) }"
              :title="favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`) ? 'Remove from favorites' : 'Set as favorite badge'"
              @click="toggleFavoriteSpecialBadge(selectedSpecialBadge)"
            >{{ favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`) ? '★' : '☆' }}</button>
          </div>
          <div v-else-if="favoriteSpecialBadge && !selectedBadge" class="nge-trophy-featured">
            <div class="nge-trophy-featured-effects">
              <div class="nge-trophy-ring nge-trophy-ring--1"></div>
              <div class="nge-trophy-ring nge-trophy-ring--2"></div>
              <div class="nge-trophy-ring nge-trophy-ring--3"></div>
              <div class="nge-trophy-ring nge-trophy-ring--4"></div>
              <div class="nge-trophy-ring nge-trophy-ring--5"></div>
              <span v-for="i in 12" :key="i" class="nge-trophy-orbit-dot" :style="{ '--j': i }"></span>
              <div class="nge-trophy-aura"></div>
            </div>
            <img
              :src="favoriteSpecialBadge.badge?.image_url || favoriteSpecialBadge.badge?.thumbnail_url"
              :alt="favoriteSpecialBadge.badge?.name"
              class="nge-trophy-featured-icon nge-trophy-featured-icon--animated"
              @click="zoomBadge(favoriteSpecialBadge.badge?.image_url || favoriteSpecialBadge.badge?.thumbnail_url, favoriteSpecialBadge.badge?.name, favoriteSpecialBadge.badge?.description, 'Won on ' + formatDate(favoriteSpecialBadge.awarded_at))"
            />
            <div class="nge-trophy-featured-info">
              <div class="nge-trophy-featured-name nge-trophy-featured-name--scifi">{{ favoriteSpecialBadge.badge?.name || 'Award' }}</div>
              <div v-if="favoriteSpecialBadge.badge?.description" class="nge-trophy-featured-desc">{{ favoriteSpecialBadge.badge.description }}</div>
              <div class="nge-trophy-featured-desc" style="font-style: italic; opacity: 0.7;">Won for being awesome</div>
              <div class="nge-trophy-featured-threshold">
                Won on <strong>{{ formatDate(favoriteSpecialBadge.awarded_at) }}</strong>
              </div>
              <div class="nge-trophy-featured-fav-label">★ Your favorite badge</div>
            </div>
            <button
              class="nge-trophy-featured-star nge-trophy-featured-star--active"
              title="Remove from favorites"
              @click="toggleFavoriteSpecialBadge(favoriteSpecialBadge)"
            >★</button>
          </div>
          <div v-else-if="featuredBadge" class="nge-trophy-featured">
            <div class="nge-trophy-featured-effects">
              <div class="nge-trophy-ring nge-trophy-ring--1"></div>
              <div class="nge-trophy-ring nge-trophy-ring--2"></div>
              <div class="nge-trophy-ring nge-trophy-ring--3"></div>
              <div class="nge-trophy-ring nge-trophy-ring--4"></div>
              <div class="nge-trophy-ring nge-trophy-ring--5"></div>
              <span v-for="i in 12" :key="i" class="nge-trophy-orbit-dot" :style="{ '--j': i }"></span>
              <div class="nge-trophy-aura"></div>
            </div>
            <img
              :src="getBadgeUrl(featuredBadge.imageKey)"
              :alt="featuredBadge.name"
              class="nge-trophy-featured-icon nge-trophy-featured-icon--animated"
              :class="`nge-badge--${featuredBadge.slug}`"
              @click="zoomBadge(getBadgeUrl(featuredBadge.imageKey), featuredBadge.name, featuredBadge.description, 'Unlocked at ' + featuredBadge.threshold.toLocaleString() + ' ' + thresholdLabel(featuredBadge))"
            />
            <div class="nge-trophy-featured-info">
              <div class="nge-trophy-featured-name nge-trophy-featured-name--scifi">{{ featuredBadge.name }}</div>
              <div class="nge-trophy-featured-desc">{{ featuredBadge.description }}</div>
              <div class="nge-trophy-featured-threshold">
                Unlocked at <strong>{{ featuredBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(featuredBadge) }}
              </div>
              <div v-if="favoriteBadgeSlug === featuredBadge.slug" class="nge-trophy-featured-fav-label">★ Your favorite badge</div>
            </div>
            <button
              class="nge-trophy-featured-star"
              :class="{ 'nge-trophy-featured-star--active': favoriteBadgeSlug === featuredBadge.slug }"
              :title="favoriteBadgeSlug === featuredBadge.slug ? 'Remove from favorites' : 'Set as favorite badge'"
              @click="toggleFavoriteBadge(featuredBadge)"
            >{{ favoriteBadgeSlug === featuredBadge.slug ? '★' : '☆' }}</button>
          </div>

          <!-- Stars for the badge on show: one gold favorite, up to five silver, up to ten bronze -->
          <div v-if="!viewingOtherUser && featuredSlug" class="nge-trophy-stars">
            <button class="nge-trophy-starbtn nge-trophy-starbtn--gold" :class="{ 'is-on': featuredIsGold }"
                    :title="featuredIsGold ? 'Remove the gold star' : 'Make this your one gold favorite, shown on your profile'"
                    @click="toggleGoldFeatured">★ {{ featuredIsGold ? 'Gold favorite' : 'Make gold' }}</button>
            <button class="nge-trophy-starbtn nge-trophy-starbtn--silver" :class="{ 'is-on': featuredIsSilver }"
                    :disabled="!featuredIsSilver && silverFull"
                    :title="featuredIsSilver ? 'Remove the silver star' : silverFull ? 'Five silver favorites is the limit. Remove one first.' : 'Add to your silver favorites'"
                    @click="toggleSilverFeatured">★ {{ featuredIsSilver ? 'Silver favorite' : 'Add silver' }}</button>
            <button class="nge-trophy-starbtn nge-trophy-starbtn--bronze" :class="{ 'is-on': featuredIsBronze }"
                    :disabled="!featuredIsBronze && bronzeFull"
                    :title="featuredIsBronze ? 'Remove the bronze star' : bronzeFull ? 'Ten bronze favorites is the limit. Remove one first.' : 'Add to your bronze favorites'"
                    @click="toggleBronzeFeatured">★ {{ featuredIsBronze ? 'Bronze favorite' : 'Add bronze' }}</button>
          </div>

          <div v-if="favoriteRow.length || !viewingOtherUser" class="nge-trophy-favs">
            <div class="nge-trophy-favs-label">Favorites</div>
            <template v-if="favoriteRow.length">
              <div class="nge-trophy-favs-row">
                <button v-for="f in favoriteRow.filter(x => x.tier !== 'bronze')" :key="f.slug" class="nge-trophy-fav"
                        :class="{ 'nge-trophy-fav--gold': f.gold, 'is-shown': featuredSlug === f.slug, 'is-dragging': draggingFav?.slug === f.slug, 'is-drop': dropFav === f.slug }"
                        :draggable="favDraggable(f)" @dragstart="favDragStart(f, $event)" @dragover="favDragOver(f, $event)" @drop.prevent="favDrop(f)" @dragend="favDragEnd"
                        :title="f.name + (f.gold ? ', gold favorite' : ', silver favorite' + (viewingOtherUser ? '' : '. Drag to reorder.'))" @click="openFavorite(f)">
                  <img :src="f.img" :alt="f.name" />
                  <span class="nge-trophy-fav-star">★</span>
                </button>
              </div>
              <div v-if="bronzeRow.length" class="nge-trophy-favs-row nge-trophy-favs-row--bronze">
                <button v-for="f in bronzeRow" :key="f.slug" class="nge-trophy-fav nge-trophy-fav--bronze"
                        :class="{ 'is-shown': featuredSlug === f.slug, 'is-dragging': draggingFav?.slug === f.slug, 'is-drop': dropFav === f.slug }"
                        :draggable="favDraggable(f)" @dragstart="favDragStart(f, $event)" @dragover="favDragOver(f, $event)" @drop.prevent="favDrop(f)" @dragend="favDragEnd"
                        :title="f.name + ', bronze favorite' + (viewingOtherUser ? '' : '. Drag to reorder.')" @click="openFavorite(f)">
                  <img :src="f.img" :alt="f.name" />
                  <span class="nge-trophy-fav-star">★</span>
                </button>
              </div>
            </template>
            <div v-else class="nge-trophy-favs-empty">Pick a badge on the right, then star it.</div>
          </div>
          </div><!-- end side -->

          <div class="nge-trophy-main">
          <!-- Exploration track (Cell Achievements first) -->
          <div class="nge-trophy-track" :class="{ 'is-dragging': draggingSection === 'cells', 'is-drop': dropSection === 'cells' }" :style="sectionOrder('cells')" @dragover="sectionDragOver('cells', $event)" @drop.prevent="sectionDrop('cells')">
            <div class="nge-trophy-track-label" style="color: #90fff2;">Cell Completions
              <span class="nge-trophy-track-count">{{ earnedExplorationBadges.earned.length }} earned</span>
              <span v-if="!viewingOtherUser" class="nge-trophy-track-move">
                <button type="button" class="nge-trophy-track-grip" draggable="true" title="Drag to move this section" aria-label="Drag to move this section"
                        @dragstart="sectionDragStart('cells', $event)" @dragend="sectionDragEnd">⠿</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move up" aria-label="Move this section up" @click="moveSection('cells', -1)">▲</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move down" aria-label="Move this section down" @click="moveSection('cells', 1)">▼</button>
              </span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="badge in earnedExplorationBadges.earned"
                :key="badge.id"
                class="nge-trophy-badge nge-trophy-badge--exploration"
                :title="`${badge.name}: ${badge.threshold.toLocaleString()} cells`"
                :class="{
                  'nge-trophy-badge--selected': selectedBadge?.id === badge.id,
                  'nge-trophy-badge--favorited': favoriteBadgeSlug === badge.slug,
                  'nge-trophy-badge--silver': silverSlugs.includes(badge.slug),
                  'nge-trophy-badge--bronze': bronzeSlugs.includes(badge.slug),
                }"
                @click="onBadgeClick(badge)"
              >
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-trophy-badge-icon" :class="`nge-badge--${badge.slug}`" />
                <div class="nge-trophy-badge-name">{{ badge.name }}</div>
                <div class="nge-trophy-badge-threshold">{{ badge.threshold.toLocaleString() }} cells</div>
              </div>
            </div>
          </div>

          <!-- Proofreading track -->
          <div class="nge-trophy-track" :class="{ 'is-dragging': draggingSection === 'editor', 'is-drop': dropSection === 'editor' }" :style="sectionOrder('editor')" @dragover="sectionDragOver('editor', $event)" @drop.prevent="sectionDrop('editor')">
            <div class="nge-trophy-track-label" style="color: #ffd08a;">Editor Achievements
              <span class="nge-trophy-track-count">{{ earnedBuildingBadges.earned.length }} earned</span>
              <span v-if="!viewingOtherUser" class="nge-trophy-track-move">
                <button type="button" class="nge-trophy-track-grip" draggable="true" title="Drag to move this section" aria-label="Drag to move this section"
                        @dragstart="sectionDragStart('editor', $event)" @dragend="sectionDragEnd">⠿</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move up" aria-label="Move this section up" @click="moveSection('editor', -1)">▲</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move down" aria-label="Move this section down" @click="moveSection('editor', 1)">▼</button>
              </span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="badge in earnedBuildingBadges.earned"
                :key="badge.id"
                class="nge-trophy-badge nge-trophy-badge--building"
                :title="`${badge.name}: ${badge.threshold.toLocaleString()} edits`"
                :class="{
                  'nge-trophy-badge--selected': selectedBadge?.id === badge.id,
                  'nge-trophy-badge--favorited': favoriteBadgeSlug === badge.slug,
                  'nge-trophy-badge--silver': silverSlugs.includes(badge.slug),
                  'nge-trophy-badge--bronze': bronzeSlugs.includes(badge.slug),
                }"
                @click="onBadgeClick(badge)"
              >
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-trophy-badge-icon" :class="`nge-badge--${badge.slug}`" />
                <div class="nge-trophy-badge-name">{{ badge.name }}</div>
                <div class="nge-trophy-badge-threshold">{{ badge.threshold.toLocaleString() }} edits</div>
              </div>
            </div>
          </div>

          <!-- Loyalty track -->
          <div v-if="earnedLoyaltyBadges.earned.length > 0" class="nge-trophy-track" :class="{ 'is-dragging': draggingSection === 'loyalty', 'is-drop': dropSection === 'loyalty' }" :style="sectionOrder('loyalty')" @dragover="sectionDragOver('loyalty', $event)" @drop.prevent="sectionDrop('loyalty')">
            <div class="nge-trophy-track-label" style="color: #c9a8ff;">Loyalty Achievements
              <span class="nge-trophy-track-count">{{ earnedLoyaltyBadges.earned.length }} earned</span>
              <span v-if="!viewingOtherUser" class="nge-trophy-track-move">
                <button type="button" class="nge-trophy-track-grip" draggable="true" title="Drag to move this section" aria-label="Drag to move this section"
                        @dragstart="sectionDragStart('loyalty', $event)" @dragend="sectionDragEnd">⠿</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move up" aria-label="Move this section up" @click="moveSection('loyalty', -1)">▲</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move down" aria-label="Move this section down" @click="moveSection('loyalty', 1)">▼</button>
              </span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="badge in earnedLoyaltyBadges.earned"
                :key="badge.id"
                class="nge-trophy-badge nge-trophy-badge--loyalty"
                :title="`${badge.name}: ${badge.threshold} days of science`"
                :class="{
                  'nge-trophy-badge--selected': selectedBadge?.id === badge.id,
                  'nge-trophy-badge--favorited': favoriteBadgeSlug === badge.slug,
                  'nge-trophy-badge--silver': silverSlugs.includes(badge.slug),
                  'nge-trophy-badge--bronze': bronzeSlugs.includes(badge.slug),
                }"
                @click="onBadgeClick(badge)"
              >
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-trophy-badge-icon" :class="`nge-badge--${badge.slug}`" />
                <div class="nge-trophy-badge-name">{{ badge.name }}</div>
                <div class="nge-trophy-badge-threshold">{{ badge.threshold }} days of science</div>
              </div>
            </div>
          </div>

          <!-- Competitions -->
          <div v-if="competitionMedals.length" class="nge-trophy-track" :class="{ 'is-dragging': draggingSection === 'competitions', 'is-drop': dropSection === 'competitions' }" :style="sectionOrder('competitions')" @dragover="sectionDragOver('competitions', $event)" @drop.prevent="sectionDrop('competitions')">
            <div class="nge-trophy-track-label">◆ Competitions
              <span v-if="!viewingOtherUser" class="nge-trophy-track-move">
                <button type="button" class="nge-trophy-track-grip" draggable="true" title="Drag to move this section" aria-label="Drag to move this section"
                        @dragstart="sectionDragStart('competitions', $event)" @dragend="sectionDragEnd">⠿</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move up" aria-label="Move this section up" @click="moveSection('competitions', -1)">▲</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move down" aria-label="Move this section down" @click="moveSection('competitions', 1)">▼</button>
              </span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="m in competitionMedals"
                :key="m.tier"
                class="nge-trophy-badge nge-trophy-badge--medal"
                :class="{ 'nge-trophy-badge--selected': medalSelected(m) }"
                :title="medalTooltip(m)"
                @click="onMedalClick(m)"
              >
                <span class="nge-trophy-medal-img">
                  <img :src="medalArt(m)" :alt="MEDAL_WORD[m.tier]" class="nge-trophy-badge-icon" />
                  <span v-if="m.count > 1" class="nge-medal-count" :aria-label="`won ${m.count} times`">×{{ m.count }}</span>
                </span>
                <div class="nge-trophy-badge-name">{{ MEDAL_WORD[m.tier] }}</div>
                <div v-if="MEDAL_SUB[m.tier]" class="nge-trophy-medal-place">{{ MEDAL_SUB[m.tier] }}</div>
              </div>
            </div>
          </div>

          <!-- Special Awards -->
          <div v-if="plainSpecialBadges.length > 0" class="nge-trophy-track" :class="{ 'is-dragging': draggingSection === 'special', 'is-drop': dropSection === 'special' }" :style="sectionOrder('special')" @dragover="sectionDragOver('special', $event)" @drop.prevent="sectionDrop('special')">
            <div class="nge-trophy-track-label">★ Special Awards
              <span v-if="!viewingOtherUser" class="nge-trophy-track-move">
                <button type="button" class="nge-trophy-track-grip" draggable="true" title="Drag to move this section" aria-label="Drag to move this section"
                        @dragstart="sectionDragStart('special', $event)" @dragend="sectionDragEnd">⠿</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move up" aria-label="Move this section up" @click="moveSection('special', -1)">▲</button>
                <button type="button" class="nge-trophy-track-nudge" title="Move down" aria-label="Move this section down" @click="moveSection('special', 1)">▼</button>
              </span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="award in plainSpecialBadges"
                :key="award.id"
                class="nge-trophy-badge"
                :class="{ 'nge-trophy-badge--selected': selectedSpecialBadge?.id === award.id, 'nge-trophy-badge--favorited': favoriteBadgeSlug === specialSlug(award), 'nge-trophy-badge--silver': silverSlugs.includes(specialSlug(award)), 'nge-trophy-badge--bronze': bronzeSlugs.includes(specialSlug(award)) }"
                :title="specialBadgeTooltip(award)"
                @click="onSpecialBadgeClick(award)"
              >
                <img :src="award.badge?.thumbnail_url || award.badge?.image_url" :alt="award.badge?.name" class="nge-trophy-badge-icon" />
                <div class="nge-trophy-badge-name">{{ award.badge?.name || 'Award' }}</div>
              </div>
            </div>
          </div>

          </div><!-- end main -->
        </div>
      </div><!-- end Trophy Case -->

      <!-- ── My Cells: claims and completions by dataset, loaded on open ── -->
      <div v-if="activeTab === 'myCells'" class="nge-profile-body nge-profile-body--mycells">
        <MyCellsTab
          :key="props.viewUserId || backendStore.userId || ''"
          :user-id="props.viewUserId || backendStore.userId"
          :is-self="!viewingOtherUser"
          @jumped="handleClose"
        />
      </div>

      <!-- ── Datasets tab: contributions per dataset + switcher ── -->
      <div v-if="activeTab === 'datasets'" class="nge-profile-body nge-profile-body--datasets">
        <div class="nge-ds-tab-intro">
          {{ viewingOtherUser ? `The datasets ${profileName} has contributed to.` : 'The datasets you have contributed to.' }}
          Click one to switch your viewer to it.
        </div>
        <button class="nge-ds-tab-progress" @click="openDatasetProgress">Dataset stats: what has been done on each dataset →</button>
        <div v-if="datasetStatsLoading && !Object.keys(datasetStats).length" class="nge-ds-tab-loading">
          Counting edits…
        </div>
        <div v-if="!contributedDatasets.length && !datasetStatsLoading" class="nge-ds-tab-loading">
          {{ viewingOtherUser ? 'No contributions yet.' : 'No contributions yet. Your datasets appear here once you make an edit or complete a cell.' }}
        </div>
        <div class="nge-ds-tab-grid">
          <div
            v-for="ds in contributedDatasets"
            :key="ds.id"
            class="nge-ds-tab-card"
            :class="{
              'nge-ds-tab-card--active': canonicalDataset(segLayerName(ds)) === activeDatasetCanon,
              'nge-ds-tab-card--switching': switchingDatasetId === ds.id,
              'nge-ds-tab-card--thumb': !!ds.thumbnail,
            }"
            @click="switchProfileDataset(ds)"
          >
            <img v-if="ds.thumbnail" :src="ds.thumbnail" class="nge-ds-tab-thumb" alt="" loading="lazy" />
            <div class="nge-ds-tab-card-body">
            <div class="nge-ds-tab-card-head">
              <span v-if="!ds.thumbnail" class="nge-ds-tab-species">{{ SPECIES_ICONS[ds.species] }}</span>
              <span class="nge-ds-tab-label">{{ ds.label }}</span>
              <span v-if="canonicalDataset(segLayerName(ds)) === activeDatasetCanon" class="nge-ds-tab-badge">Active</span>
              <span v-else class="nge-ds-tab-switch">Switch ▸</span>
            </div>
            <div class="nge-ds-tab-desc">{{ ds.description }}<span v-if="ds.origin" class="nge-ds-origin"> · From {{ ds.origin }}</span></div>
            <div class="nge-ds-tab-stats">
              <template v-if="datasetContribution(ds)">
                <span v-if="showsAllStats(ds) || datasetContribution(ds)?.edits" class="nge-ds-tab-stat"><b>{{ (datasetContribution(ds)?.edits ?? 0).toLocaleString() }}</b> edits</span>
                <span v-if="showsAllStats(ds) || datasetContribution(ds)?.completions || !datasetContribution(ds)?.outside" class="nge-ds-tab-stat" :class="{ 'nge-ds-tab-stat--cells': datasetContribution(ds)?.completions }"><b>{{ (datasetContribution(ds)?.completions ?? 0).toLocaleString() }}</b> cells completed</span>
                <!-- Work the dataset's own records credit to this player, done in other
                     tools. Shown here only: it counts toward nothing (Ames 2026-10-07). -->
                <span v-if="datasetContribution(ds)?.outside" class="nge-ds-tab-stat nge-ds-tab-stat--cells"
                      title="From the dataset's own records, for work done outside EyeWire II. It does not count toward Achievements, the leaderboard or cells completed."><b>{{ (datasetContribution(ds)?.outside ?? 0).toLocaleString() }}</b> cells proofread outside the game</span>
                <span v-if="showsAllStats(ds) || datasetContribution(ds)?.helpRequests" class="nge-ds-tab-stat"><b>{{ (datasetContribution(ds)?.helpRequests ?? 0).toLocaleString() }}</b> help requests</span>
                <span v-if="!hasContributed(ds)" class="nge-ds-tab-stat nge-ds-tab-stat--none">no contributions yet</span>
              </template>
              <span v-else class="nge-ds-tab-stat nge-ds-tab-stat--none">…</span>
            </div>
            </div>
          </div>
        </div>
      </div>

      <!-- More datasets (Ames 2026-10-06): optional, explore only volumes
           each player can add to their own switcher. -->
      <div v-if="activeTab === 'datasets' && !viewingOtherUser" class="nge-profile-body nge-ds-more">
        <div class="nge-ds-more-title">More datasets</div>
        <div class="nge-ds-more-intro">Turn on extra datasets to add them to your dataset switcher. These are for exploring: you can look around, colour cells and share views, but there is nothing to proofread or claim in them.</div>
        <label v-for="ds in DATASETS.filter(d => d.optional && !d.hidden)" :key="ds.id" class="nge-ds-more-row">
          <input type="checkbox" :checked="extraOn(ds.id)" @change="toggleExtra(ds.id, $event)" />
          <span class="nge-ds-more-icon">{{ SPECIES_ICONS[ds.species] }}</span>
          <span class="nge-ds-more-text">
            <span class="nge-ds-more-label">{{ ds.label }}</span>
            <span class="nge-ds-more-desc">{{ ds.description }}<span v-if="ds.origin" class="nge-ds-origin"> · From {{ ds.origin }}</span></span>
          </span>
        </label>
      </div>

      <!-- ── Dataset Stats tab ─────────────────────────────────── -->
      <div v-if="activeTab === 'datasetStats'" class="nge-profile-body nge-profile-body--dstats">
        <DatasetStatsPanel embedded :person="datasetStatsPerson" />
      </div>

      <!-- ── Week in Science tab ───────────────────────────────── -->
      <div v-if="activeTab === 'weekInScience'" class="nge-profile-body nge-profile-body--week">
        <WeeklyRecapPanel embedded />
      </div>

      <!-- ── Admin Hub tab ─────────────────────────────────────── -->
      <div v-if="activeTab === 'adminHub'" class="nge-profile-body nge-profile-body--admin">
        <AdminHub :initial-sub-tab="adminInitialSubTab" />
      </div>

      <!-- ── Blog tab (listed authors only) ────────────────────── -->
      <div v-if="activeTab === 'blog'" class="nge-profile-body nge-profile-body--admin">
        <BlogEditor />
      </div>

      <!-- ── Settings tab ──────────────────────────────────────── -->
      <div v-if="activeTab === 'settings'" class="nge-profile-body nge-profile-body--settings">
        <SettingsPanel embedded @hide="emit('hide')" />
      </div>

      <!-- ── All Special Awards modal ── -->
      <div v-if="showAllSpecialModal" class="nge-special-modal-backdrop" @click.self="showAllSpecialModal = false">
        <div class="nge-special-modal">
          <div class="nge-special-modal-head">
            <span class="nge-special-modal-title">★ All Special Awards</span>
            <button class="nge-special-modal-close" @click="showAllSpecialModal = false">×</button>
          </div>
          <div class="nge-special-modal-grid">
            <div
              v-for="award in plainSpecialBadges"
              :key="award.id"
              class="nge-special-modal-tile"
              :title="specialBadgeTooltip(award)"
              @click="onSpecialBadgeClick(award); showAllSpecialModal = false;"
            >
              <img :src="award.badge?.thumbnail_url || award.badge?.image_url" :alt="award.badge?.name" class="nge-special-modal-icon" />
              <div class="nge-special-modal-name">{{ award.badge?.name || 'Award' }}</div>
              <div v-if="award.reason" class="nge-special-modal-reason">{{ award.reason }}</div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Mobile fullscreen badge viewer: tap the featured badge art to see
         it big, with a simplified award moment. Tap anywhere to close. -->
    <teleport to="body">
      <transition name="nge-bz">
        <div v-if="badgeZoom" class="nge-badge-zoom" @click="badgeZoom = null">
          <div class="nge-badge-zoom-halo"></div>
          <div class="nge-badge-zoom-ring"></div>
          <img :src="badgeZoom.img" :alt="badgeZoom.name" class="nge-badge-zoom-img" />
          <div class="nge-badge-zoom-name">{{ badgeZoom.name }}</div>
          <div v-if="badgeZoom.desc" class="nge-badge-zoom-desc">{{ badgeZoom.desc }}</div>
          <div v-if="badgeZoom.meta" class="nge-badge-zoom-meta">{{ badgeZoom.meta }}</div>
          <div class="nge-badge-zoom-hint">Tap anywhere to close</div>
        </div>
      </transition>
    </teleport>
  </modal-overlay>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap');
.nge-profile-modal { font-size: 0.9em; }
/* a size up on desktop now that the window is the frame (Ames 2026-10-11:
   "the text is all a bit small"); phones keep mobile.css's sizes */
body:not(.nge-mobile) .nge-profile-modal { font-size: 1.05em; }

/* ─────────────────────────────────────────────────────────────────────────────
   OPEN ANIMATION — panel materializes fast, then sections stagger in
───────────────────────────────────────────────────────────────────────────── */

/* NOTE: NO position:relative here. Neuroglancer's .overlay-content already
   has position:absolute; top:50%; left:50%; transform:translate(-50%,-50%).
   Adding position:relative would override that and break centering.          */
.nge-profile-modal :deep(.nge-overlay) {
  /* visible, !important: ng-override.css forces overflow:auto !important on
     every .nge-overlay.modal.overlay-content, and this box's content is 1px
     larger than it, which drew scrollbars around the whole profile. Visible
     never draws scrollbars, and the shell is height-capped with each tab body
     scrolling on its own, so nothing escapes. NOT hidden: hidden clipped the
     orbiting edge glow (::before, inset -1px) along the straight edges but only
     partly at the rounded corners, so the corner looked sharp as the light
     passed it (Amy 2026-09-28). */
  overflow: visible !important;
}
/* Out-specifies ng-override's 0,3,0 !important rule regardless of load order. */
.nge-profile-modal :deep(.nge-overlay.modal.overlay-content) {
  overflow: visible !important;
}
/* ── Holographic edge glow: soft lights orbiting the frame ──
   Painted as the panel's own background: the fill covers the padding box and
   the orbiting conic shows only under the 1px border, so the light follows
   the rounded corner by construction. It used to be a ::before ring cut out
   with mask-composite; on GPU Chrome that drew seams across the corners and a
   lit curve that didn't sit on the panel's curve as the light passed (Ames
   2026-09-29, screen recording). Stop alphas are the old ones x 0.7, the
   ring's former opacity. */
.nge-profile-modal :deep(.nge-overlay) {
  animation: ngeProfileMaterialize 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
  /* the orbiting conic light under the border is gone: the frame fills the
     window now, so its edge is the screen's (Ames 2026-10-17) */
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.97) 0%, rgba(8, 12, 24, 0.95) 50%, rgba(4, 8, 18, 0.97) 100%) padding-box !important;
}

/* Scanline removed — holographic border glow handled by ModalOverlay */

/* Close animation — overrides materialize with higher specificity */
.nge-profile-closing.nge-profile-modal :deep(.nge-overlay) {
  animation: ngeProfileCollapse 0.15s ease-in both;
}

@keyframes ngeProfileMaterialize {
  0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.97); filter: blur(10px) brightness(2.5); box-shadow: 0 0 80px rgba(0,180,255,0.5); }
  30%  { opacity: 0.8; transform: translate(-50%,-50%) scale(1.003); filter: blur(1px) brightness(1.2); }
  60%  { opacity: 1; transform: translate(-50%,-50%) scale(0.998); filter: blur(0) brightness(1.05); }
  100% { opacity: 1; transform: translate(-50%,-50%); filter: blur(0) brightness(1); box-shadow: none; }
}

@keyframes ngeProfileCollapse {
  0%   { opacity: 1; transform: translate(-50%,-50%) scale(1); filter: blur(0) brightness(1); }
  50%  { filter: blur(0) brightness(1.3); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(0.94); filter: blur(10px) brightness(2); }
}

/* (scanline keyframe removed — using ModalOverlay holographic effects) */

/* Staggered section roll-in */
@keyframes ngeSectionRollIn {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* ─────────────────────────────────────────────────────────────────────────────
   SHELL
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-shell {
  display: flex;
  flex-direction: column;
  /* Never taller than the viewport, whatever a tab's content does. The
     plain 90vh clamp still let content escape on short windows because
     ModalOverlay's overlay-content is overflow: visible; the hard cap plus
     overflow hidden means nothing can render past the shell edge, and each
     tab body scrolls internally. */
  max-height: min(calc(90 * var(--nge-vh, 1vh)), calc(100 * var(--nge-vh, 1vh) - 32px));
  overflow: hidden;
  transition: width 0.25s ease;
}
.nge-profile-shell--trophy {
  width: calc(85 * var(--nge-vw, 1vw));
  max-width: 1200px;
}
.nge-profile-shell--admin {
  width: 720px;
  max-width: calc(90 * var(--nge-vw, 1vw));
}
/* Give Week in Science a real, consistent width instead of letting the shell
   shrink to the recap's old fixed content width (which read as a tiny box). */
.nge-profile-shell--week {
  /* Wide enough for the recap's three columns to fit without scrolling. */
  width: 1180px;
  max-width: calc(94 * var(--nge-vw, 1vw));
}
.nge-profile-shell--dstats {
  /* Wide enough for the three columns of dataset stats. */
  width: 1180px;
  max-width: calc(94 * var(--nge-vw, 1vw));
}
.nge-profile-body--dstats {
  display: block;
  padding: 0;
  max-height: calc(90 * var(--nge-vh, 1vh) - 100px);
  overflow-y: auto;
}
.nge-profile-shell--datasets {
  width: 640px;
  max-width: calc(90 * var(--nge-vw, 1vw));
}
.nge-profile-shell--settings {
  /* Full profile size with three columns (Ames 2026-09-29). */
  width: 1120px;
  max-width: calc(94 * var(--nge-vw, 1vw));
  height: min(760px, calc(100 * var(--nge-vh, 1vh) - 32px));
}
.nge-profile-body--settings {
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* ── Datasets tab ── */
.nge-profile-body--datasets {
  flex-direction: column;
  overflow-y: auto;
  padding: 18px 22px 26px;
  gap: 12px;
}
/* More datasets: one toggle row per optional volume */
/* A block, not the profile body's row: as a row its title, intro and
   toggles sat side by side in thin columns. */
.nge-profile-body.nge-ds-more { display: block; flex: none; padding: 4px 22px 20px; max-height: calc(38 * var(--nge-vh, 1vh)); overflow-y: auto; }
.nge-ds-more-title { font-size: 0.78em; letter-spacing: 0.12em; text-transform: uppercase; color: #8fb8e8; font-weight: 700; margin-bottom: 4px; }
.nge-ds-more-intro { font-size: 0.86em; color: #9fb0c8; line-height: 1.45; margin-bottom: 10px; }
.nge-ds-more-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 8px; margin-bottom: 6px; cursor: pointer; }
.nge-ds-more-row:hover { border-color: rgba(100, 200, 255, 0.25); background: rgba(100, 200, 255, 0.04); }
.nge-ds-more-row input { width: 16px; height: 16px; accent-color: #4a9eff; cursor: pointer; flex: none; }
.nge-ds-more-icon { font-size: 1.2em; flex: none; }
.nge-ds-more-text { display: flex; flex-direction: column; min-width: 0; }
.nge-ds-more-label { color: #e6eefc; font-weight: 600; font-size: 0.92em; }
.nge-ds-origin { color: rgba(143, 184, 232, 0.9); }
.nge-ds-more-desc { color: rgba(255, 255, 255, 0.5); font-size: 0.82em; line-height: 1.35; }

.nge-ds-tab-intro {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}
.nge-ds-tab-progress {
  align-self: flex-start;
  padding: 7px 12px;
  font-size: 12px;
  color: rgb(126, 224, 255);
  background: rgba(126, 224, 255, 0.06);
  border: 1px solid rgba(126, 224, 255, 0.28);
  border-radius: 6px;
  cursor: pointer;
}
.nge-ds-tab-progress:hover { background: rgba(126, 224, 255, 0.14); color: #fff; }
.nge-ds-tab-loading {
  font-size: 12px;
  color: rgba(100, 200, 255, 0.7);
}
.nge-ds-tab-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nge-ds-tab-card {
  position: relative;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.nge-ds-tab-card:hover:not(.nge-ds-tab-card--active) {
  background: rgba(100, 200, 255, 0.06);
  border-color: rgba(100, 200, 255, 0.2);
}
.nge-ds-tab-card--active {
  background: rgba(100, 200, 255, 0.1);
  border-color: rgba(100, 200, 255, 0.4);
  cursor: default;
}
.nge-ds-tab-card--switching {
  opacity: 0.5;
  pointer-events: none;
}
.nge-ds-tab-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nge-ds-tab-species { font-size: 16px; line-height: 1; }
/* Cards with a render get it as a small 16:9 thumbnail on the left. */
.nge-ds-tab-card--thumb {
  display: grid;
  grid-template-columns: 124px 1fr;
  gap: 14px;
  align-items: center;
}
.nge-ds-tab-card-body { min-width: 0; }
/* With a thumbnail there is no species icon, so the description and stats
   line up under the name instead of keeping the icon's 24px indent. */
.nge-ds-tab-card--thumb .nge-ds-tab-desc,
.nge-ds-tab-card--thumb .nge-ds-tab-stats { margin-left: 0; }
/* The week tab fits its content; on a short window it still scrolls, just
   without a visible bar. */
.nge-profile-body--week { scrollbar-width: none; }
.nge-profile-body--week::-webkit-scrollbar { display: none; }
.nge-profile-body--week :deep(*) { scrollbar-width: none; }
.nge-ds-tab-thumb {
  width: 124px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
@media (max-width: 520px) {
  .nge-ds-tab-card--thumb { grid-template-columns: 84px 1fr; gap: 10px; }
  .nge-ds-tab-thumb { width: 84px; }
}
.nge-ds-tab-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  flex: 1;
}
.nge-ds-tab-badge {
  font-size: 10px;
  font-weight: 600;
  color: #64c8ff;
  background: rgba(100, 200, 255, 0.12);
  padding: 1px 7px;
  border-radius: 3px;
  letter-spacing: 0.03em;
}
.nge-ds-tab-switch {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
.nge-ds-tab-card:hover .nge-ds-tab-switch { color: #64c8ff; }
.nge-ds-tab-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin: 4px 0 8px 24px;
  line-height: 1.35;
}
.nge-ds-tab-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-left: 24px;
}
.nge-ds-tab-stat {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.6);
}
.nge-ds-tab-stat b {
  color: rgba(255, 255, 255, 0.92);
  font-weight: 600;
}
/* Cells proofread is the headline of a card once there are some. */
.nge-ds-tab-stats { align-items: baseline; }
.nge-ds-tab-stat--cells {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(66, 213, 236, 0.12);
  border: 1px solid rgba(66, 213, 236, 0.35);
}
.nge-ds-tab-stat--cells b {
  color: #5fe3f5;
  font-weight: 800;
  font-size: 14px;
}
.nge-ds-tab-stat--none {
  color: rgba(255, 255, 255, 0.3);
  font-style: italic;
}

/* ── Topbar ── */
.nge-profile-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(74, 158, 255, 0.1);
  background: rgba(74, 158, 255, 0.04);
}

.nge-profile-topbar-label {
  font-size: 0.65em;
  letter-spacing: 0.18em;
  color: rgba(74, 158, 255, 0.55);
  text-transform: uppercase;
  font-weight: 600;
}
/* Dataset scope, in the bar's own lettering. */
.nge-profile-topbar-scope {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  cursor: pointer;
  transition: color 0.15s;
}
.nge-profile-topbar-sep { margin: 0 0.5em; }
.nge-profile-topbar-scope-icon { font-size: 1.5em; letter-spacing: 0; vertical-align: -1px; margin: 0 0.15em 0 0.3em; }
.nge-profile-topbar-scope-name { color: #7ff0e0; border-bottom: 1px dotted rgba(127, 240, 224, 0.4); }
.nge-profile-topbar-scope:hover { color: rgba(140, 195, 255, 0.95); }
.nge-profile-topbar-scope:hover .nge-profile-topbar-scope-name { color: #fff; border-bottom-color: #fff; }
.nge-profile-topbar-scope--fallback .nge-profile-topbar-scope-name { color: #f5a623; }

.nge-profile-exit--tabs { margin-left: auto; padding: 4px 2px 4px 12px; }
.nge-profile-exit {
  background: none; border: none;
  color: #666; font-size: 1.5em; cursor: pointer; line-height: 1; padding: 0;
}
.nge-profile-exit:hover { color: #fff; }

/* ── Three-column body ── */
.nge-profile-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Shared column base ── */
.nge-profile-col {
  overflow-y: auto;
  /* macOS hides overlay scrollbars until you scroll, which made a clipped
     column and a scrollable one look identical. A slim always-there thumb
     says "there's more". */
  scrollbar-gutter: stable;
  padding: 20px 24px 32px;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}
.nge-profile-col::-webkit-scrollbar        { width: 4px; }
.nge-profile-col::-webkit-scrollbar-track  { background: rgba(255, 255, 255, 0.02); }
.nge-profile-col::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }
.nge-profile-col::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.4); }

/* Left: stats + recent cells */
/* Column sizes: ideal 460 / 460 / 360 (1280 total), but each may shrink to a
   minimum. They were fixed-width and unshrinkable, so any window narrower
   than about 1310px cut the right column off the profile (fit audit,
   Amy 2026-09-28: 13" laptops and non-full-screen windows). */
.nge-profile-col--left {
  flex: 0 1 460px;
  min-width: 300px;
}

/* Center: badges + streak + countdown */
.nge-profile-col--center {
  flex: 0 1 460px;
  min-width: 330px;
  overflow-x: hidden;
  border-left: 1px solid rgba(74, 158, 255, 0.08);
  border-right: 1px solid rgba(74, 158, 255, 0.08);
  background: rgba(74, 158, 255, 0.01);
}

/* Very narrow windows (below the three columns' minimums): the right column
   drops under the other two and the body scrolls as one. */
@media (max-width: 960px) {
  body:not(.nge-mobile) .nge-profile-body:has(> .nge-profile-col--right) {
    flex-wrap: wrap;
    overflow-y: auto;
  }
  body:not(.nge-mobile) .nge-profile-body > .nge-profile-col--right {
    flex: 1 1 100%;
    overflow-y: visible;
    border-top: 1px solid rgba(74, 158, 255, 0.08);
  }
}

/* Right: latest badge / badge detail */
.nge-profile-col--right {
  flex: 0 1 360px;
  min-width: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background: rgba(74, 158, 255, 0.015);
  /* Was overflow: hidden, which silently clipped Favorite Badge / Top of the
     Week on short windows while the sibling columns scrolled (the recurring
     "a rule was written but never applied" trap, in reverse: a rule applied
     that never should have been). */
  overflow-y: auto;
  overflow-x: hidden;
}

/* ─────────────────────────────────────────────────────────────────────────────
   HEADER
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-header {
  padding-bottom: 22px;
  margin-bottom: 6px;
  animation: ngeSectionRollIn 0.2s ease-out 0.12s both;
}

.nge-profile-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

/* Flag + inline picker */
.nge-profile-flag-wrap {
  position: relative;
  flex-shrink: 0;
}

/* Flag images (cross-platform — Windows doesn't render flag emoji) */
.nge-flag-img { width: 24px; height: 18px; object-fit: cover; border-radius: 2px; vertical-align: middle; }
.nge-flag-img.nge-pyr-icon { width: 22px; height: 22px; object-fit: contain; border-radius: 0; }
.nge-flag-img--picker { width: 28px; height: 20px; }

.nge-profile-flag {
  background: none; border: none;
  font-size: 1.55em; line-height: 1; cursor: pointer; padding: 2px;
  border-radius: 4px;
  transition: background 0.12s, transform 0.12s;
}
.nge-profile-flag:hover            { background: rgba(255,255,255,0.08); transform: scale(1.1); }
.nge-profile-flag--active          { background: rgba(74,158,255,0.15); }

.nge-profile-flag-picker {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  background: #1c1e26;
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 8px;
  padding: 6px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  max-height: 240px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.3) transparent;
}

.nge-profile-flag-opt {
  background: none; border: none;
  font-size: 1.3em; padding: 4px; border-radius: 4px; cursor: pointer;
  transition: background 0.1s, transform 0.1s;
  line-height: 1;
}
.nge-profile-flag-opt:hover          { background: rgba(255,255,255,0.1); transform: scale(1.15); }
.nge-profile-flag-opt--active        { background: rgba(74,158,255,0.18); }

/* Picker transition */
.nge-flag-picker-enter-active  { transition: all 0.14s cubic-bezier(0.34, 1.56, 0.64, 1); }
.nge-flag-picker-leave-active  { transition: all 0.1s ease-in; }
.nge-flag-picker-enter-from,
.nge-flag-picker-leave-to      { opacity: 0; transform: translateY(-6px) scale(0.96); }

/* Name */
.nge-profile-name {
  font-size: 1.45em;
  font-weight: 700;
  color: #eef0f4;
  letter-spacing: -0.01em;
  text-shadow: 0 0 28px rgba(74, 158, 255, 0.28);
  flex: 1;
}

/* Edit button */
.nge-profile-edit-btn {
  background: none; border: none;
  color: rgba(74, 158, 255, 0.4);
  font-size: 1em; cursor: pointer; padding: 2px 4px; border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.nge-profile-edit-btn:hover {
  color: rgba(74, 158, 255, 0.9);
  background: rgba(74, 158, 255, 0.1);
}

/* The chat handle. Monospace and accented so it reads as an identifier rather
   than more grey metadata like the email below it. */
.nge-profile-username {
  font-family: 'Consolas', 'Monaco', monospace;
  color: #9db8ff;
  font-size: 1.12em;
  font-weight: 600;
  margin: 2px 0 4px;
}

.nge-profile-email {
  font-style: italic;
  color: rgba(158, 158, 158, 0.7);
  font-size: 0.82em;
  margin-bottom: 4px;
}

.nge-profile-bio {
  font-size: 0.82em;
  color: #aaa;
  line-height: 1.45;
  font-style: italic;
  margin-top: 4px;
}

.nge-profile-bio-add {
  background: none; border: none;
  font-size: 0.78em;
  color: rgba(74, 158, 255, 0.45);
  cursor: pointer; padding: 0; margin-top: 4px;
  transition: color 0.15s;
  font-style: italic;
}
.nge-profile-bio-add:hover { color: rgba(74, 158, 255, 0.8); }

/* ─────────────────────────────────────────────────────────────────────────────
   SECTIONS (shared layout)
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-section {
  margin-bottom: 22px;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.nge-profile-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }

/* Section label: "▌ EDITS" style */
.nge-profile-section-label {
  font-size: 0.78em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(120, 180, 255, 0.95);
  margin-bottom: 12px;
}

.nge-profile-section-label--amber { color: rgba(255, 195, 110, 0.95); }

.nge-profile-section-label--green { color: rgba(160, 255, 175, 0.95); }

/* Section roll-in delays */
.nge-profile-section--edits     { animation: ngeSectionRollIn 0.2s ease-out 0.18s both; }
.nge-profile-section--cells     { animation: ngeSectionRollIn 0.2s ease-out 0.24s both; }
.nge-profile-section--streak    { animation: ngeSectionRollIn 0.2s ease-out 0.29s both; }
.nge-profile-section--badges    { animation: ngeSectionRollIn 0.2s ease-out 0.33s both; }
.nge-profile-section--countdown { animation: ngeSectionRollIn 0.2s ease-out 0.37s both; }

/* ── Achievement countdown ── */
.nge-profile-countdown-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.nge-profile-countdown-name { font-weight: 400; color: rgba(255,255,255,0.5); font-size: 0.82em; font-style: italic; }
.nge-profile-countdown-remaining { font-size: 0.86em; color: #cde; }
.nge-profile-countdown-track {
  height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden;
}
.nge-profile-countdown-fill {
  height: 100%; background: linear-gradient(90deg, #7f8, #4a9eff); border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nge-profile-countdown-labels {
  display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.68em; color: #555;
}
.nge-profile-countdown-inline { margin-bottom: 10px; }
.nge-profile-countdown-fill--building { background: linear-gradient(90deg, #ffd08a, #f5a623); }
.nge-profile-countdown-fill--exploration { background: linear-gradient(90deg, #90fff2, #4ae5d5); }
.nge-profile-countdown-fill--loyalty { background: linear-gradient(90deg, #c9a8ff, #f0c869); }

/* ── Stat row ── */
/* Days track: the stretch of the milestone ladder around today. */
.nge-days-ladder { margin: 10px 0 12px; }
.nge-days-steps { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-days-step { min-width: 34px; padding: 3px 8px; border-radius: 999px; text-align: center; font-size: 0.8em; font-variant-numeric: tabular-nums;
  color: rgba(200, 215, 240, 0.55); background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(140, 170, 220, 0.3); }
.nge-days-step--reached { color: #0a1424; font-weight: 700; background: #7fd4ff; border: 1px solid #7fd4ff; }
.nge-days-step--big { border-color: rgba(255, 205, 100, 0.75); color: rgba(255, 215, 130, 0.9); }
.nge-days-step--big.nge-days-step--reached { color: #1c1200; background: #ffcd64; border-color: #ffcd64; }
.nge-days-bar { height: 4px; margin-top: 9px; border-radius: 2px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.nge-days-bar-fill { height: 100%; border-radius: 2px; background: #7fd4ff; transition: width 0.5s ease; }
.nge-days-next { margin-top: 5px; font-size: 0.8em; color: rgba(200, 215, 240, 0.7); }

.nge-profile-stat-row {
  display: flex;
  gap: 16px;
}

.nge-profile-stat-col {
  flex: 1;
}

.nge-profile-stat-label {
  font-size: 0.78em;
  color: #9bb;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  margin-bottom: 4px;
}

.nge-profile-stat-val {
  font-size: 1.2em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  color: #d8dde8;
  letter-spacing: -0.02em;
}

.nge-profile-stat-val--hero {
  font-size: 1.6em;
  color: rgba(120, 200, 255, 0.9);
  text-shadow: 0 0 20px rgba(74, 158, 255, 0.3);
}

.nge-profile-stat-sub {
  font-size: 0.78em;
  color: #aab;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.nge-profile-stat-breakdown {
  display: flex;
  gap: 10px;
  margin-top: 5px;
}

.nge-profile-stat-bp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.92em;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-variant-numeric: tabular-nums;
  color: #889;
}

.nge-profile-stat-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nge-profile-stat-icon--merge { color: rgba(120, 200, 255, 0.9); }
.nge-profile-stat-icon--split { color: rgba(255, 160, 100, 0.9); }

/* ── Weekly Podium (🥇/🥈/🥉) ── */
.nge-profile-section--podium {
  margin-bottom: 14px;
}
.nge-profile-podium-metric {
  margin-top: 6px;
}
.nge-profile-podium-metric:first-of-type {
  margin-top: 0;
}
.nge-profile-podium-metric-label {
  font-size: 0.68em;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(180, 195, 215, 0.55);
  margin-bottom: 2px;
}
.nge-profile-podium-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.nge-profile-podium-tile {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.nge-profile-podium-medal {
  font-size: 1.25em;
  line-height: 1;
}
.nge-profile-podium-count {
  font-weight: 700;
}
.nge-profile-podium-tile--gold {
  background: linear-gradient(135deg, rgba(255, 215, 100, 0.14), rgba(255, 180, 60, 0.08));
  border: 1px solid rgba(255, 215, 100, 0.45);
  color: #ffd964;
  box-shadow: 0 0 10px rgba(255, 215, 100, 0.18);
}
.nge-profile-podium-tile--silver {
  background: linear-gradient(135deg, rgba(220, 230, 240, 0.12), rgba(180, 200, 220, 0.06));
  border: 1px solid rgba(220, 230, 240, 0.35);
  color: #dde6f0;
}
.nge-profile-podium-tile--bronze {
  background: linear-gradient(135deg, rgba(220, 140, 80, 0.13), rgba(180, 100, 50, 0.06));
  border: 1px solid rgba(220, 140, 80, 0.35);
  color: #e3a371;
}

/* ── Streak ── */
.nge-profile-streak-row {
  display: flex;
  align-items: baseline;
  gap: 18px;
  flex-wrap: wrap;
}

.nge-profile-streak-current {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.nge-profile-streak-flame {
  font-size: 1.25em; line-height: 1;
  animation: nge-streak-flicker 2s ease-in-out infinite;
}
.nge-profile-streak-count {
  font-size: 1.7em; font-weight: 800; color: #f5a623; line-height: 1;
  text-shadow: 0 0 8px rgba(245, 166, 35, 0.3);
  animation: nge-streak-glow 3s ease-in-out infinite;
}
@keyframes nge-streak-flicker {
  0%, 100% { transform: scale(1); }
  25% { transform: scale(1.1) rotate(-3deg); }
  75% { transform: scale(1.05) rotate(2deg); }
}
@keyframes nge-streak-glow {
  0%, 100% { text-shadow: 0 0 8px rgba(245, 166, 35, 0.3); }
  50% { text-shadow: 0 0 14px rgba(245, 166, 35, 0.5), 0 0 24px rgba(245, 166, 35, 0.2); }
}
.nge-profile-streak-unit  { font-size: 0.8em; color: #777; }

.nge-profile-streak-best {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.82em;
}
.nge-profile-streak-best-label { color: #9bb; }
.nge-profile-streak-best-val   { color: #cde; font-weight: 600; }

/* ── Activity chart ────────────────────────────────────────── */
.nge-profile-activity-chart {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.nge-profile-chart-label {
  font-size: 0.78em;
  color: #9bb;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  margin-bottom: 6px;
}

.nge-profile-chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 64px;
  padding-bottom: 16px;
}

.nge-profile-chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.nge-profile-chart-bar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 48px;
  width: 100%;
  gap: 1px;
}

.nge-profile-chart-bar {
  width: 100%;
  max-width: 12px;
  border-radius: 2px 2px 0 0;
  min-height: 0;
  transition: height 0.3s ease;
}

.nge-profile-chart-bar--edit {
  /* gold, the Editor Achievements colour (Ames 2026-10-11: one colour key) */
  background: linear-gradient(to top, rgba(255, 208, 138, 0.5), rgba(255, 208, 138, 0.85));
}

.nge-profile-chart-bar--completion {
  /* teal like the Cell Completions track and the cells pill, one colour for
     one quantity (was amber, the trophies' colour) */
  background: linear-gradient(to top, rgba(144, 255, 242, 0.45), rgba(144, 255, 242, 0.85));
  border-radius: 2px;
}

.nge-profile-chart-day {
  font-size: 0.55em;
  color: #445;
  margin-top: 3px;
  white-space: nowrap;
}

.nge-profile-chart-legend {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 4px;
}

.nge-profile-chart-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.62em;
  color: #556;
}

.nge-profile-chart-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.nge-profile-chart-legend-dot--edit {
  background: rgba(255, 208, 138, 0.7);
}

.nge-profile-chart-legend-dot--completion {
  background: rgba(144, 255, 242, 0.7);
}

/* ── Badges ── */
.nge-profile-badges-divider {
  height: 1px;
  margin: 14px 0 8px;
  background: linear-gradient(90deg, transparent 0%, rgba(74, 158, 255, 0.2) 30%, rgba(74, 158, 255, 0.2) 70%, transparent 100%);
}

.nge-profile-badges-hint {
  font-size: 0.7em;
  color: rgba(74, 158, 255, 0.45);
  font-style: italic;
  margin-bottom: 10px;
}

/* Badges sit smaller, five to a row, on faint shelf lines (Amy: "laid out
   as though they were set in 2 rows on a shelf"). The shelf is a repeating
   gradient tuned to the fixed row height plus the row gap. */
.nge-profile-badges-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px 8px;
  grid-auto-rows: 78px;
  padding: 0 2px;
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0px 74px,
    rgba(130, 190, 255, 0.30) 74px 75px,
    rgba(130, 190, 255, 0.08) 75px 77px,
    transparent 77px 90px
  );
}

.nge-profile-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: default;
  transition: transform 0.15s;
  border-radius: 6px;
  padding: 3px 2px;
  transition: transform 0.15s, background 0.15s;
}

.nge-profile-badge:not(.nge-profile-badge--locked) { cursor: pointer; }
.nge-profile-badge:not(.nge-profile-badge--locked):hover { transform: scale(1.1); }
/* Exploration badges: blue highlight (default) */
.nge-profile-badge--selected {
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.3) inset;
}
.nge-profile-badge--selected .nge-profile-badge-img {
  filter: drop-shadow(0 0 6px rgba(100, 180, 255, 0.75));
}
.nge-profile-badge--latest .nge-profile-badge-img {
  filter: drop-shadow(0 0 8px rgba(100, 180, 255, 0.6));
}
.nge-profile-badge--latest .nge-profile-badge-name {
  color: #8ac8ff;
}
/* Building badges: subtle golden highlight */
.nge-profile-badge--building.nge-profile-badge--selected {
  background: rgba(245, 166, 35, 0.06);
  box-shadow: 0 0 0 1px rgba(245, 166, 35, 0.2) inset;
}
.nge-profile-badge--building.nge-profile-badge--selected .nge-profile-badge-img {
  filter: drop-shadow(0 0 3px rgba(255, 200, 80, 0.35));
}
.nge-profile-badge--building.nge-profile-badge--latest .nge-profile-badge-img {
  filter: drop-shadow(0 0 4px rgba(255, 200, 80, 0.3));
}
.nge-profile-badge--building.nge-profile-badge--latest .nge-profile-badge-name {
  color: #ffd08a;
}
/* Twine: rotate 90° to look like an infinity symbol */
.nge-badge--twine { transform: rotate(90deg); }

/* ── "View All" tile in badge grid ── */
.nge-profile-badge--viewall {
  cursor: pointer;
  background: rgba(74, 158, 255, 0.04);
  border: 1px dashed rgba(74, 158, 255, 0.2);
  border-radius: 8px;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.nge-profile-badge--viewall:hover {
  background: rgba(74, 158, 255, 0.1);
  border-color: rgba(74, 158, 255, 0.4);
  transform: scale(1.08);
}
.nge-profile-badge-viewall-icon {
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2em;
  opacity: 0.7;
}

.nge-profile-section--special {
  border-top: none;
}
/* Competitions: the medal with how many times it was won (Ames 2026-10-21) */
.nge-profile-badge--medal .nge-profile-badge-img, .nge-trophy-medal-img { position: relative; display: inline-flex; }
.nge-medal-count {
  position: absolute; right: -6px; bottom: -2px; min-width: 20px; padding: 0 5px; border-radius: 999px;
  background: #0b1424; border: 1px solid rgba(245, 209, 66, 0.75); color: #f8e08a;
  font: 700 10.5px/16px 'Orbitron', 'Inter', sans-serif; text-align: center; letter-spacing: 0.02em;
  box-shadow: 0 0 8px rgba(245, 209, 66, 0.25);
}
.nge-trophy-medal-img .nge-medal-count { right: -8px; bottom: 4px; font-size: 11.5px; line-height: 18px; min-width: 24px; }
.nge-trophy-medal-place { margin-top: 1px; font-size: 0.72em; color: rgba(196, 228, 255, 0.55); }
.nge-medal-wins { color: #f8e08a; }

.nge-profile-medal-gap { align-self: center; width: 1px; height: 30px; margin: 0 4px; background: rgba(100, 180, 255, 0.25); }

.nge-profile-badges-empty {
  font-size: 0.75em;
  color: #556;
  padding: 8px 0;
  font-style: italic;
}

.nge-profile-badges-toggle {
  background: none;
  border: 1px solid rgba(245, 166, 35, 0.25);
  color: rgba(255, 208, 138, 0.6);
  font-size: 0.72em;
  padding: 4px 12px;
  border-radius: 12px;
  cursor: pointer;
  margin-top: 6px;
  transition: color 0.15s, border-color 0.15s;
}
.nge-profile-badges-toggle:hover {
  color: rgba(255, 208, 138, 0.9);
  border-color: rgba(245, 166, 35, 0.45);
}

/* Cells as highlighted tiles: each stat in its own softly lit card, even
   spacing, definitions on hover (the old sub-label row is gone). */
.nge-profile-stat-row--tiles {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.nge-profile-stat-tile {
  flex: 1 1 0;
  min-width: 86px;
  padding: 10px 12px;
  border-radius: 9px;
  background: rgba(74, 158, 255, 0.055);
  border: 1px solid rgba(74, 158, 255, 0.16);
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
/* Compact (Ames 2026-10-01): label and number share a line, so the four
   tiles take two short rows and the column fits without scrolling. */
.nge-profile-stat-row--tiles { gap: 6px; }
.nge-profile-stat-tile--build { background: rgba(170, 140, 255, 0.08); border-color: rgba(170, 140, 255, 0.3); }
.nge-profile-stat-tile--build .nge-profile-stat-val { color: #c9b8ff; text-shadow: 0 0 14px rgba(170, 140, 255, 0.4); }
.nge-profile-stat-row--tiles .nge-profile-stat-tile {
  flex: 1 1 calc(50% - 3px);
  box-sizing: border-box;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px;
}
.nge-profile-stat-row--tiles .nge-profile-stat-label { margin: 0; }
.nge-profile-stat-row--tiles .nge-profile-stat-val { margin: 0; font-size: 1.15em; }
.nge-profile-stat-row--tiles .nge-profile-stat-val--hero { font-size: 1.3em; }
.nge-profile-stat-row--scout .nge-profile-stat-label { white-space: nowrap; font-size: 0.62em; }
/* A number that could not be read says so, never 0. */
.nge-profile-stat-na { font-size: 0.42em; font-weight: 500; letter-spacing: 0.02em; color: #7f8aa0; white-space: nowrap; }
.nge-profile-stat-tile:hover {
  background: rgba(74, 158, 255, 0.1);
  border-color: rgba(74, 158, 255, 0.35);
  transform: translateY(-1px);
}

.nge-profile-right-divider {
  height: 1px;
  margin: 18px 20px;
  background: linear-gradient(90deg, transparent 0%, rgba(74, 158, 255, 0.15) 30%, rgba(74, 158, 255, 0.15) 70%, transparent 100%);
}

.nge-profile-badge-img {
  display: flex; align-items: center; justify-content: center;
  width: 46px; height: 46px;
  transition: filter 0.15s;
}

.nge-profile-badge-icon { width: 42px; height: 42px; object-fit: contain; }

.nge-profile-badge-mystery {
  width: 50px; height: 50px;
  background: rgba(255,255,255,0.04);
  border: 2px dashed rgba(255,255,255,0.12);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  display: flex; align-items: center; justify-content: center;
}
.nge-profile-badge-mystery-q {
  font-size: 1.1em; font-weight: 700; color: rgba(255,255,255,0.18); font-style: italic; line-height: 1;
}

/* Never split a name mid-word ("Screwdri / ver" when the columns shrink on
   a laptop, fit audit 2026-09-28); a narrow center column uses a smaller
   size instead (container query below). */
.nge-profile-badge-name {
  font-size: 0.78em; color: #cde; margin-top: 3px; line-height: 1.2;
  max-width: 80px; word-break: normal; overflow-wrap: normal; hyphens: none;
}
.nge-profile-col--center { container-type: inline-size; }
@container (max-width: 420px) {
  .nge-profile-badge-name { font-size: 0.64em; letter-spacing: -0.01em; }
}
.nge-profile-badge-name--locked { color: #333; }

/* ─────────────────────────────────────────────────────────────────────────────
   VIZ COLUMN
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-viz-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  animation: ngeSectionRollIn 0.2s ease-out 0.15s both;
}

.nge-profile-viz-title {
  font-size: 0.78em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(74, 158, 255, 0.55);
  align-self: flex-start;
}

/* Badge detail in viz column */
.nge-profile-viz-badge { justify-content: flex-start; text-align: center; gap: 12px; padding-top: 16px; }

/* max-width guards: the right column is 360px, and anything wider walked
   off its right edge (Amy's clipped Favorite Badge report, 2026-08-17). */
.nge-profile-viz-badge-icon { width: 220px; height: 220px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 0 20px rgba(74,158,255,0.4)); }
.nge-profile-viz-badge-icon--large { width: 240px; height: 240px; max-width: 100%; }
/* Sized to the window, so the silver favorites and the streak chart fit under it. */
.nge-profile-viz-badge-icon, .nge-profile-viz-badge-icon--large { width: min(220px, calc(25 * var(--nge-vh, 1vh))); height: min(220px, calc(25 * var(--nge-vh, 1vh))); }
.nge-profile-viz-panel { max-width: 100%; box-sizing: border-box; }
.nge-profile-viz-badge-name,
.nge-profile-viz-badge-desc { max-width: 100%; overflow-wrap: break-word; padding: 0 10px; box-sizing: border-box; }

.nge-profile-viz-badge-name {
  font-family: 'Orbitron', 'Rajdhani', 'Audiowide', 'Share Tech Mono', ui-monospace, monospace;
  font-size: 1.1em; font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: linear-gradient(135deg, #e0ecff 0%, #58a6ff 50%, #a0d0ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nge-profile-viz-badge-desc { font-size: 0.8em; color: #888; line-height: 1.4; font-style: italic; }

.nge-profile-viz-badge-threshold {
  font-size: 0.75em; color: #555; line-height: 1.5; text-align: center;
}
.nge-profile-viz-badge-threshold strong { color: rgba(74,158,255,0.7); font-size: 1.15em; }

.nge-profile-viz-badge-back {
  margin-top: 4px;
  background: none; border: none;
  font-size: 0.75em; color: rgba(74,158,255,0.5);
  cursor: pointer; padding: 4px 8px; border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.nge-profile-viz-badge-back:hover { color: rgba(74,158,255,0.9); background: rgba(74,158,255,0.1); }

/* Viz swap transition */
.nge-viz-swap-enter-active { transition: all 0.18s ease-out; }
.nge-viz-swap-leave-active { transition: all 0.12s ease-in; }
.nge-viz-swap-enter-from   { opacity: 0; transform: translateX(12px); }
.nge-viz-swap-leave-to     { opacity: 0; transform: translateX(-12px); }

/* ─────────────────────────────────────────────────────────────────────────────
   CELL HISTORY LIST
───────────────────────────────────────────────────────────────────────────── */
.nge-cell-list {
  margin-top: 16px;
}

.nge-cell-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.nge-cell-list-title {
  font-size: 0.82em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(74, 158, 255, 0.65);
  font-style: normal;
}

.nge-cell-list-columns {
  display: flex;
  align-items: center;
  padding: 0 2px 4px 42px; /* align with cell rows (past fav + pip) */
  border-bottom: 1px solid rgba(74, 158, 255, 0.08);
  margin-bottom: 2px;
}
.nge-cell-col-label {
  font-size: 0.78em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(180, 195, 220, 0.55);
}
.nge-cell-col-label--id { flex: 1; }
.nge-cell-col-label--type { width: 110px; text-align: left; }
.nge-cell-col-label--time { width: 64px; text-align: right; padding-right: 18px; }

.nge-cell-list-more {
  display: block; margin: 6px 0 0 auto;
  background: none; border: none; padding: 2px 4px;
  color: #8cf; font: inherit; font-size: 0.8em; cursor: pointer;
}
.nge-cell-list-more:hover { color: #bdf; text-decoration: underline; }
.nge-cell-list-all {
  margin-left: auto;
  background: none;
  border: 1px solid rgba(120, 170, 255, 0.35);
  border-radius: 8px;
  color: #8cf;
  font: inherit;
  font-size: 0.72em;
  padding: 1px 8px;
  cursor: pointer;
}
.nge-cell-list-all:hover { background: rgba(120, 170, 255, 0.12); }
.nge-profile-body--mycells { display: block; overflow-y: auto; padding: 18px 28px; }
.nge-cell-list-dataset {
  font-size: 0.62em !important;
  font-style: normal !important;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.08);
  border: 1px solid rgba(74, 158, 255, 0.2);
  color: rgba(74, 158, 255, 0.6) !important;
  font-weight: 500;
}

.nge-profile-track-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.nge-profile-track-head .nge-profile-section-label { margin-bottom: 0; }
.nge-profile-track-total { font-size: 0.82em; color: #9fb3cc; white-space: nowrap; }
.nge-profile-track-total b {
  font-family: 'Orbitron', 'Inter', sans-serif; font-size: 1.55em; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--track); margin-right: 3px;
}
.nge-profile-track-head + .nge-profile-countdown-inline { margin-top: 8px; }
.nge-profile-career-note {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin: 0 0 10px;
}

.nge-cell-list-scroll {
  /* As tall as the window allows, so the column never needs its own scroll. */
  max-height: max(52px, min(200px, calc(90 * var(--nge-vh, 1vh) - 580px)));
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}

.nge-cell-list-scroll::-webkit-scrollbar       { width: 3px; }
.nge-cell-list-scroll::-webkit-scrollbar-track  { background: transparent; }
.nge-cell-list-scroll::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }

.nge-cell-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #cde;
  font-size: 0.95em;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  overflow: hidden;
}

.nge-cell-row:hover {
  background: rgba(74, 158, 255, 0.1);
  color: #fff;
}

.nge-cell-pip {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 0.9em;
}

.nge-cell-status--complete .nge-cell-pip,
.nge-cell-pip.nge-cell-status--complete { color: #CE93D8; }
.nge-cell-status--typed .nge-cell-pip,
.nge-cell-pip.nge-cell-status--typed    { color: #4CAF50; }
.nge-cell-status--pending .nge-cell-pip,
.nge-cell-pip.nge-cell-status--pending  { color: #555; }

.nge-cell-id {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.95em;
  color: #9cf;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.nge-cell-type {
  flex: 1;
  font-size: 0.95em;
  color: #bcc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.nge-cell-time {
  flex-shrink: 0;
  font-size: 0.92em;
  color: #889;
  white-space: nowrap;
}

.nge-cell-fav {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  opacity: 0.3;
  transition: opacity 0.12s;
}
.nge-cell-row:hover .nge-cell-fav { opacity: 0.6; }
.nge-cell-fav--active { opacity: 1 !important; color: #f5a623; }

.nge-cell-rename {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  opacity: 0;
  color: rgba(74, 158, 255, 0.6);
  transition: opacity 0.12s;
}
.nge-cell-row:hover .nge-cell-rename { opacity: 0.6; }
.nge-cell-rename:hover { opacity: 1 !important; }

.nge-cell-empty {
  margin-top: 12px;
  font-size: 0.75em;
  color: #444;
  font-style: italic;
  line-height: 1.5;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAB BAR
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-tabbar {
  display: flex;
  align-items: center;
  /* Wrap rather than crop: in the narrower Settings / Datasets shells the
     tabs are wider than the box and "Admin Hub" was cut off (fit audit). */
  flex-wrap: wrap;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(74, 158, 255, 0.1);
  flex-shrink: 0;
}

.nge-profile-tab {
  background: none;
  border: none;
  color: rgba(160, 175, 200, 0.6);
  font-size: 0.82em;
  font-weight: 600;
  padding: 8px 16px 7px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  letter-spacing: 0.02em;
}
.nge-profile-tab-svg { display: inline-block; font-size: 1.25em; line-height: 1; vertical-align: -0.16em; margin-right: 2px; }
.nge-profile-tab-svg :deep(svg) { color: currentColor !important; }
.nge-profile-tab:hover {
  color: rgba(200, 220, 255, 0.8);
}
.nge-profile-tab--active {
  color: rgba(200, 220, 255, 0.95);
  border-bottom-color: #4a9eff;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TROPHY CASE TAB
───────────────────────────────────────────────────────────────────────────── */
/* Flex column so the scroll area takes exactly the space left under the tab
   bar. Its old max-height (90vh minus a guessed 100px) was ~15px taller than
   that space, so the bottom of the grid was clipped (fit audit 2026-09-28). */
.nge-profile-body--trophy {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.nge-profile-body--trophy > .nge-trophy-scroll {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}

/* Week in Science tab — embedded recap, scrolls within the profile body. */
.nge-profile-body--week {
  display: block;
  padding: 0;
  max-height: calc(90 * var(--nge-vh, 1vh) - 100px);
  overflow-y: auto;
}

/* ─────────────────────────────────────────────────────────────────────────────
   ADMIN HUB TAB — fills the body, AdminHub.vue handles internal padding
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-body--admin {
  /* Flex column, not block: AdminHub's own height:100% resolved against an
     auto-height parent, so it grew to its full content height and this
     overflow:hidden clipped it with nothing left to scroll (Triage, the
     longest sub-tab, was unreachable past the first cards). As a shrinking
     flex item it is bounded by the body and its own overflow-y takes over. */
  display: flex;
  flex-direction: column;
  padding: 0;
  max-height: calc(90 * var(--nge-vh, 1vh) - 100px);
  overflow: hidden;
}
.nge-profile-body--admin > :deep(.nge-admin-hub) {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
}

.nge-trophy-scroll {
  overflow-y: auto;
  padding: 16px 24px 24px;
  max-height: calc(90 * var(--nge-vh, 1vh) - 100px);
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}
.nge-trophy-scroll::-webkit-scrollbar        { width: 4px; }
.nge-trophy-scroll::-webkit-scrollbar-track  { background: rgba(255, 255, 255, 0.02); }
.nge-trophy-scroll::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }
.nge-trophy-scroll::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.4); }

.nge-trophy-track {
  margin-bottom: 24px;
}

.nge-trophy-track-label {
  font-size: 0.88em;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.nge-trophy-track-count {
  font-size: 0.82em;
  font-weight: 500;
  color: #667;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 2px 8px;
}

.nge-trophy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 10px;
}

.nge-trophy-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.nge-trophy-badge:hover {
  transform: scale(1.05);
  background: rgba(74, 158, 255, 0.06);
  border-color: rgba(74, 158, 255, 0.15);
}
.nge-trophy-badge--selected {
  background: rgba(74, 158, 255, 0.1) !important;
  border-color: rgba(74, 158, 255, 0.3) !important;
  box-shadow: 0 0 12px rgba(74, 158, 255, 0.15);
}
.nge-trophy-badge--building.nge-trophy-badge--selected {
  background: rgba(245, 166, 35, 0.08) !important;
  border-color: rgba(245, 166, 35, 0.25) !important;
  box-shadow: 0 0 12px rgba(245, 166, 35, 0.1);
}

.nge-trophy-badge--locked {
  opacity: 0.35;
  cursor: default;
}
.nge-trophy-badge--locked:hover {
  transform: none;
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.04);
}

.nge-trophy-badge-icon {
  width: 56px;
  height: 56px;
  object-fit: contain;
  margin-bottom: 6px;
  filter: drop-shadow(0 0 4px rgba(100, 180, 255, 0.2));
}

/* In the Trophy Case grid the art is the card: bigger, and the name and
   count move to the tooltip (Ames 2026-10-27: "badges are too small -- we
   don't want to have the title on display - they can appear on hover"). */
.nge-trophy-grid .nge-trophy-badge { padding: 10px; justify-content: center; }
.nge-trophy-grid .nge-trophy-badge-icon {
  width: 82%; max-width: 150px; height: auto; aspect-ratio: 1; margin-bottom: 0;
}
.nge-trophy-grid .nge-trophy-medal-img { display: block; width: 82%; max-width: 150px; }
.nge-trophy-grid .nge-trophy-medal-img .nge-trophy-badge-icon { width: 100%; }
.nge-trophy-grid .nge-trophy-badge-name,
.nge-trophy-grid .nge-trophy-badge-threshold,
.nge-trophy-grid .nge-trophy-medal-place { display: none; }

.nge-trophy-badge-mystery {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.8em;
  color: #445;
  border: 2px dashed rgba(100, 120, 160, 0.2);
  border-radius: 50%;
  margin-bottom: 6px;
}

.nge-trophy-badge-name {
  font-size: 0.72em;
  font-weight: 600;
  color: rgba(200, 215, 240, 0.85);
  line-height: 1.2;
  margin-bottom: 2px;
}
.nge-trophy-badge-name--locked {
  color: #445;
}

/* Two lines, then an ellipsis (the full text is the tooltip). It used to be
   a plain height cap, which cut sentences mid-word with no sign they
   continued (fit audit 2026-09-28). */

.nge-trophy-badge-threshold {
  font-size: 0.6em;
  color: #556;
  margin-top: 3px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}

/* ── Featured badge banner (top of Trophy Case) ── */
.nge-trophy-featured {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px 28px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, rgba(8, 14, 28, 0.95), rgba(12, 22, 48, 0.9));
  border: 1px solid rgba(74, 158, 255, 0.15);
  border-radius: 14px;
  position: relative;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), inset 0 0 40px rgba(74, 158, 255, 0.02);
}
.nge-trophy-featured-icon {
  width: 350px;
  height: 350px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 0 20px rgba(100, 180, 255, 0.4));
}
.nge-trophy-featured-info {
  flex: 1;
  min-width: 0;
}
.nge-trophy-featured-name {
  font-size: 1.6em;
  font-weight: 700;
  color: #e0ecff;
  margin-bottom: 6px;
}
.nge-trophy-featured-desc {
  font-size: 1em;
  color: #99aabb;
  line-height: 1.5;
  margin-bottom: 8px;
}
.nge-trophy-featured-threshold {
  font-size: 0.88em;
  color: #667;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}
.nge-trophy-featured-fav-label {
  font-size: 0.78em;
  color: rgba(74, 158, 255, 0.6);
  margin-top: 8px;
  letter-spacing: 0.03em;
}
.nge-trophy-featured-star {
  position: absolute;
  top: 16px;
  right: 18px;
  background: none;
  border: none;
  font-size: 2em;
  color: #556;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.2s, transform 0.2s;
  line-height: 1;
}
.nge-trophy-featured-star:hover {
  color: #58a6ff;
  transform: scale(1.15);
}
.nge-trophy-featured-star--active {
  color: #58a6ff;
  text-shadow: 0 0 12px rgba(88, 166, 255, 0.5);
}

/* Favorited badge gets subtle gold outline in grid */
.nge-trophy-badge--favorited {
  box-shadow: 0 0 0 1.5px rgba(255, 215, 0, 0.35) inset;
}
.nge-trophy-badge--silver {
  box-shadow: 0 0 0 1.5px rgba(200, 212, 228, 0.4) inset;
}
.nge-trophy-badge--bronze {
  box-shadow: 0 0 0 1.5px rgba(214, 150, 96, 0.45) inset;
}
.nge-trophy-detail-close:hover { color: #f66; }

/* ── Trophy Case, wide screens (Ames 2026-10-01): the badge on show sits on
      the left with its name and description under it, the grids fill the
      right, and the window takes the whole screen. ── */
.nge-trophy-side, .nge-trophy-main { min-width: 0; }
.nge-trophy-stars { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 4px 0 16px; position: relative; z-index: 2; }
.nge-trophy-starbtn {
  padding: 6px 12px; border-radius: 6px; font: inherit; font-size: 0.82em; font-weight: 600; letter-spacing: 0.04em;
  background: rgba(10, 16, 30, 0.8); border: 1px solid rgba(140, 160, 190, 0.3); color: #8a97ab; cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.nge-trophy-starbtn:disabled { opacity: 0.4; cursor: default; }
.nge-trophy-starbtn--gold:hover:not(:disabled), .nge-trophy-starbtn--gold.is-on { color: #ffd54a; border-color: rgba(255, 213, 74, 0.6); }
.nge-trophy-starbtn--gold.is-on { background: rgba(255, 213, 74, 0.12); }
.nge-trophy-starbtn--silver:hover:not(:disabled), .nge-trophy-starbtn--silver.is-on { color: #dfe7f2; border-color: rgba(223, 231, 242, 0.6); }
.nge-trophy-starbtn--silver.is-on { background: rgba(223, 231, 242, 0.1); }
.nge-trophy-favs { position: relative; z-index: 2; text-align: center; }
.nge-trophy-favs-label { font-size: 0.7em; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(120, 180, 255, 0.7); font-weight: 600; margin-bottom: 8px; }
.nge-trophy-favs-row, .nge-profile-silvers { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.nge-profile-silvers { margin: 10px 20px 0; }
.nge-trophy-favs-empty { font-size: 0.82em; color: #7d8aa0; }
.nge-trophy-fav {
  position: relative; width: 54px; height: 54px; padding: 5px; box-sizing: border-box; border-radius: 9px; cursor: pointer;
  background: rgba(10, 16, 30, 0.75); border: 1px solid rgba(200, 212, 228, 0.35);
  transition: transform 0.15s, border-color 0.15s;
}
.nge-trophy-fav img { width: 100%; height: 100%; object-fit: contain; display: block; }
.nge-trophy-fav:hover { transform: translateY(-2px); border-color: rgba(223, 231, 242, 0.8); }
.nge-trophy-fav.is-shown { box-shadow: 0 0 12px rgba(120, 190, 255, 0.45); }
.nge-trophy-fav-star { position: absolute; top: -7px; right: -6px; font-size: 14px; line-height: 1; color: #dfe7f2; text-shadow: 0 0 4px #000, 0 0 6px rgba(223, 231, 242, 0.6); }
.nge-trophy-fav--gold { border-color: rgba(255, 213, 74, 0.6); }
.nge-trophy-fav--gold .nge-trophy-fav-star { color: #ffd54a; text-shadow: 0 0 4px #000, 0 0 6px rgba(255, 213, 74, 0.7); }
.nge-profile-silvers .nge-trophy-fav { width: 42px; height: 42px; padding: 4px; }
/* Bronze: the third strip, a size down, in a warm copper */
.nge-trophy-starbtn--bronze:hover:not(:disabled), .nge-trophy-starbtn--bronze.is-on { color: #e8a878; border-color: rgba(232, 168, 120, 0.6); }
.nge-trophy-starbtn--bronze.is-on { background: rgba(232, 168, 120, 0.1); }
.nge-trophy-favs-row--bronze { margin-top: 10px; gap: 6px; }
.nge-trophy-fav[draggable="true"] { cursor: grab; }
.nge-trophy-fav.is-dragging { opacity: 0.4; }
.nge-trophy-fav.is-drop { box-shadow: -3px 0 0 0 rgba(120, 190, 255, 0.9); }
.nge-trophy-fav--bronze { width: 42px; height: 42px; padding: 4px; border-color: rgba(214, 150, 96, 0.45); }
.nge-trophy-fav--bronze:hover { border-color: rgba(232, 168, 120, 0.9); }
.nge-trophy-fav--bronze .nge-trophy-fav-star { font-size: 12px; color: #e8a878; text-shadow: 0 0 4px #000, 0 0 6px rgba(232, 168, 120, 0.6); }
.nge-profile-bronzes { margin-top: 8px; gap: 6px; }
.nge-profile-bronzes .nge-trophy-fav { width: 34px; height: 34px; padding: 3px; }
/* Sections in the player's own order: dragged by the grip in the heading */
.nge-trophy-main { display: flex; flex-direction: column; }
.nge-trophy-track { transition: opacity 0.15s ease, box-shadow 0.15s ease; border-radius: 10px; }
.nge-trophy-track.is-dragging { opacity: 0.45; }
.nge-trophy-track.is-drop { box-shadow: 0 -3px 0 0 rgba(120, 190, 255, 0.85); }
.nge-trophy-track-move { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 0.15s ease; }
.nge-trophy-track:hover .nge-trophy-track-move, .nge-trophy-track-move:focus-within { opacity: 1; }
.nge-trophy-track-grip, .nge-trophy-track-nudge {
  padding: 2px 6px; border: 1px solid transparent; border-radius: 5px; background: none; color: rgba(160, 185, 220, 0.75);
  font: inherit; font-size: 11px; line-height: 1.2; cursor: pointer;
}
.nge-trophy-track-grip { cursor: grab; font-size: 14px; }
.nge-trophy-track-grip:active { cursor: grabbing; }
.nge-trophy-track-grip:hover, .nge-trophy-track-nudge:hover, .nge-trophy-track-grip:focus-visible, .nge-trophy-track-nudge:focus-visible {
  color: #dcebff; border-color: rgba(120, 190, 255, 0.45); background: rgba(120, 190, 255, 0.08); outline: none;
}
@media (hover: none), (pointer: coarse) { .nge-trophy-track-move { opacity: 1; } }

@media (min-width: 901px) {
  body:not(.nge-mobile) .nge-profile-shell--trophy { width: calc(97 * var(--nge-vw, 1vw)); max-width: none; height: calc(94 * var(--nge-vh, 1vh)); max-height: calc(94 * var(--nge-vh, 1vh)); }
  body:not(.nge-mobile) .nge-profile-body--trophy > .nge-trophy-scroll {
    display: grid; grid-template-columns: minmax(300px, 34%) minmax(0, 1fr);
    overflow: hidden; padding: 0;
  }
  body:not(.nge-mobile) .nge-trophy-side {
    --trophy-icon: min(300px, calc(24 * var(--nge-vw, 1vw)), calc(38 * var(--nge-vh, 1vh)));
    overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
    padding: 28px 22px 22px; border-right: 1px solid rgba(74, 158, 255, 0.1);
  }
  body:not(.nge-mobile) .nge-trophy-main {
    overflow-y: auto; padding: 22px 26px 26px;
    scrollbar-width: thin; scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
  }
  body:not(.nge-mobile) .nge-trophy-side .nge-trophy-featured {
    flex-direction: column; align-items: center; text-align: center; gap: 22px; padding: 12px 0 0; margin-bottom: 10px;
  }
  body:not(.nge-mobile) .nge-trophy-side .nge-trophy-featured-icon { width: var(--trophy-icon); height: var(--trophy-icon); }
  body:not(.nge-mobile) .nge-trophy-side .nge-trophy-featured-effects { left: 50%; top: calc(12px + var(--trophy-icon) / 2); }
  body:not(.nge-mobile) .nge-trophy-side .nge-trophy-featured-info { flex: none; position: relative; z-index: 1; }
  /* The stars live in the row under the badge here. */
  body:not(.nge-mobile) .nge-trophy-side .nge-trophy-featured-star,
  body:not(.nge-mobile) .nge-trophy-side .nge-trophy-featured-fav-label { display: none; }
  body:not(.nge-mobile) .nge-trophy-main .nge-trophy-grid { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); }
}

/* ── Hero-style effects around featured badge ── */
.nge-trophy-featured {
  overflow: visible;          /* let rings extend beyond banner */
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  gap: 72px;                  /* more space between icon and text */
}
.nge-trophy-featured-effects {
  position: absolute;
  top: 50%;
  left: 200px;               /* center on the 350px icon area + padding */
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 0;
}
.nge-trophy-featured-icon {
  z-index: 1;
  position: relative;
}
.nge-trophy-featured-icon--animated {
  animation: nge-trophy-float 5s ease-in-out infinite alternate;
}
.nge-trophy-featured-name--scifi {
  font-family: 'Orbitron', 'Rajdhani', 'Audiowide', 'Share Tech Mono', ui-monospace, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 1.8em;
  background: linear-gradient(135deg, #e0ecff 0%, #58a6ff 50%, #a0d0ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
@keyframes nge-trophy-float {
  from { transform: translateY(0); }
  to   { transform: translateY(-8px); }
}

/* Rotating rings */
.nge-trophy-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid transparent;
  will-change: transform;
  transform: translateZ(0);
  top: 50%;
  left: 50%;
}
.nge-trophy-ring--1 {
  width: 380px; height: 380px;
  margin: -190px 0 0 -190px;
  border-color: rgba(0, 200, 255, 0.12);
  animation: nge-trophy-ring-spin 50s linear infinite;
  box-shadow: 0 0 12px rgba(0, 200, 255, 0.06);
}
.nge-trophy-ring--2 {
  width: 340px; height: 340px;
  margin: -170px 0 0 -170px;
  border-color: rgba(206, 147, 216, 0.08);
  border-style: dashed;
  animation: nge-trophy-ring-spin 70s linear infinite reverse;
  box-shadow: 0 0 12px rgba(206, 147, 216, 0.04);
}
.nge-trophy-ring--3 {
  width: 410px; height: 410px;
  margin: -205px 0 0 -205px;
  border-color: rgba(0, 255, 180, 0.05);
  border-width: 0.5px;
  animation: nge-trophy-ring-spin 90s linear infinite;
}
/* Trim-path style rings: dashed with animated dash offset */
.nge-trophy-ring--4 {
  width: 440px; height: 440px;
  margin: -220px 0 0 -220px;
  border: none;
  background: transparent;
  border-radius: 50%;
  /* SVG-like trim path via background gradient on a ring */
  box-shadow: none;
  outline: 1.5px dashed rgba(0, 200, 255, 0.07);
  outline-offset: -1px;
  animation: nge-trophy-ring-spin 120s linear infinite;
}
.nge-trophy-ring--5 {
  width: 360px; height: 360px;
  margin: -180px 0 0 -180px;
  border: 1.5px solid transparent;
  border-top-color: rgba(0, 200, 255, 0.1);
  border-right-color: rgba(206, 147, 216, 0.06);
  animation: nge-trophy-ring-spin 40s linear infinite reverse;
}
@keyframes nge-trophy-ring-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Orbital dots */
.nge-trophy-orbit-dot {
  position: absolute;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: rgba(0, 220, 255, 0.8);
  box-shadow: 0 0 6px rgba(0, 220, 255, 0.4), 0 0 12px rgba(0, 220, 255, 0.15);
  top: 50%; left: 50%;
  will-change: transform;
  animation: nge-trophy-orbit 40s linear infinite;
  animation-delay: calc(var(--j) * -3.3s);
}
.nge-trophy-orbit-dot:nth-child(odd) {
  width: 3px; height: 3px;
  background: rgba(206, 180, 255, 0.7);
  box-shadow: 0 0 5px rgba(206, 180, 255, 0.3);
  animation-duration: 55s;
  animation-direction: reverse;
}
.nge-trophy-orbit-dot:nth-child(3n) {
  width: 3.5px; height: 3.5px;
  background: rgba(0, 255, 180, 0.6);
  box-shadow: 0 0 5px rgba(0, 255, 180, 0.3);
  animation-duration: 48s;
}
/* Outer orbit particles */
.nge-trophy-orbit-dot:nth-child(n+7) {
  animation-name: nge-trophy-orbit-outer;
  animation-duration: 65s;
  width: 3px; height: 3px;
  opacity: 0.8;
}
.nge-trophy-orbit-dot:nth-child(8) {
  width: 3.5px; height: 3.5px;
  background: rgba(255, 200, 100, 0.6);
  box-shadow: 0 0 5px rgba(255, 200, 100, 0.3);
  animation-duration: 58s;
  animation-direction: reverse;
}
.nge-trophy-orbit-dot:nth-child(9) {
  width: 3px; height: 3px;
  background: rgba(100, 180, 255, 0.7);
  box-shadow: 0 0 5px rgba(100, 180, 255, 0.3);
  animation-duration: 72s;
}
.nge-trophy-orbit-dot:nth-child(10) {
  width: 3px; height: 3px;
  background: rgba(255, 150, 200, 0.6);
  box-shadow: 0 0 6px rgba(255, 150, 200, 0.3);
  animation-duration: 50s;
  animation-direction: reverse;
}
.nge-trophy-orbit-dot:nth-child(11) {
  width: 3.5px; height: 3.5px;
  background: rgba(0, 220, 255, 0.5);
  box-shadow: 0 0 5px rgba(0, 220, 255, 0.2);
  animation-duration: 80s;
}
.nge-trophy-orbit-dot:nth-child(12) {
  width: 2.5px; height: 2.5px;
  background: rgba(206, 147, 216, 0.6);
  box-shadow: 0 0 4px rgba(206, 147, 216, 0.3);
  animation-duration: 62s;
  animation-direction: reverse;
}
@keyframes nge-trophy-orbit {
  from { transform: rotate(calc(var(--j) * 45deg))       translateX(175px) rotate(calc(var(--j) * -45deg)); }
  to   { transform: rotate(calc(var(--j) * 45deg + 360deg)) translateX(175px) rotate(calc(var(--j) * -45deg - 360deg)); }
}
@keyframes nge-trophy-orbit-outer {
  from { transform: rotate(calc(var(--j) * 45deg))       translateX(210px) rotate(calc(var(--j) * -45deg)); }
  to   { transform: rotate(calc(var(--j) * 45deg + 360deg)) translateX(210px) rotate(calc(var(--j) * -45deg - 360deg)); }
}

/* Pulsing aura */
.nge-trophy-aura {
  position: absolute;
  width: 340px; height: 340px;
  top: 50%; left: 50%;
  margin: -170px 0 0 -170px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 180, 255, 0.05) 0%, rgba(206, 147, 216, 0.025) 40%, transparent 70%);
  animation: nge-trophy-aura-pulse 10s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nge-trophy-aura-pulse {
  0%, 100% { transform: scale(1);    opacity: 0.5; }
  50%      { transform: scale(1.12); opacity: 0.85; }
}

/* ─────────────────────────────────────────────────────────────────────────────
   ALL SPECIAL AWARDS MODAL
───────────────────────────────────────────────────────────────────────────── */
.nge-special-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 4, 12, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: ngeSectionRollIn 0.18s ease-out;
}
.nge-special-modal {
  width: min(720px, calc(92 * var(--nge-vw, 1vw)));
  max-height: calc(80 * var(--nge-vh, 1vh));
  background: linear-gradient(135deg, rgba(8, 12, 24, 0.98), rgba(12, 18, 32, 0.97));
  border: 1px solid rgba(74, 158, 255, 0.25);
  border-radius: 12px;
  padding: 18px 20px 24px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.55), 0 0 32px rgba(74, 158, 255, 0.08);
  display: flex;
  flex-direction: column;
}
.nge-special-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.nge-special-modal-title {
  font-size: 0.92em;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #cde;
  text-transform: uppercase;
}
.nge-special-modal-close {
  background: none; border: none;
  color: #889; font-size: 1.4em; cursor: pointer; line-height: 1;
}
.nge-special-modal-close:hover { color: #fff; }
.nge-special-modal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
  overflow-y: auto;
  /* Always reserve the scrollbar's space so revealing it on hover doesn't
     reflow the grid and resize every badge. */
  scrollbar-gutter: stable;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) transparent;
}
.nge-special-modal-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 8px;
  padding: 10px 6px;
  cursor: pointer;
  transition: transform 0.12s, background 0.12s, border-color 0.12s;
}
.nge-special-modal-tile:hover {
  transform: scale(1.05);
  background: rgba(74, 158, 255, 0.06);
  border-color: rgba(74, 158, 255, 0.18);
}
.nge-special-modal-icon {
  width: 56px; height: 56px; object-fit: contain;
  margin-bottom: 6px;
}
.nge-special-modal-name {
  font-size: 0.78em; color: #cde;
  font-weight: 600;
  line-height: 1.2;
}
.nge-special-modal-reason {
  font-size: 0.7em; color: #889;
  margin-top: 4px; line-height: 1.3;
  font-style: italic;
}

/* ─────────────────────────────────────────────────────────────────────────────
   MOBILE FULLSCREEN BADGE VIEWER
   Tap the featured badge art on a phone: the badge takes the whole screen
   with a simplified award moment (bloom halo, one sweeping ring, springy
   scale in). Tap anywhere to close.
───────────────────────────────────────────────────────────────────────────── */
.nge-badge-zoom {
  position: fixed;
  inset: 0;
  z-index: 10600;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  box-sizing: border-box;
  background: radial-gradient(ellipse at 50% 42%, rgba(20, 40, 80, 0.92), rgba(2, 5, 12, 0.97) 70%);
  backdrop-filter: blur(8px);
  text-align: center;
}
.nge-badge-zoom-halo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(calc(90 * var(--nge-vw, 1vw)), 420px);
  height: min(calc(90 * var(--nge-vw, 1vw)), 420px);
  transform: translate(-50%, -62%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(53, 181, 255, 0.28) 0%, rgba(53, 181, 255, 0.08) 45%, transparent 70%);
  animation: nge-bz-halo 2.4s ease-out both;
  pointer-events: none;
}
.nge-badge-zoom-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(calc(74 * var(--nge-vw, 1vw)), 340px);
  height: min(calc(74 * var(--nge-vw, 1vw)), 340px);
  transform: translate(-50%, -62%);
  border-radius: 50%;
  border: 1px solid rgba(53, 181, 255, 0.55);
  border-top-color: rgba(191, 233, 255, 0.9);
  box-shadow: 0 0 24px rgba(53, 181, 255, 0.35), inset 0 0 24px rgba(53, 181, 255, 0.12);
  animation: nge-bz-ring 2.2s cubic-bezier(0.22, 1, 0.36, 1) both;
  pointer-events: none;
}
.nge-badge-zoom-img {
  width: min(calc(64 * var(--nge-vw, 1vw)), 300px);
  height: min(calc(64 * var(--nge-vw, 1vw)), 300px);
  object-fit: contain;
  margin-bottom: 6px;
  filter: drop-shadow(0 0 24px rgba(100, 180, 255, 0.55));
  animation: nge-bz-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.nge-badge-zoom-name {
  font-family: 'Orbitron', sans-serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #f0f6ff;
  text-shadow: 0 0 14px rgba(53, 181, 255, 0.6);
  animation: nge-bz-rise 0.5s 0.15s ease-out both;
}
.nge-badge-zoom-desc {
  font-size: 14px;
  line-height: 1.5;
  color: #aebfdd;
  max-width: 320px;
  animation: nge-bz-rise 0.5s 0.25s ease-out both;
}
.nge-badge-zoom-meta {
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  letter-spacing: 1.2px;
  color: rgba(53, 181, 255, 0.85);
  text-transform: uppercase;
  animation: nge-bz-rise 0.5s 0.35s ease-out both;
}
.nge-badge-zoom-hint {
  position: absolute;
  bottom: calc(18px + env(safe-area-inset-bottom));
  left: 0;
  right: 0;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(143, 166, 204, 0.6);
  text-transform: uppercase;
  animation: nge-bz-rise 0.5s 0.6s ease-out both;
}

@keyframes nge-bz-pop {
  from { transform: scale(0.4); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}
@keyframes nge-bz-rise {
  from { transform: translateY(10px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes nge-bz-halo {
  0%   { opacity: 0; transform: translate(-50%, -62%) scale(0.5); }
  35%  { opacity: 1; }
  100% { opacity: 0.75; transform: translate(-50%, -62%) scale(1); }
}
@keyframes nge-bz-ring {
  0%   { opacity: 0; transform: translate(-50%, -62%) scale(0.45) rotate(0deg); }
  30%  { opacity: 1; }
  100% { opacity: 0.7; transform: translate(-50%, -62%) scale(1) rotate(200deg); }
}

.nge-bz-enter-active, .nge-bz-leave-active { transition: opacity 0.25s ease; }
.nge-bz-enter-from, .nge-bz-leave-to { opacity: 0; }

/* The featured art is a tap target on phones. */
body.nge-mobile .nge-trophy-featured-icon { cursor: pointer; }


/* ─────────────────────────────────────────────────────────────────────────────
   FULL SCREEN (Ames 2026-10-11): the profile fills the window on desktop, as
   it already did on phones (mobile.css). The three Overview columns keep
   their 460 : 460 : 360 proportions and grow with the window; the narrower
   tabs (Datasets, Settings, Admin Hub, Blog) keep their widths, centred.
   Bodies that capped themselves at 90vh minus a guess are bounded by the
   shell instead. Test page: experimental-UI/components/profile.html.
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-modal :deep(.nge-overlay.modal.overlay-content) {
  width: calc(100 * var(--nge-vw, 1vw));
  height: calc(100 * var(--nge-vh, 1vh));
  /* ng-override sizes every overlay to its content (min-width: max-content):
     here that is about 1340 px, so on a narrower window the profile spilled
     off both sides with its close button out of sight (Celia, report 171,
     2026-10-19). The frame is the window; the Overview scrolls inside it. */
  min-width: 0 !important;
  /* ng-override caps every modal at 100vw - 24px, with !important */
  max-width: calc(100 * var(--nge-vw, 1vw)) !important;
  max-height: calc(100 * var(--nge-vh, 1vh)) !important;
  border-radius: 0;
  box-sizing: border-box;
}
.nge-profile-modal .nge-profile-shell,
.nge-profile-modal .nge-profile-shell--trophy,
.nge-profile-modal .nge-profile-shell--admin,
.nge-profile-modal .nge-profile-shell--week,
.nge-profile-modal .nge-profile-shell--dstats,
.nge-profile-modal .nge-profile-shell--datasets,
.nge-profile-modal .nge-profile-shell--settings {
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: calc(100 * var(--nge-vh, 1vh));
}
.nge-profile-modal .nge-profile-col--main { flex: 1 1 0; min-width: 0; }
.nge-profile-modal .nge-profile-col--right  { flex: 0 1 420px; min-width: 300px; }
/* room at the edges on desktop: full screen is not a reason to sit on them
   (Ames 2026-10-11). Phones keep mobile.css's safe area padding. */
body:not(.nge-mobile) .nge-profile-modal :deep(.nge-overlay.modal.overlay-content) {
  padding: 22px 40px 26px;
}
/* the tabs that were narrower boxes keep their widths, centred in the frame */
.nge-profile-modal .nge-profile-body--datasets,
.nge-profile-modal .nge-profile-body.nge-ds-more { width: 100%; max-width: 640px; align-self: center; }
/* sized to its list, not to the whole frame, so More datasets follows it
   instead of sitting at the foot of the screen */
.nge-profile-modal .nge-profile-body--datasets { flex: 0 1 auto; }
/* Settings use the full width of the profile (Ames 2026-10-21). */
.nge-profile-modal .nge-profile-body--settings { width: 100%; max-width: none; align-self: stretch; }
.nge-profile-modal .nge-profile-body--admin { width: 100%; max-width: 720px; align-self: center; max-height: none; }
.nge-profile-modal .nge-profile-body--week { width: 100%; max-width: 1180px; align-self: center; max-height: none; }
.nge-profile-modal .nge-profile-body--dstats { width: 100%; max-width: 1180px; align-self: center; max-height: none; }
.nge-profile-modal .nge-profile-body--trophy { width: 100%; max-width: 1200px; align-self: center; }
/* the Overview keeps the proportions it has at 1920 px: on a wider screen
   (Ames 2026-10-13, a 2560 px window: "look how bad this looks on a super
   wide screen") the rows no longer stretch, the body is capped and centred
   in the frame like the other tabs */
.nge-profile-modal .nge-profile-body--overview { width: 100%; max-width: 1880px; align-self: center; }
/* Narrower than its columns can go (a small laptop, or a zoomed in browser):
   the Overview scrolls sideways inside the frame; the top bar, the tabs and
   the close button stay put. */
.nge-profile-modal .nge-profile-body--overview { min-width: 0; overflow-x: auto; }
.nge-profile-modal .nge-profile-shell { min-width: 0; }
.nge-profile-modal .nge-trophy-scroll { max-height: none; }

/* ── Cells completed and Edits: the curve, then the three windows ──────────
   The curve sits under the label and the numbers under it, whatever the
   column's width (Ames 2026-10-11: "put the animated chart above the
   stats"). */
.nge-profile-section--completions { animation: ngeSectionRollIn 0.2s ease-out 0.16s both; }
.nge-profile-windows { display: grid; gap: 10px; min-width: 0; }
.nge-profile-windows :deep(.nge-effort) { margin-top: 2px; }

/* ── Days: the latest Days Achievement beside the total ─────────────────── */
.nge-profile-days-row { display: flex; align-items: center; gap: 20px; }
.nge-profile-days-row > .nge-profile-stat-col { flex: 1 1 0; min-width: 0; }
.nge-profile-feature {
  flex: none; width: 92px;
  display: flex; flex-direction: column; align-items: center; text-align: center;
  cursor: pointer; border-radius: 8px; padding: 4px 2px;
  transition: background 0.15s, transform 0.15s;
}
.nge-profile-feature:hover { background: rgba(74, 158, 255, 0.06); transform: translateY(-1px); }
.nge-profile-feature-icon { width: 64px; height: 64px; object-fit: contain; filter: drop-shadow(0 0 10px rgba(201, 168, 255, 0.35)); }
/* the same beside the cells and edits numbers: the art at the left, the
   curve and the three windows to its right */
.nge-profile-feature-row { display: flex; align-items: center; gap: 20px; }
.nge-profile-feature-row > .nge-profile-windows { flex: 1 1 0; min-width: 0; }

/* ── Achievement names are tooltips, not labels (Ames 2026-10-11) ─────────
   The Overview's rows show the art alone; the name shows on hover. The
   rows are shorter for it, with the shelf line redrawn under the art. */
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge .nge-profile-badge-name { display: none; }
.nge-track-achievements .nge-profile-badges-grid {
  grid-auto-rows: 56px;
  /* no shelf line: with the names gone it read as a stray border under
     each row (Ames 2026-10-11); the section's own border is enough */
  background-image: none;
}

/* ── View all: a round button with a drawn arrow, not a dashed box with a
   text arrow (Ames 2026-10-11) ── */
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge--viewall,
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge--viewall:hover { background: none; border: none; transform: none; }
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge--viewall .nge-profile-badge-img {
  width: 42px; height: 42px; border-radius: 50%;
  border: 1px solid rgba(140, 195, 255, 0.35);
  background: rgba(74, 158, 255, 0.06);
  color: rgba(170, 210, 255, 0.9);
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s, color 0.15s;
}
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge--viewall:hover .nge-profile-badge-img {
  border-color: rgba(170, 210, 255, 0.9);
  background: rgba(74, 158, 255, 0.14);
  box-shadow: 0 0 14px rgba(74, 158, 255, 0.35);
  color: #fff;
}
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge-viewall-icon { width: 20px; height: 20px; opacity: 1; transition: transform 0.15s; }
:is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge--viewall:hover .nge-profile-badge-viewall-icon { transform: translateX(2px); }

/* ── One row per track (Ames 2026-10-11) ────────────────────────────────
   The stats and curve at the left, that track's Achievements at the right,
   in one grid so the rows line up. The achievements cell keeps the look of
   the old middle column: the hairline and the faint tint. */
.nge-track-row {
  display: grid;
  /* the stats take the larger share: three windows with merge/split
     breakdowns need the room, the tile grid is capped at 440 px */
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 0 22px;
  padding: 16px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
/* ── The row's head ────────────────────────────────────────────────────────
   The label, a 1.4px circuit trace drawn out to a pad, a second pad 9px
   further on (the same small distance in every row, as on the layer tabs,
   where a trace breaks at a component), and from it the bar toward the
   next Achievement, lit as far as the count has come, ending at a quiet
   count of how many to go (Ames 2026-10-11). The break lands where each
   label's wire ends, not at one shared spot. */
@property --nge-track-run  { syntax: '<number>'; inherits: false; initial-value: 1; }
@property --nge-track-fill { syntax: '<number>'; inherits: false; initial-value: 1; }
.nge-track-row--cells { --track: #90fff2; }
.nge-track-row--edits { --track: #ffd08a; }
.nge-track-row--days  { --track: #c9a8ff; }
.nge-track-head {
  grid-column: 1 / -1;
  display: flex; align-items: center;
  margin-bottom: 12px; min-width: 0;
  /* ends above the Achievements' last tile (set by layoutTrackHeads), not
     at the frame's edge (Ames 2026-10-13) */
  width: var(--head-end, auto); max-width: 100%; justify-self: start; box-sizing: border-box;
}
.nge-track-head .nge-profile-section-label { margin: 0 10px 0 0; white-space: nowrap; color: var(--track); }
/* the head's lines sit at about half strength so the curve below, in the
   same colour, stays the figure (Ames 2026-10-11: "they need distinction") */
.nge-track-wire, .nge-track-pads, .nge-track-bar { height: 9px; --trace: color-mix(in srgb, var(--track) 52%, transparent); --pad: color-mix(in srgb, var(--track) 55%, transparent); }
.nge-track-wire {
  flex: 0 1 120px; min-width: 16px;
  --nge-track-run: 1;
  background: linear-gradient(var(--trace), var(--trace)) left 50% / calc(100% * var(--nge-track-run)) 1.4px no-repeat;
}
.nge-track-pads {
  flex: none; width: 22px;
  background:
    radial-gradient(circle at 4.5px 50%, #0a1223 0 0.9px, var(--pad) 1.3px 2.1px, transparent 2.5px),
    radial-gradient(circle at 13.5px 50%, #0a1223 0 0.9px, var(--pad) 1.3px 2.1px, transparent 2.5px);
}
.nge-track-bar {
  flex: 1 1 0; min-width: 24px;
  --nge-track-fill: 1;
  cursor: help;
  background:
    linear-gradient(var(--trace), var(--trace)) left 50% / calc(100% * var(--frac, 1) * var(--nge-track-fill)) 1.4px no-repeat,
    linear-gradient(rgba(201, 228, 255, 0.14), rgba(201, 228, 255, 0.14)) left 50% / 100% 1.4px no-repeat;
}
/* the trace draws when its row goes live (the rows take turns, so no per
   row delays any more) */
.nge-track-row.is-live .nge-track-wire { animation: ngeTrackRun 420ms cubic-bezier(0.3, 0, 0.2, 1) 1 both; }
.nge-track-row.is-live .nge-track-pads { animation: ngeTrackPads 180ms linear 420ms 1 both; }
.nge-track-row.is-live .nge-track-bar  { animation: ngeTrackFill 560ms cubic-bezier(0.3, 0, 0.2, 1) 560ms 1 both; }
/* a row that has not had its turn keeps its label and its space (Ames
   2026-10-17) */
.nge-track-row:not(.is-live) > :not(.nge-track-head),
.nge-track-row:not(.is-live) .nge-track-head > :not(.nge-profile-section-label) { opacity: 0; pointer-events: none; }
/* and when it goes live everything comes in from the top down (Ames: "the
   badges are building in from the bottom"): the stats settle down from
   above, the tiles follow one after another left to right, the count lands
   once its bar has filled. The sections' own roll in, which slid up from
   below out of step with the row, is off inside the rows. */
@keyframes ngeRowIn { 0% { opacity: 0; transform: translateY(-6px); } 100% { opacity: 1; transform: none; } }
.nge-track-row .nge-profile-section { animation: none; }
.nge-track-row.is-live > .nge-track-stats,
.nge-track-row.is-live > .nge-track-achievements--rest { animation: ngeRowIn 0.3s ease-out both; }
.nge-track-row.is-live .nge-track-count { animation: ngeRowIn 0.3s ease-out 0.55s both; }
.nge-track-row.is-live .nge-track-achievements .nge-profile-badge { animation: ngeRowIn 0.26s ease-out both; }
.nge-track-row.is-live .nge-track-achievements .nge-profile-badge:nth-child(2) { animation-delay: 70ms; }
.nge-track-row.is-live .nge-track-achievements .nge-profile-badge:nth-child(3) { animation-delay: 140ms; }
.nge-track-row.is-live .nge-track-achievements .nge-profile-badge:nth-child(4) { animation-delay: 210ms; }
.nge-track-row.is-live .nge-track-achievements .nge-profile-badge:nth-child(5) { animation-delay: 280ms; }
.nge-track-row.is-live .nge-track-achievements .nge-profile-badge:nth-child(n+6) { animation-delay: 350ms; }
@keyframes ngeTrackRun  { 0% { --nge-track-run: 0; }  100% { --nge-track-run: 1; } }
@keyframes ngeTrackPads { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes ngeTrackFill { 0% { --nge-track-fill: 0; } 100% { --nge-track-fill: 1; } }
@media (prefers-reduced-motion: reduce) { .nge-track-row.is-live :is(.nge-track-wire, .nge-track-pads, .nge-track-bar, .nge-track-count, .nge-track-stats, .nge-track-achievements--rest, .nge-profile-badge) { animation: none; } }
/* quiet: it is a note at the end of the bar, not a number to read first */
.nge-track-count {
  margin-left: 10px;
  font-size: 0.7em; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  white-space: nowrap; cursor: help;
  color: color-mix(in srgb, var(--track) 72%, transparent);
}

/* ── All time is the number that counts: the display face the career totals
   used, in the track's colour (Ames 2026-10-11) ── */
.nge-profile-stat-col--all .nge-profile-stat-label { color: var(--track); opacity: 0.85; }
.nge-profile-stat-col--all .nge-profile-stat-val,
.nge-track-row--days .nge-profile-stat-val--hero {
  font-family: 'Orbitron', 'Rajdhani', ui-monospace, 'Cascadia Code', monospace;
  font-size: 1.6em; font-weight: 700; letter-spacing: 0.02em; line-height: 1.15;
  color: var(--track);
  text-shadow: 0 0 16px color-mix(in srgb, var(--track) 35%, transparent);
}

/* ── The three windows share their lines (Ames 2026-10-12: "all time is out
   of alignment with the other stats") ──────────────────────────────────────
   One grid for the nine cells, not three stacked columns: the labels on one
   line, the three numbers on ONE BASELINE whatever their face and size, and
   the merge/split breakdowns on one line under them. The columns are sized
   to their content, so the bigger All time number takes what it needs and
   the row never runs past its box into the Achievements (Ames: "edit badges
   are very close to the edge of the graph"); a breakdown short of room for
   one line wraps to two instead. */
.nge-profile-windows .nge-profile-stat-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(min-content, 210px));  /* never spread across a wide cell */
  gap: 0 16px;  /* the flex rule's gap would open 16 px between the lines */
  align-items: baseline;
}
.nge-profile-windows .nge-profile-stat-col { display: contents; }
.nge-profile-windows .nge-profile-stat-col:nth-child(1) > * { grid-column: 1; }
.nge-profile-windows .nge-profile-stat-col:nth-child(2) > * { grid-column: 2; }
.nge-profile-windows .nge-profile-stat-col:nth-child(3) > * { grid-column: 3; }
.nge-profile-windows .nge-profile-stat-label { grid-row: 1; }
.nge-profile-windows .nge-profile-stat-val { grid-row: 2; }
.nge-profile-windows .nge-profile-stat-breakdown { grid-row: 3; flex-wrap: wrap; row-gap: 2px; min-width: 0; }
/* the laptop tiers keep the breakdowns to one line a little longer, and
   where the windows are too narrow for that (a 1366 px laptop) all three
   stack as two lines together, not whichever happens to run out of room */
.is-compact .nge-profile-windows .nge-profile-stat-bp { font-size: 0.84em; gap: 3px; }
.is-compact .nge-profile-windows .nge-profile-stat-icon { width: 16px; height: 16px; }
.is-compact .nge-profile-windows .nge-profile-stat-breakdown { column-gap: 8px; }
.nge-profile-windows { container-type: inline-size; }
@container (max-width: 360px) {
  .nge-profile-stat-breakdown { flex-direction: column; align-items: flex-start; row-gap: 1px; }
}
.is-compact .nge-profile-stat-col--all .nge-profile-stat-val,
.is-compact .nge-track-row--days .nge-profile-stat-val--hero { font-size: 1.4em; }

/* the Achievements sit in the middle of their row's height */
.nge-track-achievements { display: flex; flex-direction: column; justify-content: center; }
.nge-track-achievements--rest { justify-content: flex-start; }

/* ── No scroll on the Overview (Ames 2026-10-11) ──────────────────────────
   The three rows take their natural height, the last row takes what is
   left, and the list scrolls inside its own box. Phones keep scrolling as
   one page (mobile.css). On a short screen the last row keeps room for the
   Scout report and several cells, and the Overview scrolls instead of
   cutting them off (Ames 2026-10-24: "keep in mind smaller screens, we may
   have to enable scroll"). Tall screens never see a scrollbar. */
body:not(.nge-mobile) .nge-profile-col--main { overflow-x: hidden; overflow-y: auto; display: flex; flex-direction: column; }
body:not(.nge-mobile) .nge-track-rows { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
body:not(.nge-mobile) .nge-track-row { flex: none; }
body:not(.nge-mobile) .nge-track-row--rest { flex: 1 1 0; min-height: 240px; }
body:not(.nge-mobile) .nge-track-row--rest > .nge-track-stats { display: flex; flex-direction: column; min-height: 0; }
body:not(.nge-mobile) .nge-track-row--rest .nge-profile-section--cells { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
body:not(.nge-mobile) .nge-track-row--rest .nge-cell-list { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; margin-top: 0; }
body:not(.nge-mobile) .nge-track-row--rest .nge-cell-list-scroll { flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; }

/* ── The header: name and bio at the left; Special Awards and, for the
   builder, Building Pyr at the right ── */
.nge-profile-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px 28px; }
.nge-profile-header-main { flex: 1 1 260px; min-width: 0; }
.nge-profile-header-side { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 26px; padding-top: 4px; }
.nge-profile-header-side .nge-profile-section { border: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 12px; animation: none; }
.nge-profile-header-side .nge-profile-section-label { margin: 0; white-space: nowrap; }
.nge-profile-header-side .nge-profile-badges-grid { display: flex; gap: 8px; grid-auto-rows: auto; background: none; padding: 0; }
.nge-profile-header-side .nge-profile-badge { padding: 0; }
.nge-profile-header-side .nge-profile-stat-row--tiles { flex-wrap: nowrap; }
/* room inside the tiles: the number sat on the box edge (Ames 2026-10-11) */
.nge-profile-header-side .nge-profile-stat-tile { padding: 4px 16px; min-width: 140px; gap: 14px; }

/* ── Short screens (laptops): smaller rows so the list under them is in
   reach without much scrolling. The curves draw at 56px (a prop). ── */
.is-compact .nge-track-row { padding: 6px 0 8px; }
.is-compact .nge-track-head { margin-bottom: 4px; }
.is-compact .nge-profile-header { padding-bottom: 2px; margin-bottom: 0; }
.is-compact .nge-profile-header-side .nge-profile-stat-tile { padding: 2px 12px; min-width: 120px; }
.is-compact .nge-profile-stat-label { margin-bottom: 2px; }
.is-compact .nge-profile-stat-breakdown { margin-top: 3px; }
/* in the compact tiers the curve stays above the numbers and shrinks (36 px,
   then 30), which is what keeps the list in reach without a scroll
   (Ames 2026-10-11: no vertical scroll) */
.is-compact .nge-profile-windows { gap: 3px; }
.is-compact .nge-profile-windows :deep(.nge-effort) { margin-top: 0; }
/* the awards side stacks its two sections at the right, so the header stays
   as tall as the name and bio and never wraps under them */
.is-compact .nge-profile-header-main { flex: 0 1 auto; max-width: 40%; }
.is-compact .nge-profile-header-side { flex: 1 1 auto; flex-direction: column; align-items: flex-end; gap: 4px; padding-top: 0; }
.is-compact .nge-profile-header-side .nge-profile-stat-tile { min-width: 112px; }
.is-compact .nge-track-row { padding: 4px 0 6px; }
.is-compact .nge-track-head { margin-bottom: 3px; }
.is-compact .nge-track-row--days .nge-profile-stat-val--hero { font-size: 1.25em; }
.is-compact .nge-track-row--days .nge-days-next { margin-top: 1px; }
.is-compact .nge-cell-list-title { white-space: normal; }
.is-compact .nge-profile-header-side .nge-profile-badge-img { width: 36px; height: 36px; }
.is-compact .nge-profile-header-side .nge-profile-badge-icon { width: 32px; height: 32px; }
.is-compact .nge-profile-stat-label { margin-bottom: 1px; }
.is-compact .nge-profile-stat-breakdown { margin-top: 2px; }
.is-tiny .nge-track-row { padding: 3px 0 5px; }
/* the curve's caption goes on laptops; hovering the curve still reads any day */
.is-compact :deep(.nge-effort-cap-start), .is-compact :deep(.nge-effort-cap-end) { display: none; }
.is-compact :deep(.nge-effort-cap) { margin-top: 1px; }
.nge-profile-stat-val--na { color: rgba(200, 215, 240, 0.4); font-size: 0.9em; }
/* Cells identified beside the name: the tile the Building Pyr numbers used,
   in the plain number colour until the Identification track has a colour */
.nge-profile-stat-tile--identified .nge-profile-stat-val { color: #d8dde8; text-shadow: none; }
.nge-track-achievements--rest .nge-profile-section--building { margin-top: 16px; }
/* the builder's two tiles are small and sit at the left under the Scout
   report, not stretched across the cell (Ames 2026-10-13: "make my
   developer stats smaller so they aren't weirdly sticking out") */
.nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-row--tiles { display: flex; flex-wrap: wrap; gap: 8px; }
.nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-tile { flex: 0 1 auto; min-width: 136px; padding: 3px 12px; gap: 12px; }
.nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-val--hero { font-size: 1.1em; }
/* on laptops it is one line, the label and the two numbers side by side
   with no tiles, so the last row still fits without a scroll */
.is-compact .nge-track-achievements--rest .nge-profile-section--building { margin-top: 4px; display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; }
.is-compact .nge-track-achievements--rest .nge-profile-section--building .nge-profile-section-label { margin: 0; }
.is-compact .nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-row--tiles { display: flex; gap: 12px; flex-wrap: nowrap; }
.is-compact .nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-tile { flex: none; min-width: 0; padding: 0; gap: 6px; background: none; border: none; box-shadow: none; }
.is-compact .nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-val--hero { font-size: 1em; }
.is-compact .nge-track-achievements--rest .nge-profile-section--building .nge-profile-section-label { font-size: 0.7em; }
.is-compact .nge-track-achievements--rest .nge-profile-section--building .nge-profile-stat-label { font-size: 0.62em; }
/* on a small laptop the merge and split breakdown goes too; the tooltip keeps it */
.is-tiny .nge-profile-stat-breakdown { display: none; }
/* the Scout report's five numbers wrap in the last row's narrow right half */
.nge-track-achievements--rest .nge-profile-stat-row--scout { flex-wrap: wrap; gap: 8px 18px; }
.nge-track-achievements--rest .nge-profile-stat-row--scout .nge-profile-stat-col { flex: 0 1 auto; min-width: 64px; }
/* under 760 px (a small laptop): smaller still, and the bio goes */
.is-tiny .nge-track-row { padding: 4px 0 6px; }
.is-tiny .nge-track-head { margin-bottom: 3px; }
.is-tiny .nge-profile-feature { width: 64px; }
.is-tiny .nge-profile-feature-icon { width: 40px; height: 40px; }
.is-tiny .nge-track-row--cells .nge-profile-feature-icon, .is-tiny .nge-track-row--edits .nge-profile-feature-icon { width: 52px; height: 52px; }
.is-tiny .nge-profile-stat-val { font-size: 1em; }
.is-tiny .nge-profile-stat-col--all .nge-profile-stat-val, .is-tiny .nge-track-row--days .nge-profile-stat-val--hero { font-size: 1.2em; }
.is-tiny .nge-profile-stat-label { font-size: 0.68em; margin-bottom: 1px; }
.is-tiny .nge-profile-stat-breakdown { margin-top: 2px; }
.is-tiny .nge-profile-bio { display: none; }
.is-tiny .nge-profile-name { font-size: 1.1em; }
.is-tiny .nge-track-achievements .nge-profile-badges-grid { grid-auto-rows: 40px; }
.is-tiny .nge-track-achievements .nge-profile-badge-icon { width: 32px; height: 32px; }
.is-tiny .nge-profile-windows { gap: 3px; }
.is-tiny .nge-days-next { margin-top: 2px; }
.is-compact .nge-profile-name { font-size: 1.25em; }
.is-compact .nge-profile-bio { margin-top: 0; }
.is-compact .nge-cell-list { margin-top: 10px; }
.is-compact .nge-track-row--cells .nge-profile-feature, .is-compact .nge-track-row--edits .nge-profile-feature { width: 96px; }
.is-compact .nge-track-row--cells .nge-profile-feature-icon, .is-compact .nge-track-row--edits .nge-profile-feature-icon { width: 72px; height: 72px; }
.is-compact .nge-profile-feature-icon { width: 56px; height: 56px; }
.is-compact .nge-track-row--cells .nge-profile-feature-icon, .is-compact .nge-track-row--edits .nge-profile-feature-icon { width: 72px; height: 72px; }
.is-compact .nge-profile-stat-val { font-size: 1.08em; }
.is-compact .nge-profile-stat-val--hero { font-size: 1.35em; }
.is-compact .nge-track-achievements .nge-profile-badges-grid { grid-auto-rows: 48px; }
.is-compact .nge-profile-header { padding-bottom: 12px; }
.is-compact .nge-profile-windows { gap: 6px; }
.nge-profile-career-note--foot { margin: 10px 0 0; }
.nge-track-row:last-child { border-bottom: none; }
.nge-track-stats, .nge-track-achievements { min-width: 0; }
.nge-track-achievements {
  padding-left: 22px;
  border-left: 1px solid rgba(74, 158, 255, 0.08);
  background: rgba(74, 158, 255, 0.01);
}
.nge-track-row .nge-profile-section { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.nge-track-stats > .nge-profile-section + .nge-profile-section { margin-top: 22px; }
.nge-track-achievements .nge-profile-badges-grid { max-width: 440px; }
/* the art in the top two rows is larger: those blocks are taller */
.nge-track-row--cells .nge-profile-feature, .nge-track-row--edits .nge-profile-feature { width: 120px; }
.nge-track-row--cells .nge-profile-feature-icon, .nge-track-row--edits .nge-profile-feature-icon { width: 96px; height: 96px; }
body.nge-mobile .nge-track-row { grid-template-columns: minmax(0, 1fr); gap: 14px 0; }
body.nge-mobile .nge-track-achievements { padding-left: 0; border-left: none; }

/* ── The track colours, one per block (Ames 2026-10-11): cells sky blue,
   edits gold, days purple, the colours the Achievement sections use ── */
.nge-profile-section--completions > .nge-profile-section-label { color: #90fff2; }
.nge-profile-section--edits > .nge-profile-section-label { color: #ffd08a; }
.nge-profile-section--days > .nge-profile-section-label { color: #c9a8ff; }
.nge-profile-section--days .nge-profile-stat-val--hero { color: #c9a8ff; text-shadow: 0 0 20px rgba(201, 168, 255, 0.3); }
.nge-profile-section--completions .nge-profile-feature-icon { filter: drop-shadow(0 0 10px rgba(144, 255, 242, 0.35)); }
.nge-profile-section--edits .nge-profile-feature-icon { filter: drop-shadow(0 0 10px rgba(255, 208, 138, 0.35)); }

/* ── The right column's sections share one left edge ──────────────────────
   Top of the Week and Streak sat as narrow blocks centred under the art,
   so their labels floated (Ames 2026-10-11). */
.nge-profile-col--right > .nge-profile-section--podium,
.nge-profile-col--right > .nge-profile-section--streak,
.nge-profile-col--right > .nge-profile-right-divider { align-self: stretch; }
.nge-profile-col--right .nge-profile-activity-chart { max-width: 340px; }
/* A number that can not be read says so; it is never shown as zero. */
.nge-profile-stat-unavailable { font-size: 0.82em; color: rgba(200, 215, 240, 0.55); }

/* ══ Calm screen (body.nge-calm; Settings > Screen, off by default) ══
   Annkri (#144): "too many glowing / bright elements stealing focus ... it
   gets too much and strenuous to look at over time". The base in
   ng-override.css already stops every animation and transition and clears
   text-shadow on everything, and reports prefers-reduced-motion while calm,
   so the curves land finished and the numbers do not roll. This block is
   the profile's share (2026-10-16, Ames said go): the glows around art and
   tiles go, each row keeps ONE accent (the lit part of its progress bar),
   the All time numbers take the plain face and colour, the Scout report's
   numbers one colour, the frame a flat dark instead of the game showing
   through, the favourite's art smaller, and the Trophy Case's glows go.
   What does not change: the layout, the earned art itself (never dimmed),
   text luminance, focus outlines, and colour that carries meaning (the bar
   fill, the Last 14 days legend, the merge and split icons). */
body.nge-calm .nge-profile-modal :deep(.nge-overlay.modal.overlay-content) { background: #080c14 !important; backdrop-filter: none !important; }
/* the modal's drifting particle layer (ModalOverlay.vue) is the dot field behind the frame */
body.nge-calm .nge-profile-modal :deep(.nge-holo-modal-particles) { display: none; }
/* inline text-shadows on a few numbers (the base's rule cannot reach inline styles) */
body.nge-calm .nge-profile-stat-val { text-shadow: none !important; }
body.nge-calm .nge-profile-name { text-shadow: none; }
/* glows around art and tiles */
body.nge-calm .nge-profile-feature-icon,
body.nge-calm .nge-profile-section--completions .nge-profile-feature-icon,
body.nge-calm .nge-profile-section--edits .nge-profile-feature-icon,
body.nge-calm .nge-profile-badge--selected .nge-profile-badge-img,
body.nge-calm .nge-profile-badge--latest .nge-profile-badge-img,
body.nge-calm .nge-profile-badge--building.nge-profile-badge--selected .nge-profile-badge-img,
body.nge-calm .nge-profile-badge--building.nge-profile-badge--latest .nge-profile-badge-img,
body.nge-calm .nge-profile-viz-badge-icon,
body.nge-calm .nge-trophy-badge-icon,
body.nge-calm .nge-trophy-featured-icon,
body.nge-calm .nge-badge-zoom-img { filter: none; }
body.nge-calm .nge-profile-badge--selected,
body.nge-calm .nge-profile-badge--building.nge-profile-badge--selected,
body.nge-calm :is(.nge-track-achievements, .nge-profile-header-side) .nge-profile-badge--viewall:hover .nge-profile-badge-img,
body.nge-calm .nge-profile-podium-tile--gold,
body.nge-calm .nge-trophy-badge--selected,
body.nge-calm .nge-trophy-badge--building.nge-trophy-badge--selected,
body.nge-calm .nge-trophy-featured,
body.nge-calm .nge-trophy-fav.is-shown,
body.nge-calm .nge-trophy-ring--1,
body.nge-calm .nge-trophy-ring--2,
body.nge-calm .nge-trophy-orbit-dot,
body.nge-calm .nge-badge-zoom-ring,
body.nge-calm .nge-special-modal { box-shadow: none; }
/* the Trophy Case's selected and favourite marks keep a plain ring, so the state still reads */
body.nge-calm .nge-trophy-badge--selected { box-shadow: 0 0 0 1px rgba(170, 200, 240, 0.45) inset; }
body.nge-calm .nge-trophy-badge--favorited { box-shadow: 0 0 0 1.5px rgba(255, 215, 0, 0.35) inset; }
body.nge-calm .nge-profile-badge--selected { box-shadow: 0 0 0 1px rgba(170, 200, 240, 0.35) inset; }
/* one accent per row: the label and the trace go plain, the lit bar stays in the track colour */
body.nge-calm .nge-track-head .nge-profile-section-label { color: #9bb; }
body.nge-calm .nge-track-wire, body.nge-calm .nge-track-pads { --trace: rgba(201, 228, 255, 0.22); --pad: rgba(201, 228, 255, 0.32); }
body.nge-calm .nge-track-count { color: #9bb; }
/* All time in the plain face and colour; its size alone marks it */
body.nge-calm .nge-profile-stat-col--all .nge-profile-stat-label { color: #9bb; opacity: 1; }
body.nge-calm .nge-profile-stat-col--all .nge-profile-stat-val,
body.nge-calm .nge-track-row--days .nge-profile-stat-val--hero,
body.nge-calm .nge-profile-section--days .nge-profile-stat-val--hero {
  font-family: ui-monospace, 'Cascadia Code', monospace; letter-spacing: -0.02em; color: #d8dde8;
}
body.nge-calm .nge-profile-stat-val--hero, body.nge-calm .nge-profile-stat-tile--build .nge-profile-stat-val { color: #d8dde8; }
/* the curves: a plain line, no bands, no coloured total (the figure stays, the colour goes) */
body.nge-calm .nge-profile-windows :deep(.nge-effort-band),
body.nge-calm .nge-profile-windows :deep(.nge-effort-band--today) { fill: rgba(255, 255, 255, 0.035); }
body.nge-calm .nge-profile-windows :deep(.nge-effort-band-edge) { stroke: rgba(201, 228, 255, 0.3); }
body.nge-calm .nge-profile-windows :deep(.nge-effort-band-label) { fill: rgba(201, 228, 255, 0.5); }
body.nge-calm .nge-profile-windows :deep(.nge-effort-line) { stroke: rgba(216, 221, 232, 0.85); }
body.nge-calm .nge-profile-windows :deep(.nge-effort-head) { fill: #d8dde8; }
body.nge-calm .nge-profile-windows :deep(.nge-effort-halo) { display: none; }
body.nge-calm .nge-profile-windows :deep(.nge-effort-area) { opacity: 0.5; }
body.nge-calm .nge-profile-windows :deep(.nge-effort-total) { fill: #d8dde8; }
body.nge-calm .nge-profile-windows :deep(.nge-effort-span) { color: rgba(201, 228, 255, 0.5); }
body.nge-calm .nge-profile-windows :deep(.nge-effort-span.is-on) { color: #e6eefc; background: rgba(201, 228, 255, 0.14); }
/* the Scout report's numbers in one colour (inline colours otherwise) */
body.nge-calm .nge-profile-stat-row--scout .nge-profile-stat-val { color: #d8dde8 !important; }
/* the favourite, the brightest thing on the page, a size down */
body.nge-calm .nge-profile-viz-badge-icon, body.nge-calm .nge-profile-viz-badge-icon--large { width: min(150px, calc(18 * var(--nge-vh, 1vh))); height: min(150px, calc(18 * var(--nge-vh, 1vh))); }
/* the streak's flame and count sit still in the plain colours */
body.nge-calm .nge-profile-streak-count { color: #e6c98a; text-shadow: none; }
</style>
