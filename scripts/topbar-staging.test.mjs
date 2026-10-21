// Top bar staging for new players (src/data/toolbar-stages.ts): every icon
// has a moment that brings it, and every tutorial step that should bring an
// icon still does. Runs on every push (on_dev_branch_push.yml), so a tutorial
// rewrite that drops such a step fails the build instead of leaving new
// players without the icon.
// Run: node --test scripts/topbar-staging.test.mjs   (needs typescript installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const src = read('src/data/toolbar-stages.ts');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toolbar-stages-')), 'toolbar-stages.mjs');
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
const { STAGE_MOMENTS, NEVER_AUTO, ALL_AUTO, TUTORIAL_REVEALS, dragInFull, togglesInFull } = await import(pathToFileURL(out).href);

// The icons a player can have in the top bar today (screenshot is added after batch).
const icons = read('src/data/toolbar-icons.ts');
const listOf = (name) => [...icons.match(new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]'))[1].matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);
const TOP_BAR = [...listOf('DEFAULT_TOOLBAR_ORDER'), 'screenshot'];
const RETIRED = listOf('RETIRED_TOOLBAR_ICON_IDS');

const FILES = { 2: 'src/tutorial-2.ts', 3: 'src/tutorial-3.ts', 5: 'src/tutorial-cut.ts', 9: 'src/merger-sandbox.ts', 11: 'src/proofreading-test.ts' };
const moment = (key) => STAGE_MOMENTS.find(m => m.key === key);

test('every top bar icon has a moment that brings it, or is knowingly left to Settings', () => {
  for (const id of TOP_BAR) {
    assert.ok(ALL_AUTO.includes(id) || NEVER_AUTO.includes(id), `${id} is never brought in`);
  }
  for (const id of ALL_AUTO) assert.ok(!RETIRED.includes(id), `${id} is retired but still staged`);
});

test('a brand new player starts with the bell alone', () => {
  assert.deepEqual(moment('start').icons, ['notif']);
});

test('the order Ames set', () => {
  assert.deepEqual([...moment('getStarted').icons].sort(), ['chat', 'leaderboard', 'undelete']);
  assert.deepEqual(moment('aiDone').icons, ['layers'], 'the layer side panel after Advanced Interface');
  assert.ok(moment('basics').icons.includes('cells'), 'Cell Library comes with finishing Merge and Cut');
  assert.ok(!moment('getStarted').icons.includes('cells'), 'Cell Library does not come with Get Started');
  assert.ok(moment('week1').icons.includes('recap') && moment('week1').settingsButton, 'Your Week after a week, with the Settings button');
  assert.ok(NEVER_AUTO.includes('batch') && NEVER_AUTO.includes('datasetStats'), 'Batch and Dataset Stats stay off until Settings');
});

test('a player who skips every tutorial still has a full top bar by day 3', () => {
  const have = new Set([...moment('start').icons, ...moment('day2').icons, ...moment('day3').icons, ...moment('week1').icons]);
  for (const id of ALL_AUTO) assert.ok(have.has(id), `${id} only comes from a tutorial`);
});

for (const r of TUTORIAL_REVEALS) {
  test(`${r.name} still has a step that brings ${r.icon}`, () => {
    const text = read(FILES[r.tutorial]);
    const byReveals = [...text.matchAll(/reveals:\s*\[([^\]]*)\]/g)].some(m => m[1].includes(`'${r.icon}'`));
    const byPointing = text.includes(`data-icon-id="${r.icon}"`);
    assert.ok(byReveals || byPointing, `no step in ${FILES[r.tutorial]} brings ${r.icon}`);
  });
}

test('saving a drag or the Settings switches never drops an icon still on its way', () => {
  const full = [...TOP_BAR];
  const dragged = dragInFull(full, 'chat', 'cells', false);
  assert.deepEqual([...dragged].sort(), [...full].sort());
  assert.equal(dragged[0], 'chat');
  const toggled = togglesInFull(full, ['notif', 'chat', 'leaderboard'], ['notif', 'chat', 'cells']);
  assert.ok(!toggled.includes('leaderboard'), 'switched off');
  for (const id of full) if (id !== 'leaderboard') assert.ok(toggled.includes(id), `${id} kept`);
});

test("Nurro's lines follow the house rules", () => {
  for (const m of STAGE_MOMENTS) {
    if (!m.nurro) continue;
    assert.ok(!/[–—]/.test(m.nurro), `${m.key}: no dashes`);
    assert.ok(!/\bbadge/i.test(m.nurro), `${m.key}: Achievement, never badge`);
  }
});
