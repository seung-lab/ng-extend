<script setup lang="ts">
/**
 * NeuronGlyph.vue — the fluorescent pyramidal neuron from the login box's
 * Identity Verification icon, extracted for reuse (filter/gradient ids are
 * mw-prefixed so both can be in the DOM at once). Used by the mobile
 * welcome sheet's spinnable cell (Amy 2026-08-25).
 */
</script>

<template>
    <svg viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg" class="nge-glyph-svg">
    <defs>
      <!-- Fluorescence glow filter -->
      <filter id="mwNeuronGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur1"/>
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur2"/>
        <feMerge>
          <feMergeNode in="blur2"/>
          <feMergeNode in="blur1"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <!-- Bright soma glow — animated pulse -->
      <filter id="mwSomaGlow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur1">
          <animate attributeName="stdDeviation" values="4;6;4" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
        </feGaussianBlur>
        <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur2">
          <animate attributeName="stdDeviation" values="8;14;8" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
        </feGaussianBlur>
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur3">
          <animate attributeName="stdDeviation" values="2;5;2" dur="4.7s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"/>
        </feGaussianBlur>
        <feMerge>
          <feMergeNode in="blur3"/>
          <feMergeNode in="blur2"/>
          <feMergeNode in="blur1"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <radialGradient id="mwSomaGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#80f0ff" stop-opacity="1"/>
        <stop offset="40%" stop-color="#20d0ff" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#00a0e0" stop-opacity="0.3"/>
      </radialGradient>
    </defs>

    <g filter="url(#mwNeuronGlow)">
      <!-- ═══ APICAL DENDRITE (main trunk going up) ═══ -->
      <path d="M60 52 L59 42 L57 32 L55 22 L52 12 L49 4"
        stroke="#18cfff" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>
      <!-- Apical branch right -->
      <path d="M57 32 L62 26 L68 20 L76 16 L84 13"
        stroke="#15c8f8" stroke-width="1.4" stroke-linecap="round" opacity="0.75"/>
      <path d="M68 20 L72 14 L78 8"
        stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>
      <path d="M76 16 L82 20 L88 18"
        stroke="#10b8e8" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
      <!-- Apical branch left -->
      <path d="M55 22 L48 16 L40 12 L32 10"
        stroke="#15c8f8" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/>
      <path d="M48 16 L44 10 L38 5"
        stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" opacity="0.5"/>
      <path d="M40 12 L36 16 L30 15"
        stroke="#10b8e8" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
      <!-- Apical tuft (top branches) -->
      <path d="M52 12 L46 6 L40 2"
        stroke="#12c0f0" stroke-width="1.0" stroke-linecap="round" opacity="0.6"/>
      <path d="M49 4 L44 1" stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
      <path d="M49 4 L52 1" stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
      <!-- More apical sub-branches -->
      <path d="M59 42 L66 38 L74 36 L80 33"
        stroke="#15c8f8" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
      <path d="M74 36 L78 40 L84 42"
        stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
      <path d="M59 42 L52 38 L44 36"
        stroke="#15c8f8" stroke-width="1.0" stroke-linecap="round" opacity="0.55"/>
      <path d="M44 36 L38 32 L32 30"
        stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>

      <!-- ═══ BASAL DENDRITES (spreading from soma) ═══ -->
      <!-- Basal left-down -->
      <path d="M54 60 L44 66 L34 74 L26 82 L20 90"
        stroke="#18cfff" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>
      <path d="M34 74 L28 70 L20 66 L14 62"
        stroke="#12c0f0" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
      <path d="M20 66 L16 72 L10 74"
        stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
      <path d="M26 82 L18 80 L12 76"
        stroke="#0ab0e0" stroke-width="0.8" stroke-linecap="round" opacity="0.45"/>
      <path d="M20 90 L14 94 L8 96"
        stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
      <path d="M20 90 L22 96 L20 102"
        stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
      <!-- Basal left-up -->
      <path d="M52 56 L42 50 L32 48 L22 50"
        stroke="#15c8f8" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
      <path d="M32 48 L26 42 L20 38"
        stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.5"/>
      <path d="M22 50 L16 54 L10 56"
        stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
      <!-- Basal right-down -->
      <path d="M66 60 L76 66 L86 74 L94 82 L100 90"
        stroke="#18cfff" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>
      <path d="M86 74 L92 70 L100 66 L106 62"
        stroke="#12c0f0" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
      <path d="M100 66 L104 72 L110 74"
        stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.4"/>
      <path d="M94 82 L102 80 L108 76"
        stroke="#0ab0e0" stroke-width="0.8" stroke-linecap="round" opacity="0.45"/>
      <path d="M100 90 L106 94 L112 96"
        stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
      <path d="M100 90 L98 96 L100 102"
        stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
      <!-- Basal right-up -->
      <path d="M68 56 L78 50 L88 48 L98 50"
        stroke="#15c8f8" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
      <path d="M88 48 L94 42 L100 38"
        stroke="#10b8e8" stroke-width="0.9" stroke-linecap="round" opacity="0.5"/>
      <path d="M98 50 L104 54 L110 56"
        stroke="#0ab0e0" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>
      <!-- Basal down-center -->
      <path d="M58 64 L52 76 L48 88 L44 98"
        stroke="#15c8f8" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>
      <path d="M48 88 L40 92 L34 90"
        stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.35"/>
      <path d="M62 64 L68 76 L72 88 L76 98"
        stroke="#15c8f8" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>
      <path d="M72 88 L80 92 L86 90"
        stroke="#0ab0e0" stroke-width="0.7" stroke-linecap="round" opacity="0.35"/>

      <!-- ═══ AXON (going down from soma) ═══ -->
      <path d="M60 64 L60 78 L58 92 L56 106 L54 118 L52 130 L50 138"
        stroke="#18cfff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
      <!-- Axon collaterals -->
      <path d="M58 92 L50 98 L42 100"
        stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" opacity="0.4"/>
      <path d="M56 106 L64 112 L72 114"
        stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" opacity="0.4"/>
      <path d="M54 118 L46 122 L38 120"
        stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" opacity="0.3"/>
      <!-- Axon terminals -->
      <path d="M50 138 L44 140" stroke="#08a0d0" stroke-width="0.5" stroke-linecap="round" opacity="0.25"/>
      <path d="M50 138 L56 140" stroke="#08a0d0" stroke-width="0.5" stroke-linecap="round" opacity="0.25"/>

      <!-- ═══ DENDRITIC SPINES (tiny dots along branches) ═══ -->
      <circle cx="57" cy="32" r="0.6" fill="#40e0ff" opacity="0.6"/>
      <circle cx="52" cy="14" r="0.5" fill="#40e0ff" opacity="0.5"/>
      <circle cx="66" cy="24" r="0.5" fill="#40e0ff" opacity="0.5"/>
      <circle cx="44" cy="68" r="0.5" fill="#40e0ff" opacity="0.5"/>
      <circle cx="36" cy="74" r="0.5" fill="#40e0ff" opacity="0.5"/>
      <circle cx="76" cy="68" r="0.5" fill="#40e0ff" opacity="0.5"/>
      <circle cx="86" cy="74" r="0.5" fill="#40e0ff" opacity="0.5"/>
      <circle cx="48" cy="50" r="0.4" fill="#40e0ff" opacity="0.45"/>
      <circle cx="78" cy="50" r="0.4" fill="#40e0ff" opacity="0.45"/>
      <circle cx="28" cy="72" r="0.4" fill="#40e0ff" opacity="0.4"/>
      <circle cx="92" cy="72" r="0.4" fill="#40e0ff" opacity="0.4"/>
    </g>

    <!-- ═══ SOMA (bright glowing cell body — alive!) ═══ -->
    <g filter="url(#mwSomaGlow)">
      <!-- Outer soma membrane — gentle size breathe -->
      <ellipse cx="60" cy="58" rx="7" ry="6" fill="url(#mwSomaGrad)">
        <animate attributeName="rx" values="7;7.8;7" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
        <animate attributeName="ry" values="6;6.7;6" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>
      </ellipse>
      <!-- Inner bright nucleus — faster flicker, slightly offset rhythm -->
      <ellipse cx="60" cy="58" rx="3.5" ry="3" fill="#b0f8ff" opacity="0.6">
        <animate attributeName="opacity" values="0.6;0.85;0.55;0.75;0.6" dur="4.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.3 0 0.7 1;0.4 0 0.6 1;0.4 0 0.6 1"/>
        <animate attributeName="rx" values="3.5;4.2;3.3;3.8;3.5" dur="4.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.3 0 0.7 1;0.4 0 0.6 1;0.4 0 0.6 1"/>
        <animate attributeName="ry" values="3;3.6;2.8;3.3;3" dur="4.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.3 0 0.7 1;0.4 0 0.6 1;0.4 0 0.6 1"/>
      </ellipse>
      <!-- Calcium spark — tiny bright flash that periodically fires -->
      <ellipse cx="60" cy="57.5" rx="1.5" ry="1.2" fill="#e0ffff" opacity="0">
        <animate attributeName="opacity" values="0;0;0.9;0.4;0;0;0" dur="5.1s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.9 1;0.0 0 0.2 1;0.3 0 0.7 1;0.8 0 1 1;0.1 0 0.9 1;0.1 0 0.9 1"/>
        <animate attributeName="rx" values="1.5;1.5;2.5;1.8;1.5;1.5;1.5" dur="5.1s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.9 1;0.0 0 0.2 1;0.3 0 0.7 1;0.8 0 1 1;0.1 0 0.9 1;0.1 0 0.9 1"/>
      </ellipse>
    </g>

    <!-- ═══ SYNAPTIC SPARKS — signals traveling toward soma ═══ -->
    <!-- Each spark is a tiny bright dot with a soft glow that rides
         along a dendrite path using animateMotion. Paths run TIP → SOMA
         so the signal converges inward, like real dendritic integration. -->
    <defs>
      <filter id="sparkGlow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="2.5" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- Spark 1: Apical tip → soma (main trunk) -->
    <circle r="1.4" fill="#b0ffff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="2.8s" begin="0s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M49 4 L52 12 L55 22 L57 32 L59 42 L60 52"/>
      <animate attributeName="opacity" values="0;0.85;0.9;0.7;0" dur="2.8s" begin="0s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.8;1.4;1.5;1.2;0.5" dur="2.8s" begin="0s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 2: Apical right branch tip → junction -->
    <circle r="1.1" fill="#90f0ff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="2.2s" begin="1.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M84 13 L76 16 L68 20 L62 26 L57 32"/>
      <animate attributeName="opacity" values="0;0.7;0.8;0.5;0" dur="2.2s" begin="1.4s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.6;1.1;1.2;0.9;0.3" dur="2.2s" begin="1.4s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 3: Basal left-down tip → soma -->
    <circle r="1.3" fill="#a0f8ff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="3.1s" begin="0.7s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M20 90 L26 82 L34 74 L44 66 L54 60"/>
      <animate attributeName="opacity" values="0;0.75;0.85;0.6;0" dur="3.1s" begin="0.7s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.7;1.3;1.4;1.0;0.4" dur="3.1s" begin="0.7s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 4: Basal right-down tip → soma -->
    <circle r="1.3" fill="#a0f8ff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="3.1s" begin="2.3s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M100 90 L94 82 L86 74 L76 66 L66 60"/>
      <animate attributeName="opacity" values="0;0.75;0.85;0.6;0" dur="3.1s" begin="2.3s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.7;1.3;1.4;1.0;0.4" dur="3.1s" begin="2.3s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 5: Apical left branch → junction -->
    <circle r="1.0" fill="#80e8ff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="2.0s" begin="3.5s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M32 10 L40 12 L48 16 L55 22"/>
      <animate attributeName="opacity" values="0;0.65;0.75;0.45;0" dur="2.0s" begin="3.5s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.5;1.0;1.1;0.7;0.2" dur="2.0s" begin="3.5s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 6: Axon OUTWARD — signal fires DOWN from soma (efferent!) -->
    <circle r="1.2" fill="#c0ffff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="3.4s" begin="1.0s" repeatCount="indefinite" calcMode="spline" keySplines="0.15 0 0.5 1"
        path="M60 64 L60 78 L58 92 L56 106 L54 118 L52 130 L50 138"/>
      <animate attributeName="opacity" values="0;0.9;0.8;0.6;0.3;0" dur="3.4s" begin="1.0s" repeatCount="indefinite"/>
      <animate attributeName="r" values="1.2;1.5;1.3;1.0;0.7;0.3" dur="3.4s" begin="1.0s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 7: Basal left-up → soma -->
    <circle r="1.0" fill="#90f0ff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="2.3s" begin="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M22 50 L32 48 L42 50 L52 56"/>
      <animate attributeName="opacity" values="0;0.7;0.8;0.5;0" dur="2.3s" begin="4.2s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.5;1.0;1.1;0.7;0.2" dur="2.3s" begin="4.2s" repeatCount="indefinite"/>
    </circle>

    <!-- Spark 8: Basal right-up → soma -->
    <circle r="1.0" fill="#90f0ff" opacity="0" filter="url(#sparkGlow)">
      <animateMotion dur="2.3s" begin="5.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.6 1"
        path="M98 50 L88 48 L78 50 L68 56"/>
      <animate attributeName="opacity" values="0;0.7;0.8;0.5;0" dur="2.3s" begin="5.8s" repeatCount="indefinite"/>
      <animate attributeName="r" values="0.5;1.0;1.1;0.7;0.2" dur="2.3s" begin="5.8s" repeatCount="indefinite"/>
    </circle>

    <!-- ═══ ACTION POTENTIAL RIPPLE — ring radiates from soma ═══ -->
    <circle cx="60" cy="58" r="6" fill="none" stroke="#60e8ff" stroke-width="1.2" opacity="0">
      <animate attributeName="r" values="6;28;50" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.25 0 0.4 1;0.3 0 0.7 1"/>
      <animate attributeName="opacity" values="0.45;0.18;0" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.6 1;0.3 0 0.7 1"/>
      <animate attributeName="stroke-width" values="1.2;0.6;0.2" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.3 0 0.6 1;0.3 0 0.7 1"/>
    </circle>
    <!-- Second ripple, staggered (fires 2s after the first) -->
    <circle cx="60" cy="58" r="6" fill="none" stroke="#40d0ff" stroke-width="0.8" opacity="0">
      <animate attributeName="r" values="6;28;50" dur="4s" begin="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.25 0 0.4 1;0.3 0 0.7 1"/>
      <animate attributeName="opacity" values="0.3;0.12;0" dur="4s" begin="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.1 0 0.6 1;0.3 0 0.7 1"/>
      <animate attributeName="stroke-width" values="0.8;0.4;0.1" dur="4s" begin="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.3 0 0.6 1;0.3 0 0.7 1"/>
    </circle>
  </svg>
</template>

<style scoped>
.nge-glyph-svg { width: 100%; height: 100%; display: block; }
</style>
