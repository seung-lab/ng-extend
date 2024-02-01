<script setup lang="ts">
  import ModalOverlay from "components/ModalOverlay.vue";
  /*
  import {useStatsStore} from '../store';
  const statsStore = useStatsStore();

  const {activeLayers, selectLayers} = statsStore;
  */
  const emit = defineEmits({
    hide: null,
  });
</script>

<template>
  <modal-overlay class="userProfile" @hide="emit('hide')">
      <button class="exit" @click="emit('hide')">×</button>
        <div class="content">
            <div class="header"><div class="title">User Profile</div></div>
      </div>
    </modal-overlay>
</template>

<style scoped>


</style>
