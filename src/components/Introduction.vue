<template>
  <div class="introductionStep" v-if="activeStep">
    <div v-if="activeStep.modal" class="nge-overlay-blocker" @mousedown.stop.prevent></div>
    <div class="ng-extend introductionStepAnchor" :class="activeStep.cssClass" :style="{left: activeStep.left, top: activeStep.top}">
      <div class="arrow"></div>
      <div class="chip" :class="{modal: activeStep.modal}" :style="chipBounds">
        <div class="title" v-if="activeStep.title">{{ activeStep.title }}</div>
        <div class="text" v-if="activeStep.text">{{ activeStep.text }}</div>
        <div class="html" v-if="activeStep.html" v-html="activeStep.html"></div>
        <div class="buttonContainer">
          <button v-if="!activeStep.first" @click="back">back</button>
          <button v-if="activeStep.last" @click="close">done</button>
          <button v-else @click="close">next</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { storeProxy } from "../state";

interface ElementPostition {
  element: string,
  side: 'top'|'left'|'bottom'|'right',
  offset?: {x: number, y: number},
}

interface Step {
  title?: string,
  text?: string,
  html?: string,
  position: ElementPostition | 'center',
  modal?: boolean,
}

interface ComputedStep {
  index: number,
  first: boolean,
  last: boolean,
  title?: string,
  text?: string,
  html?: string,
  left: string,
  top: string,
  cssClass?: string,
  windowWidth: number, // for forcing re-computation on window resize
  windowHeight: number,
  modal: boolean,
}

const steps: Step[] = [
  {
    html: `<iframe width='640' height='360'
      src="https://www.youtube-nocookie.com/embed/eHUPaGvx4Ng?rel=0"
      frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
    position: 'center',
    modal: true,
  },
  {
    title: "Welcome",
    text: "Check out the Quick Start guide",
    position: {
      element: '.nge-gs-link:nth-child(2)',
      side: 'right',
      offset: {x: -25, y: 0},
    }
  },
];

export default Vue.extend({
  data: () => {
    return {
      chipBounds: {top: 'auto', left: 'auto'},
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    }
  },
  mounted() {
    window.addEventListener('resize', () => {
      this.chipBounds = {top: 'auto', left: 'auto'};
      this.windowWidth = window.innerWidth;
      this.windowHeight = window.innerHeight;
    });
  },
  computed: {
    activeStep(): ComputedStep|undefined {
      if (steps.length > storeProxy.introductionStep) {
        const step = steps[storeProxy.introductionStep];

        let left = '';
        let top = '';
        let cssClass = undefined;

        if (step.position === 'center') {
          cssClass = 'center';
          left = '50%';
          top = '50%';
        } else {
          const element = document.querySelector(step.position.element);

          if (element) {
            cssClass = step.position.side;
            const rect = element.getBoundingClientRect();

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
          }
        }

        this.chipBounds = {top: 'auto', left: 'auto'};

        this.$nextTick(function () {
          const el = document.querySelector('.chip');
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
        
        return {
          first: storeProxy.introductionStep === 0,
          last: storeProxy.introductionStep === steps.length - 1,
          index: storeProxy.introductionStep,
          title: step.title,
          text: step.text,
          html: step.html,
          left,
          top,
          cssClass,
          windowWidth: this.windowWidth,
          windowHeight: this.windowHeight,
          modal: step.modal || false,
        }
      }
      return undefined;
    },
  },
  methods: {
      close() {
          storeProxy.introductionStep++;
      },
      back() {
          storeProxy.introductionStep = Math.max(0, storeProxy.introductionStep - 1);
      }
  },
});
</script>

<style>

.introductionStep .nge-overlay-blocker {
  z-index: 89 !important;
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

.introductionStepAnchor {
  position: absolute;
  z-index: 90;
}

.chip {
  position: absolute;
  width: max-content;
  background-color: var(--color-flywire-dark-green);
  color: var(--color-small-text);
  padding: 20px;
  border-radius: 10px;
  display: grid;
  justify-items: center;
  font-size: 14px;
  grid-row-gap: 10px;
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

.ng-extend .chip .buttonContainer {
  display: grid;
  grid-auto-flow: column;
  column-gap: 10px;
}

.ng-extend .chip button {
  border-radius: 999px;
  border: 1px solid var(--color-small-text);
  text-transform: uppercase;
  padding: 2px 16px;
}

.ng-extend .chip button:hover {
  background-color: rgba(255, 255, 255, 0.25);
}

</style>