import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {exportResult, regularFiles} from './triage-export.mjs';
import {validateResult} from './triage-policy.mjs';

function world(base, changed, left, summary = 'Fixed the button.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-export-'));
  const put = (dir, files) => { for (const [p, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, dir, p)), {recursive: true}); fs.writeFileSync(path.join(root, dir, p), text); } };
  put('base', base); put('pack/files', changed);
  put('pack/pack', {'triage-summary.md': summary, 'all-files': left.map(p => './' + p).join('\0') + '\0'});
  return {root, pack: path.join(root, 'pack'), base: path.join(root, 'base')};
}
const text = f => f.content === null ? null : Buffer.from(f.content, 'base64').toString('utf8');

test('edits, new files and deletions are found against the clean checkout', () => {
  const base = {'src/a.ts': 'one', 'src/b.ts': 'two', 'src/gone.ts': 'bye', 'scripts/triage-export.mjs': 'trusted'};
  const w = world(base, {'src/a.ts': 'ONE', 'src/b.ts': 'two', 'docs/new.md': 'hello'}, ['src/a.ts', 'src/b.ts', 'docs/new.md', 'scripts/triage-export.mjs']);
  const r = exportResult(w.pack, w.base, Object.keys(base));
  assert.deepEqual(r.files.map(f => [f.path, text(f)]), [['docs/new.md', 'hello'], ['src/a.ts', 'ONE'], ['src/gone.ts', null]]);
  assert.equal(r.summary, 'Fixed the button.');
  assert.doesNotThrow(() => validateResult(r));
});

test('a rewritten script is only data here, and the publisher refuses it', () => {
  const base = {'src/a.ts': 'one', 'scripts/triage-export.mjs': 'trusted'};
  const w = world(base, {'scripts/triage-export.mjs': 'process.exit(0)', '.triage/triage-prompt.md': 'x', '.git/config': '[core] fsmonitor = evil'}, ['src/a.ts', 'scripts/triage-export.mjs']);
  const r = exportResult(w.pack, w.base, Object.keys(base));
  assert.deepEqual(r.files.map(f => f.path), ['scripts/triage-export.mjs']);
  assert.throws(() => validateResult(r), /reviewed pull request/);
});

test('links and other odd entries in the pack are refused', {skip: process.platform === 'win32'}, () => {
  const w = world({'src/a.ts': 'one'}, {'src/a.ts': 'ONE'}, ['src/a.ts']);
  fs.symlinkSync('/etc/passwd', path.join(w.pack, 'files', 'src', 'link.ts'));
  assert.throws(() => regularFiles(path.join(w.pack, 'files')), /Only regular files/);
  assert.throws(() => exportResult(w.pack, w.base, ['src/a.ts']), /Only regular files/);
});

test('nothing written means nothing to publish', () => {
  const w = world({'src/a.ts': 'one'}, {}, ['src/a.ts'], 'QUESTION: which button?');
  assert.deepEqual(exportResult(w.pack, w.base, ['src/a.ts']), {summary: 'QUESTION: which button?', files: []});
});
