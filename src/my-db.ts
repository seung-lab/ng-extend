import {ref} from 'vue';
import {defineStore} from 'pinia';
import {authFetch} from './request';

export const useLoginStore = defineStore('login', () => {
  const localStorageKeys: string[] = [];

  async function update() {
    console.log('update');
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("auth_token_v2_")) {
        localStorageKeys.push(key)
      }
    }

    if (localStorageKeys.length) {
        // todo for now just use the first token, advanced mode show all, default mode make an intelligent choice based on the layers?
        const dataString = localStorage.getItem(localStorageKeys[1]);
        if (!dataString) { return; }
        const data = JSON.parse(dataString);
        console.log(data);

        const res = await authFetch(data.url + '/api/v1/user/me', data.accessToken);

        if (res) {
          username.value = res.name;
        }

        console.log("res", res);

    }
  }

  const username = ref('unknown');

  return {username, update};
});
