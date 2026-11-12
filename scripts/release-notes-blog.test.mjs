// Run: node --test scripts/release-notes-blog.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { weekOf, weekFromSlugDate, weekTitle, weekSummary, readDigestBody, buildWeekPost, publishWeek, american, LATEST_URL } from './release-notes-blog.mjs';

test('weeks run Monday to Sunday, Eastern', () => {
  // Sunday Nov 15, 11 pm Eastern is Monday 04:00 UTC: still the week of Nov 9.
  assert.equal(weekOf(Date.parse('2026-11-16T04:00:00Z')).slug, 'whats-new-in-pyr-2026-11-09');
  assert.equal(weekOf(Date.parse('2026-11-16T05:30:00Z')).slug, 'whats-new-in-pyr-2026-11-16');
  const w = weekFromSlugDate('2026-11-02');
  assert.equal(w.slug, 'whats-new-in-pyr-2026-11-02');
  // Daylight saving ended Nov 1: midnight Eastern is 05:00 UTC.
  assert.equal(new Date(w.startMs).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(weekTitle(w), "What's new in Pyr: week of November 2");
  assert.equal(weekSummary(w), 'Every update to Pyr from November 2 to 8, 2026, newest first.');
  assert.equal(weekSummary(weekFromSlugDate('2026-10-26')), 'Every update to Pyr from October 26 to November 1, 2026, newest first.');
  // A week that starts in daylight saving time.
  assert.equal(new Date(weekFromSlugDate('2026-10-26').startMs).toISOString(), '2026-10-26T04:00:00.000Z');
});

test('American spelling', () => {
  assert.equal(american('Colours stay, recognising cells in grey, cancelled'), 'Colors stay, recognizing cells in gray, canceled');
});

test('the note keeps its summary and highlights, not the list, the link or the numbers', () => {
  const { note, activity } = readDigestBody('**TLDR:** Big day.\n\n**New tool:** Does a thing.\n\n**All 9 updates:**\n- A\n- B\n\n' +
      `[Every update this week, on the blog](${LATEST_URL})\n\nPlayers made 5 edits and completed 1 cell.`);
  assert.deepEqual(note, ['Big day.', '**New tool:** Does a thing.']);
  assert.equal(activity, 'Players made 5 edits and completed 1 cell.');
});

const digests = [
  { send_at: '2026-11-08T21:32:00Z', body: '**TLDR:** Sunday things.' },
  { send_at: '2026-11-09T21:32:00Z', body: '**TLDR:** Monday things.\n\nPlayers made 10 edits and completed 2 cells.' },
  { send_at: '2026-11-10T21:32:00Z', body: '**TLDR:** Tuesday colours.' },
];
const changelog = [
  { at: '2026-11-08T20:00:00Z', title: 'Old one', items: ['Before the week.'] },
  { at: '2026-11-09T15:00:00Z', title: 'First', items: ['One.', 'Two.'] },
  { at: '2026-11-10T15:00:00Z', title: 'Pick your colours', items: ['Colour families.'] },
  { at: '2026-11-10T16:00:00Z', title: 'Second', items: [] },
];

test('a week is its days, newest first, each with every update in full', () => {
  const week = weekFromSlugDate('2026-11-09');
  const post = buildWeekPost(week, digests, changelog, { previousSlug: 'whats-new-in-pyr-2026-11-02' });
  assert.equal(post.slug, 'whats-new-in-pyr-2026-11-09');
  assert.equal(post.status, 'published');
  assert.equal(post.published_at, '2026-11-09T21:32:00.000Z');
  const b = post.body;
  assert.ok(b.indexOf('## Tuesday, November 10') < b.indexOf('## Monday, November 9'));
  assert.ok(!b.includes('Sunday things') && !b.includes('Old one'));
  assert.ok(b.includes('Tuesday colors.') && b.includes('- **Pick your colors.** Color families.'));
  assert.ok(b.includes('### All 2 updates') && b.includes('### The update\n\n- **First.** One. Two.'));
  assert.ok(b.includes('- Second'));
  assert.ok(b.includes('*Players made 10 edits and completed 2 cells.*'));
  assert.ok(b.endsWith('[The week before](/blog/whats-new-in-pyr-2026-11-02/)'));
  assert.equal(buildWeekPost(weekFromSlugDate('2026-11-16'), digests, changelog), null);
});

test('writes only after the SQL is in, and only when something changed', async () => {
  const written = [];
  let guard = false; let stored = [];
  const io = {
    rpc: async () => { if (!guard) throw new Error('404'); return true; },
    get: async (t) => t === 'notifications' ? digests : stored,
    upsert: async (t, row) => { written.push(row); stored = [row]; },
    changelog, now: new Date('2026-11-10T21:40:00Z'),
  };
  assert.match(await publishWeek(io), /run supabase-release-notes-blog\.sql first/);
  assert.equal(written.length, 0);
  guard = true;
  assert.match(await publishWeek(io), /started whats-new-in-pyr-2026-11-09/);
  assert.equal(written.length, 1);
  assert.match(await publishWeek(io), /up to date/);
  assert.equal(written.length, 1);
});
