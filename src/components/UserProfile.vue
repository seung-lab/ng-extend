<script setup lang="ts">
    import ModalOverlay from "components/ModalOverlay.vue";

    //TODO
    //import {useLoginStore} from "../store";
    //const {sessions} = useLoginStore();
    //const loggedInUser = sessions[0];
    const loggedInUser = {"name": "Kai Kuehner", "email": "kaikuehner@gmail.com"}

    /*
    import {useStatsStore} from "../store";
    const statsStore = useStatsStore();

    const {activeLayers, selectLayers} = statsStore;
    */
    const emit = defineEmits({
        hide: null,
    });
</script>

<template>
    <modal-overlay class="userProfile" @hide="emit('hide')">
        <button class="exit" @click="emit('hide')">×</button>
        <div class="content">
            <div class="header"><div class="title">{{loggedInUser.name}} &lt;{{loggedInUser.email}}&gt;</div></div>
            <div class="nge-user-profile-grid">
                <div>Edits</div>
                <div>Cells</div>
                <div class="nge-user-profile-subgrid">
                  <div>Today</div>
                  <div>Past 7 Days</div>
                  <div>All Time</div>
                  <div>0</div>
                  <div>0</div>
                  <div>0</div>
                </div>
                <div class="nge-user-profile-subgrid">
                  <div>Today</div>
                  <div>Past 7 Days</div>
                  <div>All Time</div>
                  <div>0</div>
                  <div>0</div>
                  <div>0</div>
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
