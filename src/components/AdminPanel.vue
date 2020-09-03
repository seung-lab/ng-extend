<template>
  <modal-overlay id="adminPanel" @hide="$emit('hide')" class="list">
    <div class="adminPanelContent">
      <div class="title">Admin Dashboard</div>
      <div class="section">
        <p>User list: <a href="https://globalv1.flywire-daf.com/auth/api/v1/user" target="_blank">https://globalv1.flywire-daf.com/auth/api/v1/user</a></p>
        <div>Rollback user ID:
          <input type="text" id="rollbackUserID">
          <button class="rollbackButton" @click="rollback()">Rollback</button>
        </div>
      </div>
      <div class="actions">
        <button class="closeButton" @click="close()">X</button>
      </div>
    </div>
  </modal-overlay>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy} from "../state";
import ModalOverlay from "components/ModalOverlay.vue";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { ModalOverlay },
  methods: {
    close() {
      this.$emit("hide");
    },
    rollback() {
      const userIDInput = <HTMLInputElement>document.getElementById("rollbackUserID");
      const userID = userIDInput.value;
      if (confirm("Rollback user " + userID + "?")) { //TODO get the name of the user
        console.log("Rollback user", userID); //TODO
      }
      userIDInput.value = "";
    }
  }
});
</script>

<style>
.adminPanelContent {
  padding: 30px;
  width: 800px;
  height: 400px;
}

.adminPanelContent .title {
  font-size: 2em;
}

.adminPanelContent .section {
  white-space: nowrap;
  padding-top: 20px;
  padding-bottom: 30px;
}

.adminPanelContent .actions {
  justify-self: center;
  display: grid;
  grid-auto-flow: column;
  grid-column-gap: 20px;
}

.adminPanelContent a {
  color: var(--color-small-text);
}

.ng-extend button.closeButton {
  position: absolute;
  top: 10px;
  right: 10px;
  border-radius: 999px;
  width: 30px;
  height: 30px;
}

.ng-extend button.rollbackButton {
  border-radius: 999px;
  padding-left: 10px;
  padding-right: 10px;
  height: 30px;
  background: var(--gradient-highlight);
}

.ng-extend button.rollbackButton:hover {
  background: var(--gradient-highlight-hover);
}
</style>