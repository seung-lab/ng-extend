import {store, Vue} from "./state";
import App from 'components/App.vue';

export function setupVueApp() {
  Vue.directive('visible', function(el, binding) {
    el.style.visibility = !!binding.value ? 'visible' : 'hidden';
  });

  const app = new Vue({
    store,
    render: h => h(App),
  });
  
  app.$mount('#vueApp');

  return app;
}
