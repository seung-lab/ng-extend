<template>
  <div class="nge-overlay" @click.stop @mousedown.stop>
    <slot></slot>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
});
</script>

<style>
.nge-overlay {
  pointer-events: initial;
}
</style>