<template>
  <div class="nge-chatbox">
    <div class="nge-chatbox-title">
      <div>Chat</div>
      <button class="nge-chatbox-title-button" @click="toggleMinimized()">
        <img v-show="!minimized" src="images/minimize.svg" width="20" title="Minimize" />
        <img v-show="minimized" src="images/chevron.svg" width="20" title="Restore" />
      </button>
      <button class="nge-chatbox-title-button" @click="toggleExpanded()">
        <img v-show="!expanded" src="images/expand.svg" width="20" title="Expand" />
        <img v-show="expanded" src="images/chevron.svg" width="20" style="transform: rotate(180deg);" title="Restore" />
      </button>
    </div>
    <div class="nge-chatbox-content" v-show="!minimized">
      <div class="nge-chatbox-filler"></div>
      <simplebar class="nge-chatbox-messages" data-simplebar-auto-hide="false">
        <span
          class="nge-chatbox-item"
          v-for="(message, index) of appState.chatMessages"
          :key="index"
        >
          <div class="nge-chatbox-info" v-if="message.type === 'users'">
            <div class="nge-chatbox-info-content">Users online: {{message.name}}</div>
            <div class="nge-chatbox-info-content">Type !help to see available commands.</div>
          </div>

          <div class="nge-chatbox-info" v-if="message.type === 'join'">
            <div class="nge-chatbox-info-content">{{message.name}} joined chat.</div>
          </div>

          <div class="nge-chatbox-info" v-if="message.type === 'leave'">
            <div class="nge-chatbox-info-content">{{message.name}} left chat.</div>
          </div>

          <div class="nge-chatbox-message-info" v-if="message.type === 'sender'">
            <div :class="'nge-chatbox-message-sender' + getPlace(message.name)">{{message.name}}</div>
            <div class="nge-chatbox-message-time">{{message.time}}</div>
          </div>

          <span class="nge-chatbox-message" v-if="message.type === 'messagePart'">
            <span class="nge-chatbox-message-content" :title="message.time">{{message.message}}</span>
          </span>

          <span class="nge-chatbox-message" v-if="message.type === 'messageLink'">
            <a
              class="nge-chatbox-message-content"
              target="_blank"
              v-bind:href="message.message"
              :title="message.time"
            >{{message.message}}</a>
          </span>

          <div class="nge-chatbox-message" v-if="message.type === 'messageEnd'"></div>
        </span>
      </simplebar>
      <form class="nge-chatbox-sendmessage" @submit.prevent="submitMessage" autocomplete="off">
        <input type="text" id="chatMessage" />
        <button type="submit">Submit</button>
      </form>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import simplebar from "simplebar-vue";
import "simplebar/dist/simplebar.min.css";
import { storeProxy } from "../state";
import ws from "../chat_socket";
import Cookies from "js-cookie";

export default Vue.extend({
  components: {
    simplebar
  },
  data: () => {
    return {
      appState: storeProxy,
      minimized: Cookies.get("chatVisible") === "false",
      expanded: Cookies.get("leaderboardVisible") === "false"
    };
  },
  methods: {
    submitMessage() {
      const messageEl = <HTMLInputElement>(
        document.getElementById("chatMessage")
      );
      const message = messageEl.value;
      messageEl.value = "";

      const messageObj = { type: "message", message: message };
      ws.send(JSON.stringify(messageObj));
    },
    getPlace(name: string): string {
      const places: string[] = ["firstplace", "secondplace", "thirdplace"];
      for (let i = 0; i < places.length; i++) {
        if (
          storeProxy.leaderboardEntries.length > i &&
          storeProxy.leaderboardEntries[i].name === name
        ) {
          return " " + places[i];
        }
      }
      return "";
    },
    toggleMinimized() {
      if (this.expanded) {
        this.toggleExpanded();
      }
      this.minimized = !this.minimized;
      this.$root.$emit("toggleChat");
    },
    toggleExpanded() {
      if (this.minimized) {
        this.toggleMinimized();
      }
      this.expanded = !this.expanded;
      this.$root.$emit("toggleLeaderboard");
    }
  }
});
</script>

<style>
.nge-chatbox {
  display: grid;
  grid-template-rows: min-content auto;
}

.nge-chatbox-title {
  background-color: #000;
  font-size: 1.15em;
  padding: 0.75em;
  display: grid;
  grid-template-columns: auto min-content min-content;
}

.nge-chatbox-title-button {
  align-self: end;
}

.nge-chatbox-title-button > img {
  padding-left: 5px;
  padding-right: 5px;
}

.nge-chatbox-content {
  display: grid;
  grid-template-rows: auto minmax(auto, min-content) min-content;
  background-color: #111;
}

.nge-chatbox-messages {
  overflow-wrap: break-word;
  font-size: 0.85em;
}

.nge-chatbox-message-info {
  background-color: #222;
  padding: 0.5em;
  margin-bottom: 0.5em;
  display: grid;
  grid-template-columns: minmax(auto, 70%) auto;
}

.nge-chatbox-message-sender {
  font-weight: bold;
}

.nge-chatbox-message-time {
  text-align: right;
}

.nge-chatbox-message-content {
  padding: 0.5em;
  padding-top: 0.15em;
  display: inline-block;
  width: 92%;
}

a.nge-chatbox-message-content {
  color: white;
  padding-left: 0;
  padding-right: 0;
}

.nge-chatbox-info-content {
  padding: 0.5em;
  padding-top: 0.15em;
  text-align: center;
  font-style: italic;
}

.nge-chatbox-sendmessage {
  align-self: end;
  z-index: 1000;
}

.nge-chatbox-sendmessage button {
  padding: 5px !important;
}

/*.nge-chatbox-sendmessage > input {
  color: #fff;
  background-color: #000;
}*/
</style>