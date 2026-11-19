// Turns what the model job left behind into result.json, as inert data.
//
// Trusted code, run in a job the model never touched (security review
// 2026-11-13, finding 5). It used to run inside the model's own checkout,
// right after the model, where the model's file tools could have rewritten
// this very script, or the repository's git settings, before it ran.
//
// Now the model job only packs files; nothing from its checkout is executed.
// This reads that pack:
//   <pack>/pack/all-files           every file path left in the model's tree, NUL separated
//   <pack>/files/...                the files written since the model started
//   <pack>/pack/triage-summary.md   the model's summary
// and compares it with a clean checkout of the commit the model started from.
// The publisher (triage-secure.mjs) still validates every path and byte.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SKIP = /^(?:\.git|node_modules|\.triage|model-output)(?:\/|$)/;
const clean = p => String(p).replace(/^\.\//, '');
const plain = p => p && !p.startsWith('/') && !p.split('/').some(s => s === '..' || s === '') && !SKIP.test(p);

/** Every regular file under dir, as paths relative to it. Anything else is refused. */
export function regularFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), {withFileTypes: true})) {
    const p = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...regularFiles(dir, p));
    else if (entry.isFile()) out.push(p);
    else throw Error('Only regular files may be published: ' + p);
  }
  return out;
}

/**
 * @param packDir   the opened pack from the model job
 * @param baseDir   a clean checkout of the commit the model started from
 * @param tracked   that commit's tracked paths
 */
export function exportResult(packDir, baseDir, tracked) {
  const summaryFile = path.join(packDir, 'pack', 'triage-summary.md');
  if (!fs.lstatSync(summaryFile).isFile()) throw Error('The summary is not a regular file');
  const summary = fs.readFileSync(summaryFile, 'utf8');
  const left = new Set(fs.readFileSync(path.join(packDir, 'pack', 'all-files'), 'utf8').split('\0').map(clean).filter(Boolean));
  const filesDir = path.join(packDir, 'files');
  const files = [];
  for (const p of fs.existsSync(filesDir) ? regularFiles(filesDir).sort() : []) {
    if (!plain(p)) continue;
    const content = fs.readFileSync(path.join(filesDir, p));
    const before = path.join(baseDir, p);
    // Touched but unchanged is not a change.
    if (tracked.includes(p) && fs.existsSync(before) && fs.lstatSync(before).isFile() && fs.readFileSync(before).equals(content)) continue;
    files.push({path: p, content: content.toString('base64')});
  }
  for (const p of tracked) if (plain(p) && !left.has(p)) files.push({path: p, content: null});
  return {summary, files};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [packDir, baseDir] = process.argv.slice(2);
  if (!packDir || !baseDir) throw Error('usage: triage-export.mjs <pack dir> <clean checkout>');
  const tracked = execFileSync('git', ['-C', baseDir, 'ls-files', '-z'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\0').filter(Boolean);
  fs.mkdirSync('model-output', {recursive: true});
  fs.writeFileSync('model-output/result.json', JSON.stringify(exportResult(packDir, baseDir, tracked)));
}
