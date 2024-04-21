import "neuroglancer";
import { setupDefaultViewer } from "neuroglancer/unstable/ui/default_viewer_setup.js";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "#src/components/App.vue";
import { useLayersStore } from "#src/store.js";
import { LightBulbService, liveNeuroglancerInjection } from '#src/widgets/lightbulb_service.js';

function mergeTopBars() {
  const ngTopBar = document.querySelector(".neuroglancer-viewer")!.children[0];
  const topBarVueParent = document.getElementById("insertNGTopBar")!;
  topBarVueParent.appendChild(ngTopBar);
}

window.addEventListener("DOMContentLoaded", () => {
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  const { initializeWithViewer } = useLayersStore();
  app.directive("visible", function (el, binding) {
    el.style.visibility = !!binding.value ? "visible" : "hidden";
  });
  app.mount("#app");
  const viewer = setupDefaultViewer();
  initializeWithViewer(viewer);
  mergeTopBars();

  const lightbulb : LightBulbService = new LightBulbService();
  liveNeuroglancerInjection(lightbulb);
});
