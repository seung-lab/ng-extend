import {createApp, defineComponent} from 'vue';
import {store} from "./state";
import App from 'components/App.vue';
/*const App = defineComponent({
  components: {},
  data: () => {
    return {
      greeting: "hello",
    }
  }
});*/

export function setupVueApp() {
  const app = createApp(App);

  app.directive('visible', {
    beforeMount(el, binding) {
      el.style.visibility = !!binding.value ? 'visible' : 'hidden';
    }
  });

  app.use(store);

  app.mount('#vueApp');

  return app;
}
