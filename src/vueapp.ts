import {store, Vue} from "./state";
import App from 'components/App.vue';

export function setupVueApp() {
  const app = new Vue({
    store,
    render: h => h(App),
  });
  
  app.$mount('#vueApp');
}
