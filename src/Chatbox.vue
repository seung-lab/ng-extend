<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, useTemplateRef, watch, WatchHandle } from "vue";
import { storeToRefs } from "pinia";
import { useChatStore, useStatsStore } from '#src/store-pyr.js';
import HologramPanel from "#src/components/HologramPanel.vue";

//import sendImage from '../images/send.svg';
//import chevronImage from '../images/chevron.svg';

const scrollEl = useTemplateRef<HTMLElement>('scrollEl');

const store = useChatStore();
const { chatMessages, unreadMessages, minimizeChat } = storeToRefs(store);
const { sendMessage, markLastMessageRead } = store;
const { leaderboardEntries } = storeToRefs(useStatsStore());

/*function encodeSVG(svg: string) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}*/

let stopWatchingMessages: WatchHandle | undefined = undefined;

let scrollAtBottom = true;

onMounted(() => {
    //(document.querySelector(".nge-chatbox-messageprompt > img")! as HTMLImageElement).src = encodeSVG(chevronImage);
    //(document.querySelector(".nge-chatbox-submit > button > img")! as HTMLImageElement).src = encodeSVG(sendImage);

    scrollEl.value?.addEventListener("scroll", handleScroll);

    console.log("mounted");

    stopWatchingMessages = watch(store.chatMessages, (newValue) => {
        console.log("other watch");
        const lastMessage = newValue[newValue.length - 1];
        if (!lastMessage) return;
        const { type, dateTime } = lastMessage;
        console.log('scrollAtBottom', scrollAtBottom);
        if (scrollAtBottom) {
            // markLastMessageRead();
            // scroll to bottom of message box (once vue updates the page)
            nextTick(scrollToBottom);
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
    });

    scrollToBottom();
});

onUnmounted(() => {
    console.log('unmount!');
    // const scrollEl = document.querySelector(".nge-chatbox-scroll")!;
    scrollEl.value?.removeEventListener("scroll", handleScroll);

    if (stopWatchingMessages) {
        stopWatchingMessages();
    }
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
    console.log('scroll to bottom');
    const el = scrollEl.value;
    if (el) {
        el.scrollTo(0, el.scrollHeight);
    }
}

function handleScroll() {
    console.log('handleScroll');
    const el = scrollEl.value;
    if (el) {
        scrollAtBottom = Math.ceil(el.scrollTop) + el.offsetHeight >= el.scrollHeight;
        if (scrollAtBottom) {
            markLastMessageRead();
        }
    }
}

</script>

<template>
    <hologram-panel class="nge-chatbox-hologram" id="chatbox-hologram">
        <div class="hologram-controls">
            <button class="exit" @click="$emit('hide')">×</button>
            <button class="minimize" @click="minimizeChat = !minimizeChat">–</button>
        </div>
        <div class="nge-chatbox" :class="{ minimized: minimizeChat }" tabindex="1">
            <div class="nge-chatbox-filler"></div>
            <div class="nge-chatbox-grid">
                <div ref="scrollEl" class="nge-chatbox-scroll">
                    <div class="nge-chatbox-messages">
                        <span class="nge-chatbox-item" v-for="(message, index) of chatMessages"
                            :key="'message' + index">
                            <div class="nge-chatbox-info" v-if="message.type === 'users'">
                                <div class="nge-chatbox-info-content">{{ message.name }}</div>
                                <div class="nge-chatbox-info-content">Type !help to see available commands.</div>
                            </div>

                            <div class="nge-chatbox-info" v-if="message.type === 'join'">
                                <div class="nge-chatbox-info-content">{{ message.name }} joined chat.</div>
                            </div>

                            <div class="nge-chatbox-info" v-if="message.type === 'leave'">
                                <div class="nge-chatbox-info-content">{{ message.name }} left chat.</div>
                            </div>

                            <div class="nge-chatbox-info" v-if="message.type === 'disconnected'">
                                <div class="nge-chatbox-info-content">Your message was not sent because you were
                                    disconnected from chat. Try reloading the page.</div>
                            </div>

                            <div class="nge-chatbox-time" v-if="message.type === 'time'">{{ message.time }}</div>

                            <div class="nge-chatbox-message" v-if="message.type === 'message'" :title="message.time">
                                <span v-for="(part, partIndex) of message.parts"
                                    :key="'messagepart' + index + '-' + partIndex">
                                    <span v-if="part.type === 'sender'"
                                        :class="'nge-chatbox-message-text sender ' + message.rank">{{ part.text }}{{
                                            getTrophy(message.name) }}:
                                    </span>
                                    <span v-if="part.type === 'text'" class="nge-chatbox-message-text">{{ part.text
                                    }}</span>
                                    <a v-if="part.type === 'link'" class="nge-chatbox-message-text" target="_blank"
                                        :href="part.text">{{ part.text }}</a>
                                </span>
                            </div>
                        </span>
                    </div>
                </div>
            </div>
            <form class="nge-chatbox-sendmessage" @submit.prevent="submitMessage" autocomplete="off">
                <!--<div class="nge-chatbox-messageprompt"><img src="insert-svg" width="15" style="transform: rotate(90deg);" /></div>-->
                <div class="nge-chatbox-inputbox"><input type="text" id="chatMessage" placeholder=">" /></div>
                <!--<div class="nge-chatbox-submit"><button type="submit"><img src="insert-svg" width="15" /></button></div>-->
            </form>
            <div class="nge-chatbox-unread" v-show="unreadMessages" @click="scrollToBottom()">NEW MESSAGES</div>
        </div>
    </hologram-panel>
</template>

<style>
.nge-chatbox-hologram {
    width: 250px;
}

/* .nge-chatbox-hologram.minimized {
    height: 22px;
} */

.nge-chatbox {
    min-height: 0;
}

.nge-chatbox.minimized {
    display: none;
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

.nge-chatbox-title-button>img {
    padding-left: 10px;
    padding-right: 10px;
}

.nge-chatbox-grid {
    display: grid;
    height: 250px;
}

.nge-chatbox-scroll {
    overflow: auto;
}

.nge-chatbox-messages {
    font-size: 0.75em;
    padding-left: 15px;
    padding-right: 15px;
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
    /*text-align: center;*/
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
    padding-left: 10px;
    padding-right: 10px;
    padding-bottom: 12px;
}

.nge-chatbox-messageprompt {
    padding-top: 5px;
}

.nge-chatbox-sendmessage button {
    padding: 5px !important;
}

.nge-chatbox-inputbox>input {
    color: #fff;
    background-color: #2226;
    width: 220px;
    border: 1px solid #01ffffba;
    border-radius: 4px;
}

.nge-chatbox-unread {
    z-index: 90;
    user-select: none;
    background: var(--color-light-bg);
    font-size: 0.9em;
    text-align: center;
    border-radius: 10px;
    cursor: pointer;
    position: relative;
    top: -50px;
}
</style>
