'use strict';
// The Eyewire II Principles (Ames 2026-10-27): asked once per account and
// version when a player opens the Retina dataset. Rules in access-request.js.
// Run: cd functions && node --test principles.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {handle, PRINCIPLES_VERSION} = require('./access-request');

function world() {
  const store = {};
  const principles = {get: async k => store[k] || null, set: async (k, v) => { store[k] = v; }};
  const io = (over = {}) => ({principles, me: {id: 'u-1', username: 'sam'}, who: {email: 'Sam@Example.org'}, ...over});
  return {store, io};
}

test('not agreed yet, then agreed, for this version', async () => {
  const {store, io} = world();
  assert.deepEqual(await handle('access.principlesStatus', {}, io()), {version: PRINCIPLES_VERSION, agreed: false, at: null});
  const out = await handle('access.principlesAgree', {version: PRINCIPLES_VERSION}, io());
  assert.equal(out.agreed, true);
  const rec = store['user:u-1'];
  assert.equal(rec.version, PRINCIPLES_VERSION);
  assert.equal(rec.email, 'sam@example.org', 'the email is the server-checked sign in, lower case');
  assert.equal(rec.name, 'sam');
  assert.ok(!Number.isNaN(Date.parse(rec.at)));
  const st = await handle('access.principlesStatus', {}, io());
  assert.equal(st.agreed, true);
  assert.equal(st.at, rec.at);
});

test('asked only ever once: an agreement to any version counts, and the first one stands', async () => {
  const {store, io} = world();
  await assert.rejects(handle('access.principlesAgree', {version: '2020-01-01'}, io()), /updated/);
  await assert.rejects(handle('access.principlesAgree', {}, io()), /updated/);
  assert.deepEqual(store, {});
  store['user:u-1'] = {version: '2020-01-01', at: '2020-01-01T00:00:00Z'};
  const st = await handle('access.principlesStatus', {}, io());
  assert.equal(st.agreed, true, 'an older agreement still counts (Ames: "only ever ask them this once")');
  const again = await handle('access.principlesAgree', {version: PRINCIPLES_VERSION}, io());
  assert.equal(again.at, '2020-01-01T00:00:00Z');
  assert.equal(store['user:u-1'].version, '2020-01-01', 'never written over');
});

test('each account is asked on its own; with no profile yet the sign in email is the key', async () => {
  const {store, io} = world();
  await handle('access.principlesAgree', {version: PRINCIPLES_VERSION}, io());
  assert.equal((await handle('access.principlesStatus', {}, io({me: {id: 'u-2'}}))).agreed, false);
  await handle('access.principlesAgree', {version: PRINCIPLES_VERSION}, io({me: null, who: {email: 'New@Example.org'}}));
  assert.ok(store['email:new@example.org']);
  await assert.rejects(handle('access.principlesStatus', {}, io({me: null, who: {}})), /profile is not ready/);
});

test('nothing the browser sends changes who agreed or when', async () => {
  const {store, io} = world();
  await handle('access.principlesAgree', {version: PRINCIPLES_VERSION, userId: 'u-999', email: 'someone@else.org', at: '1999-01-01T00:00:00Z'}, io());
  assert.ok(!store['user:u-999']);
  assert.equal(store['user:u-1'].email, 'sam@example.org');
  assert.notEqual(store['user:u-1'].at, '1999-01-01T00:00:00Z');
});
