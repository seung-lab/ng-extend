import { createModule, action, createProxy, extractVuexModule } from "vuex-class-component";
import { authFetch, authTokenShared } from "neuroglancer/authentication/frontend";
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { Uint64 } from "neuroglancer/util/uint64";

import {viewer} from "./main";

interface LoggedInUser {
  name: string;
  email: string;
}

interface LayerDescription {
  source: string,
  type: "image"|"segmentation"|"segmentation_with_graph"
}

export interface DatasetDescription {
  name: string,
  layers: LayerDescription[],
  curatedCells?: CellDescription[]
}

export interface CellDescription {
  id: string,
}

export interface LeaderboardEntry {
  name: string,
  score: number
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

export enum LeaderboardTimespan {
  Daily = 0,
  Weekly = 6
}

class AppStore extends createModule({strict: false}) {
  loggedInUser: LoggedInUser|null = null;
  showDatasetChooser: boolean = false;
  showCellChooser: boolean = false;

  activeDataset: DatasetDescription|null = null;
  activeCells: CellDescription[] = [];

  leaderboardEntries: LeaderboardEntry[] = [];
  chatMessages: ChatMessage[] = [];
  leaderboardTimespan: LeaderboardTimespan = LeaderboardTimespan.Daily;

  datasets: DatasetDescription[] = [
    {
      name: "production",
      layers: [
        {
          type: "image",
          source: "precomputed://gs://microns-seunglab/drosophila_v0/alignment/vector_fixer30_faster_v01/v4/image_stitch_v02"
        },
        {
          type: "segmentation_with_graph",
          source: "graphene://https://prodv1.flywire-daf.com/segmentation/table/fly_v31"
        }
      ],
      curatedCells: [
        {
          id: "720575940650468481",
        }
      ]
    },
    {
      name: "sandbox",
      layers: [
        {
          type: "image",
          source: "precomputed://gs://microns-seunglab/drosophila_v0/alignment/vector_fixer30_faster_v01/v4/image_stitch_v02"
        },
        {
          type: "segmentation_with_graph",
          source: "graphene://https://prodv1.flywire-daf.com/segmentation/table/fly_v26"
        }
      ],
      curatedCells: [
        {
          id: "720575940625416797",
        },
        {
          id: "720575940637436173",
        },
      ]
    }
  ];

  @action async loadActiveDataset() {
    const numberOfLayers = viewer!.layerManager.managedLayers.length;

    if (numberOfLayers > 0) {
      const firstLayerName = viewer!.layerManager.managedLayers[0].name.split('-')[0];
      for (let dataset of this.datasets) {
        if (dataset.name === firstLayerName) {
          // TODO, should check to see the layers are correct
          this.activeDataset = dataset;
          break;
        }
      }
    } else {
      storeProxy.showDatasetChooser = true;
    }

    const layers = viewer!.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        console.log('root segments callback 2');
        layer.displayState.rootSegments.changed.add(() => {
          console.log('root segments changed! 2');
          this.refreshActiveCells();
        });
        this.refreshActiveCells();
      }
    }
  }

  @action async refreshActiveCells() {
    if (!viewer) {
      return false;
    }

    if (!this.activeDataset || !this.activeDataset.curatedCells) {
      return false;
    }

    const layers = viewer.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        let changes = false;
        // await layer.multiscaleSource!;

        console.log('clearing active cells!');
        this.activeCells = [];

        console.log('---- checking active');

        console.log('active roots', layer.displayState.rootSegments);

        for (let segment of layer.displayState.rootSegments) {
          console.log('we have a segment: ', segment.toString());
          for (let cell of this.activeDataset.curatedCells) {
            if (segment.toString() === cell.id) {
              console.log('segment confirmed curated', cell.id);
              this.activeCells.push(cell);
              changes = true;
            }
          }
        }

        if (changes) {
          // force update
          // this.activeCells = this.activeCells;
        }

        return true;
      }
    }

    return false;
  }

  @action async selectDataset(dataset: DatasetDescription) {
    if (!viewer) {
      return false;
    }

    this.activeDataset = dataset;

    viewer.layerManager.clear();
    viewer.navigationState.position.spatialCoordinatesValid = false;

    for (let layerDesc of dataset.layers) {
      const layerWithSpec = viewer.layerSpecification.getLayer(`${dataset.name}-${layerDesc.type}`, layerDesc);
      viewer.layerManager.addManagedLayer(layerWithSpec);

      const {layer} = layerWithSpec;

      if (layer instanceof SegmentationUserLayer) {
        await layer.multiscaleSource!;
        console.log('root segments callback 1');
        layer.displayState.rootSegments.changed.add(() => {
          console.log('root segments changed 1');
          this.refreshActiveCells();
        });
        this.refreshActiveCells();
      }
    }

    return true;
  }

  @action async selectCell(cell: CellDescription) {
    if (!viewer) {
      return false;
    }

    console.log('selectCell');
    const layers = viewer.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        console.log('we have a seg layer');
        console.log('want to select cell', cell.id);
        await layer.multiscaleSource!;
        const uint64Id = new Uint64().parseString(cell.id, 10);
        layer.displayState.segmentSelectionState.set(uint64Id);
        layer.displayState.segmentSelectionState.setRaw(uint64Id);
        layer.selectSegment();
        console.log('selectedCell', cell.id);
        return true;
      }
    }

    return false;
  }

  @action async fetchLoggedInUser() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      let res = await authFetch(`${existingAuthURL.substring(0, existingAuthURL.indexOf('/authorize'))}/user/me`); //TODO go back to just ${existingAuthURL} once server is updated
      let user = await res.json();
      let {name, email} = user;
      this.loggedInUser = {name, email};
    } else {
      this.loggedInUser = null; // TODO - do I need this?
    }
  }

  @action async logout() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      await authFetch(`${existingAuthURL.substring(0, existingAuthURL.indexOf('/authorize'))}/logout`).then(res => {  //TODO go back to just ${existingAuthURL} once server is updated
        return res.json();
      });

      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_url");

      authTokenShared!.value = null;

      this.loggedInUser = null;
    }
  }

  @action async loopUpdateLeaderboard() {
    await this.updateLeaderboard();
    await new Promise(() => setTimeout(this.loopUpdateLeaderboard, 20000));
  }

  @action async updateLeaderboard() {
    const url = 'https://pyrdev.eyewire.org/pyr-backend';
    //const url = 'http://localhost:9000';
    const queryUrl = url + '?days=' + this.leaderboardTimespan;
    fetch(queryUrl).then(result => result.json()).then(async (json) => {
      const newEntries = json.entries;
      this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
      for (const entry of newEntries) {
        this.leaderboardEntries.push(entry);
      }
    });
  }

  @action async resetLeaderboard() {
    this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
    return this.updateLeaderboard();
  }

  @action async joinChat() {
    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    await this.fetchLoggedInUser();

    const joinMessage = JSON.stringify({
      type: 'join',
      name: this.loggedInUser ? this.loggedInUser.name : 'Guest'
    });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(joinMessage);
    } else {
      ws.onopen = () => {
        ws.send(joinMessage); };
    }
  }

  @action async handleMessage(message: any) {
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
}

import Vue from 'vue';
import Vuex from 'vuex';
import ws from './chat_socket';
Vue.use(Vuex);

export const store = new Vuex.Store({
  modules: {
    ...extractVuexModule(AppStore)
  },
});

export const storeProxy = createProxy(store, AppStore);
export {Vue}; // vue app needs to be instantiated from this modified VueConstructor
