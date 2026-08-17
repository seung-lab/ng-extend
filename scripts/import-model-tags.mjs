/**
 * import-model-tags.mjs
 * Import machine-detected merge-error candidates (Sven/Fuming's per-neuron
 * window exports) into Supabase.
 *
 *   suspect windows -> issue_tags   (source 'model', tag_type 'merger')
 *   ALL windows     -> model_windows (feeds the per-neuron AI heat layer)
 *
 * File format (schema_version 1, .json or .json.gz):
 *   { neuron: { latest_root_id, datastack }, metadata: {...},
 *     windows: [{ idx, center_um: [x,y,z] MICRONS, verify_prob, is_suspect,
 *                 tokens?: { pos_rel_um: [[x,y,z]...], labels: [0|1...],
 *                            spectral: { score, ... } } }] }
 *
 * Requires the columns added by supabase-issue-tags-model.sql.
 *
 * Run: node scripts/import-model-tags.mjs [--force] file1.json.gz [file2 ...]
 *   --force  delete previously imported rows for each file's neuron first
 * With no file arguments it imports Sven's two demo files from ~/Downloads.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';

const SUPABASE_URL = 'https://javthknksdcrlhiaaptj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphdnRoa25rc2RjcmxoaWFhcHRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzUyOTIsImV4cCI6MjA4ODIxMTI5Mn0.APdwuQ-uudyHISBr7Dj6HTylO7qavJ0HhB32E5X434g';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEFAULT_FILES = [
  `${homedir()}/Downloads/sven_1_864691135375361480_hybrid.json.gz`,
  `${homedir()}/Downloads/sven_2_864691135258774191_hybrid.json.gz`,
];

// datastack (from the export file) -> canonical dataset tag (src/datasets.ts)
// and voxel size in nm. Positions are stored in voxels like every other
// issue_tags row: vox = um * 1000 / nm_per_voxel.
// Voxel sizes verified against each volume's precomputed info: minnie65 em
// mip0 is 8x8x40 nm (bossdb), NOT the 4x4x40 sometimes quoted; importing at
// 4 nm put every marker 2x out along x/y, off the edge of the dataset.
const DATASTACK_MAP = {
  minnie65_public: { dataset: 'minnie65_public', voxelNm: [8, 8, 40] },
  minnie65_public_v117: { dataset: 'minnie65_public', voxelNm: [8, 8, 40] },
  pinky_sandbox: { dataset: 'pinky_nf_v2', voxelNm: [4, 4, 40] },
  stroeh_mouse_retina: { dataset: 'stroeh_mouse_retina', voxelNm: [16, 16, 40] },
};

function umToVox(um, voxelNm) {
  return [
    Math.round(um[0] * 1000 / voxelNm[0]),
    Math.round(um[1] * 1000 / voxelNm[1]),
    Math.round(um[2] * 1000 / voxelNm[2]),
  ];
}

function loadExport(path) {
  const raw = readFileSync(path);
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const data = JSON.parse(text);
  if (data.schema_version !== 1) {
    console.warn(`  schema_version is ${data.schema_version}, expected 1; attempting anyway`);
  }
  return data;
}

async function importFile(path, force) {
  console.log(`\n=== ${path}`);
  const data = loadExport(path);
  const rootId = String(data.neuron.latest_root_id);
  const datastack = data.neuron.datastack;
  const map = DATASTACK_MAP[datastack];
  if (!map) throw new Error(`Unknown datastack "${datastack}" — add it to DATASTACK_MAP`);
  const { dataset, voxelNm } = map;
  const batch = path.split('/').pop().replace(/\.json(\.gz)?$/, '');
  const windows = data.windows ?? [];
  const suspects = windows.filter(w => w.is_suspect);
  console.log(`  root ${rootId} on ${datastack} -> dataset ${dataset}`);
  console.log(`  ${windows.length} windows, ${suspects.length} suspects`);

  // Existing rows for this neuron?
  const { count: existing } = await supabase
    .from('issue_tags')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'model')
    .eq('segment_id', rootId);
  if (existing && existing > 0) {
    if (!force) {
      console.log(`  ${existing} model tags already exist for this neuron. Skipping (use --force to replace).`);
      return { dataset, rootId, tags: 0, windows: 0, skipped: true };
    }
    console.log(`  --force: deleting ${existing} old model tags and this neuron's windows`);
    await supabase.from('issue_tags').delete().eq('source', 'model').eq('segment_id', rootId);
    await supabase.from('model_windows').delete().eq('dataset', dataset).eq('root_id', rootId);
  }

  // 1. Suspect windows -> issue_tags, highest confidence first so the
  //    realtime feed and any created_at ordering read hottest-first.
  const tagRows = suspects
    .slice()
    .sort((a, b) => b.verify_prob - a.verify_prob)
    .map(w => ({
      dataset,
      segment_id: rootId,
      position: JSON.stringify(umToVox(w.center_um, voxelNm)),
      tag_type: 'merger',
      note: 'AI candidate',
      user_name: 'Merge Detector (AI)',
      status: 'open',
      source: 'model',
      confidence: w.verify_prob,
      model_data: {
        windowIdx: w.idx,
        batch,
        centerUm: w.center_um,
        posRelUm: w.tokens?.pos_rel_um ?? null,
        labels: w.tokens?.labels ?? null,
        spectralScore: w.tokens?.spectral?.score ?? null,
      },
    }));

  // 2. ALL windows -> model_windows.
  const windowRows = windows.map(w => ({
    dataset,
    root_id: rootId,
    window_idx: w.idx,
    position: JSON.stringify(umToVox(w.center_um, voxelNm)),
    verify_prob: w.verify_prob,
    is_suspect: !!w.is_suspect,
    batch,
  }));

  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < tagRows.length; i += BATCH) {
    const { error } = await supabase.from('issue_tags').insert(tagRows.slice(i, i + BATCH));
    if (error) throw new Error(`issue_tags insert: ${error.message}`);
    n += Math.min(BATCH, tagRows.length - i);
    process.stdout.write(`\r  issue_tags: ${n}/${tagRows.length}`);
  }
  console.log();
  n = 0;
  for (let i = 0; i < windowRows.length; i += BATCH) {
    const { error } = await supabase.from('model_windows').insert(windowRows.slice(i, i + BATCH));
    if (error) throw new Error(`model_windows insert: ${error.message}`);
    n += Math.min(BATCH, windowRows.length - i);
    process.stdout.write(`\r  model_windows: ${n}/${windowRows.length}`);
  }
  console.log();
  return { dataset, rootId, tags: tagRows.length, windows: windowRows.length, skipped: false };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const files = args.filter(a => a !== '--force');
  const targets = files.length ? files : DEFAULT_FILES;

  const results = [];
  for (const f of targets) results.push(await importFile(f, force));

  console.log('\nDone.');
  for (const r of results) {
    console.log(`  ${r.rootId} (${r.dataset}): ${r.skipped ? 'skipped' : `${r.tags} tags, ${r.windows} windows`}`);
  }
}

main().catch(e => { console.error('\nImport failed:', e.message); process.exit(1); });
