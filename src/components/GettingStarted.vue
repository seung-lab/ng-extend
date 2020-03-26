<template>
  <div class="nge-getting-started">
    <div class="nge-gs-title">Getting Started</div>
    <div class="nge-gs-links">
      <div class="nge-gs-link">
        <a href="https://www.youtube.com/watch?v=oHg5SJYRHA0" target="_blank">Welcome video</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://www.youtube.com/watch?v=R1LtZb9ZlWQ" target="_blank">Cheatsheet</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://drive.google.com/drive/u/0/folders/1SwWatyE-GLLhJrRIIuRqPBhLh5uf5C3x" target="_blank">Self-guided training</a>
      </div>
      <div class="nge-gs-link">
        <a href="https://docs.google.com/document/d/1FvEtMnAHenufDtCqKdi2DAyPyX9IzWkW9P2H31WxkMo/edit" target="_blank">FAQ</a>
      </div>
      <div class="nge-gs-link">
        <a href="http://flywire-forum.slack.com/" target="_blank">Slack Forum</a>
      </div>
      <div class="nge-gs-link">
        <a href="mailto:flywire@princeton.edu">Email us</a>
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
  background-color: black;
}
.nge-gs-title {
  text-align: center;
  font-size: 1.3em;
  padding-top: 0.75em;
  padding-bottom: 0.75em;
}
.nge-gs-links {
  padding-left: 1em;
}
.nge-gs-link {
  padding-bottom: 1em;
}
.nge-gs-link > a {
  color: white;
}
</style>
