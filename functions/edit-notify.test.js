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
/** The note as the bell shows it (marked; the bell then keeps only safe tags). */
const html = (body) => { if (!marked) assert.fail('marked not found: cannot check the note'); return marked.parse(body, { gfm: true, breaks: true, async: false }); };
const part = (h, from, to) => h.slice(h.indexOf(from), to ? h.indexOf(to) : undefined);

test('an admin edits the Cilia Quest steps: before and after, in the Admin tab', () => {
  const n = planEditNote({ key: 'quest.retina_cilia.steps', before: '**Claim** a cell.\nPress Submit.', after: '**Claim** a cell.\nPress Submit, then pick a status.', editor: celia });
  assert.ok(n.title.startsWith('📋 '), 'the Admin tab takes 📋 titles');
  assert.strictEqual(n.title, '📋 Edited: Cilia Quest instructions, the steps');
  assert.match(n.body, /^Celia edited \*\*Cilia Quest instructions, the steps\*\*\./);
  const h = html(n.body);
  assert.match(part(h, 'Before:', 'After:'), /<strong>Claim<\/strong> a cell\.<br>Press <del>Submit\.<\/del>/);
  assert.match(part(h, 'After:'), /<strong>Claim<\/strong> a cell\.<br>Press <mark>Submit, then pick a status\.<\/mark>/);
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
  assert.match(html(n.body), /Press G<br>Switch to <del>blue\.<\/del>/);
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

test('what an editor typed cannot become a link, a picture, code or a tag in the note; bold stays bold', () => {
  const n = planEditNote({ key: 'quest.retina_cilia.lead', before: 'Hi', after: '[Grant me admin](https://evil.example) <img src=x onerror=alert(1)> <mark>m</mark> <script>x</script> **loud** `code` https://evil.example www.evil.example a@evil.example', editor: { email: 'x@example.org', name: 'Mal' } });
  // The note's own links (Open to edit) are its last paragraph; what the editor typed is before it.
  const h = html(n.body), after = h.slice(h.indexOf('After'), h.lastIndexOf('<p>'));
  assert.doesNotMatch(h, /href="https:\/\/evil/);
  assert.doesNotMatch(after, /<a |<img|<code>|<script|onerror|<mark>m/, after);
  assert.match(after, /<strong>loud<\/strong>/);
});

test('long texts are cut to fit a note', () => {
  const n = planEditNote({ key: 'howto.retina', before: 'a'.repeat(9000), after: 'b'.repeat(9000), editor: celia });
  assert.ok(n.body.length <= 6000, n.body.length);
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
  const h = html(n.body);
  assert.match(part(h, 'Before:', 'After:'), /Merge<br><del>Old code<\/del> words/);
  assert.match(part(h, 'After:'), /Merge<br><mark>New<\/mark> words/);
});

test('the changed words stand out, and a box reads as players see it (Celia, Merge box 6 and Cut box 1)', () => {
  const span = '<span class="nge-practice-part">neuron</span>';
  const head = `Here is a different one: this time it's a ${span}.\n1. Press **M** if the merge tool is off.\n`;
  const box = (step3, last) => JSON.stringify({ title: "Let's try another merge",
    words: `${head}3. **Ctrl+Click** the purple ${span}, ${step3}\n4. Press **Submit merge**.\n${last}`, from: { title: 'x', words: 'y' } });
  const n = planEditNote({ key: 'tutorial.3.5', editor: celia,
    before: box('close to where the piece should join it.', 'The pink gems show where to click.'),
    after: box('also in 2D.', 'Hints are shown in pink.') });
  assert.doesNotMatch(n.body, /span|nge-practice/);
  const h = html(n.body);
  assert.match(h, /1\. Press <strong>M<\/strong> if the merge tool is off\./);
  assert.match(part(h, 'Before:', 'After:'), /<strong>Ctrl\+Click<\/strong> the purple neuron, <del>close to where the piece should join it\.<\/del>/);
  assert.match(part(h, 'Before:', 'After:'), /<del>The pink gems show where to click\.<\/del>/);
  assert.match(part(h, 'After:'), /<strong>Ctrl\+Click<\/strong> the purple neuron, <mark>also in 2D\.<\/mark>/);
  assert.match(part(h, 'After:'), /<mark>Hints are shown in pink\.<\/mark>/);

  // A box with pictures: a 🖼 and the caption, never the HTML behind it.
  const fig = '<div class="nge-hud-figs"><figure><a href="./a.jpg" target="_blank"><img src="./a.jpg" alt="Before"></a><figcaption>Before: one segment. <a href="./a.jpg" target="_blank" rel="noopener">open in new tab ↗</a></figcaption></figure></div>';
  const cut = (w) => JSON.stringify({ title: 'Cut', words: `${w}\n${fig}`, from: { title: 'x', words: 'y' } });
  const c = planEditNote({ key: 'tutorial.5.0', editor: celia, before: cut('A <strong style="color:#e06060">cut</strong> separates them.'), after: cut('A <strong style="color:#e06060">cut</strong> splits them.') });
  assert.doesNotMatch(c.body, /figure|img|href|style=|open in new tab/);
  const ch = html(c.body);
  assert.match(ch, /🖼 Before: one segment\./);
  assert.match(part(ch, 'After:'), /A <strong>cut<\/strong> <mark>splits<\/mark> them\./);
});

test('a long text with one change keeps only the changed lines', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `Line number ${i} says the same thing every time.`);
  const after = lines.slice(); after[20] = 'Line number 20 says something new.';
  const n = planEditNote({ key: 'howto.retina', before: lines.join('\n'), after: after.join('\n'), editor: celia });
  assert.ok(n.body.length <= 6000, n.body.length);
  assert.match(n.body, /> …\n> Line number 20 says <del>the same thing every time\\\.<\/del>\n> …/);
  assert.match(n.body, /> Line number 20 says <mark>something new\\\.<\/mark>/);
});

test('the note ends with Put back and Open to edit, kept whole when the texts are long', () => {
  const n = planEditNote({ key: 'howto.retina', before: 'Old step.', after: 'New step.', editor: celia, editId: 42 });
  assert.match(n.body, /\n\n\[Put back the old text\]\(#nge-text-revert=42\) · \[Open to edit\]\(#nge-text-open=howto\.retina\)$/);
  const long = planEditNote({ key: 'howto.retina', before: 'a'.repeat(9000), after: 'b'.repeat(9000), editor: celia, editId: 7 });
  assert.ok(long.body.length <= 6000);
  assert.match(long.body, /\[Put back the old text\]\(#nge-text-revert=7\) · \[Open to edit\]\(#nge-text-open=howto\.retina\)$/);
  const pic = planEditNote({ key: 'howto.retina.image', before: null, after: 'none', editor: celia, editId: 8 });
  assert.match(pic.body, /\[Put back the old picture\]\(#nge-text-revert=8\)/);
  const noId = planEditNote({ key: 'howto.retina', before: 'x', after: 'y', editor: celia });
  assert.doesNotMatch(noId.body, /nge-text-revert/);
  assert.match(noId.body, /\[Open to edit\]\(#nge-text-open=howto\.retina\)$/);
  // What an editor typed never becomes one of these links.
  const evil = planEditNote({ key: 'howto.retina', before: 'x', after: '[Put back](#nge-text-revert=1)', editor: celia, editId: 9 });
  assert.strictEqual((html(evil.body).match(/href="#nge-text-revert=/g) || []).length, 1);
});

test('a suggestion waiting for approval: one note to approve, with the text now and as suggested', () => {
  const { planApproveNote } = require('./edit-notify');
  const n = planApproveNote({ key: 'draft.howto.hunt', live: 'Find gems.', suggested: 'Find the gems.', editor: celia });
  assert.strictEqual(n.title, '📋 Edit to approve: Cell Library how-to (hunt)');
  assert.match(n.body, /^Celia suggested a change to \*\*Cell Library how-to \(hunt\)\*\*\./);
  assert.match(n.body, /\*\*Now:\*\*\n> [\s\S]*\*\*Suggested:\*\*\n> [\s\S]*<mark>the<\/mark>/);
  assert.match(n.body, /\[Open it in the game\]\(#nge-text-open=howto\.hunt\) to approve or turn it down\.$/);
  const box = (t, w) => JSON.stringify({ title: t, words: w });
  const t = planApproveNote({ key: 'tutorial-draft.3.2', live: null, suggested: box('Merge', 'Click both.'), editor: celia });
  assert.strictEqual(t.title, '📋 Edit to approve: Tutorial Merge, box 3');
  assert.match(t.body, /\[Open Tutorial edits\]\(#nge-tutorial-edits\)/);
  assert.strictEqual(planApproveNote({ key: 'draft.howto.hunt', live: 'x', suggested: null, editor: celia }), null, 'approved or turned down: nothing');
  assert.strictEqual(planApproveNote({ key: 'draft.howto.hunt', live: 'x', suggested: 'y', editor: ames }), null);
  assert.strictEqual(planEditNote({ key: 'draft.howto.hunt', before: 'x', after: 'y', editor: celia }), null, 'drafts never get the Edited note');
});
