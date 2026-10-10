#!/usr/bin/env node
/**
 * check-changelog.mjs
 * Run by the deploy workflow on every push to the live branch (Ames
 * 2026-10-10: the "New version ready" notice kept showing an old summary).
 *
 * 1. static/changelog.json must be well formed, and no entry may be dated in
 *    the future: a future date made one entry look new to everybody all day.
 * 2. A push that changes what players get (src/, static/, third_party/) must
 *    add an entry saying so, in the same push. When the change really is
 *    invisible to players (a refactor, an admin tool, a test), say so by
 *    putting [no player change] in a commit message of the push.
 *
 * Usage: node scripts/check-changelog.mjs [<before sha>]
 * Exits 1 with a plain explanation when a rule is broken.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'static/changelog.json';
const OPT_OUT = /\[no player change\]/i;
const ADMIN_ONLY = /^src\/components\/(AdminHub|TriagePage)\.vue$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const fail = msg => { console.error(`\n[changelog] ${msg}\n\nThe rule is in README.md, section CHANGELOG-RULE.`); process.exit(1); };

/** Parse and validate; returns the entries. */
export function readEntries(text, now = Date.now()) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`${FILE} is not valid JSON: ${e.message}`); }
  if (!Array.isArray(data?.entries)) throw new Error(`${FILE} has no "entries" list`);
  data.entries.forEach((e, i) => {
    const where = `entry ${i + 1}${e?.title ? ` ("${e.title}")` : ''}`;
    if (!e || typeof e.title !== 'string' || !e.title.trim()) throw new Error(`${where} has no title`);
    if (!Array.isArray(e.items) || !e.items.length || e.items.some(x => typeof x !== 'string' || !x.trim())) throw new Error(`${where} needs at least one sentence in "items"`);
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) throw new Error(`${where} has no readable "at" time`);
    if (at > now + 20 * 60_000) throw new Error(`${where} is dated in the future (${e.at}). Use the time of this push, in UTC`);
    if (/[–—]/.test(e.title + e.items.join(' '))) throw new Error(`${where} has a long dash in it. Use commas and full stops`);
  });
  return data.entries;
}
const keyOf = e => `${e.at}|${e.title}`;

/** What the push changed, and whether it owes players an entry. */
export function verdict({ changedFiles, entriesBefore, entriesNow, messages }) {
  // Admin Hub and the triage page are seen by admins only.
  const visible = changedFiles.filter(f => /^(src|static|third_party)\//.test(f) && f !== FILE && !ADMIN_ONLY.test(f));
  const had = new Set(entriesBefore.map(keyOf));
  const added = entriesNow.filter(e => !had.has(keyOf(e)));
  if (!visible.length) return { ok: true, why: 'nothing players get was changed' };
  if (added.length) return { ok: true, why: `${added.length} new entr${added.length === 1 ? 'y' : 'ies'}: ${added.map(e => e.title).join('; ')}` };
  if (OPT_OUT.test(messages)) return { ok: true, why: 'marked [no player change]' };
  return { ok: false, visible };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-changelog.mjs')) {
  let now;
  try { now = readEntries(fs.readFileSync(FILE, 'utf8')); } catch (e) { fail(e.message); }
  const before = process.argv[2] || '';
  if (!/^[0-9a-f]{40}$/.test(before) || /^0+$/.test(before)) { console.log('[changelog] file is valid; no earlier commit to compare with'); process.exit(0); }
  let changedFiles, old, messages;
  try {
    changedFiles = git('diff', '--name-only', `${before}..HEAD`).split('\n').filter(Boolean);
    messages = git('log', '--format=%B', `${before}..HEAD`);
    try { old = readEntries(git('show', `${before}:${FILE}`), Infinity); } catch { old = []; }
  } catch (e) { console.log(`[changelog] file is valid; could not compare with ${before.slice(0, 7)} (${e.message.split('\n')[0]})`); process.exit(0); }
  const v = verdict({ changedFiles, entriesBefore: old, entriesNow: now, messages });
  if (v.ok) { console.log(`[changelog] ok: ${v.why}`); process.exit(0); }
  fail(`This push changes what players get, but adds no entry to ${FILE}:\n`
    + v.visible.slice(0, 12).map(f => `  ${f}`).join('\n') + (v.visible.length > 12 ? `\n  and ${v.visible.length - 12} more` : '')
    + `\n\nAdd an entry at the TOP of "entries" (at = now in UTC, a short title, one plain sentence per item) and push again.`
    + `\nIf players cannot notice this change, put [no player change] in the commit message instead.`);
}
