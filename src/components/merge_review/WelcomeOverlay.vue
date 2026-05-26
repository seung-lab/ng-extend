<script setup lang="ts">
import { useImport } from "#src/merge_review/useImport.js";

const { importBundle, importDecisions } = useImport();
</script>

<template>
  <div id="welcome-overlay">
    <div class="card">
      <h2>MERGER FREE</h2>
      <p>
        <button class="link-btn primary" @click="importBundle">
          ↑ Import bundle JSON
        </button>
        &nbsp;Pick the per-neuron JSON your admin sent you to start.
      </p>
      <p>
        <button class="link-btn" @click="importDecisions">
          ↑ Import prior decisions
        </button>
        &nbsp;if you had reviewed this neuron earlier.
      </p>
      <p>
        Welcome. This is a research demo of an auto-proofreading system
        developed by <b>Fuming Yang</b> and <b>Sven Dorkenwald</b>.
        Inference is performed end-to-end on a complete neuron from the
        MICrONS dataset in a single pass (~45 seconds). Ground-truth merge
        regions are pre-marked in a separate colour to aid comparison, but
        please note that this annotation is <b>not exhaustive</b> — regions
        outside the GT may still contain genuine merges, so please
        cross-reference the underlying EM imagery and the segmentation when
        making your judgement rather than relying on the GT colour alone.
      </p>
      <p>
        Reviewers step through the suspect windows in the Decision panel and
        answer two questions per window:
      </p>
      <ol class="welcome-questions">
        <li>
          <b>Real merge?</b> — does this location actually contain a merge
          error in the underlying segmentation?
        </li>
        <li>
          <b>SPLIT WHICH?</b> — pick which colored token clusters in the EM
          viewer should actually be split off. Multi-select: click each
          cluster button to toggle it on/off. Pick <b>Skip</b> to defer the
          decision.
        </li>
      </ol>
      <p>
        For each suspect window, the system has already partitioned its
        tokens into one or more colored clusters (visible as soft ellipsoid
        blobs in the EM view). Your job: decide which of those clusters
        genuinely need to be split off as separate segments. Decisions
        persist in your browser's local storage and can be downloaded as
        JSON via <b>Export decisions</b> when you are finished. We greatly
        appreciate your contribution!
      </p>
      <p class="dim">
        <b>Keyboard:</b>
        <kbd>Y</kbd>/<kbd>N</kbd>/<kbd>S</kbd>/<kbd>U</kbd> — Real merge?;
        <kbd>1</kbd>–<kbd>4</kbd> — toggle that-numbered cluster (in SPLIT
        WHICH); <kbd>0</kbd> — toggle Skip; <kbd>→</kbd>/<kbd>Enter</kbd> —
        next undecided; <kbd>←</kbd> — step back one window;
        <kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>j</kbd>/<kbd>k</kbd> — adjacent
        navigation.
      </p>
    </div>
  </div>
</template>
