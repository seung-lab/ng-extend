// Pinning a chat message: the rows the server writes (chat-pin.js).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pinRow, unpinRow} = require('./chat-pin');

test('a pin row carries the message, shortened, and points at it', () => {
  assert.deepEqual(pinRow({id: 4812, name: 'Nseraf', text: 'retina cells\n are   open again'}),
    {text: '\u{1F4CC} Nseraf: retina cells are open again', dataset: 'pin:4812'});
  const long = pinRow({id: 'a1b2-c3', name: 'Nseraf', text: 'x'.repeat(400)});
  assert.equal(Array.from(long.text).length, '\u{1F4CC} Nseraf: '.length - 1 + 241);
  assert.ok(long.text.endsWith('\u2026'));
  assert.equal(long.dataset, 'pin:a1b2-c3');
});

test('nothing to pin, or a made up id, is refused', () => {
  assert.throws(() => pinRow(null), /Unknown message/);
  assert.throws(() => pinRow({id: '1; drop', name: 'x', text: 'y'}), /Unknown message/);
  assert.throws(() => pinRow({id: 5, name: 'x', text: '   '}), /no text/);
});

test('unpinning is a row of its own', () => {
  assert.deepEqual(unpinRow(), {text: '\u{1F4CC} Unpinned the message', dataset: 'pin:none'});
});
