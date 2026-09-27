export function validateResetExample(ex, manifest) {
  const pinned = manifest[ex.id];
  if (!pinned) throw new Error('Practice example has no reviewed reset manifest');
  for (const key of ['kind','pcg_server','pcg_table','supervoxel_a','supervoxel_b','baseline_at']) {
    if (ex[key] !== pinned[key]) throw new Error(`Practice reset configuration changed: ${key}`);
  }
  if (ex.pcg_server !== 'https://minnie.microns-daf.com' || ex.pcg_table !== 'pinky_nf_v2') throw new Error('Unapproved reset sandbox');
  if (!/^\d{1,20}$/.test(ex.supervoxel_a) || !/^\d{1,20}$/.test(ex.supervoxel_b) || !Number.isFinite(Date.parse(ex.baseline_at))) throw new Error('Invalid pinned example');
  return `${ex.pcg_server}/segmentation/api/v1/table/${ex.pcg_table}`;
}

export function resetDue(ex, now, force = false) {
  // Never interrupt a learner, even on a manually forced reset.
  if (ex.status === 'in_use' && (!ex.expires_at || Date.parse(ex.expires_at) > now)) return false;
  if (ex.status === 'resetting' && Date.parse(ex.updated_at) > now - 15 * 60 * 1000) return false;
  return force || ex.status === 'needs_reset' || ex.status === 'in_use' || ex.status === 'resetting';
}

export function overlapsActive(ex, rows, now) {
  const pieces=new Set([ex.supervoxel_a,ex.supervoxel_b].filter(Boolean));
  return rows.some(other => other.id!==ex.id && !resetDue(other,now,true) &&
    [other.supervoxel_a,other.supervoxel_b].some(sv=>pieces.has(sv)));
}

export function parsePcgStamp(value) {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(\.\d+)?$/.test(value)) return parsePcgStamp(Number(value));
  const iso = value.replace(' ', 'T');
  return Date.parse(iso + (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
}

export function operationsAfter(data, rootId, baseline) {
  // The API wraps pandas' JSON by root ID; deployments expose records or columns.
  let rows = data[String(rootId)] ?? data;
  if (typeof rows === 'string') rows = JSON.parse(rows);
  if (!Array.isArray(rows)) {
    if (!Object.hasOwn(rows,'operation_id') || !Object.hasOwn(rows,'timestamp')) throw Error('Unrecognized CAVE operation history shape');
    const ids = rows.operation_id ?? {};
    rows = Object.keys(ids).map(i => ({operation_id: ids[i], timestamp: rows.timestamp?.[i]}));
  }
  const ops = rows.map(row => ({operationId:Number(row.operation_id),at:parsePcgStamp(row.timestamp)}));
  if (ops.some(row => !Number.isSafeInteger(row.operationId) || row.operationId < 0 || !Number.isFinite(row.at) || row.at > Date.now()+60000)) throw Error('Unrecognized CAVE operation history');
  return ops.filter(row => row.at > Date.parse(baseline))
    .sort((a,b) => b.at - a.at);
}
