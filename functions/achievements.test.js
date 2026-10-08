// Announcing achievements in chat: the server's check (achievements.js).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {achievementRow, specialAwardRow, TABLE} = require('./achievements');
const {readDefinitions} = require('../scripts/build-achievement-thresholds');

test('the server\'s list is the app\'s list', () => {
  assert.deepEqual(TABLE, readDefinitions());
  assert.equal(TABLE.length, 200);
});

test('an achievement is announced only once the counter has reached it', () => {
  const mallet = TABLE.find(a => a.track === 'building' && a.threshold === 100);
  assert.throws(() => achievementRow('building', mallet.id, {total_edits: 99}), /Not earned yet/);
  const row = achievementRow('building', mallet.id, {total_edits: 100});
  assert.equal(row.text, `earned the ${mallet.name} achievement`);
  assert.equal(row.dataset, `achievement:building:${mallet.id}`);
  // the other counter does not help
  assert.throws(() => achievementRow('building', mallet.id, {cells_completed: 5000}), /Not earned yet/);
});

test('cell achievements 2, 3 and 4 stay quiet; 1 and 5 are announced', () => {
  const cell = n => TABLE.find(a => a.track === 'exploration' && a.threshold === n);
  for (const n of [2, 3, 4]) assert.deepEqual(achievementRow('exploration', cell(n).id, {cells_completed: 50}), {quiet: true});
  for (const n of [1, 5]) assert.equal(achievementRow('exploration', cell(n).id, {cells_completed: 50}).name, cell(n).name);
});

test('made up achievements and tracks are refused', () => {
  assert.throws(() => achievementRow('building', 9999, {total_edits: 1e9}), /Unknown achievement/);
  assert.throws(() => achievementRow('loyalty', 201, {total_days: 400}), /Unknown achievement/);
  assert.throws(() => achievementRow('exploration', 1, {cells_completed: 1e9}), /Unknown achievement/);   // id 1 is a building one
});

test('a special award makes a chat row from the award itself', () => {
  assert.deepEqual(specialAwardRow({id: 7, name: 'Mini Michelangelo'}),
    {text: 'earned the Mini Michelangelo award', dataset: 'achievement:special:7', name: 'Mini Michelangelo'});
  assert.throws(() => specialAwardRow({id: 0, name: 'x'}), /Unknown award/);
  assert.throws(() => specialAwardRow({id: 3, name: '  '}), /Unknown award/);
  assert.throws(() => specialAwardRow(null), /Unknown award/);
});
