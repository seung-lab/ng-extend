Based on https://github.com/google/neuroglancer/tree/master/examples/dependent-project
but using git submodule instead of npm because of https://github.com/google/neuroglancer/issues/172

Installation Instructions

```console
$ git submodule init && git submodule update
$ npm i
$ cd third_party/neuroglancer/ && npm i && cd ../..
$ npm run dev-server
```
