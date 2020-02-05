<template>
  <modal-overlay @hide="$emit('hide')" class="list">
    <div class="title">Datasets</div>
    <ul>
      <li v-for="dataset of datasets" v-bind:key="dataset.name" :class="{selected: dataset === activeDataset}" @click="selectDataset(dataset)">{{ dataset.name }}</li>
    </ul>
  </modal-overlay>
</template>

<script lang="ts">
import Vue from "vue";
import {storeProxy, DatasetDescription} from "../state";
import ModalOverlay from "components/ModalOverlay.vue";

export default Vue.extend({
  data() {
    return {
      appState: storeProxy
    }
  },
  components: { ModalOverlay },
  computed: {
    datasets() {
      return storeProxy.datasets;
    },
    activeDataset() {
      return storeProxy.datasets;
    },
  },
  methods: {
    selectDataset: async function(dataset: DatasetDescription) {
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
</style>