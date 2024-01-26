<script setup lang="ts">
import {onMounted, onUnmounted} from "vue";
import {storeToRefs} from "pinia";
import {useChatStore, useStatsStore} from '../store';

const store = useChatStore();
const {chatMessages, unreadMessages} = storeToRefs(store);
const {sendMessage, markLastMessageRead} = store;
const {leaderboardEntries} = storeToRefs(useStatsStore());

onMounted(() => {
    const scrollEl = document.querySelector(".nge-chatbox-scroll .simplebar-content-wrapper")!;
    scrollEl.addEventListener("scroll", handleScroll);
});

onUnmounted(() => {
    const scrollEl = document.querySelector(".nge-chatbox-scroll .simplebar-content-wrapper")!;
    scrollEl.removeEventListener("scroll", handleScroll);
});

function submitMessage() {
    const messageEl = <HTMLInputElement>(
        document.getElementById("chatMessage")
    );
    const message = messageEl.value;
    messageEl.value = "";
    if (message.trim() !== "") {
        sendMessage(message);
    }
}

function getTrophy(name: string): string {
    const places: string[] = ["🥇", "🥈", "🥉"];
    for (let i = 0; i < places.length; i++) {
        if (leaderboardEntries.value.length > i && leaderboardEntries.value[i].name === name) {
            return places[i];
        }
    }
    return "";
}

function scrollToBottom() {
    const el = <HTMLElement>document.querySelector('.nge-chatbox-scroll .simplebar-content-wrapper');
    el.scrollTo(0, el.scrollHeight);
}

function handleScroll() {
    const el = <HTMLElement>document.querySelector('.nge-chatbox-scroll .simplebar-content-wrapper');
    const scrollAtBottom = Math.ceil(el.scrollTop) + el.offsetHeight >= el.scrollHeight;
    if (scrollAtBottom) {
        markLastMessageRead();
    }
}

</script>

<template>
    <div class="nge-chatbox" tabindex="1">
      <div class="nge-chatbox-title">
        <div>Chat</div>
        <!--<button class="nge-chatbox-title-button" @click="toggleMinimized()">
          <img v-show="!minimized" src="images/minimize.svg" width="15" title="Minimize" />
          <img v-show="minimized" src="images/chevron.svg" width="15" title="Restore" />
        </button>
        <button class="nge-chatbox-title-button" @click="toggleExpanded()">
          <img v-show="!expanded" src="images/expand.svg" width="15" title="Expand" />
          <img
            v-show="expanded"
            src="images/chevron.svg"
            width="15"
            style="transform: rotate(180deg);"
            title="Restore"
          />
        </button>-->
      </div>
      <div class="nge-chatbox-content">
        <div class="nge-chatbox-filler"></div>
        <simplebar class="nge-chatbox-scroll" data-simplebar-auto-hide="false">
          <div class="nge-chatbox-messages">
            <span
              class="nge-chatbox-item"
              v-for="(message, index) of chatMessages"
              :key="'message' + index"
            >
              <div class="nge-chatbox-info" v-if="message.type === 'users'">
                <div class="nge-chatbox-info-content">{{message.name}}</div>
                <div class="nge-chatbox-info-content">Type !help to see available commands.</div>
              </div>
  
              <div class="nge-chatbox-info" v-if="message.type === 'join'">
                <div class="nge-chatbox-info-content">{{message.name}} joined chat.</div>
              </div>
  
              <div class="nge-chatbox-info" v-if="message.type === 'leave'">
                <div class="nge-chatbox-info-content">{{message.name}} left chat.</div>
              </div>
  
              <div class="nge-chatbox-info" v-if="message.type === 'disconnected'">
                <div class="nge-chatbox-info-content">Your message was not sent because you were disconnected from chat. Try reloading the page.</div>
              </div>
  
              <div class="nge-chatbox-time" v-if="message.type === 'time'">{{message.time}}</div>
  
              <div
                class="nge-chatbox-message"
                v-if="message.type === 'message'"
                :title="message.time"
              >
                <span
                  v-for="(part, partIndex) of message.parts"
                  :key="'messagepart' + index + '-' + partIndex"
                >
                  <span
                    v-if="part.type === 'sender'"
                    :class="'nge-chatbox-message-text sender ' + message.rank"
                  >{{part.text}}{{getTrophy(message.name)}}:</span>
                  <span v-if="part.type === 'text'" class="nge-chatbox-message-text">{{part.text}}</span>
                  <a
                    v-if="part.type === 'link'"
                    class="nge-chatbox-message-text"
                    target="_blank"
                    :href="part.text"
                  >{{part.text}}</a>
                </span>
              </div>
            </span>
          </div>
        </simplebar>
        <div class="nge-chatbox-unread" v-show="unreadMessages" @click="scrollToBottom()">NEW MESSAGES</div>
        <form class="nge-chatbox-sendmessage" @submit.prevent="submitMessage" autocomplete="off">
          <div class="nge-chatbox-messageprompt"><img src="images/chevron.svg" width="15" style="transform: rotate(90deg);" /></div>
          <div class="nge-chatbox-inputbox"><input type="text" id="chatMessage" /></div>
          <div><button type="submit"><img src="images/send.svg" width="15" /></button></div>
        </form>
      </div>
    </div>
</template>

<style>
.nge-chatbox {
    position: absolute;
    width: 250px;
    height: 300px;
    bottom: 10px;
    left: 10px;
    border-radius: 25px;
    box-shadow: inset 0 0 20px 3px #a46fe2;
    background-color: #00000099;
    z-index: 80; /* over top of leaderboard simplebar */
    display: grid;
    grid-template-rows: min-content auto;
}
.nge-chatbox-title {
    /*background-color: #000;*/
    font-size: 1.15em;
    padding: 10px;
    display: grid;
    grid-template-columns: auto min-content min-content;
}
.nge-chatbox-title-button {
    align-self: end;
}
.nge-chatbox-title-button > img {
    padding-left: 10px;
    padding-right: 10px;
}
.nge-chatbox-content {
    display: grid;
    grid-template-rows: auto minmax(auto, min-content) min-content;
    /*background-color: #111;*/
}
.nge-chatbox-messages {
    font-size: 0.75em;
    padding-top: 10px;
    padding-left: 10px;
    padding-right: 10px;
}
.nge-chatbox-message {
    overflow-wrap: break-word;
    padding-top: 0.5em;
    padding-bottom: 0.15em;
}
.nge-chatbox-message-text.sender {
    font-weight: bold;
}
.nge-chatbox-message-text.sender.admin {
    color: #E6C760;
}
.nge-chatbox-message-text.sender.eyewirer {
    color: #0292AE;
}
.nge-chatbox-message-text.sender.researcher {
    color: #0FB18B;
}
.nge-chatbox-message-text {
    color: white;
}
.nge-chatbox-info-content {
    padding: 0.5em;
    text-align: center;
    font-style: italic;
}
.nge-chatbox-time {
    padding-top: 0.15em;
    text-align: center;
    font-size: 0.85em;
}
.nge-chatbox-sendmessage {
    align-self: end;
    z-index: 90;
    display: grid;
    grid-template-columns: min-content auto min-content;
    padding-top: 5px;
}
.nge-chatbox-messageprompt {
    padding-top: 5px;
}
.nge-chatbox-sendmessage button {
    padding: 5px !important;
}
.nge-chatbox-inputbox > input {
    color: #fff;
    background-color: #111;
    max-width: 150px;
    /*border-width: 0px;*/
}
.nge-chatbox-unread {
    z-index: 90;
    user-select: none;
    background: var(--color-light-bg);
    font-size: 0.9em;
    text-align: center;
    border-radius: 10px;
    cursor: pointer;
}
</style> 
