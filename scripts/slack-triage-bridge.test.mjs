import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyDecision, decisionConfirmation, postThreadReplyOnce } from './slack-triage-bridge.mjs';

const row = { id: 'triage-1', source: 'site_issue', source_id: 'issue-1', recommendation: 'message', proposed_message: 'Thanks for reporting this.' };
function mockRequest(recipient, failure) {
  const calls = [];
  const request = async (path, init = {}) => {
    calls.push({ path, ...init, body: init.body && JSON.parse(init.body) });
    return { ok: path !== failure, status: 503, json: async () => recipient === undefined ? [] : [{ user_id: recipient }] };
  };
  return { calls, request };
}

test('approved reply targets only its reporter and preserves edited text', async () => {
  const { calls, request } = mockRequest('reporter-1');
  const result = await applyDecision(row, 'approved', 'U1', ' Updated reply. ', request);
  const notification = calls.find(call => call.path === 'notifications').body;
  assert.equal(notification.target_type, 'user');
  assert.equal(notification.target_id, 'reporter-1');
  assert.equal(notification.body, 'Updated reply.');
  assert.match(decisionConfirmation('approved', 'U1', result), /sent to the reporter/);
});

for (const recipient of [null, undefined, '', '   ']) {
  test(`missing recipient ${JSON.stringify(recipient)} never broadcasts and retains the reply for Slack`, async () => {
    const { calls, request } = mockRequest(recipient);
    const delivered = [];
    const result = await applyDecision(row, 'approved', 'U1', '', request, async (replyRow, text) => {
      assert.equal(calls.some(call => call.method === 'PATCH'), false);
      delivered.push({ row: replyRow, text });
    });
    assert.equal(delivered.length, 1);
    assert.ok(delivered[0].text.endsWith(row.proposed_message));
    assert.equal(calls.some(call => call.path === 'notifications'), false);
    const confirmation = decisionConfirmation('approved', 'U1', result);
    assert.match(confirmation, /no in-app notification was sent/);
    assert.ok(confirmation.endsWith(row.proposed_message));
    assert.equal(calls.at(-1).body.status, 'approved');
  });
}

test('client error replies never send an in-app notification', async () => {
  const { calls, request } = mockRequest('unrelated-user');
  const result = await applyDecision({ ...row, source: 'client_error' }, 'approved', 'U1', '', request, async () => {});
  assert.equal(result.delivery, 'thread_only');
  assert.deepEqual(calls.map(call => call.path), ['feedback_triage?id=eq.triage-1']);
});

test('Slack reply failure leaves anonymous proposal pending for retry', async () => {
  const { calls, request } = mockRequest(null);
  await assert.rejects(applyDecision(row, 'approved', 'U1', '', request, async () => { throw new Error('Slack unavailable'); }), /Slack unavailable/);
  assert.equal(calls.some(call => call.method === 'PATCH'), false);
  assert.equal(calls.some(call => call.path === 'notifications'), false);
});

test('thread-only retry after status failure finds its prior reply across pages without posting twice', async () => {
  const threadRow = { ...row, slack_channel: 'C1', slack_ts: '100.1' };
  const posted = [];
  const read = async (_method, params) => params.cursor
    ? { messages: posted.map(message => ({ ...message, bot_id: 'B1' })) }
    : { messages: [], has_more: true, response_metadata: { next_cursor: 'page2' } };
  const post = async (_method, payload) => { posted.push(payload); };
  const deliver = (replyRow, text) => postThreadReplyOnce(replyRow, text, read, post);
  const failing = mockRequest(null, 'feedback_triage?id=eq.triage-1');
  await assert.rejects(applyDecision(threadRow, 'approved', 'U1', '', failing.request, deliver), /status update failed/);
  const retry = mockRequest(null);
  await applyDecision(threadRow, 'approved', 'U1', '', retry.request, deliver);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].channel, 'C1');
  assert.equal(posted[0].thread_ts, '100.1');
  assert.equal(retry.calls.at(-1).body.status, 'approved');
});

test('incomplete thread history cannot trigger an unchecked duplicate reply', async () => {
  let posted = false;
  await assert.rejects(postThreadReplyOnce({ ...row, slack_ts: '100.1' }, 'reply', async () => ({ messages: [], has_more: true }), async () => { posted = true; }), /Incomplete Slack thread history/);
  assert.equal(posted, false);
});

for (const failure of ['site_issues?id=eq.issue-1&select=user_id', 'notifications']) {
  test(`failure at ${failure} leaves the proposal pending`, async () => {
    const { calls, request } = mockRequest('reporter-1', failure);
    await assert.rejects(applyDecision(row, 'approved', 'U1', '', request), /failed/);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  });
}

test('empty reply cannot be silently approved', async () => {
  const { calls, request } = mockRequest('reporter-1');
  await assert.rejects(applyDecision({ ...row, proposed_message: ' ' }, 'approved', 'U1', '', request), /Reply is empty/);
  assert.equal(calls.length, 0);
});

test('dismissals do not send replies', async () => {
  const { calls, request } = mockRequest('reporter-1');
  await applyDecision(row, 'dismissed', 'U1', '', request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.status, 'dismissed');
});

// Exercise the actual AdminHub handler without Vue or a live Supabase client.
// Its type annotations and dynamic import are replaced for this isolated harness.
const adminSource = await readFile(new URL('../src/components/AdminHub.vue', import.meta.url), 'utf8');
const adminHandler = adminSource.slice(adminSource.indexOf('async function setTriageStatus('), adminSource.indexOf('// ── Notification form state'))
  .replace("row: TriageRow, status: 'approved' | 'dismissed' | 'done'", 'row, status')
  .replace('let resultNote: string | null', 'let resultNote')
  .replace('let targetUserId: string | null', 'let targetUserId')
  .replace('catch (e: any)', 'catch (e)')
  .replace("const { supabase } = await import('../supabase');", '');
const createAdminHandler = new Function('supabase', 'triageActing', 'triageEdits', 'triageError', 'backend', 'loadTriage', `${adminHandler}; return setTriageStatus;`);

for (const scenario of ['targeted', 'anonymous', 'lookup-error', 'insert-error']) {
  test(`AdminHub ${scenario} approval respects delivery outcome`, async () => {
    const calls = [];
    const supabase = { from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        single: async () => ({ data: { user_id: scenario === 'anonymous' ? null : 'reporter-1' }, error: scenario === 'lookup-error' ? new Error('lookup failed') : null }),
        insert: async payload => { calls.push({ table, payload }); return { error: scenario === 'insert-error' ? new Error('insert failed') : null }; },
        update(payload) { calls.push({ table, payload }); return this; },
      };
    } };
    const error = { value: '' };
    const handler = createAdminHandler(supabase, { value: null }, { value: {} }, error, { userId: 'admin' }, async () => {});
    await handler(row, 'approved');
    if (scenario === 'targeted') {
      assert.equal(error.value, '');
      assert.equal(calls[0].payload.target_type, 'user');
      assert.equal(calls[0].payload.target_id, 'reporter-1');
      assert.equal(calls.at(-1).table, 'feedback_triage');
    } else {
      assert.notEqual(error.value, '');
      assert.equal(calls.some(call => call.table === 'feedback_triage'), false);
      if (scenario !== 'insert-error') assert.equal(calls.length, 0);
    }
  });
}
