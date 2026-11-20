const {test} = require('node:test');
const assert = require('node:assert/strict');
const {nameTaken, ownsName} = require('./name-owner');
const {nameKey} = require('./sheet-policy');

const people = [
  {id: 'old', display_name: 'Target Player', username: 'target', created_at: '2026-01-01T00:00:00Z'},
  {id: 'new', display_name: 'target-player!', username: 'sneaky', created_at: '2026-11-01T00:00:00Z'},
  {id: 'solo', display_name: 'Solo', username: 'solo1', created_at: '2026-05-01T00:00:00Z'},
];
// Stands in for PostgREST's ilike with * between every letter.
const sb = rows => async path => {
  const likes = [...decodeURIComponent(path).matchAll(/ilike\.\*([^,)]*)\*/g)].map(m => new RegExp(m[1].split('*').join('.*'), 'i'));
  return rows.filter(u => likes.some(re => re.test(u.display_name) || re.test(u.username)));
};

test('a rename to a name someone else carries is refused, however it is punctuated', async () => {
  assert.equal(nameKey('target-player!'), nameKey('Target Player'));
  assert.equal(await nameTaken(sb(people), 'solo', ['T.a.r.g.e.t PLAYER']), true);
  assert.equal(await nameTaken(sb(people), 'solo', ['Target']), true, 'a username counts too');
  assert.equal(await nameTaken(sb(people), 'solo', ['Solo', 'solo1']), false, 'your own name is yours');
  assert.equal(await nameTaken(sb(people), 'solo', ['Somebody New']), false);
});

test('rows under a shared name belong to the account that had it first', async () => {
  assert.equal(await ownsName(sb(people), people[0]), true);
  assert.equal(await ownsName(sb(people), people[1]), false);
  assert.equal(await ownsName(sb(people), people[2]), true);
  assert.equal(await ownsName(sb(people), null), false);
});

test('when it cannot be sure, it refuses', async () => {
  const twins = [{...people[0]}, {...people[1], created_at: people[0].created_at}];
  assert.equal(await ownsName(sb(twins), twins[0]), false, 'same moment: neither');
  const undated = [{...people[0], created_at: null}, people[1]];
  assert.equal(await ownsName(sb(undated), undated[0]), false);
  const crowd = Array.from({length: 1000}, (_, i) => ({id: 'c' + i, display_name: 'Sol' + i + 'o', username: 'x' + i, created_at: '2026-02-01T00:00:00Z'}));
  assert.equal(await ownsName(async () => crowd, people[2]), false);
  assert.equal(await nameTaken(async () => crowd, 'solo', ['Solo']), true);
});
