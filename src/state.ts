import {authFetch, authTokenShared} from 'neuroglancer/authentication/frontend';
import {SingletonLayerGroupViewer} from 'neuroglancer/layer_groups_layout';
import {Viewer} from 'neuroglancer/viewer';
import {action, createModule, createProxy, extractVuexModule} from 'vuex-class-component';
import ReconnectingWebSocket from 'reconnecting-websocket';

import getChatSocket from './chat_socket';
import {config} from './main';

interface LoggedInUser {
  name: string;
  email: string;
  id: number;
  joinDate: string;
  admin: boolean;
}

export interface LeaderboardEntry {
  name: string, score: number
}

export enum LeaderboardTimespan {
  Daily = 0,
  Weekly = 6
}

interface ServerMessage {
  type: string,
  name: string,
  message: string
}

export interface ChatMessage {
  type: string,
  name: string,
  time: string | undefined,
  dateTime: Date | undefined,
  parts: MessagePart[] | undefined
}

interface MessagePart {
  type: string,
  text: string
}

export interface UserInfo {
  editsToday: number, editsThisWeek: number, editsAllTime: number
}

export interface ActionsMenuItem {
  text: string, click(): void
}

export let viewer: Viewer|undefined;

export function getLayerPanel(viewer: Viewer) {
  const groupViewerSingleton = viewer.layout.container.component;
  if (groupViewerSingleton instanceof SingletonLayerGroupViewer) {
    return groupViewerSingleton.layerGroupViewer.layerPanel;
  }

  return undefined;
}

export interface ViewerState {
  layers: string[], selectedLayer: string|undefined, sidebar: {
    open: boolean,
    width: number,
  }
}


export class AppStore extends createModule
({
  strict: false,
  enableLocalWatchers: true,
}) {
  sidebarOpen = false;

  loggedInUser: LoggedInUser|null|undefined =
      undefined;  // undefined = fetchLoggedInUser hasn't returned yet
  showDatasetChooser: boolean = false;
  showCellChooser: boolean = false;
  showResetConfirm: boolean = false;
  showAdminPanel: boolean = false;

  loadedViewer: boolean = false;
  finishedLoading: boolean = false;
  activeDropdown: {[group: string]: number} = {};
  actionsMenuItems: ActionsMenuItem[] = [];
  leaderboardEntries: LeaderboardEntry[] = [];
  leaderboardTimespan: LeaderboardTimespan = LeaderboardTimespan.Weekly;
  leaderboardLoaded: boolean = false;
  joinedChat: boolean = false;
  chatMessages: ChatMessage[] = [];
  userInfo: UserInfo = {editsToday: 0, editsThisWeek: 0, editsAllTime: 0};

  introductionStep: number =
      parseInt(localStorage.getItem('nge-introduction-step') || '0');

  viewer: ViewerState = {
    layers: [],
    selectedLayer: undefined,
    sidebar: {
      open: false,
      width: 0,
    }
  };

  static $watch = {
    introductionStep(newVal: number) {
      localStorage.setItem('nge-introduction-step', JSON.stringify(newVal));
    }
  }

  @action
  async initializeViewer(v: Viewer) {
    viewer = v;

    const layerPanel = getLayerPanel(v)!;
    layerPanel.selectedLayer.changed.add(() => {
      this.viewer.selectedLayer = layerPanel.selectedLayer.layer ?
          layerPanel.selectedLayer.layer.name :
          undefined;
      this.viewer.sidebar.open = layerPanel.selectedLayer.visible;
      // size has it's own changed signal but size changes also trigger
      // selectedLayer.changed
      this.viewer.sidebar.width = layerPanel.selectedLayer.size.value;
    });

    v.layerManager.layersChanged.add(() => {
      this.viewer.layers =
          v.layerManager.managedLayers.map((layer) => layer.name);
    });
  }

  @action
  async toggleSidePanel(visible?: boolean) {
    const layerPanel = getLayerPanel(viewer!)!;

    if (visible === undefined) {
      layerPanel.selectedLayer.visible = !layerPanel.selectedLayer.visible;
    } else {
      layerPanel.selectedLayer.visible = visible;
    }
  }

  @action
  async fetchLoggedInUser() {
    const existingToken = localStorage.getItem('auth_token');
    const existingAuthURL = localStorage.getItem('auth_url');

    if (existingToken && existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;

      let res = await authFetch(`${authURL}/auth/api/v1/user/me`);
      let user = await res.json();
      let {name, email, id, created, admin} = user;
      const createdTime = new Date(created);
      const joinDate = createdTime.toLocaleDateString('en-US');
      this.loggedInUser = {name, email, id, joinDate, admin};
      this.updateUserInfo();
    } else {
      this.loggedInUser = null;
    }
  }

  @action
  async logout() {
    const existingToken = localStorage.getItem('auth_token');
    const existingAuthURL = localStorage.getItem('auth_url');

    if (existingToken && existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;

      await authFetch(`${authURL}/auth/api/v1/logout`).then(res => {
        return res.json();
      });

      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_url');

      authTokenShared!.value = null;

      this.loggedInUser = null;
    }
  }

  @action
  async loopUpdateLeaderboard() {
    await this.updateLeaderboard();
    await this.updateUserInfo();
    await new Promise(() => setTimeout(this.loopUpdateLeaderboard, 20000));
  }

  @action
  async updateLeaderboard() {
    const goalTimespan = this.leaderboardTimespan;
    const url = config.leaderboardURL;
    const queryUrl = url + '?days=' + this.leaderboardTimespan;
    fetch(queryUrl).then(result => result.json()).then(async (json) => {
      if (this.leaderboardTimespan != goalTimespan) return;
      const newEntries = json.entries;
      this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
      for (const entry of newEntries) {
        this.leaderboardEntries.push(entry);
      }
      this.leaderboardLoaded = true;
    });
  }

  @action
  async resetLeaderboard() {
    this.leaderboardLoaded = false;
    this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
    return this.updateLeaderboard();
  }

  @action
  async sendJoinMessage(ws: ReconnectingWebSocket) {
    const joinMessage = JSON.stringify({
      type: this.joinedChat ? 'rejoin' : 'join',
      name: this.loggedInUser ? this.loggedInUser.name : 'Guest'
    });
    ws.send(joinMessage);
    this.joinedChat = true;
  }

  @action
  async joinChat() {
    const ws = getChatSocket();
    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    await this.fetchLoggedInUser();

    ws.onopen = () => {
      this.sendJoinMessage(ws);
    };
    if (ws.readyState === WebSocket.OPEN) {
      this.sendJoinMessage(ws);
    }
  }

  @action
  async handleMessage(message: any) {
    const messageParsed: ServerMessage = JSON.parse(message);
    const type = messageParsed.type;
    const messageText = messageParsed.message;
    const name = messageParsed.name;
    const dateTime = new Date();
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
      if (this.chatMessages.length > 0) {
        const lastMessage = this.chatMessages[this.chatMessages.length - 1];
        if (lastMessage.type.startsWith('message') && isCloseTo(lastMessage.dateTime, dateTime)) {
          addTime = false;
        }
      }
      if (addTime) {
        const timeInfo: ChatMessage = { type: 'time', name: name, time: time, dateTime: dateTime, parts: undefined };
        this.chatMessages.push(timeInfo);
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
      dateTime: dateTime,
      time: time,
      parts: parts
    };

    this.chatMessages.push(messageObj);

    // scroll to bottom of message box (once vue updates the page)
    Vue.nextTick(() => {
      const messageBox = <HTMLElement>document.querySelector('.nge-chatbox-scroll .simplebar-content-wrapper');
      messageBox.scrollTo(0, messageBox.scrollHeight);
    });
  }

  @action
  async updateUserInfo() {
    if (!this.loggedInUser) return;
    const url = config.leaderboardURL + '/userInfo?userID=' + this.loggedInUser!.id;
    fetch(url).then(result => result.json()).then(async(json) => { this.userInfo = json; });
  }

  @action
  async rollbackUserID(userID: string) {
    const existingAuthURL = localStorage.getItem('auth_url');
    if (existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;
      const res = await authFetch(`${authURL}/auth/api/v1/user?id=${userID}`);
      const json = await res.json();
      if (json.length !== 1) {
        alert('Could not find user for ID ' + userID);
        return;
      }
      const name = json[0].name;
      const email = json[0].email;
      if (confirm(
              'Rollback training edits for user ' + name + ' (' + email +
              ')?')) {
        const rollbackURL = config.proctorURL + '/rollback?user_id=' + userID;
        const rollbackRes = await authFetch(rollbackURL);
        const rollbackJSON = await rollbackRes.text();
        alert(rollbackJSON);
      }
    }
  }
}

import Vue from 'vue';
import Vuex from 'vuex';
import { LayerState } from './layer-state';
Vue.use(Vuex);

export const store = new Vuex.Store({
  modules: {...extractVuexModule(AppStore),
            ...extractVuexModule(LayerState)},
});

export const storeProxy = createProxy(store, AppStore);
export const layerProxy = createProxy(store, LayerState);
export {
  Vue
};  // vue app needs to be instantiated from this modified VueConstructor
