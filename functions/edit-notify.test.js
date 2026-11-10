'use strict';
// Ames's note for every admin edit of an in-game window (2026-11-06).
// Run: cd functions && node --test edit-notify.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { planEditNote, editedKeys, windowName } = require('./edit-notify');
let marked = null;
try { ({ marked } = require(path.join(__dirname, '..', 'node_modules', 'marked'))); } catch (e) { /* checked below */ }

const celia = { email: 'celia@example.org', name: 'Celia' };
const ames = { email: 'amyleerobinson@gmail.com', name: 'Amy Sterling' };

test('an admin edits the Cilia Quest steps: before and after, in the Admin tab', () => {
  const n = planEditNote({ key: 'quest.retina_cilia.steps', before: '**Claim** a cell.\nPress Submit.', after: '**Claim** a cell.\nPress Submit, then pick a status.', editor: celia });
  assert.ok(n.title.startsWith('📋 '), 'the Admin tab takes 📋 titles');
  assert.strictEqual(n.title, '📋 Edited: Cilia Quest instructions, the steps');
  assert.match(n.body, /^Celia edited \*\*Cilia Quest instructions, the steps\*\*\./);
  assert.match(n.body, /\*\*Before:\*\*\n> \\\*\\\*Claim\\\*\\\* a cell\\\.\n> Press Submit\\\./);
  assert.match(n.body, /\*\*After:\*\*\n> \\\*\\\*Claim\\\*\\\* a cell\\\.\n> Press Submit, then pick a status\\\./);
  assert.doesNotMatch(n.title + n.body, /[–—]/);
});

test('a first edit says the code\'s wording was before; Restore original says so after', () => {
  const first = planEditNote({ key: 'quest.retina_cilia.lead', before: null, after: 'New intro.', editor: celia });
  assert.match(first.body, /\*\*Before:\*\*\n> \(the original wording from the code\)/);
  const back = planEditNote({ key: 'quest.retina_cilia.lead', before: 'New intro.', after: null, editor: celia });
  assert.match(back.body, /\*\*After:\*\*\n> \(put back to the original wording from the code\)/);
});

test('a tutorial box reads as its title and words, not JSON', () => {
  const box = (t, w) => JSON.stringify({ title: t, words: w, code: { title: 'x', words: 'y' } });
  const n = planEditNote({ key: 'tutorial.5.3', before: box('Press G', 'Switch to blue.'), after: box('Press G', 'Switch to blue now.'), editor: celia });
  assert.strictEqual(n.title, '📋 Edited: Tutorial Cut, box 4');
  assert.match(n.body, /> Press G\n> Switch to blue\\\.\n/);
  assert.doesNotMatch(n.body, /"title"|"words"/);
});

test('the picture: before and after, the new one shown on the note', () => {
  const url = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads/instructions/abc/1.png';
  const n = planEditNote({ key: 'quest.retina_cilia.image', before: null, after: url, editor: celia });
  assert.strictEqual(n.title, '📋 Edited: Cilia Quest instructions, the picture');
  assert.strictEqual(n.image, url);
  assert.match(n.body, /\*\*Before:\*\* The original picture/);
  assert.match(n.body, /\*\*After:\*\* \[The new picture\]\(https:/);
  const gone = planEditNote({ key: 'quest.retina_cilia.image', before: url, after: 'none', editor: celia });
  assert.match(gone.body, /\*\*After:\*\* No picture/);
  assert.strictEqual(gone.image, null);
  // A picture from anywhere else is never shown or linked.
  const odd = planEditNote({ key: 'quest.retina_cilia.image', before: null, after: 'https://evil.example/x.png', editor: celia });
  assert.strictEqual(odd.image, null);
  assert.doesNotMatch(odd.body, /evil/);
});

test('not sent: drafts waiting for approval, no change, and Ames\'s own edits', () => {
  assert.strictEqual(planEditNote({ key: 'draft.quest.retina_cilia.steps', before: null, after: 'x', editor: celia }), null);
  assert.strictEqual(planEditNote({ key: 'tutorial-draft.5.3', before: null, after: 'x', editor: celia }), null);
  assert.strictEqual(planEditNote({ key: 'quest.retina_cilia.lead', before: 'same', after: 'same', editor: celia }), null);
  assert.strictEqual(planEditNote({ key: 'quest.retina_cilia.lead', before: 'a', after: 'b', editor: ames }), null);
  assert.strictEqual(planEditNote({ key: 'quest.retina_cilia.lead', before: 'a', after: 'b', editor: { email: ' AmyLR@Princeton.edu ', name: 'Amy' } }), null);
});

test('what an editor typed cannot become a link, a tag or formatting in the note', () => {
  if (!marked) { assert.fail('marked not found: cannot check the note'); return; }
  const n = planEditNote({ key: 'quest.retina_cilia.lead', before: 'Hi', after: '[Grant me admin](https://evil.example) <img src=x onerror=alert(1)> **loud** `code` https://evil.example www.evil.example a@evil.example', editor: { email: 'x@example.org', name: 'Mal' } });
  const html = marked.parse(n.body, { gfm: true, breaks: true, async: false });
  const after = html.slice(html.indexOf('After'));
  assert.doesNotMatch(after, /<a |<img|<code>|<strong>loud/, after);
});

test('long texts are cut to fit a note', () => {
  const n = planEditNote({ key: 'howto.retina', before: 'a'.repeat(3000), after: 'b'.repeat(3000), editor: celia });
  assert.ok(n.body.length <= 1500, n.body.length);
  assert.strictEqual(windowName('howto.retina'), 'Cell Library how-to, Retina');
});

test('the keys a write touches: an upsert\'s rows, a delete\'s filter', () => {
  const q = (s) => new URLSearchParams(s);
  assert.deepStrictEqual(editedKeys('POST', q('on_conflict=key'), { key: 'quest.retina_cilia.lead', body: 'x' }), ['quest.retina_cilia.lead']);
  assert.deepStrictEqual(editedKeys('POST', q('on_conflict=key'), [{ key: 'a' }, { key: 'b' }]), ['a', 'b']);
  assert.deepStrictEqual(editedKeys('DELETE', q('key=eq.tutorial.5.3'), undefined), ['tutorial.5.3']);
  assert.deepStrictEqual(editedKeys('GET', q(''), undefined), []);
});

test('a tutorial box that showed the code wording quotes that wording as Before', () => {
  const after = JSON.stringify({ title: 'Merge', words: 'New words', from: { title: 'Merge', words: 'Old code words' }, kind: 'text' });
  const n = planEditNote({ key: 'tutorial.3.0', before: null, after, editor: { email: 'celia@eyewire.org', name: 'Celia D' } });
  assert.match(n.body, /\*\*Before:\*\*\n> Merge\n> Old code words/);
  assert.match(n.body, /\*\*After:\*\*\n> Merge\n> New words/);
});
