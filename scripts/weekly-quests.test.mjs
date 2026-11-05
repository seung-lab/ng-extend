// node --test scripts/weekly-quests.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { countQuestWeek, topQuesters, sheetDay, questCounts } from './weekly-quests.mjs';

const rows = [
  { annotator: 'Celia D', status: 'Cilium annotated', quest_date: '11/2/2026' },            // Monday
  { annotator: 'celia d', status: 'No cilium (BB & DC clear)', quest_date: '11/8/2026' },   // Sunday, same player
  { annotator: 'Celia D', status: 'Need help', quest_date: '11/3/2026' },                  // does not count
  { annotator: 'Marissa Pratt', status: 'Cilium annotated (fixation artifact)', quest_date: '11/4/2026' },
  { annotator: 'Marissa Pratt', status: 'Cilium annotated', quest_date: '11/9/2026' },      // next week
  { annotator: 'Lab Person', status: 'No cilium', quest_date: '11/1/2026' },                // last week
  { annotator: 'Lab Person', status: 'Skipped (low quality)', quest_date: '11/5/2026' },
  { annotator: '', status: 'Cilium annotated', quest_date: '11/5/2026' },                   // no name
  { annotator: 'Nobody', status: 'Cilium annotated', quest_date: '' },                      // no date
];

test('the rule matches the leaderboard and profile', () => {
  assert.equal(questCounts('Cilium annotated'), true);
  assert.equal(questCounts('No cilium (one centriole)'), true);
  assert.equal(questCounts('Need help: One centriole missing'), false);
  assert.equal(questCounts('Skipped (low quality)'), false);
  assert.equal(sheetDay('11/2/2026'), '2026-11-02');
  assert.equal(sheetDay('2026-11-02'), null);
});

test('counts the Monday to Sunday week, by name, most first', () => {
  assert.deepEqual(countQuestWeek(rows, '2026-11-02').map(r => [r.name, r.count]), [['Celia D', 2], ['Marissa Pratt', 1]]);
  assert.deepEqual(countQuestWeek(rows, '2026-10-26').map(r => [r.name, r.count]), [['Lab Person', 1]]);
});

test('matches names to players; an unknown name keeps a stand in id', async () => {
  const get = async (path) => {
    if (path.startsWith('ew_quest_sheet_rows')) return rows;
    if (path.includes('display_name=in.')) return [{ id: 'u-celia', display_name: 'Celia D', username: 'celiad' }];
    return [];
  };
  const top = await topQuesters(get, '2026-11-02');
  assert.deepEqual(top, [
    { user_id: 'u-celia', name: 'Celia D', count: 2 },
    { user_id: 'sheet:marissapratt', name: 'Marissa Pratt', count: 1 },
  ]);
});
