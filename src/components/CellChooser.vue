<template>
  <overlay class="list cellChooser">
    <div class="title">Cells</div>
    <ul>
      <li v-for="cell of cells" v-bind:key="cell.id" :class="{selected: activeCells.includes(cell)}" @click="selectCell(cell)">{{ cell.id }}</li>
    </ul>
  </overlay>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy, CellDescription} from "../state";
import Overlay from "components/Overlay.vue";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { Overlay },
  computed: {
    cells() {
      return (storeProxy.activeDataset && storeProxy.activeDataset.curatedCells) || [];
    },
    activeCells() {
      return storeProxy.activeCells;
    }
  },
  methods: {
    selectCell: async function(cell: CellDescription) {
      const success = await this.appState.selectCell(cell);

      if (success) {
        // this.$emit('hide');
      } else {
        console.warn("cannot select cell because viewer is not yet created");
      }
    }
  }
});
</script>

<style>
.cellChooser {
  position: absolute;
  background-color: purple;
  right: 0;
  top: 30px;
}

#datasetList li, #datasetList .title {
  height: 48px;
  box-sizing: border-box;
  padding: 10px;
  display: flex;
  align-items: center;
}

#datasetList li {
  cursor: pointer;
}

#datasetList li:hover {
  background-color: #f1f1f1;
}

#datasetList li.selected {
  background-color: lightgreen;
}
</style>