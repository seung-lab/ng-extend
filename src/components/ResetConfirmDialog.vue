<template>
  <image-overlay id="resetConfirmDialog">
    <template #image>
      <img src="images/thinkingnurro.png" style="width: 95%; height: auto;">
    </template>
    <template #text>
      <div class="title">Reset FlyWire View</div>
      <div class="description">
        <p>This will delete any cells you have selected and reset your view to the default neurons.</p>
        <p>Are you sure you want to do this?</p>
      </div>
    </template>
    <template #buttons>
      <div class="actions">
        <button class="cancelButton" @click="cancel()">Cancel</button>
        <button class="confirmButton" @click="confirm()">Reset</button>
      </div>
    </template>
  </image-overlay>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy} from "../state";
import ImageOverlay from "./ImageOverlay.vue";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { ImageOverlay },
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
#resetConfirmDialog .dialogContent {
    height: 300px;
}

.dialogContent .title {
  font-size: 1.5em;
}

.dialogContent .description {
  font-size: 0.7em;
}

#resetConfirmDialog button {
  border-radius: 999px;
  width: 80px;
  height: 30px;
  font-size: 0.8em;
}

.ng-extend button.cancelButton {
  border: 1px solid var(--color-border);
}

.ng-extend button.confirmButton {
  background: var(--gradient-highlight);
}

.ng-extend button.confirmButton:hover {
  background: var(--gradient-highlight-hover);
}
</style>