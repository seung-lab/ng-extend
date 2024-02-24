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
        <div class="content">
            <div class="header">
                <div class="title" v-if="sessions.length > 0">{{sessions[0].name}} &lt;{{sessions[0].email}}&gt;</div>
            </div>
            <div class="nge-user-profile-grid">
                <div>Edits</div>
                <div>Cells</div>
                <div class="nge-user-profile-subgrid">
                    <div>Today</div>
                    <div>Past 7 Days</div>
                    <div>All Time</div>
                    <div>{{userInfo.editsToday}}</div>
                    <div>{{userInfo.editsThisWeek}}</div>
                    <div>{{userInfo.editsAllTime}}</div>
                </div>
                <div class="nge-user-profile-subgrid">
                    <div>Today</div>
                    <div>Past 7 Days</div>
                    <div>All Time</div>
                    <div>0</div>
                    <div>0</div>
                    <div>{{cellsSubmitted}}</div>
                </div>
            </div>
        </div>
    </modal-overlay>
</template>

<style scoped>
.userProfile {
    font-size: .9em;
}

.nge-user-profile-grid {
    display: grid;
    grid-template-columns: 50% 50%;
}

.nge-user-profile-subgrid {
    display: grid;
    grid-template-columns: 33% 33% 34%;
}

</style>
