// Run: node --test scripts/access-update.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { accessBody, sendAccessUpdate } from './access-update.mjs';

test('a quiet day says nothing', () => assert.equal(accessBody([], []), null));
test('groups by dataset, approvals first', () => {
  const b = accessBody([{ name: 'Rae', what: 'Retina' }], [{ name: 'Sam', what: 'MEC' }, { name: 'Lee', what: 'MEC' }]);
  assert.equal(b, '**Approved (2)**\n\n- MEC: Sam, Lee\n\n**Requested (1)**\n\n- Retina: Rae');
});
test('sends once a day, to every admin, never to chat', async () => {
  const sent = []; let had = [];
  const get = async (t, q) => {
    if (t === 'access_requests') return [{ player_name: 'Rae' }];
    if (t === 'admins') return [{ user_id: 'a1', email: 'x@y' }];
    if (t === 'users') return [{ id: 'a2' }];
    if (t === 'notifications' && q.startsWith('select=id')) return had;
    return [];
  };
  const go = () => sendAccessUpdate({ get, post: async (_, r) => sent.push(...r), now: new Date('2026-10-30T20:30:00Z'), day: 'October 30' });
  await go();
  assert.deepEqual(sent.map(r => r.target_id).sort(), ['a1', 'a2']);
  assert.ok(sent.every(r => r.post_to_chat === false && r.title === '🔑 Access update: October 30'));
  had = [{ id: 1 }]; await go(); assert.equal(sent.length, 2);
});
