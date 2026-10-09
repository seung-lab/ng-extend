// Writes functions/achievement-thresholds.json from the achievement
// definitions the app uses (src/widgets/badge_definitions.ts), so the server
// can check an earned achievement without a second, hand kept list.
// Only the Editor (building) and Cell Completions (exploration) tracks: the
// ones that are live. Run after changing a threshold or a name:
//   node scripts/build-achievement-thresholds.js
// functions/achievements.test.js fails if the two fall out of step.
const fs = require('fs');
const path = require('path');

function readDefinitions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'widgets', 'badge_definitions.ts'), 'utf8');
  const re = /\{ id: (\d+), track: '(building|exploration)', sequence: \d+, slug: '([^']+)', code: '[^']*', name: '([^']+)'[^\n]*?threshold: ([\d_]+)/g;
  const rows = [...src.matchAll(re)].map(m => ({id: Number(m[1]), track: m[2], slug: m[3], name: m[4], threshold: Number(m[5].replace(/_/g, ''))}));
  // Loyalty (live 2026-10-09) is written by hand as loyalty(n, days, 'slug', 'CODE', 'Name', ...); its id is 200 + n.
  const loyal = /^\s*loyalty\((\d+),\s*(\d+),\s*'([^']+)',\s*'[^']*',\s*'([^']+)'/gm;
  for (const m of src.matchAll(loyal)) rows.push({id: 200 + Number(m[1]), track: 'loyalty', slug: m[3], name: m[4], threshold: Number(m[2])});
  return rows;
}

if (require.main === module) {
  const rows = readDefinitions();
  if (rows.length !== 224) throw new Error(`expected 224 achievements (200 and 24 Loyalty), read ${rows.length}`);
  const out = path.join(__dirname, '..', 'functions', 'achievement-thresholds.json');
  fs.writeFileSync(out, '[\n' + rows.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
  console.log(`wrote ${rows.length} achievements to ${out}`);
}
module.exports = {readDefinitions};
