<template>
  <div class="nge-getting-started">
    <div class="nge-gs-title">
      <a href="https://flywire.ai/" target="_blank">FlyWire</a>
    </div>
    <div class="nge-gs-links">
      <div class="nge-gs-link">
        <a href="https://www.youtube.com/watch?v=oHg5SJYRHA0" target="_blank">Welcome video</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1tjy6axXvxVcfvrYiBbJsLTSx1Y3rTGI_HcXKETIqyiM/edit" target="_blank">Cheatsheet</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://drive.google.com/drive/u/0/folders/1SwWatyE-GLLhJrRIIuRqPBhLh5uf5C3x" target="_blank">Self-guided training</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://join.slack.com/t/flywire-forum/shared_invite/zt-d6pyjonk-uC7_kjcjU~8c64t~Qid~oQ" target="_blank">Slack Forum</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://flywire.ai/support.html" target="_blank">Support</a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";

export default Vue.extend({
});
</script>

<style>
.nge-getting-started {
  background-color: #111;
}
.nge-gs-title {
  text-align: center;
  font-size: 1.3em;
  padding-top: 0.75em;
  padding-bottom: 0.75em;
}
.nge-gs-title > a {
  color: #fff;
}
.nge-gs-links {
  padding-left: 1em;
}
.nge-gs-link {
  padding-bottom: 1em;
}
.nge-gs-link > a {
  color: #fff;
}
</style>
