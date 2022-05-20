<template>
  <modal-overlay @hide="$emit('hide')" class="list">
    <div class="dialogContent">
      <div class="image">
        <slot name="image"></slot>
      </div>
      <div class="textholder">
        <div class="text">
          <slot name="text"></slot>
          <button v-if="hasButton" class="imgConfirmButton" @click="$emit('hide')"><slot name="buttonCaption"></slot></button>
        </div>
      </div>
    </div>
  </modal-overlay>
</template>

<script lang="ts">
import Vue from "vue";
import ModalOverlay from "components/ModalOverlay.vue";

export default Vue.extend({
  components: { ModalOverlay },
  computed: {
    hasButton() {
      return !!this.$slots.buttonCaption;
    }
  }
});
</script>

<style>
.dialogContent {
  display: grid;
  grid-template-columns: 60% 40%;
  width: 800px;
  height: 200px;
}

.dialogContent .image > img {
  height: 500px;
  position: relative;
}

.dialogContent .textholder {
  position: relative;
}

.dialogContent .text {
  font-size: 1.4em;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.dialogContent .text > div {
  padding-bottom: 20px;
}

.dialogContent button.imgConfirmButton {
  font-size: 0.7em;
  padding: 10px;
  background: var(--gradient-highlight);
  border-radius: 10px;
}

.dialogContent button.imgConfirmButton:hover {
  background: var(--gradient-highlight-hover);
}

/*.dialogContent .title {
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
}*/
</style>