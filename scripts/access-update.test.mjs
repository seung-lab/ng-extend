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
test('a dataset request names its dataset', async () => {
  const { gatherAccess } = await import('./access-update.mjs');
  const get = async (t) => t === 'site_issues' ? [{ user_name: 'toknow', category: 'Dataset access', title: 'Medial Entorhinal Cortex access request from toknow' }] : [];
  const { requests } = await gatherAccess(get, '2026-11-01T00:00:00Z');
  assert.deepEqual(requests, [{ name: 'toknow', what: 'Medial Entorhinal Cortex' }]);
});
test('Sunday also sends the week', async () => {
  const sent = [];
  const get = async (t, q) => {
    if (t === 'access_requests') return [{ player_name: 'Rae' }];
    if (t === 'admins') return [{ user_id: 'a1' }];
    return [];
  };
  // 2026-11-08 is a Sunday; 20:30Z is 3:30 pm Eastern.
  await sendAccessUpdate({ get, post: async (_, r) => sent.push(...r), now: new Date('2026-11-08T20:30:00Z'), day: 'Nov 8' });
  assert.deepEqual(sent.map(r => r.title), ['🔑 Access update: Nov 8', '🔑 Access this week: Nov 2 – Nov 8']);
});
test('beta approvals come from Pilot testers; a pasted list is counted', async () => {
  const { gatherAccess } = await import('./access-update.mjs');
  const list = Array.from({ length: 6 }, (_, i) => ({ email: `l${i}@x`, created_at: 'T1' }));
  const get = async (t, q) => {
    if (t === 'pilot_members') return [{ email: 'ken@x', created_at: 'T2' }, { email: 'new@x', created_at: 'T3' }, ...list];
    if (t === 'users') { assert.ok(!q.includes('l0@x')); return [{ display_name: 'Ken Mierow', middleauth_email: 'Ken@x' }]; }
    return [];
  };
  const { approvals } = await gatherAccess(get, '2026-11-01T00:00:00Z');
  assert.deepEqual(approvals, [{ name: 'Ken Mierow', what: 'Beta' }, { name: 'new@x', what: 'Beta' }, { name: '6 emails', what: 'Beta, added as a list' }]);
});
