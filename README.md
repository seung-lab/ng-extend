Based on https://github.com/google/neuroglancer/tree/master/examples/dependent-project
but using git submodule instead of npm because of https://github.com/google/neuroglancer/issues/172

Installation Instructions

```console
$ npm i
$ npm run dev-server
```

Run on Windows: (Make sure neuroglancer symlink is setup properly https://stackoverflow.com/questions/5917249/git-symbolic-links-in-windows )

```console
$ npm i
$ node ./node_modules/neuroglancer/config/esbuild-cli.js --define "CONFIG=$(cat 'config/ng-extend.txt')" --define "STATE_SERVERS=$(cat 'config/state_servers.txt')" --define "CUSTOM_BINDINGS=$(cat 'config/custom-keybinds.txt')" --config=dev --serve --watch
```