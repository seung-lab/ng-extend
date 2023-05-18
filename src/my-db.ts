import {Ref, ref} from 'vue';
import {defineStore} from 'pinia';
import {authFetch} from './request';

export const useDropdownListStore = defineStore('dropdownlist', () => {
  let dropdownCount = 0;

  function getDropdownId() {
    dropdownCount++;
    return dropdownCount;
  }

  return {getDropdownId};
});

/*
{
    "admin": true,
    "admin_datasets": [],
    "affiliations": [
        []
    ],
    "created": "Mon, 19 Jul 2021 23:05:56 GMT",
    "email": "chris@eyewire.org",
    "gdpr_consent": true,
    "id": 1,
    "name": "chrisj",
    "pi": "Sebastian Seung Lab",
    "service_account": false
}
*/

export interface loginSession {
  name: string,
  email: string,
  url: string,
}

export const useLoginStore = defineStore('login', () => {
  const localStorageKeys: string[] = [];

  async function update() {
    console.log('update');
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("auth_token_v2_")) {
        localStorageKeys.push(key)
      }
    }

    const newSessions: loginSession[] = [];

    for (const key of localStorageKeys) {
      const dataString = localStorage.getItem(key);
      if (!dataString) { return; }
      const data = JSON.parse(dataString);
      try {
        const res = await authFetch(data.url + '/api/v1/user/me', data.accessToken);
        newSessions.push({
          name: res.name,
          email: res.email,
          url: data.url,
        });
      } catch (e) {
        newSessions.push({
          name: 'n/a',
          email: 'n/a',
          url: data.url,
        });
      }
    }

    sessions.value = newSessions;


    // if (localStorageKeys.length) {
    //     // todo for now just use the first token, advanced mode show all, default mode make an intelligent choice based on the layers?
    //     const dataString = localStorage.getItem(localStorageKeys[1]);
    //     if (!dataString) { return; }
    //     const data = JSON.parse(dataString);
    //     console.log(data);

    //     const res = await authFetch(data.url + '/api/v1/user/me', data.accessToken);

    //     if (res) {
    //       username.value = res.name;
    //     }

    //     console.log("res", res);

    // }
  }

  const sessions: Ref<loginSession[]> = ref([]);

  // const username: Ref<string|undefined> = ref(undefined);

  return {sessions, update};
});
