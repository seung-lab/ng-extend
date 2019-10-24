<template>
  <div v-if="loggedInUser" id="loggedInUserBar">
    <div>{{ loggedInUser.name }} ({{ loggedInUser.email }})</div>
    <button @click="logout">Logout</button>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import {authTokenShared, authFetch} from "neuroglancer/authentication/frontend";

interface LoggedInUser {
  name: string;
  email: string;
}

interface VueData {
  loggedInUser: LoggedInUser | null;
}

export default Vue.extend({
  data(): VueData {
    return {
      loggedInUser: null
    };
  },
  mounted() {
    this.$root.$on("ng-viewer-loaded", () => {
      this.init();
    });
  },
  methods: {
    tryGettingUser() {
      const existingToken = localStorage.getItem("auth_token");
      const existingAuthURL = localStorage.getItem("auth_url");

      if (existingToken && existingAuthURL) {
        authFetch(`https://${existingAuthURL}/user/me`)
          .then(res => {
            return res.json();
          })
          .then(res => {
            this.loggedInUser = {
              name: res.name,
              email: res.email
            };
          });
      } else {
        this.loggedInUser = null;
      }
    },
    init() {
      authTokenShared!.changed.add(() => {
        this.tryGettingUser();
      });
      this.tryGettingUser();
    },
    logout: async () => {
      const existingToken = localStorage.getItem("auth_token");
      const existingAuthURL = localStorage.getItem("auth_url");

      if (existingToken && existingAuthURL) {
        await authFetch(`https://${existingAuthURL}/logout`).then(res => {
          return res.json();
        });

        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_url");

        authTokenShared!.value = null;
      }
    }
  }
});
</script>

<style>
@import "../common.css";

#loggedInUserBar {
  background: var(--color-dark-bg);
  color: var(--color-small-text);
  display: flex;
  justify-content: flex-end;
}

#loggedInUserBar > button {
  margin-left: 10px;
}
</style>