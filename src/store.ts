import {Ref, ref, reactive, nextTick} from 'vue';
import {defineStore} from 'pinia';

import {Viewer} from 'neuroglancer/viewer';
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {MiddleAuthCredentialsProvider} from 'neuroglancer/datasource/middleauth/credentials_provider';
import {cancellableFetchSpecialOk, parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import {responseJson} from 'neuroglancer/util/http_request';

import ReconnectingWebSocket from 'reconnecting-websocket';

import getChatSocket from './chat_socket';
import {Config} from './config';

declare const CONFIG: Config|undefined;

export const useDropdownListStore = defineStore('dropdownlist', () => {
  let dropdownCount = 0;

  const activeDropdowns = reactive({} as {[group: string]: number|undefined});

  function getDropdownId() {
    dropdownCount++;
    return dropdownCount;
  }

  return {getDropdownId, activeDropdowns};
});

export interface loginSession {
  key: string,
  name: string,
  email: string,
  id: number,
  hostname: string,
  status?: number,
}

export const useLoginStore = defineStore('login', () => {
  const TOKEN_PREFIX = 'auth_token_v2_';

  async function logout(session: loginSession) {
    window.localStorage.removeItem(session.key);
    const login_url = session.key.split(TOKEN_PREFIX)[1] as string|undefined;
    if (!login_url) return;
    const provider = defaultCredentialsManager.getCredentialsProvider('middleauth', login_url) as MiddleAuthCredentialsProvider;
    if (provider) {
      provider.updateCachedGet();
    }
    sessions.value = sessions.value.filter(x => x.key !== session.key);
  }

  async function update() {
    const localStorageKeys: string[] = [];
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(TOKEN_PREFIX)) {
        localStorageKeys.push(key);
      }
    }

    const newSessions: loginSession[] = [];

    for (const key of localStorageKeys) {
      const login_url = key.split(TOKEN_PREFIX)[1] as string|undefined;
      if (!login_url) continue;
      const provider = defaultCredentialsManager.getCredentialsProvider('middleauth', login_url) as MiddleAuthCredentialsProvider;
      if (!provider) continue;

      const dataString = localStorage.getItem(key);
      if (!dataString) { return; }
      const data = JSON.parse(dataString);
      const {hostname} = new URL(data.url);
      if (hostname !== "https://global.daf-apis.com/sticky_auth") {
        continue;
      }

      try {
        const res = await fetch(data.url + '/api/v1/user/me', {
          headers: {
            "Authorization": `Bearer ${data.accessToken}`,
          }
        });
        if (res.status === 200) {
          const contentType = res.headers.get("content-type");
          const message = await ((contentType === 'application/json') ? res.json() : res.text());
          newSessions.push({
            key,
            name: message.name,
            email: message.email,
            id: message.id,
            hostname,
          });
        } else {
          newSessions.push({
            key,
            name: '',
            email: '',
            id: 0,
            hostname,
            status: res.status,
          });
        }
      } catch (e) {
        e;
        // newSessions.push({
        //   name: '',
        //   email: '',
        //   hostname,
        //   error: e,
        // });
      }
    }

    sessions.value = newSessions;
  }
  const sessions: Ref<loginSession[]> = ref([]);
  return {sessions, update, logout};
});

export interface Volume {
  name: string,
  description: string,
  image_layers: Layer[],
  segmentation_layers: Layer[],
}

interface Layer {
  source: string,
  ngl_image_name?: string,
  name: string,
  description: string,
  type: string,
}


export const useLayersStore = defineStore('layers', () => {
  const activeLayers: Set<string> = reactive(new Set());

  let viewer: Viewer|undefined = undefined;

  function refreshLayers() {
    if (!viewer) return;
    activeLayers.clear();
    const layers = viewer.layerManager.managedLayers;
    for (const layer of layers) {
      if (!layer.layer) {
        console.log('does this ever happen?');
        continue;
      }
      const dataSources = layer.layer.dataSources;
      for (const source of dataSources) {
        activeLayers.add(source.spec.url.replace('middleauth+', ''));
      }
    }
  }

  function initializeWithViewer(v: Viewer) {
    viewer = v;

    viewer.displayDimensions.changed.add(() => {
      console.log('viewer.displayDimensions.changed', viewer!.displayDimensions.value);
    });

    viewer.layerManager.layersChanged.add(refreshLayers);
    refreshLayers();
  }

  async function selectLayers(layers: any[]) {
    if (!viewer) return;
    viewer.layerSpecification.restoreState(layers);
    viewer.navigationState.reset();
    viewer.coordinateSpace.restoreState({
      x: [4e-9, 'm'],
      y: [4e-9, 'm'],
      z: [40e-9, 'm'],
    });
    return true;
  }

  return {initializeWithViewer, activeLayers, selectLayers};
});

export const useVolumesStore = defineStore('volumes', () => {
  const volumes: Ref<Volume[]> = ref([]);

  (async () => {
      if (!CONFIG || !CONFIG.volumes_url) return;
      const {url, credentialsProvider} = parseSpecialUrl(CONFIG.volumes_url, defaultCredentialsManager);
      const response = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);

        for (const [key, value] of Object.entries(response as any)) {
          volumes.value.push({
            name: key,
            description: (value as any).description,
            image_layers: (value as any).image_layers.map((x: any) => {
              x.type = 'image';
              x.source = x.image_source;
              return x;
            }),
            segmentation_layers: (value as any).segmentation_layers.map((x: any) => {
              x.type = 'segmentation';
              x.source = x.segmentation_source;
              return x;
            }),
          });
        }
  })();

  return {volumes};
});

export interface LeaderboardEntry {
  name: string, score: number
}

export enum LeaderboardTimespan {
  Daily = 0,
  Weekly = 6
}

export interface UserInfo {
  editsToday: number, editsThisWeek: number, editsAllTime: number
}

export const useStatsStore = defineStore('stats', () => {
  let leaderboardLoaded: Ref<boolean> = ref(false);
  let leaderboardEntries: LeaderboardEntry[] = reactive([]);
  let leaderboardTimespan: LeaderboardTimespan = LeaderboardTimespan.Weekly;
  let userInfo: UserInfo = reactive({editsToday: 0, editsThisWeek: 0, editsAllTime: 0});
  let cellsSubmitted: Ref<number> = ref(0);

  const {sessions} = useLoginStore();
  const loggedInUser = sessions[0];

  function setLeaderboardTimespan(ts: LeaderboardTimespan) {
    leaderboardTimespan = ts;
  }

  async function loopUpdateLeaderboard() {
    await updateLeaderboard();
    await updateUserInfo();
    await new Promise(() => setTimeout(loopUpdateLeaderboard, 20000));
  }

  async function updateLeaderboard() {
    if (!CONFIG) return;
    const goalTimespan = leaderboardTimespan;
    const url = CONFIG.leaderboard_url;
    const queryUrl = url + '?days=' + leaderboardTimespan;
    fetch(queryUrl).then(result => result.json()).then(async (json) => {
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
    if (!loggedInUser) return;
    const userID = loggedInUser.id;
    const url = CONFIG.leaderboard_url + '/userInfo?userID=' + userID;
    fetch(url).then(result => result.json()).then(async(json) => { userInfo = json; });
    const statsURL = CONFIG.user_stats_url + '&user_id=' + userID;
    fetch(statsURL).then(result => result.json()).then(async(json) => { cellsSubmitted = json["cells_submitted_all_time"]; });
  }

  return {leaderboardLoaded, leaderboardEntries, userInfo, cellsSubmitted, 
          setLeaderboardTimespan, resetLeaderboard, loopUpdateLeaderboard};
});

interface ServerMessage {
  type: string,
  name: string,
  rank: string | undefined,
  timestamp: Date,
  message: string
}

export interface ChatMessage {
  type: string,
  name: string,
  rank: string | undefined,
  time: string | undefined,
  dateTime: Date | undefined,
  parts: MessagePart[] | undefined
}

interface MessagePart {
  type: string,
  text: string
}

export const useChatStore = defineStore('chat', () => {
  let joinedChat: boolean = false;
  let chatMessages: ChatMessage[] = reactive([]);
  let unreadMessages: Ref<boolean> = ref(false);

  const {sessions} = useLoginStore();
  const loggedInUser = sessions[0];

  function sendJoinMessage(ws: ReconnectingWebSocket) {
    const joinMessage = JSON.stringify({
      type: joinedChat ? 'rejoin' : 'join',
      name: loggedInUser ? loggedInUser.name : 'Guest'
    });
    ws.send(joinMessage);
    joinedChat = true;
  }

  function sendMessage(message: string) {
    const now = new Date();
    const messageObj = {
      name: loggedInUser ? loggedInUser.name : 'Guest',
      userID: loggedInUser ? loggedInUser.id : 0,
      type: 'message',
      message: message,
      timestamp: now
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
    const dateTime = messageParsed.timestamp ? new Date(messageParsed.timestamp) : new Date();
    const time = dateTime.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
    const parts: MessagePart[] = [];

    if (type === 'message') {
      // add timestamp if it has been a while since the last message
      function isCloseTo(timeA: Date|undefined, timeB: Date|undefined): boolean {
        if (!timeA || !timeB) return false;
        const diff = timeB.valueOf() - timeA.valueOf();
        return diff < 1000 * 60 * 10; // 10 minutes in milliseconds
      }
      let addTime = true;
      if (chatMessages.length > 0) {
        const lastMessage = chatMessages[chatMessages.length - 1];
        if (lastMessage.type.startsWith('message') && isCloseTo(lastMessage.dateTime, dateTime)) {
          addTime = false;
        }
      }
      if (addTime) {
        const timeInfo: ChatMessage = { type: 'time', name: name, rank: undefined, time: time, dateTime: dateTime, parts: undefined };
        chatMessages.push(timeInfo);
      }

      // first part of message is sender's name
      const namePart: MessagePart = {
        type: 'sender',
        text: name
      };
      parts.push(namePart);

      // split message up into plain text and links
      const messageParts = messageText.split(/(https?:\/\/\S+)/);
      for (let i = 0; i < messageParts.length; i++) {
        const messagePart: MessagePart = {
          type: i % 2 === 0 ? 'text' : 'link',
          text: messageParts[i]
        }
        parts.push(messagePart);
      }
    }

    const messageObj: ChatMessage = {
      type: type,
      name: name,
      rank: rank,
      dateTime: dateTime,
      time: time,
      parts: parts
    };

    chatMessages.push(messageObj);

    const sidebarVisible = localStorage.getItem("visible") !== "false";
    const el = <HTMLElement>document.querySelector('.nge-chatbox-scroll');
    const scrollAtBottom = el.scrollTop + el.offsetHeight >= el.scrollHeight;
    if (sidebarVisible && scrollAtBottom) {
      markLastMessageRead();
      // scroll to bottom of message box (once vue updates the page)
      nextTick(() => {
        const messageBox = <HTMLElement>document.querySelector('.nge-chatbox-scroll');
        messageBox.scrollTo(0, messageBox.scrollHeight);
      });
    }
    else if (type === "message") {
      const lastReadMessageTime = localStorage.getItem("lastReadMessageTime");
      const compareDate = new Date(dateTime.toString());
      if (lastReadMessageTime === null || (compareDate > new Date(lastReadMessageTime))) {
        unreadMessages.value = true;
      }
    }
  }

  function markLastMessageRead() {
    unreadMessages.value = false;
    if (chatMessages.length > 0) {
      const lastMessage = chatMessages[chatMessages.length - 1];
      localStorage.setItem("lastReadMessageTime", lastMessage.dateTime!.toString());
    }
  }

  return {chatMessages, unreadMessages, sendMessage, markLastMessageRead, joinChat};
});
