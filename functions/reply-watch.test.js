const test = require('node:test');
const assert = require('node:assert/strict');
const { newReplies, copyNote, isOwnerEmail } = require('./reply-watch');

test('only the new replies to the player are copied', () => {
  const old = [{ role: 'reporter_update', via: 'admin', by: 'Celia D', text: 'first', ts: '1' }, { role: 'note', text: 'n', ts: '2' }];
  const now = [...old,
    { role: 'reporter_update', via: 'admin', by: 'Celia D', text: 'second', ts: '3' },
    { role: 'reporter_update', via: 'auto', by: 'the robot', text: 'Fixed!', ts: '4' },
    { role: 'reporter_update', via: 'admin', by: 'Celia D', text: 'not sent', ts: '5', sent: false },
    { role: 'reporter_reply', text: 'player said thanks', ts: '6' }];
  assert.deepEqual(newReplies(old, now).map(e => e.text), ['second']);
  assert.deepEqual(newReplies(now, now), []);
  assert.deepEqual(newReplies(null, [{ role: 'reporter_update', via: 'slack', user: 'U033NHWDE', text: 'hi', ts: '9' }]).map(e => e.text), ['hi']);
});

test('the copy names the admin, the report and the exact words', () => {
  const n = copyNote({ by: 'Celia D', text: 'Please read the tutorial.', about: 'Cut tool  broken', link: 'https://x/?triage=board&report=1' });
  assert.equal(n.title, '💬 Celia D replied to a player');
  assert.equal(n.body, 'On "Cut tool broken":\n\nPlease read the tutorial.\n\nhttps://x/?triage=board&report=1');
});

test('Ames is not copied on her own replies', () => {
  assert.equal(isOwnerEmail('amylr@princeton.edu'), true);
  assert.equal(isOwnerEmail('AmyLeeRobinson@gmail.com'), true);
  assert.equal(isOwnerEmail('celia@x.org'), false);
});
