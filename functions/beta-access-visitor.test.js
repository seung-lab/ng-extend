'use strict';
// Beta access requests: from the game (access.beta) and from connectome.quest
// (visitorBeta, Ames 2026-10-26). Rules in access-request.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const {handle, visitorBeta, BETA_CATEGORY} = require('./access-request');

/** site_issues only, with the eq and ilike filters these use. */
function world() {
  const state = {site_issues: [], bells: [], posts: []};
  const sb = async (path, init = {}) => {
    const [table, qs = ''] = path.split('?');
    assert.equal(table, 'site_issues');
    if ((init.method || 'GET') === 'POST') { state.site_issues.push(...JSON.parse(init.body)); return []; }
    const q = new URLSearchParams(qs);
    return state.site_issues.filter(r => [...q].every(([k, v]) => {
      if (['select', 'limit'].includes(k)) return true;
      if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
      if (v.startsWith('ilike.')) return String(r[k]).toLowerCase().includes(v.slice(6).replace(/\*/g, '').toLowerCase());
      throw new Error('filter ' + v);
    }));
  };
  const io = {sb, notifyAdmins: async b => state.bells.push(b), postIssue: async p => state.posts.push(p)};
  return {state, io};
}
const visitor = (over = {}) => ({name: 'Sophia Sterling', email: 'Sophia@Example.com', agree: true, ...over});

test('a visitor request is a report, a bell and a post, marked as from connectome.quest', async () => {
  const {state, io} = world();
  assert.deepEqual(await visitorBeta(visitor({note: 'Played EyeWire in 2014'}), io), {requested: true});
  assert.equal(state.site_issues.length, 1);
  const r = state.site_issues[0];
  assert.equal(r.category, BETA_CATEGORY);
  assert.equal(r.user_id, null);
  assert.match(r.title, /Sophia Sterling \(connectome\.quest\)/);
  assert.match(r.message, /sophia@example\.com/);
  assert.match(r.message, /Played EyeWire in 2014/);
  assert.equal(state.bells.length, 1);
  assert.match(state.bells[0].title, /^🔑 Beta access request from Sophia Sterling$/);
  assert.match(state.bells[0].body, /Their note:\n\nPlayed EyeWire in 2014/);
  assert.equal(state.posts.length, 1);
});

test('the same email asks once: a second request is kept quiet', async () => {
  const {state, io} = world();
  await visitorBeta(visitor(), io);
  assert.deepEqual(await visitorBeta(visitor({email: 'sophia@example.com', name: 'Sophia'}), io), {requested: true, already: true});
  assert.equal(state.site_issues.length, 1);
  assert.equal(state.bells.length, 1);
});

test('a bot that fills the hidden field is told it worked, and nothing is stored', async () => {
  const {state, io} = world();
  assert.deepEqual(await visitorBeta(visitor({website: 'http://spam.example'}), io), {requested: true});
  assert.equal(state.site_issues.length + state.bells.length + state.posts.length, 0);
});

test('a visitor request is checked hard', async () => {
  const {state, io} = world();
  await assert.rejects(visitorBeta(visitor({name: ''}), io), /Your name is empty/);
  await assert.rejects(visitorBeta(visitor({name: '<script>x</script>'}), io), /letters, spaces/);
  await assert.rejects(visitorBeta(visitor({email: 'not an email'}), io), /email does not look right/);
  await assert.rejects(visitorBeta(visitor({agree: false}), io), /community principles/);
  await assert.rejects(visitorBeta(visitor({agree: 'true'}), io), /community principles/);
  await assert.rejects(visitorBeta(visitor({note: 'x'.repeat(501)}), io), /too long/);
  await assert.rejects(visitorBeta(null, io), /Your name is empty/);
  assert.equal(state.site_issues.length, 0);
});

test('a note is plain text in the bell: markdown is escaped', async () => {
  const {state, io} = world();
  await visitorBeta(visitor({note: '[click](http://evil.example) **bold**'}), io);
  assert.ok(!state.bells[0].body.includes('[click](http'));
  assert.match(state.bells[0].body, /\\\[click\\\]\\\(http/);
});

test('the bell and the post failing do not fail the visitor', async () => {
  const {state, io} = world();
  io.notifyAdmins = async () => { throw new Error('down'); };
  io.postIssue = async () => { throw new Error('down'); };
  assert.deepEqual(await visitorBeta(visitor(), io), {requested: true});
  assert.equal(state.site_issues.length, 1);
});

test('in the game, one email when the form email is the sign in email, and the note is in the bell', async () => {
  const {state, io} = world();
  const me = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'};
  await handle('access.beta', {name: 'Sophia Sterling', email: 'sophia@example.com', note: 'Hello there'},
    {...io, me, who: {email: 'Sophia@example.com'}});
  const body = state.bells[0].body;
  assert.equal(body.match(/sophia/g).length, 1);
  assert.ok(!/Sign in email/.test(body));
  assert.match(body, /Their note:\n\nHello there/);
  assert.equal(state.site_issues[0].message.match(/sophia@example\.com/g).length, 1);
});

test('in the game, both emails when they differ', async () => {
  const {state, io} = world();
  const me = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'};
  await handle('access.beta', {name: 'Sam', email: 'sam@home.example'}, {...io, me, who: {email: 'sam@work.example'}});
  assert.ok(state.bells[0].body.includes('Email they gave: sam\\@home'));
  assert.ok(state.bells[0].body.includes('Sign in email: sam\\@work'));
  assert.ok(!/Their note/.test(state.bells[0].body));
});
