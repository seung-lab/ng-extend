<template>
  <div id="vueMain">
    <Auth />
    <div id="neuroglancer-container"></div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Auth from "components/Auth.vue";

export default Vue.extend({
  components: { Auth }
});
</script>

<style>
#vueMain {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
}
</style>