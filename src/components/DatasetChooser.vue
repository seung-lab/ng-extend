<template>
  <div class="overlay" @click="$emit('hide')" @mousedown.stop.prevent>
    <div id="datasetList" class="overlay-content" @click.stop.prevent>
      <div class="title">Datasets</div>
      <ul>
        <li v-for="dataset of datasets" v-bind:key="dataset.name" :class="{selected: dataset.active}" @click="selectDataset(dataset)">{{ dataset.name }}</li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy, Dataset} from "../state";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  computed: {
    datasets() {
      return storeProxy.datasets;
    }
  },
  methods: {
    selectDataset: async function(dataset: Dataset) {
      const success = await this.appState.selectDataset(dataset);

      if (success) {
        this.$emit('hide');
      } else {
        console.warn("cannot select dataset because viewer is not yet created");
      }
    }
  }
});
</script>

<style>
@import "../common.css";

#datasetList {
  min-width: 250px;
}

#datasetList .title {
  background-color: lightgray;
  font-size: 1.25em;
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