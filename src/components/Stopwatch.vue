<template>
  <div class="nge-stopwatch">
    <img class="nge-stopwatch-icon" src="images/stopwatch.svg" width="20" title="Stopwatch" />
    <div class="nge-stopwatch-time">{{getTime()}}</div>
    <div class="nge-stopwatch-controls">
      <button class="nge-stopwatch-button" @click="toggleRunning()">{{running ? "Stop" : "Start"}}</button>
      <button class="nge-stopwatch-button" @click="reset()">Reset</button>
    </div>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import { storeProxy } from "../state";

export default defineComponent({
  data: () => {
    return {
      appState: storeProxy,
      running: false,
      secondsElapsed: 0,
      timeout: -1
    };
  },
  methods: {
    toggleRunning() {
      this.running = !this.running;
      if (this.running) {
        this.timeout = setTimeout(this.updateTime, 1000);
      } else {
        clearTimeout(this.timeout);
      }
    },
    reset() {
      this.secondsElapsed = 0;
      if (this.running) {
        this.toggleRunning();
      }
    },
    getTime(): string {
      const seconds = this.secondsElapsed % 60;
      const minutesElapsed = Math.floor(this.secondsElapsed / 60);
      const minutes = minutesElapsed % 60;
      const hoursElapsed = Math.floor(minutesElapsed / 60);
      const hours = hoursElapsed;
      return (
        (hours > 0 ? hours + ":" : "") +
        this.formatTime(minutes) +
        ":" +
        this.formatTime(seconds)
      );
    },
    formatTime(t: number): string {
      if (t < 10) {
        return "0" + t;
      }
      return t.toString();
    },
    updateTime() {
      this.secondsElapsed++;
      this.timeout = setTimeout(this.updateTime, 1000);
    }
  }
});
</script>

<style>
.nge-stopwatch {
  height: 100%;
}

.nge-stopwatch-time {
  padding: 0 8px;
}

.nge-stopwatch-controls {
  height: 100%;
}

.nge-stopwatch .nge-stopwatch-controls button {
  height: 100%;
  padding: 0 8px;
}
</style>