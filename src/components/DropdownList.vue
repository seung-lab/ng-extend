<template>
  <div class="dropdownList" :class="{ open: isActive }" @mousedown.stop.prevent>
    <button @click="toggleVisible"><slot name="buttonTitle"></slot></button>
      <ul v-visible="isActive" class="dropdownMenu">
        <slot name="listItems"></slot>
      </ul>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy} from "../state";
import { viewer } from "../main";

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
    this.$root.$on("closeDropdowns", () => {
      this.close();
    });

    /*
     Add a click handler to close the dropdown when anywhere else on the page is clicked.
     For most of the page, document.body will get the event. When the viewer panel is clicked,
     however, it will stop the click event's propagation.
     The viewer is not created immediately on page load, and it may be replaced if the user
     changes their view. So we wait until the viewer has loaded (by wrapping the dropdown in a 
     <template v-if="appState.loadedViewer">), then wait one more frame for the panel to be added
     (by using setTimeout with delay 0). Then we can add the event listener.
     We need to repeat this whenever the viewer layout is changed (and the dropdown is created after
     the initial layout change happens, so we need to do it separately the first time). This we wrap
     inside an extra setTimeout so that the panels are actually created when it runs.
    */

    //Regular mousedown handler
    document.body.addEventListener("mousedown", () => {
      this.close();
    });

    //Add mousedown handler to initial viewer panels
    this.addPanelClickHandlers();
    
    //Add mousedown handler to new viewer panels whenever they update
    viewer!.layout.changed.add(() => {
      setTimeout(() => this.addPanelClickHandlers());
    });
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
    },
    close() {
      if (this.isActive) {
        this.toggleVisible();
      }
    },
    addPanelClickHandlers() {
      setTimeout(() => {
        document.querySelectorAll("div.neuroglancer-rendered-data-panel.neuroglancer-panel.neuroglancer-noselect")
          .forEach(e => e.addEventListener("mousedown", () => {
            this.close();
          }));
      }, 0);
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
  top: 40px;
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

.dropdownMenu > li.selected {
  background-color: green;
}
</style>
