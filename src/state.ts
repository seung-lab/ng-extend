import { createModule, action, createProxy, extractVuexModule } from "vuex-class-component";
import { authFetch, authTokenShared } from "neuroglancer/authentication/frontend";

interface LoggedInUser {
  name: string;
  email: string;
}

class AppStore extends createModule({strict: false}) {
  loggedInUser: LoggedInUser|null = null;

  @action async fetchLoggedInUser() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      let res = await authFetch(`https://${existingAuthURL}/user/me`);
      let user = await res.json();
      let {name, email} = user;
      this.loggedInUser = {name, email};
    } else {
      this.loggedInUser = null; // TODO - do I need this?
    }
  }

  @action async logout() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      await authFetch(`https://${existingAuthURL}/logout`).then(res => {
        return res.json();
      });

      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_url");

      authTokenShared!.value = null;

      this.loggedInUser = null;
    }
  }
}

import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(Vuex);

export const store = new Vuex.Store({
  modules: {
    ...extractVuexModule(AppStore)
  },
});

export const storeProxy = createProxy(store, AppStore);
export {Vue}; // vue app needs to be instantiated from this modified VueConstructor
