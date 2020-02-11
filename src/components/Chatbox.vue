<template>
  <div class="nge-chatbox">
    <div class="nge-chatbox-message" v-for="(message, index) of appState.chatMessages" :key="index">
      <div class="nge-chatbox-message-sender">{{message.name}}</div>
      <div class="nge-chatbox-message-content">{{message.message}}</div>
    </div>
    <form @submit.prevent="submitMessage" autocomplete="off">
      <input type="text" id="chatMessage" />
      <input type="submit" value="Submit" />
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
      const name = this.appState.loggedInUser ? this.appState.loggedInUser.name : "Guest";

      const messageObj = { name: name, message: message };
      console.log("sending message", messageObj);
      ws.send(JSON.stringify(messageObj));
    }
  }
});
</script>

<style>
.nge-chatbox {
  background-color: #92af7d;
}
</style>