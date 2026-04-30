import { Ref, ref, reactive, watch } from "vue";
import { defineStore, storeToRefs } from "pinia";
import { useLoginStore, useProofreadingBackendStore } from 'src/store';
import { supabase } from 'src/supabase';
import { Config } from './config';

declare const CONFIG: Config | undefined;

export interface LeaderboardEntry {
  name: string;
  score: number;
}

export enum LeaderboardTimespan {
  Daily = 0,
  Weekly = 6,
}

export interface UserInfo {
  editsToday: number;
  editsThisWeek: number;
  editsAllTime: number;
  mergesToday: number;
  mergesThisWeek: number;
  mergesAllTime: number;
  splitsToday: number;
  splitsThisWeek: number;
  splitsAllTime: number;
}

export const useStatsStore = defineStore("stats", () => {
  let leaderboardLoaded: Ref<boolean> = ref(false);
  let leaderboardEntries: LeaderboardEntry[] = reactive([]);
  let leaderboardTimespan: LeaderboardTimespan = LeaderboardTimespan.Weekly;
  let userInfo: UserInfo = reactive({
    editsToday: 0,
    editsThisWeek: 0,
    editsAllTime: 0,
    mergesToday: 0,
    mergesThisWeek: 0,
    mergesAllTime: 0,
    splitsToday: 0,
    splitsThisWeek: 0,
    splitsAllTime: 0,
  });
  let cellsSubmitted: Ref<number> = ref(0);

  function setLeaderboardTimespan(ts: LeaderboardTimespan) {
    leaderboardTimespan = ts;
  }

  async function loopUpdateLeaderboard() {
    await updateLeaderboard();
    await updateUserInfo();
    await new Promise(() => setTimeout(loopUpdateLeaderboard, 20000));
  }

  const { update } = useLoginStore();
  const { sessions } = storeToRefs(useLoginStore());

  watch(sessions, async () => {
    await updateUserInfo();
  });
  update();

  async function updateLeaderboard() {
    if (!CONFIG) return;
    const goalTimespan = leaderboardTimespan;
    const url = CONFIG.leaderboard_url;
    const queryUrl = url + "?days=" + leaderboardTimespan;
    fetch(queryUrl)
      .then((result) => result.json())
      .then(async (json) => {
        if (leaderboardTimespan != goalTimespan) return;
        const newEntries = json.entries;
        leaderboardEntries.splice(0, leaderboardEntries.length);
        for (const entry of newEntries) {
          leaderboardEntries.push(entry);
        }
        leaderboardLoaded.value = true;
      });
  }

  async function resetLeaderboard() {
    leaderboardLoaded.value = false;
    leaderboardEntries.splice(0, leaderboardEntries.length);
    return updateLeaderboard();
  }

  async function updateUserInfo() {
    if (!CONFIG) return;
    const loggedInUser = sessions.value[0];
    if (!loggedInUser) return;
    // const userID = loggedInUser.id;
    const url = `${CONFIG.leaderboard_url}/userInfo?userID=${loggedInUser.id}`;
    fetch(url)
      .then((result) => result.json())
      .then(async (json) => {
        userInfo.editsAllTime = json.editsAllTime;
        userInfo.editsThisWeek = json.editsThisWeek;
        userInfo.editsToday = json.editsToday;
        userInfo.mergesAllTime = json.mergesAllTime;
        userInfo.mergesThisWeek = json.mergesThisWeek;
        userInfo.mergesToday = json.mergesToday;
        userInfo.splitsAllTime = json.splitsAllTime;
        userInfo.splitsThisWeek = json.splitsThisWeek;
        userInfo.splitsToday = json.splitsToday;
      });
    //const statsURL = CONFIG.user_stats_url + '&user_id=' + userID;
    //fetch(statsURL).then(result => result.json()).then(async(json) => { cellsSubmitted = json["cells_submitted_all_time"]; });
  }

  return {
    leaderboardLoaded,
    leaderboardEntries,
    userInfo,
    cellsSubmitted,
    setLeaderboardTimespan,
    resetLeaderboard,
    loopUpdateLeaderboard,
  };
});

interface NextToElementPostition {
  element: string;
  side: "top" | "left" | "bottom" | "right";
  offset?: { x: number; y: number };
}

export function isNextToElementPostition(
  position: NextToElementPostition | InsideElementPostition
): position is NextToElementPostition {
  return (position as NextToElementPostition).side !== undefined;
}

interface InsideElementPostition {
  element: string;
  x: number;
  y: number;
}

export interface Step {
  title?: string;
  text?: string;
  html?: string;
  position: NextToElementPostition | InsideElementPostition;
  modal?: boolean;
  noborder?: boolean;
  state?: string;
  video?: string;
  image?: string;
  preloading?: boolean;
  videoCache?: HTMLVideoElement;
  width?: string;
  nextLabel?: string;
  spaceAdvances?: boolean;
  clickAfterState?: string;
  floatingImage?: string;
  onEnter?: () => void | Promise<void>;
}

export const useTutorialStore = defineStore("tutorial", () => {
  // localStorage acts as a pre-login fast-path so the tutorial works for
  // first-time guests. Once a user logs in we hydrate from Supabase
  // (`users.tutorial_*`) and sync writes back, so progress follows the
  // account across browsers / incognito / devices.
  const activeTutorial: Ref<number> = ref(
    parseInt(localStorage.getItem(`nge-active-tutorial`) ?? "1")
  );

  const tutorialStep1: Ref<number> = ref(
    parseInt(localStorage.getItem(`nge-tutorial-step`) ?? "0")
  );
  const tutorialStep2: Ref<number> = ref(
    parseInt(localStorage.getItem(`nge-tutorial-2-step`) ?? "-1")
  );
  const tutorialStep3: Ref<number> = ref(
    parseInt(localStorage.getItem(`nge-tutorial-3-step`) ?? "-1")
  );

  // Track whether we've already hydrated for the current user so we don't
  // clobber locally-advanced progress on every re-render.
  const hydratedForUserId: Ref<string | null> = ref(null);
  const hydrating: Ref<boolean> = ref(false);

  function getTutorialStep() {
    if (activeTutorial.value === 1) return tutorialStep1.value;
    if (activeTutorial.value === 2) return tutorialStep2.value;
    return tutorialStep3.value;
  }

  function setTutorialStep(val: number) {
    if (activeTutorial.value === 1) tutorialStep1.value = val;
    else if (activeTutorial.value === 2) tutorialStep2.value = val;
    else tutorialStep3.value = val;
  }

  /** Pull tutorial state from Supabase for the logged-in user. We take the
   *  MAX of local vs. remote step counters so progress made on either side
   *  is preserved. */
  async function hydrateFromSupabase(userId: string) {
    if (hydratedForUserId.value === userId) return;
    hydrating.value = true;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('tutorial_active, tutorial_1_step, tutorial_2_step, tutorial_3_step')
        .eq('id', userId)
        .single();
      if (error) {
        console.warn('[tutorial] hydrate error:', error.message);
        return;
      }
      if (data) {
        // active: prefer remote if set; otherwise keep local
        if (typeof data.tutorial_active === 'number') {
          activeTutorial.value = data.tutorial_active;
        }
        // steps: take whichever is further along to avoid losing progress
        if (typeof data.tutorial_1_step === 'number') {
          tutorialStep1.value = Math.max(tutorialStep1.value, data.tutorial_1_step);
        }
        if (typeof data.tutorial_2_step === 'number') {
          tutorialStep2.value = Math.max(tutorialStep2.value, data.tutorial_2_step);
        }
        if (typeof data.tutorial_3_step === 'number') {
          tutorialStep3.value = Math.max(tutorialStep3.value, data.tutorial_3_step);
        }
      }
      hydratedForUserId.value = userId;
    } catch (e) {
      console.warn('[tutorial] hydrate failed:', e);
    } finally {
      hydrating.value = false;
    }
  }

  /** Push current tutorial state up to Supabase for the logged-in user. */
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSync() {
    if (hydrating.value) return; // don't echo our own hydration writes back
    const backend = useProofreadingBackendStore();
    if (!backend.userId) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from('users')
          .update({
            tutorial_active: activeTutorial.value,
            tutorial_1_step: tutorialStep1.value,
            tutorial_2_step: tutorialStep2.value,
            tutorial_3_step: tutorialStep3.value,
          })
          .eq('id', backend.userId);
        if (error) console.warn('[tutorial] sync error:', error.message);
      } catch (e) {
        console.warn('[tutorial] sync failed:', e);
      }
    }, 400);
  }

  // ── Local persistence (pre-login + offline fallback) ────────────
  watch(tutorialStep1, () => {
    localStorage.setItem(`nge-tutorial-step`, `${tutorialStep1.value}`);
    scheduleSync();
  });
  watch(tutorialStep2, () => {
    localStorage.setItem(`nge-tutorial-2-step`, `${tutorialStep2.value}`);
    scheduleSync();
  });
  watch(tutorialStep3, () => {
    localStorage.setItem(`nge-tutorial-3-step`, `${tutorialStep3.value}`);
    scheduleSync();
  });
  watch(activeTutorial, () => {
    localStorage.setItem(`nge-active-tutorial`, `${activeTutorial.value}`);
    scheduleSync();
  });

  // ── Hydrate on login ─────────────────────────────────────────────
  // Watch the backend store's userId; when it resolves, pull from Supabase.
  // We avoid eagerly resolving the backend store at module load time to
  // keep the import graph clean.
  setTimeout(() => {
    try {
      const backend = useProofreadingBackendStore();
      watch(
        () => backend.userId,
        (id) => { if (id) hydrateFromSupabase(id); },
        { immediate: true },
      );
    } catch (e) {
      console.warn('[tutorial] could not attach userId watcher:', e);
    }
  }, 0);

  return {
    activeTutorial,
    getTutorialStep,
    setTutorialStep,
    tutorialStep1,
    tutorialStep2,
    tutorialStep3,
    hydrateFromSupabase,
  };
});
