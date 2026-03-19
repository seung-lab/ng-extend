<script setup lang="ts">
import { useDropdownListStore } from 'src/store';
import { computed } from "vue";

const dropdownListStore = useDropdownListStore();
const uuid = dropdownListStore.getDropdownId();
const props = defineProps<{
  dropdownGroup: string;
  id?: string;
  bar?: number;
}>();

function toggleVisible() {
  dropdownListStore.activeDropdowns[props.dropdownGroup] = isActive.value
    ? undefined
    : uuid;
}

const isActive = computed(() => {
  return dropdownListStore.activeDropdowns[props.dropdownGroup] === uuid;
});

// const props = {
//   dropdownGroup: string;
// }

// export default Vue.extend({
//   props: ['dropdownGroup', 'type', 'width', 'hover'],
//   data() {
//     return {
//       appState: storeProxy,
//       id: uuid++,
//     }
//   },
//   mounted() {
//     this.$root.$on("closeDropdowns", () => {
//       this.close();
//     });

//     /*
//      Add a click handler to close the dropdown when anywhere else on the page is clicked.
//      For most of the page, document.body will get the event. When the viewer panel is clicked,
//      however, it will stop the click event's propagation.
//      The viewer is not created immediately on page load, and it may be replaced if the user
//      changes their view. So we wait until the viewer has loaded (by wrapping the dropdown in a
//      <template v-if="appState.loadedViewer">), then wait one more frame for the panel to be added
//      (by using setTimeout with delay 0). Then we can add the event listener.
//      We need to repeat this whenever the viewer layout is changed (and the dropdown is created after
//      the initial layout change happens, so we need to do it separately the first time). This we wrap
//      inside an extra setTimeout so that the panels are actually created by the time it runs.
//     */

//     //Regular mousedown handler
//     document.body.addEventListener("mousedown", () => {
//       this.close();
//     });

//     //Add mousedown handler to initial viewer panels
//     this.addPanelClickHandlers();

//     //Add mousedown handler to new viewer panels whenever they update
//     viewer!.layout.changed.add(() => {
//       setTimeout(() => this.addPanelClickHandlers());
//     });
//   },
//   computed: {
//     isActive(): boolean { // https://github.com/vuejs/vue/issues/8721#issuecomment-551301489
//       if (this.dropdownGroup) {
//         return this.appState.activeDropdown[this.dropdownGroup] === this.id;
//       }

//       return false;
//     },
//     activeDropdowns(): { [key: string]: number} {
//       return this.appState.activeDropdown;
//     }
//   },
//   methods: {
//     toggleVisible() {
//       if (this.dropdownGroup) {
//         Vue.set(this.appState.activeDropdown, this.dropdownGroup, this.isActive ? -1 : this.id);
//       }
//     },
//     close() {
//       if (this.isActive) {
//         this.toggleVisible();
//       }
//     },
//     addPanelClickHandlers() {
//       setTimeout(() => {
//         document.querySelectorAll("div.neuroglancer-rendered-data-panel.neuroglancer-panel.neuroglancer-noselect")
//           .forEach(e => e.addEventListener("mousedown", () => {
//             this.close();
//           }));
//       }, 0);
//     }
//   }
// });
</script>

<template>
  <div class="dropdownList" :id="id" :class="{ open: isActive }">
    <button @click="toggleVisible">
      <slot name="buttonTitle"></slot>
    </button>
    <ul v-visible="isActive" class="dropdownMenu">
      <slot name="listItems"></slot>
    </ul>
  </div>

  <!-- <div class="dropdownList" :class="{ open: isActive }" :style="{width: width, 'min-width': width}" @mousedown.stop.prevent>
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
</div> -->
</template>

<style scoped>
.dropdownList {
  position: relative;
  font-size: 10pt;
}

.ng-extend .dropdownList>button {
  width: 100%;
  height: 100%;
  padding: 0 4px;
}

.dropdownMenu {
  min-width: 180px;
  position: absolute;
  right: 0;
  top: 33px;
  background: linear-gradient(135deg, rgba(8, 12, 24, 0.97) 0%, rgba(12, 18, 32, 0.95) 100%);
  border-radius: 10px;
  border: 1px solid rgba(74, 158, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(74, 158, 255, 0.04);
  backdrop-filter: blur(12px);
  overflow: hidden;
  z-index: 10;
  padding: 6px 0;
  list-style: none;
}

.dropdownMenu :deep(li) {
  list-style: none;
}

.dropdownMenu :deep(li > div),
.dropdownMenu :deep(li > a) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 0.85em;
  color: rgba(200, 215, 240, 0.85);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
  text-decoration: none;
}

.dropdownMenu :deep(li > div:hover),
.dropdownMenu :deep(li > a:hover) {
  background: rgba(74, 158, 255, 0.08);
  color: #e0e8f0;
}

.dropdownMenu :deep(li + li) {
  border-top: 1px solid rgba(255, 255, 255, 0.03);
}
</style>
