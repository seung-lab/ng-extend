<template>
  <div class="introductionStep" :class="{hasVideo: computedStep.video !== undefined}">
    <div v-if="computedStep.modal" class="nge-overlay-blocker" @mousedown.stop.prevent></div>
    <div class="ng-extend introductionStepAnchor" :class="computedStep.cssClass" :style="{left: computedStep.left, top: computedStep.top}">
      <div class="arrow"></div>

      <div v-if="!inExitConfirm" class="chip" :class="{modal: computedStep.modal}" :style="chipBounds">
        <button class="exit" @click="inExitConfirm = true">×</button>
        <div class="title" v-if="computedStep.title">{{ computedStep.title }}</div>
        <video v-if="computedStep.video" width="350" height="242.81" autoplay loop muted playsinline :src="computedStep.video"></video>
        <div class="text" v-if="computedStep.text">{{ computedStep.text }}</div>
        <div class="html" v-if="computedStep.html" v-html="computedStep.html"></div>
        <div class="buttonContainer">
          <button v-if="!computedStep.first" @click="back" class="back">back</button>
          <button v-if="computedStep.last" @click="next" class="next">done</button>
          <button v-else @click="next" class="next">next</button>
        </div>
      </div>

      <div v-if="inExitConfirm" class="chip exitConfirm"  :class="{modal: computedStep.modal}" :style="chipBounds">
        <div>Do you want to exit the tutorial?</div>
        <div class="buttonContainer">
          <button @click="inExitConfirm = false" class="next">No</button>
          <button @click="exitIntro" class="next">Yes</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy } from "../state";
import { Step, isNextToElementPostition } from "../introduction-steps";

interface ComputedStep {
  first: boolean,
  last: boolean,
  title?: string,
  text?: string,
  html?: string,
  video?: string,
  left: string,
  top: string,
  cssClass?: string,
  modal: boolean,
  videoCache?: HTMLVideoElement,
}

export default Vue.extend({
  props: {
    step: Object as () => Step,
    first: Boolean,
    last: Boolean,
    index: Number,
  },
  data: () => {
    return {
      appState: storeProxy,
      chipBounds: {top: 'auto', left: 'auto', 'width': 'inherit'},
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      videoReady: false,
      computedStep: {} as ComputedStep,
      inExitConfirm: false,
    }
  },
  created() {
    this.updateChipPosition();
  },
  mounted() {
    window.addEventListener('resize', () => {
      this.chipBounds = {top: 'auto', left: 'auto', 'width': 'auto'};
      this.updateChipPosition();
    });
  },
  methods: {
    updateChipPosition() {
      const step = this.step;

      let left = '';
      let top = '';
      let cssClass = undefined;

      const element = document.querySelector(step.position.element);
      if (element) {
        const rect = element.getBoundingClientRect();

        if (isNextToElementPostition(step.position)) {
          cssClass = step.position.side;

          const {x: xOff, y: yOff} = step.position.offset || {x: 0, y: 0};

          if (step.position.side === 'right') {
            left = `${rect.right + xOff}px`;
            top = `${rect.top + rect.height / 2 + yOff}px`;
          } else if (step.position.side === 'left') {
            left = `${rect.left + xOff}px`;
            top = `${rect.top + rect.height / 2 + yOff}px`;
          } else if (step.position.side === 'bottom') {
            left = `${rect.left + rect.width / 2 + xOff}px`;
            top = `${rect.bottom + yOff}px`;
          }
        } else {
          cssClass = 'center';
          left = `${step.position.x * rect.width + rect.left}px`;
          top = `${step.position.y * rect.height + rect.top}px`;
        }
      }
      else {
        this.next();
      }

      this.chipBounds = {top: 'auto', left: 'auto', 'width': 'inherit'};

      if (!step.modal) {
        this.chipBounds['width'] = '350px';
      }

      this.computedStep = {
        first: this.first,
        last: this.last,
        title: step.title,
        video: step.video,
        text: step.text,
        html: step.html,
        left,
        top,
        cssClass,
        modal: step.modal || false,
      }

      this.$nextTick(function () {
        const el = this.$el.querySelector('.chip');
        if (el) {
          const rect = el.getBoundingClientRect();

          function clamp(val: number, min: number, max: number) {
            return Math.max(min, Math.min(max, val));
          }

          function clampWidth(val: number) {
            const buffer = rect.width / 2 - (12 + 10); // half triangle width + border radius
            return clamp(val, -buffer, buffer);
          }

          function clampHeight(val: number) {
            const buffer = rect.height / 2 - (12 + 10); // half triangle width + border radius
            return clamp(val, -buffer, buffer);
          }

          if (rect.top < 0) {
            this.chipBounds.top = `${-rect.top}px`;
          }
          if (rect.left < 0) {
            this.chipBounds.left = `${-rect.left}px`;
          }
          if (rect.right > window.innerWidth) {
            this.chipBounds.left = `${clampWidth(window.innerWidth - rect.right)}px`;
          }
          if (rect.bottom > window.innerHeight) {
            this.chipBounds.top = `${clampHeight(window.innerHeight - rect.bottom)}px`;
          }
        }
      });
    },
    next() {
      this.$emit('next');
    },
    back() {
      this.$emit('back');
    },
    exitIntro() {
      this.$emit('exitIntro');
    }
  },
});
</script>

<style scoped>
.nge-overlay-blocker {
  z-index: inherit;
}

.introductionStepAnchor {
  position: absolute;
  z-index: 90;
  filter: drop-shadow(0 8px 4px rgba(0,0,0,0.25));
}

.introductionStepAnchor.left > *, .introductionStepAnchor.right > * {
  transform: translate(0, -50%);
}

.introductionStepAnchor.top > *, .introductionStepAnchor.bottom > * {
  transform: translate(-50%, 0);
}

.introductionStepAnchor.center > * {
  transform: translate(-50%, -50%);
}

.introductionStepAnchor .arrow {
  position: absolute;
  border: 12px solid transparent;
  filter: drop-shadow(0 0px 8px rgba(0,0,0,1));
}

.introductionStepAnchor.right .arrow {
  border-right: 12px solid var(--color-flywire-dark-green);
  right: -12px;
}

.introductionStepAnchor.right .chip {
    left: 12px !important;
}

.introductionStepAnchor.bottom .arrow {
  border-bottom: 12px solid var(--color-flywire-dark-green);
  bottom: -12px;
}

.introductionStepAnchor.bottom .chip {
  top: 12px !important;
}

.chip {
  position: absolute;
  width: max-content;
  background-color: var(--color-flywire-dark-green);
  color: var(--color-small-text);
  padding: 30px;
  padding-bottom: 20px;
  border-radius: 4px;
  display: grid;
  justify-items: center;
  font-size: 16px;
  font-weight: 300;
  grid-row-gap: 15px;
}

.hasVideo .chip:not(.exitConfirm) {
  padding: 8px 8px 20px 8px;
}

.chip.modal {
  padding-top: 0;
  padding-left: 0;
  padding-right: 0;
  overflow: hidden;
}

.chip .title {
  font-size: 22px;
}

.chip video {
  width: 100%;
}

.ng-extend .chip .buttonContainer {
  display: grid;
  position: relative;
  width: 100%;
  align-items: center;
}

.ng-extend .chip.exitConfirm .buttonContainer {
  width: auto;
  grid-auto-flow: column;
  grid-column-gap: 10px;
}

.ng-extend .chip .buttonContainer button {
  text-transform: uppercase;
}

.ng-extend .chip button.next {
  justify-self: center;
  border-radius: 999px;
  border: 1px solid var(--color-small-text);
  padding: 2px 16px;
}

.ng-extend .chip button.back {
  position: absolute;
  text-transform: uppercase;
  font-style: italic;
  font-size: 14px;
  opacity: 0.5;
}

.ng-extend .chip button.back:hover {
  background: none;
  opacity: 1;
}

.ng-extend .chip button.exit {
  position: absolute;
  right: 0;
  border: none;
  padding: 0;
  opacity: 0.75;
  transition: opacity 0.2s;
  font-size: 22px;
  line-height: 22px;
  font-weight: 300;
  width: 22px;
  margin: 6px 6px 0 0;
  z-index: 1;
}

.ng-extend .chip button.exit:hover {
  background-color: initial;
  opacity: 1;
}

.ng-extend .chip button:hover {
  background-color: rgba(255, 255, 255, 0.25);
}

</style>