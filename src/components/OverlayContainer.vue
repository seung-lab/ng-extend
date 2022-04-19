<template>
  <div class="overlays">
    <dataset-chooser v-if="appState.showDatasetChooser" @hide="appState.showDatasetChooser=false"/>

    <reset-confirm-dialog v-if="appState.showResetConfirm" @hide="appState.showResetConfirm=false"/>

    <admin-panel v-if="appState.showAdminPanel" @hide="appState.showAdminPanel=false"/>

    <image-overlay v-if="appState.checkingOutNeuron">
      <template #image>
        <img src="images/inspecting.png" style="top: -150px;">
      </template>
      <template #text>
        <div>Checking out neuron from Proofreading Drive.</div>
        <div>Please wait...</div>
      </template>
    </image-overlay>

    <image-overlay v-if="appState.showSubmittedCongrats" @hide="appState.showSubmittedCongrats=false">
      <template #image>
        <img src="images/thumbsup.png" style="left: -100px; top: -150px;">
      </template>
      <template #text>
        <div>Congratulations!</div>
        <div>Your cell has been marked as complete. Thank you for contributing to the drosophila connectome.</div>
      </template>
      <template #buttonCaption>ONWARD</template>
    </image-overlay>

    <modal-overlay v-if="appState.showCheckoutHelp">
      <div>"Get Cell to Proofread" moves you to a cell that needs proofreading, and deselects other cells.<br/>
        Our Self-Guided Training provides proofreading instructions.<br/>
        Use the Lightbulb menu to mark cell when complete.</div>
      <div><button class="nge_segment" @click="appState.setShowCheckoutHelp(false)">OK</button></div>
    </modal-overlay>

    <modal-overlay v-if="appState.loggedInUser === null">
      <div>You are not logged in. Refresh the page if you do not see a Google login pop-up.</div>
    </modal-overlay>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import ModalOverlay from "components/ModalOverlay.vue";
import ResetConfirmDialog from "components/ResetConfirmDialog.vue";
import AdminPanel from "components/AdminPanel.vue"
import {storeProxy} from "../state";
import ImageOverlay from "./ImageOverlay.vue";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { ResetConfirmDialog, ModalOverlay, AdminPanel, ImageOverlay }
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
/*.overlay-button {
  margin-top: 20px;
  text-align: center;
}
.ng-extend .overlay-button > button {
  padding: 10px;
  border: 1px solid white !important;
  border-radius: 5px;
}*/
</style>
