import { Ref, ref, reactive, watch } from "vue";
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
