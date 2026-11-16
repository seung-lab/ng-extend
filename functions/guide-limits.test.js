// Nurro only sees the first GUIDE_UI_REFERENCE_MAX characters of the live UI
// reference. Its hand-written notes come first, then the toolbar, shortcuts,
// command palette and neuroglancer controls. If the notes grow too long, those
// lists are cut off without any error, which happened in Nov 2026.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { GUIDE_UI_REFERENCE_MAX } = require("./guide-limits");

// Room left for the generated lists (toolbar, shortcuts, commands, controls).
const ROOM_FOR_GENERATED_LISTS = 20000;

function staticNotesLength() {
  const file = path.join(__dirname, "..", "src", "assistant", "knowledge.ts");
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("return [", src.indexOf("function buildStaticReference"));
  const end = src.indexOf("## Keyboard shortcuts", start);
  assert.ok(start > 0 && end > start, "could not find the notes in knowledge.ts");
  const lines = src.slice(start, end).match(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/gm) || [];
  return lines.reduce((n, line) => {
    const text = JSON.parse(line.trim().replace(/,$/, ""));
    return n + text.length + 1;
  }, 0);
}

test("Nurro's notes leave room for the toolbar, shortcuts and commands", () => {
  const notes = staticNotesLength();
  assert.ok(notes > 1000, `notes look empty (${notes} characters)`);
  assert.ok(
    notes + ROOM_FOR_GENERATED_LISTS <= GUIDE_UI_REFERENCE_MAX,
    `knowledge.ts notes are ${notes} characters; with ${ROOM_FOR_GENERATED_LISTS} for the generated lists ` +
      `that passes the ${GUIDE_UI_REFERENCE_MAX} cap in functions/guide-limits.js, so Nurro would lose them`,
  );
});

test("index.js cuts the reference at the shared cap", () => {
  const index = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.match(index, /uiReference\.slice\(0, GUIDE_UI_REFERENCE_MAX\)/);
});
