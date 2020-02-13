<template>
  <div class="nge-chatbox">
    <div class="nge-sidebar-section-title">Chat</div>
    <div class="nge-chatbox-filler"></div>
    <div class="nge-chatbox-messages">
      <span
        class="nge-chatbox-item"
        v-for="(message, index) of appState.chatMessages"
        :key="index"
      >
        <div class="nge-chatbox-info" v-if="message.type === 'users'">
          <div class="nge-chatbox-info-content">Users online: {{message.name}}</div>
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
          <span class="nge-chatbox-message-content">{{message.message}}</span>
        </span>

        <span class="nge-chatbox-message" v-if="message.type === 'messageLink'">
          <a class="nge-chatbox-message-content" target="_blank" v-bind:href="message.message">{{message.message}}</a>
        </span>

        <div class="nge-chatbox-message" v-if="message.type === 'messageEnd'"></div>

        <!--<div class="nge-chatbox-message" v-if="message.type === 'message'">
          <div class="nge-chatbox-message-content">{{message.message}}</div>
        </div>-->
      </span>
    </div>
    <form class="nge-chatbox-sendmessage" @submit.prevent="submitMessage" autocomplete="off">
      <input type="text" id="chatMessage" />
      <button type="submit">Submit</button>
    </form>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

import { storeProxy } from "../state";
import ws from "../chat_socket";

export default Vue.extend({
  data: () => {
    return {
      appState: storeProxy
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
      const places: string[] = ['firstplace', 'secondplace', 'thirdplace'];
      for (let i = 0; i < places.length; i++) {
        if (storeProxy.leaderboardEntries.length > i && storeProxy.leaderboardEntries[i].name === name) {
          return ' ' + places[i];
        }
      }
      return '';
    }
  }
});
</script>

<style>
.nge-chatbox {
  display: grid;
  grid-template-rows: min-content auto minmax(auto, min-content) min-content;
  background-color: #111;
}

.nge-chatbox-messages {
  overflow: auto;
  overflow-wrap: break-word;
  font-size: 0.85em;
}

.nge-chatbox-message-info {
  background-color: #222;
  padding: 0.5em;
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
}

.nge-chatbox-sendmessage button {
  padding: 5px !important;
}

/*.nge-chatbox-sendmessage > input {
  color: #fff;
  background-color: #000;
}*/
</style>