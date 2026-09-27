export function validateResetExample(ex, manifest) {
  const pinned = manifest[ex.id];
  if (!pinned) throw new Error('Practice example has no reviewed reset manifest');
  for (const key of ['pcg_server','pcg_table','supervoxel_a','supervoxel_b','baseline_at']) {
    if (ex[key] !== pinned[key]) throw new Error(`Practice reset configuration changed: ${key}`);
  }
  if (ex.pcg_server !== 'https://minnie.microns-daf.com' || ex.pcg_table !== 'pinky_nf_v2') throw new Error('Unapproved reset sandbox');
  if (!/^\d{1,20}$/.test(ex.supervoxel_a) || !/^\d{1,20}$/.test(ex.supervoxel_b) || !Number.isFinite(Date.parse(ex.baseline_at))) throw new Error('Invalid pinned example');
  return `${ex.pcg_server}/segmentation/api/v1/table/${ex.pcg_table}`;
}
