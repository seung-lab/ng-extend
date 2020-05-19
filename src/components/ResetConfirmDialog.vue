<template>
  <modal-overlay @hide="$emit('hide')" class="list">
    <div class="dialogContent">
      <div class="title">Reset FlyWire View</div>
      <div class="description">This will delete any cells you have selected and reset your view to the default neurons. Are you sure you want to do this?</div>
      <div class="actions">
        <div></div>
        <div class="dialogButton"><button class="cancelButton" @click="cancel()">Cancel</button></div>
        <div class="dialogButton"><button class="confirmButton" @click="confirm()">Reset</button></div>
        <div></div>
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
    cancel() {
      this.$emit("hide");
    },
    confirm() {
      this.$root.$emit("confirmReset");
      this.$emit("hide");
    }
  }
});
</script>

<style>
.overlay-content {
  left: 35%;
  right: 35%;
  transform: translate(0%, -50%);
  background-color: var(--color-dark-bg);
  color: var(--color-small-text);
  border-radius: 20px;
}

.dialogContent {
  padding: 30px 50px;
}

.dialogContent .title {
  font-size: 2em;
}

.dialogContent .description {
  padding-top: 20px;
  padding-bottom: 30px;
}

.dialogContent .actions {
  display: grid;
  grid-template-columns: 20% 30% 30% 20%;
}

.dialogButton {
  margin: auto;
}

.ng-extend .dialogButton button {
  padding: 10px;
  border-radius: 20px;
  width: 80px;
}

.ng-extend .dialogButton button.cancelButton {
  border: 1px solid var(--color-border);
}

.ng-extend .dialogButton button.confirmButton {
  background: var(--gradient-highlight);
}

.ng-extend .dialogButton button.confirmButton:hover {
  background: var(--gradient-highlight-hover);
}
</style>