const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planRsvp, NOTE_COLUMN } = require('./symposium-rsvp');

const now = new Date('2026-10-29T14:05:09.123Z');

test('a good RSVP becomes one plain row', () => {
  const p = planRsvp({ name: '  Ada   Lovelace ', email: 'Ada@Example.org', username: ' @ada_traces ', question: 'How big is the volume?\r\nAnd who traced it?' }, now);
  assert.equal(p.email, 'ada@example.org');
  assert.deepEqual(p.row, ['2026-10-29 14:05:09', 'Ada Lovelace', 'ada@example.org', 'ada_traces', 'How big is the volume?\nAnd who traced it?', '']);
});

test('the Pyr username and the question are optional', () => {
  const row = planRsvp({ name: 'A', email: 'a@b.co' }, now).row;
  assert.equal(row[3], '');
  assert.equal(row[4], '');
  assert.equal(row.length, NOTE_COLUMN + 1);
});

test('name and email are required and checked', () => {
  assert.throws(() => planRsvp({ name: '', email: 'a@b.co' }, now), /name/);
  assert.throws(() => planRsvp({ name: 'A', email: 'not an email' }, now), /email/);
  assert.throws(() => planRsvp({ name: 'A', email: 'a@b' }, now), /email/);
  assert.throws(() => planRsvp(null, now), /did not go through/);
  assert.throws(() => planRsvp([], now), /did not go through/);
});

test('the bot trap refuses quietly', () => {
  assert.throws(() => planRsvp({ name: 'A', email: 'a@b.co', website: 'spam.example' }, now), /did not go through/);
});

test('cells never start as a formula', () => {
  const p = planRsvp({ name: '=HYPERLINK("x")', email: 'a@b.co', username: '-x', question: '+1 from me' }, now);
  assert.equal(p.row[1], '\'=HYPERLINK("x")');
  assert.equal(p.row[3], "'-x");
  assert.equal(p.row[4], "'+1 from me");
});

test('long answers are cut, control characters dropped', () => {
  const p = planRsvp({ name: 'x'.repeat(500), email: 'a@b.co', username: 'u'.repeat(99), question: 'q\u0000'.repeat(3000) }, now);
  assert.equal(p.row[1].length, 120);
  assert.equal(p.row[3].length, 40);
  assert.ok(p.row[4].length <= 2000 && !p.row[4].includes('\u0000'));
});
