import {createApp} from 'vue';
import {createPinia} from 'pinia';

import 'neuroglancer/ui/default_viewer.css';

import App from 'components/App.vue';
import {useLayersStore} from 'src/store';
// import {setupDefaultViewer} from 'third_party/neuroglancer/ui/default_viewer_setup';
import { liveNeuroglancerInjection, setupExtendedViewer } from './ExtendedViewerMain';

function mergeTopBars() {
  const ngTopBar = document.querySelector('.neuroglancer-viewer')!.children[0];
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  topBarVueParent.appendChild(ngTopBar);
}

window.addEventListener('DOMContentLoaded', () => {
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  const {initializeWithViewer} = useLayersStore();
  app.directive('visible', function(el, binding) {
    el.style.visibility = !!binding.value ? 'visible' : 'hidden';
  });
  app.mount('#app');
  // const viewer = setupDefaultViewer(); //use for regular viewer
  const viewer = setupExtendedViewer();
  initializeWithViewer(viewer);
  mergeTopBars();

  //added to use exteded viewer features
  liveNeuroglancerInjection();
});

