import { ref } from 'vue';

/**
 * Is the player past the beta gate (BetaGate.vue)? 'unknown' until the server
 * answers, 'in' for a tester or when the server cannot be asked (the gate
 * fails open), 'out' while the invite only screen is up. The radio waits for
 * 'in' (Ames 2026-10-26: "this starts playing music without a way to turn it
 * off"): its control sits under the screen, so it must not start there.
 */
export const betaGate = ref<'unknown' | 'in' | 'out'>('unknown');
