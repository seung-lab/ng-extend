<template>
  <div class="dropdownList" :class="{ open: isActive }">
    <button @click="toggleVisible"><slot name="buttonTitle">Button</slot></button>
      <ul v-visible="isActive" class="dropdownMenu">
        <slot name="listItems"></slot>
      </ul>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy} from "../state";

let uuid = 0;

export default Vue.extend({
  props: ['dropdownGroup'],
  data() {
    return {
      appState: storeProxy,
      id: uuid++,
    }
  },
  mounted() {
    console.log('mounted!');
    // document.body.addEventListener('mousedown', () => {
    //   console.log('mousedown!');
    // });

    // document.getElementById('neuroglancerViewer')!.addEventListener('mousedown', () => {
    //   console.log('mousedown ngc');
    // });
  },
  computed: {
    isActive(): boolean { // https://github.com/vuejs/vue/issues/8721#issuecomment-551301489
      if (this.dropdownGroup) {
        return this.appState.activeDropdown[this.dropdownGroup] === this.id;
      }

      return false;
    },
    activeDropdowns(): { [key: string]: number} {
      return this.appState.activeDropdown;
    }
  },
  methods: {
    toggleVisible() {
      if (this.dropdownGroup) {
        Vue.set(this.appState.activeDropdown, this.dropdownGroup, this.isActive ? -1 : this.id);
      }
    }
  }
});
</script>

<style>
.dropdownList {
  position: relative;
}

.dropdownList > button {
  width: 100%;
  height: 100%;
  padding: 0 4px;
}

.dropdownList.open > button {
  background-color: var(--color-medium-bg);
}

.hideDropdown {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  /* pointer-events: none; */
}


.dropdownMenu {
  position: absolute;
  right: 0;
  top: 30px;
  background-color: var(--color-medium-bg);
}

.dropdownMenu > li > button, .dropdownMenu > li > div {
  padding: 16px 26px;
  width: 100%;
  white-space: nowrap;
}

.dropdownGroup > button {
  height: 100%;
}

#extensionBar > .dropdownGroup > button {
  padding: 0 16px;
}
</style>
