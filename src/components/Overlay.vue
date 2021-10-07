<template>
  <div class="nge-overlay" @click.stop @mousedown.stop>
    <slot></slot>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";

export default defineComponent({
});
</script>

<style>
.nge-overlay {
  pointer-events: initial;
}
</style>