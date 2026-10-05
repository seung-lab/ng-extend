#!/usr/bin/env node
/**
 * leaderboard-compare.mjs  (READ ONLY)
 *
 * Shows what supabase-leaderboard-accuracy.sql would change, before it is
 * applied: for every player, the board's numbers now beside the numbers under
 * the new rule; and for every saved weekly podium, what is saved beside what
 * the new rule gives for that week.
 *
 * It sends only reads, with the app's public key. It copies the public rows
 * into an in-memory PostgreSQL on this machine, applies the new SQL THERE,
 * and compares. Nothing is written to Supabase.
 *
 *   cd functions && npm ci --legacy-peer-deps && cd ..
 *   node scripts/leaderboard-compare.mjs            # prints a summary
 *   node scripts/leaderboard-compare.mjs out.json   # and saves every row
 */
import fs from 'node:fs';
import { PGlite } from '../functions/node_modules/@electric-sql/pglite/dist/index.js';

const here = p => new URL(p, import.meta.url);
const src = fs.readFileSync(here('../src/supabase.ts'), 'utf8');
const URL_ = process.env.SUPABASE_URL || src.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || src.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
if (!URL_ || !KEY) { console.error('Could not find the public Supabase URL and key.'); process.exit(1); }

async function readAll(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    if (!res.ok) throw new Error(`GET ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const observedAt = new Date().toISOString();
const [board, logRows, winners] = await Promise.all([
  readAll('user_edit_counts?select=*&order=id'),
  readAll('edit_log?select=id,task_id,user_id,operation,timestamp,metadata,dataset,success&order=id'),
  readAll('weekly_winners?select=week_start,rank,user_id,edits,metric&order=week_start,metric,rank'),
]);

const db = new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE TABLE users(id uuid PRIMARY KEY,display_name text,flag text,bio text,total_edits integer,total_merges integer,
    total_splits integer,cells_completed integer,current_streak integer,longest_streak integer,last_edit_date date,
    total_annotations integer,updated_at timestamptz);
  CREATE TABLE edit_log(id bigint PRIMARY KEY,task_id integer,user_id uuid,operation text,timestamp timestamptz,
    segment_before text,segment_after text,coordinates text,metadata jsonb,dataset text,success boolean);
  CREATE TABLE weekly_winners(week_start date,rank integer,user_id uuid,edits integer,metric text,UNIQUE(week_start,rank,metric));`);
const load = (table, rows) => db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(rows)]);
await load('users', board);
await load('edit_log', logRows);
await load('weekly_winners', winners);
// The comparison must be made at the moment the live numbers were read.
const sql = fs.readFileSync(here('../supabase-leaderboard-accuracy.sql'), 'utf8').replaceAll('NOW()', `TIMESTAMPTZ '${observedAt}'`);
await db.exec(sql);

const name = new Map(board.map(u => [u.id, u.display_name || 'Anonymous']));
const proposed = (await db.query('SELECT * FROM user_edit_counts ORDER BY id')).rows;
const COLS = ['edits_24h', 'edits_week', 'edits_alltime', 'completions_24h', 'completions_week', 'completions_alltime'];
const players = board.map(now => {
  const next = proposed.find(p => p.id === now.id);
  const row = { id: now.id, name: name.get(now.id), changed: [] };
  for (const c of COLS) { row[c] = { now: now[c], proposed: next[c] }; if (now[c] !== next[c]) row.changed.push(c); }
  // Not shown on the board: what the log alone gives for all time.
  row.edits_logged = next.edits_logged; row.completions_logged = next.completions_logged;
  return row;
});

const weeks = [];
const keys = [...new Set(winners.map(w => `${w.week_start}|${w.metric}`))];
for (const k of keys) {
  const [week_start, metric] = k.split('|');
  const saved = winners.filter(w => w.week_start === week_start && w.metric === metric)
    .map(w => ({ rank: w.rank, name: name.get(w.user_id) ?? w.user_id, count: w.edits }));
  const fresh = (await db.query('SELECT rank,user_id,count FROM ew_weekly_ranking($1,$2,5)', [week_start, metric])).rows
    .map(r => ({ rank: r.rank, name: name.get(r.user_id) ?? r.user_id, count: r.count }));
  const same = JSON.stringify(saved) === JSON.stringify(fresh.slice(0, saved.length)) && saved.length === Math.min(3, fresh.length);
  weeks.push({ week_start, metric, same, saved, proposed: fresh });
}
await db.close();

const changed = players.filter(p => p.changed.length);
console.log(`Read at ${observedAt}: ${board.length} players, ${logRows.length} log rows, ${winners.length} saved podium rows.`);
console.log(`\nBoard: ${changed.length} of ${players.length} players would see a different number.`);
for (const p of changed) console.log(`  ${p.name}: ` + p.changed.map(c => `${c} ${p[c].now} -> ${p[c].proposed}`).join(', '));
const off = players.filter(p => p.edits_alltime.now !== p.edits_logged || p.completions_alltime.now !== p.completions_logged);
console.log(`\nAll time (saved counter beside the log's own count; nothing is changed by the SQL): ${off.length} players differ.`);
for (const p of off) console.log(`  ${p.name}: edits ${p.edits_alltime.now} saved / ${p.edits_logged} logged, cells ${p.completions_alltime.now} saved / ${p.completions_logged} logged`);
const diff = weeks.filter(w => !w.same);
console.log(`\nSaved podiums: ${diff.length} of ${weeks.length} differ from the new rule (none is rewritten by the SQL).`);
const line = l => l.map(r => `${r.rank}. ${r.name} ${r.count}`).join(' | ') || '(none)';
for (const w of diff) console.log(`  ${w.week_start} ${w.metric}\n    saved:    ${line(w.saved)}\n    proposed: ${line(w.proposed)}`);
if (process.argv[2]) { fs.writeFileSync(process.argv[2], JSON.stringify({ observedAt, players, weeks }, null, 2)); console.log(`\nSaved every row to ${process.argv[2]}`); }
