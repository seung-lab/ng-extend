<template>
  <div class="dropdownList" :class="{ open: isActive }" :style="{width: width, 'min-width': width}" @mousedown.stop.prevent>
    <template v-if="type === 'chooser'">
      <div class="dropdownChooser" @click="toggleVisible" :title="hover">
        <div class="dropdownChooserLabel">
          <div class="dropdownChooserTitle"><slot name="chooserTitle"></slot></div>
          <div class="dropdownChooserArrow"></div>
        </div>
      </div>
      <ul v-visible="isActive" class="dropdownMenu chooser">
        <div class="dropdownChooserLabel" @click="toggleVisible">
          <div class="dropdownChooserTitle"><slot name="chooserTitle"></slot></div>
          <div class="dropdownChooserArrow"></div>
        </div>
        <slot name="listItems"></slot>
      </ul>
    </template>
    <template v-else>
      <button @click="toggleVisible" :title="hover"><slot name="buttonTitle"></slot></button>
      <ul v-visible="isActive" class="dropdownMenu">
        <slot name="listItems"></slot>
      </ul>
      <div class="dropdownArrow" v-visible="isActive"></div>
    </template>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import { storeProxy, viewer } from "../state";

let uuid = 0;

export default defineComponent({
  props: ['dropdownGroup', 'type', 'width', 'hover'],
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
     inside an extra setTimeout so that the panels are actually created by the time it runs.
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

/*.ng-extend button:hover {
  background-color: hsla(0,0%,100%,.1);
}*/

.hideDropdown {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  /* pointer-events: none; */
}

.dropdownArrow {
  position: absolute;
  bottom: -1px;
  border-width: 7px;
  border-style: solid;
  border-color: transparent;
  border-bottom-color: var(--color-dark-bg);
  left: 50%;
  margin-left: -7px;
  pointer-events: none;
}

.dropdownMenu {
  min-width: 100%;
  position: absolute;
  right: 0;
  top: 40px;
  background-color: var(--color-dark-bg);
  border-radius: 5px;
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.dropdownMenu.chooser {
  top: 3px;
}

.dropdownMenu > li > button, .dropdownMenu > li > div {
  padding: 16px 26px;
  text-align: left;
}

.dropdownMenu > li > button {
  width: 100%;
}

.dropdownGroup > button {
  height: 100%;
}

#extensionBar > .dropdownGroup > button {
  padding: 0 16px;
}

.dropdownChooser {
  width: 100%;
  border-radius: 5px;
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.dropdownChooserLabel {
  cursor: pointer;
  font-size: 0.9em;
  padding: 7px;
  display: grid;
  grid-template-columns: auto min-content;
}

.dropdownChooserLabel:hover {
  background-color: var(--color-light-bg);
}

.dropdownChooserTitle {
  text-align: center;
}

.dropdownChooserArrow {
  margin-left: 10px;
  margin-right: 10px;
  background-image: url('images/dropdown.svg');
  width: 10px;
  background-repeat: no-repeat;
  background-position: center;
}

.dropdownMenu > li.selected {
  background: var(--gradient-highlight);
}

.dropdownMenu > li.selected:hover {
  background: var(--gradient-highlight-hover);
}

.dropdownMenu > li.selected button:hover {
  background-color: hsla(120, 100%, 34%, 1);
}
</style>
