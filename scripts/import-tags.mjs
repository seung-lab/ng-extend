/**
 * import-tags.mjs
 * One-time script to import segment tags from Google Sheet into Supabase.
 * Run: node scripts/import-tags.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://javthknksdcrlhiaaptj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphdnRoa25rc2RjcmxoaWFhcHRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzUyOTIsImV4cCI6MjA4ODIxMTI5Mn0.APdwuQ-uudyHISBr7Dj6HTylO7qavJ0HhB32E5X434g';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1E8iKSW6lCMU0zeA-hiUtB_M8h0bkWP8mBYalm_7IDXY/export?format=csv&gid=0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  console.log('Fetching CSV from Google Sheets...');
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const text = await res.text();

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  console.log(`Got ${lines.length} lines (including header)`);

  // Find header
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].toLowerCase().includes('segment')) { headerIdx = i; break; }
  }

  const header = lines[headerIdx].split(',').map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  console.log('Header:', header);

  const col = (name) => header.findIndex(h => h.includes(name));
  const iSeg = col('segment');
  const iTag = col('tag');

  if (iSeg < 0) throw new Error('No "Segment" column found');
  console.log(`Segment col: ${iSeg}, Tag col: ${iTag}`);

  // Check if already imported
  const { count } = await supabase
    .from('segment_tags')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'spreadsheet_import');

  if (count && count > 0) {
    console.log(`Already have ${count} imported rows. Skipping to avoid duplicates.`);
    console.log('To reimport, first DELETE FROM segment_tags WHERE source = \'spreadsheet_import\';');
    return;
  }

  const toInsert = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < lines.length; r++) {
    // Handle CSV fields that might contain commas in quotes
    const fields = lines[r].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
    const segId = fields[iSeg] || '';
    if (!segId || !/^\d+$/.test(segId)) { skipped++; continue; }

    toInsert.push({
      segment_id: segId,
      tag: iTag >= 0 ? (fields[iTag] || '') : '',
      source: 'spreadsheet_import',
      dataset: 'eyewire_ii',
    });
  }

  console.log(`Parsed ${toInsert.length} segments (${skipped} skipped)`);

  // Count labeled vs unlabeled
  const labeled = toInsert.filter(r => r.tag !== '').length;
  console.log(`  Labeled: ${labeled}, Unlabeled: ${toInsert.length - labeled}`);

  // Batch insert
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const { error } = await supabase.from('segment_tags').insert(batch);
    if (error) {
      console.error(`Batch ${Math.floor(i/batchSize)+1} error:`, error.message);
      throw error;
    }
    inserted += batch.length;
    process.stdout.write(`\r  Inserted ${inserted}/${toInsert.length}`);
  }

  console.log('\nImport complete!');

  // Verify
  const { count: total } = await supabase
    .from('segment_tags')
    .select('*', { count: 'exact', head: true });
  console.log(`Total rows in segment_tags: ${total}`);
}

main().catch(e => { console.error('Import failed:', e.message); process.exit(1); });
