import test from 'node:test';
import assert from 'node:assert/strict';
import { shippedTags, involvement, WATCHERS } from './shipped-tags.mjs';

const AMY = 'U02FH1DRC', CELIA = 'U033NHWDE', MARISSA = 'U033TSX9A';
const APPROVERS = [CELIA];
const [celia, marissa] = WATCHERS;

test('a report nobody else touched tags nobody', () => {
  assert.deepEqual(shippedTags({ row: { feedback_log: [], admin_notes: [] } }), []);
  // The robot's own thank you note is not Celia sending feedback.
  assert.deepEqual(shippedTags({ row: { feedback_log: [{ role: 'reporter_update', via: 'auto', by: 'the robot', text: 'Fixed!' }] } }), []);
});

test('1. her report', () => {
  assert.equal(involvement(celia, { reporterName: 'Celia D' }), 'her report');
  assert.equal(involvement(marissa, { reporterName: 'M Sorek' }), 'her report');
  assert.deepEqual(shippedTags({ reporterName: 'Celia D.' }), [CELIA]);
});

test('2. she commented: a board note, a Slack note, or a reply in the thread', () => {
  assert.equal(involvement(celia, { row: { admin_notes: [{ by: 'Celia D.', text: 'looked at it' }] } }), 'commented');
  assert.equal(involvement(celia, { row: { feedback_log: [{ role: 'note', user: CELIA, text: 'x' }] } }), 'commented');
  assert.equal(involvement(marissa, { thread: [{ user: MARISSA, text: 'seen this too' }] }), 'commented');
  assert.equal(involvement(celia, { thread: [{ user: AMY, text: 'mine' }] }), null);
});

test('3. she sent feedback to the player', () => {
  assert.equal(involvement(celia, { row: { feedback_log: [{ role: 'reporter_update', via: 'admin', by: 'Celia D.', text: 'Thanks!' }] } }), 'sent feedback');
  assert.equal(involvement(celia, { row: { feedback_log: [{ role: 'reporter_update', via: 'slack', user: CELIA, text: 'Thanks!' }] } }), 'sent feedback');
});

test('4. someone @ed her anywhere in the report', () => {
  assert.equal(involvement(celia, { row: { admin_notes: [{ by: 'Amy R. Sterling', text: '@Celia D. can you check' }] } }), 'tagged');
  assert.equal(involvement(celia, { thread: [{ user: AMY, text: `<@${CELIA}> look` }] }), 'tagged');
  assert.equal(involvement(marissa, { row: { result_note: 'fixed, thanks @M Sorek' } }), 'tagged');
  assert.equal(involvement(marissa, { reporterName: 'Marissa Pratt' }), null);
  // The bot tagging someone does not count, so an old robot ping cannot keep her on.
  assert.equal(involvement(celia, { thread: [{ bot_id: 'B1', user: 'U0B02RD6XQR', text: `<@${CELIA}> test this` }] }), null);
  // Tagging Celia does not tag Marissa.
  assert.deepEqual(shippedTags({ row: { admin_notes: [{ by: 'Amy', text: '@Celia D.' }] } }), [CELIA]);
});
