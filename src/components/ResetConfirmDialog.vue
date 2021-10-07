<template>
  <modal-overlay id="resetConfirmDialog" @hide="$emit('hide')" class="list">
    <div class="dialogContent">
      <div class="title">Reset FlyWire View</div>
      <div class="description">
        <p>This will delete any cells you have selected<br>and reset your view to the default neurons.</p>
        <p>Are you sure you want to do this?</p>
      </div>
      <div class="actions">
        <button class="cancelButton" @click="cancel()">Cancel</button>
        <button class="confirmButton" @click="confirm()">Reset</button>
      </div>
    </div>
  </modal-overlay>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {storeProxy} from "../state";
import ModalOverlay from "components/ModalOverlay.vue";

export default defineComponent({
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
.dialogContent {
  display: grid;
  padding: 30px;
}

.dialogContent .title {
  font-size: 2em;
}

.dialogContent .description {
  white-space: nowrap;
  padding-top: 20px;
  padding-bottom: 30px;
}

.dialogContent .actions {
  justify-self: center;
  display: grid;
  grid-auto-flow: column;
  grid-column-gap: 20px;
}

#resetConfirmDialog button {
  border-radius: 999px;
  width: 80px;
  height: 30px;
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