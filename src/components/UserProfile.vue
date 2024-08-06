<script setup lang="ts">
import {storeToRefs} from "pinia";
import ModalOverlay from "components/ModalOverlay.vue";

import {useLoginStore, useStatsStore} from "../store";
const {userInfo, cellsSubmitted} = storeToRefs(useStatsStore());
const {sessions} = storeToRefs(useLoginStore());

const emit = defineEmits({
    hide: null,
});
</script>

<template>
    <modal-overlay class="userProfile" @hide="emit('hide')">
        <button class="exit" @click="emit('hide')">×</button>
        <div class="content nge-user-profile-content">
            <div class="header" v-if="sessions.length > 0">
                <div class="title">{{sessions[0].name}}</div>
                <div class="email">{{sessions[0].email}}</div>
            </div>
            <div class="nge-user-profile-grid">
                <div class="nge-user-profile-grid-header">Edits</div>
                <div class="nge-user-profile-grid-header">Cells</div>
                <div class="nge-user-profile-subgrid">
                    <div class="nge-user-profile-timespan">Today</div>
                    <div class="nge-user-profile-timespan">Past 7 Days</div>
                    <div class="nge-user-profile-timespan">All Time</div>
                    <div class="nge-user-profile-count">{{userInfo.editsToday}} ({{userInfo.mergesToday}} | {{userInfo.splitsToday}})</div>
                    <div class="nge-user-profile-count">{{userInfo.editsThisWeek}} ({{userInfo.mergesThisWeek}} | {{userInfo.splitsThisWeek}})</div>
                    <div class="nge-user-profile-count">{{userInfo.editsAllTime}} ({{userInfo.mergesAllTime}} | {{userInfo.splitsAllTime}})</div>
                </div>
                <div class="nge-user-profile-subgrid">
                    <div class="nge-user-profile-timespan">Today</div>
                    <div class="nge-user-profile-timespan">Past 7 Days</div>
                    <div class="nge-user-profile-timespan">All Time</div>
                    <div class="nge-user-profile-count">0</div>
                    <div class="nge-user-profile-count">0</div>
                    <div class="nge-user-profile-count">{{cellsSubmitted}}</div>
                </div>
            </div>
            <div class="nge-user-profile-badges">
                <div class="nge-user-profile-badges-label">Badges</div>
                <div class="nge-user-profile-badges-box"></div>
            </div>
        </div>
    </modal-overlay>
</template>

<style scoped>
.userProfile {
    font-size: .9em;
}

.nge-user-profile-content {
    width: 500px;
    padding: 50px;
}

.header {
    padding-bottom: 30px;
}

.email {
    font-style: italic;
}

.nge-user-profile-grid {
    display: grid;
    grid-template-columns: 50% 50%;
}

.nge-user-profile-grid-header {
    padding-bottom: 20px;
    font-size: 1.6em;
}

.nge-user-profile-subgrid {
    display: grid;
    grid-template-columns: 33% 33% 34%;
}

.nge-user-profile-timespan {
    font-size: 0.8em;
    padding-bottom: 7px;
}

.nge-user-profile-count {
    font-size: 1.2em;
}

.nge-user-profile-badges {
    margin-top: 20px;
}

.nge-user-profile-badges-box {
    height: 100px;
    border: 1px solid #01ffffba;
    border-radius: 20px;
}
</style>
