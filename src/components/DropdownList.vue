<template>
  <div>
    <button @click="visible=!visible"><slot name="buttonTitle">Button</slot></button>
      <ul v-visible="visible" class="dropdownMenu">
        <slot name="listItems"></slot>
      </ul>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
  data() {
    return {
      visible: false,
      offRight: false,
    }
  },
  mounted() {
    console.log('mounted!');
    document.body.addEventListener('mousedown', () => {
      console.log('mousedown!');
    });

    document.getElementById('neuroglancerViewer')!.addEventListener('mousedown', () => {
      console.log('mousedown ngc');
    });
  },
  watch: {
    visible: function (isVisible) {
      if (isVisible)  {
        const dropdownEl = this.$el.querySelector('.dropdownMenu')!;

        const rect = dropdownEl.getBoundingClientRect();

        this.offRight = rect.right > window.innerWidth;
      }
    }
  }
});
</script>

<style>
.hideDropdown {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  /* pointer-events: none; */
}


.dropdownMenu {
  position: absolute;
  top: 30px;
  background-color: green;
}

.dropdownMenu > li > button {
  padding: 16px 26px;
  width: 100%;
}

.dropdownGroup > button {
  height: 100%;
}

#extensionBar > .dropdownGroup > button {
  padding: 0 16px;
}
</style>
