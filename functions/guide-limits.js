// How much of the client's live UI reference (src/assistant/knowledge.ts)
// Nurro's prompt keeps. It was 8000 characters, and by Nov 2026 the
// hand-written feature notes alone had grown past that, so the toolbar,
// shortcuts, command palette and neuroglancer controls were silently cut
// off. guide-limits.test.js fails if the notes outgrow this again.
// The reference sits in the cached part of the prompt, so a larger cap costs
// little after the first question in each cache window.
const GUIDE_UI_REFERENCE_MAX = 50000;

module.exports = { GUIDE_UI_REFERENCE_MAX };
