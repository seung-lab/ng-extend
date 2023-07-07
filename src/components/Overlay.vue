<script setup lang="ts">
</script>

<template>
  <div class="nge-overlay" @click.stop @mousedown.stop>
    <slot></slot>
  </div>
</template>

<style>
.nge-overlay {
  pointer-events: initial;
}
</style>