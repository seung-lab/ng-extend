// Announcing achievements in chat: the server's check (achievements.js).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {achievementRow, specialAwardRow, TABLE} = require('./achievements');
const {readDefinitions} = require('../scripts/build-achievement-thresholds');

test('the server\'s list is the app\'s list', () => {
  assert.deepEqual(TABLE, readDefinitions());
  assert.equal(TABLE.length, 224);   // 100 Editor, 100 Cell Completions, 24 Loyalty
  assert.equal(TABLE.filter(a => a.track === 'loyalty').length, 24);
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

// Cells 2, 3 and 4 used to be earned without a chat line. Since 2026-10-11
// the first cell tiers are 1, 5, 10, 15, 20: there is no 2, 3 or 4 to keep
// quiet, and every cell tier is announced.
test('the first cell achievements are 1, 5, 10, 15, 20 and each is announced', () => {
  const cells = TABLE.filter(a => a.track === 'exploration').sort((a, b) => a.id - b.id);
  assert.deepEqual(cells.slice(0, 5).map(a => a.threshold), [1, 5, 10, 15, 20]);
  for (const a of cells.slice(0, 5)) assert.equal(achievementRow('exploration', a.id, {cells_completed: 50}).name, a.name);
  assert.throws(() => achievementRow('exploration', cells[1].id, {cells_completed: 4}), /Not earned yet/);
});

test('cell tiers rise all the way and are round numbers', () => {
  const t = TABLE.filter(a => a.track === 'exploration').sort((a, b) => a.id - b.id).map(a => a.threshold);
  assert.equal(t.length, 100);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `tier ${i + 1}`);
  assert.equal(t[99], 55000);
  for (const n of t.slice(1)) assert.equal(n % 5, 0, String(n));
});

test('made up achievements and tracks are refused', () => {
  assert.throws(() => achievementRow('building', 9999, {total_edits: 1e9}), /Unknown achievement/);
  assert.throws(() => achievementRow('loyalty', 208, {total_days: 400}), /Unknown achievement/);   // the retired 30 day One Month
  assert.throws(() => achievementRow('streaks', 201, {total_days: 400}), /Unknown achievement/);
  assert.throws(() => achievementRow('exploration', 1, {cells_completed: 1e9}), /Unknown achievement/);   // id 1 is a building one
});

test('a special award makes a chat row from the award itself', () => {
  assert.deepEqual(specialAwardRow({id: 7, name: 'Mini Michelangelo'}),
    {text: 'earned the Mini Michelangelo award', dataset: 'achievement:special:7', name: 'Mini Michelangelo'});
  assert.throws(() => specialAwardRow({id: 0, name: 'x'}), /Unknown award/);
  assert.throws(() => specialAwardRow({id: 3, name: '  '}), /Unknown award/);
  assert.throws(() => specialAwardRow(null), /Unknown award/);
});

test('a Loyalty achievement is announced once the total days have reached it', () => {
  const day = n => TABLE.find(a => a.track === 'loyalty' && a.threshold === n);
  assert.equal(day(2).id, 201);
  assert.equal(day(28).name, 'One Month');
  assert.throws(() => achievementRow('loyalty', 201, {total_days: 1}), /Not earned yet/);
  assert.deepEqual(achievementRow('loyalty', 201, {total_days: 2}),
    {text: 'earned the Day Two achievement', dataset: 'achievement:loyalty:201', name: 'Day Two', slug: 'second-spark'});
  // edits and cells do not stand in for days
  assert.throws(() => achievementRow('loyalty', day(40).id, {total_edits: 5000, cells_completed: 5000, total_days: 39}), /Not earned yet/);
  assert.equal(achievementRow('loyalty', day(40).id, {total_days: 41}).name, 'Forty Days');
});
