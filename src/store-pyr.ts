import { Ref, ref, reactive, watch, nextTick } from "vue";
import { defineStore, storeToRefs } from "pinia";
import { useLoginStore } from "#src/store.js";
import { Config } from "#src/config.js";
import ReconnectingWebSocket from "reconnecting-websocket";

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

function localStorageRef<T>(key: string, initial: T, parse: (x: string) => T) {
  const initialValue = parse(localStorage.getItem(key) ?? `${initial}`);
  const res = ref(initialValue);
  watch(res, () => {
    localStorage.setItem(key, `${res.value}`);
  });
  return res;
}

const tutorialStep: Ref<number> = ref(
  parseInt(localStorage.getItem(`nge-tutorial-step`) ?? "0")
);
watch(tutorialStep, () => {
  localStorage.setItem(`nge-tutorial-step`, `${tutorialStep.value}`);
});

export const useStatsStore = defineStore("stats", () => {
  let showLeaderboard = localStorageRef(
    "showLeaderboard",
    true,
    (x) => x === "true"
  );
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
    console.log("CONFIG.leaderboard_url", CONFIG.leaderboard_url);
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
    showLeaderboard,
    leaderboardLoaded,
    leaderboardEntries,
    userInfo,
    cellsSubmitted,
    setLeaderboardTimespan,
    resetLeaderboard,
    loopUpdateLeaderboard,
  };
});

interface ServerMessage {
  type: string;
  name: string;
  rank: string | undefined;
  timestamp: Date;
  message: string;
}

export interface ChatMessage {
  type: string;
  name: string;
  rank: string | undefined;
  time: string | undefined;
  dateTime: Date | undefined;
  parts: MessagePart[] | undefined;
}

interface MessagePart {
  type: string;
  text: string;
}

export const useChatStore = defineStore("chat", () => {
  let showChat = localStorageRef("showChat", true, (x) => x === "true");
  let joinedChat: boolean = false;
  let chatMessages: ChatMessage[] = reactive([]);
  let unreadMessages: Ref<boolean> = ref(false);

  const { sessions } = storeToRefs(useLoginStore());

  function sendJoinMessage(ws: ReconnectingWebSocket) {
    const loggedInUser = sessions.value[0];
    const joinMessage = JSON.stringify({
      type: joinedChat ? "rejoin" : "join",
      name: loggedInUser ? loggedInUser.name : "Guest",
    });
    ws.send(joinMessage);
    joinedChat = true;
  }

  function sendMessage(message: string) {
    const loggedInUser = sessions.value[0];
    const now = new Date();
    const messageObj = {
      name: loggedInUser ? loggedInUser.name : "Guest",
      userID: loggedInUser ? loggedInUser.id : 0,
      type: "message",
      message: message,
      timestamp: now,
    };
    const ws = getChatSocket();
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(messageObj));
    } else {
      handleMessage('{"type":"disconnected"}');
    }
  }

  async function joinChat() {
    const ws = getChatSocket();
    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    //await this.fetchLoggedInUser(); //TODO wait for login

    ws.onopen = () => {
      sendJoinMessage(ws);
    };
    if (ws.readyState === WebSocket.OPEN) {
      sendJoinMessage(ws);
    }
  }

  function handleMessage(message: any) {
    const messageParsed: ServerMessage = JSON.parse(message);
    const type = messageParsed.type;
    const messageText = messageParsed.message;
    const name = messageParsed.name;
    const rank = messageParsed.rank;
    const dateTime = messageParsed.timestamp
      ? new Date(messageParsed.timestamp)
      : new Date();
    const time = dateTime.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts: MessagePart[] = [];

    if (type === "message") {
      // add timestamp if it has been a while since the last message
      function isCloseTo(
        timeA: Date | undefined,
        timeB: Date | undefined
      ): boolean {
        if (!timeA || !timeB) return false;
        const diff = timeB.valueOf() - timeA.valueOf();
        return diff < 1000 * 60 * 10; // 10 minutes in milliseconds
      }
      let addTime = true;
      if (chatMessages.length > 0) {
        const lastMessage = chatMessages[chatMessages.length - 1];
        if (
          lastMessage.type.startsWith("message") &&
          isCloseTo(lastMessage.dateTime, dateTime)
        ) {
          addTime = false;
        }
      }
      if (addTime) {
        const timeInfo: ChatMessage = {
          type: "time",
          name: name,
          rank: undefined,
          time: time,
          dateTime: dateTime,
          parts: undefined,
        };
        chatMessages.push(timeInfo);
      }

      // first part of message is sender's name
      const namePart: MessagePart = {
        type: "sender",
        text: name,
      };
      parts.push(namePart);

      // split message up into plain text and links
      const messageParts = messageText.split(/(https?:\/\/\S+)/);
      for (let i = 0; i < messageParts.length; i++) {
        const messagePart: MessagePart = {
          type: i % 2 === 0 ? "text" : "link",
          text: messageParts[i],
        };
        parts.push(messagePart);
      }
    }

    const messageObj: ChatMessage = {
      type: type,
      name: name,
      rank: rank,
      dateTime: dateTime,
      time: time,
      parts: parts,
    };

    chatMessages.push(messageObj);

    const el = <HTMLElement>document.querySelector(".nge-chatbox-scroll");
    const scrollAtBottom = el.scrollTop + el.offsetHeight >= el.scrollHeight;
    if (showChat.value && scrollAtBottom) {
      markLastMessageRead();
      // scroll to bottom of message box (once vue updates the page)
      nextTick(() => {
        const messageBox = <HTMLElement>(
          document.querySelector(".nge-chatbox-scroll")
        );
        messageBox.scrollTo(0, messageBox.scrollHeight);
      });
    } else if (type === "message") {
      const lastReadMessageTime = localStorage.getItem("lastReadMessageTime");
      const compareDate = new Date(dateTime.toString());
      if (
        lastReadMessageTime === null ||
        compareDate > new Date(lastReadMessageTime)
      ) {
        unreadMessages.value = true;
      }
    }
  }

  function markLastMessageRead() {
    unreadMessages.value = false;
    if (chatMessages.length > 0) {
      const lastMessage = chatMessages[chatMessages.length - 1];
      localStorage.setItem(
        "lastReadMessageTime",
        lastMessage.dateTime!.toString()
      );
    }
  }

  return {
    chatMessages,
    unreadMessages,
    sendMessage,
    markLastMessageRead,
    joinChat,
    showChat,
  };
});

// import { Config } from "#src/config.js";

// declare const CONFIG: Config | undefined;

let ws: ReconnectingWebSocket | null = null;

export function connectChatSocket() {
  if (!CONFIG) return;
  console.log("connecting to", CONFIG);
  ws = new ReconnectingWebSocket(CONFIG.chat_url);
}

export default function getChatSocket(): ReconnectingWebSocket {
  if (!ws) {
    throw new Error("Chat websocket must be connected before use");
  }
  return ws!;
}
