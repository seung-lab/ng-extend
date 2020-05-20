<template>
  <div class="overlays">
    <dataset-chooser v-if="appState.showDatasetChooser" @hide="appState.showDatasetChooser=false"/>

    <reset-confirm-dialog v-if="appState.showResetConfirm" @hide="appState.showResetConfirm=false"/>

    <modal-overlay v-if="appState.loggedInUser === null">
      <div>You are not logged in. Refresh the page if you do not see a google login pop-up.</div>
    </modal-overlay>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import ModalOverlay from "components/ModalOverlay.vue";
import ResetConfirmDialog from "components/ResetConfirmDialog.vue";
import {storeProxy} from "../state";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { ResetConfirmDialog, ModalOverlay }
});
</script>

<style>
.overlays {
  position: fixed;
  width: 100%;
  height: 100%;
  z-index: 100;
  pointer-events: none;
}
</style>
