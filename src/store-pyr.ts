import { Ref, ref, reactive, watch, computed } from "vue";
import { defineStore, storeToRefs } from "pinia";
import { useLoginStore } from "#src/store.js";
import { Config } from "#src/config.js";

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

  watch(tutorialStep1, () => {
    localStorage.setItem(`nge-tutorial-step`, `${tutorialStep1.value}`);
  });
  watch(tutorialStep2, () => {
    localStorage.setItem(`nge-tutorial-2-step`, `${tutorialStep2.value}`);
  });
  watch(tutorialStep3, () => {
    localStorage.setItem(`nge-tutorial-3-step`, `${tutorialStep3.value}`);
  });
  watch(activeTutorial, () => {
    localStorage.setItem(`nge-active-tutorial`, `${activeTutorial.value}`);
  });

  return {
    activeTutorial,
    getTutorialStep,
    setTutorialStep,
    tutorialStep1,
    tutorialStep2,
    tutorialStep3,
  };
});
