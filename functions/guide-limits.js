// How much of the client's live UI reference (src/assistant/knowledge.ts)
// Nurro's prompt keeps. It was 8000 characters, and by Nov 2026 the
// hand-written feature notes alone had grown past that, so the toolbar,
// shortcuts, command palette and neuroglancer controls were silently cut
// off. Since then it also carries the recent changelog. guide-limits.test.js
// fails if the notes outgrow this again.
// The reference sits in the cached part of the prompt, so a larger cap costs
// little after the first question in each cache window.
// Raised to 80000 (Ames 2026-11-21: "Couldn't it be longer?"): the notes had
// filled their share, and the cached reference costs little more per question.
const GUIDE_UI_REFERENCE_MAX = 80000;

// The largest request guideAssistant accepts, in bytes. The client sends the
// whole reference (it can be longer than the cap above, and non-English text
// takes more bytes), plus the last 8 turns and the app context. It was 48000,
// which a full reference could pass, and then Nurro answered nothing.
const GUIDE_REQUEST_MAX_BYTES = 200000;

module.exports = { GUIDE_UI_REFERENCE_MAX, GUIDE_REQUEST_MAX_BYTES };
