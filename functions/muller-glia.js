'use strict';
/**
 * The Muller Glia Quest (Ames 2026-11-19): "a secondary quest about Muller glia
 * cells. The first section is confirming that it's a glia with a yes or no.
 * The second stage has users split two glia together that are merged."
 *
 * Rows come from the lab's All Glia tab, copied into muller_glia_cells by
 * scripts/muller-glia-import.py (supabase-muller-glia.sql has the tables).
 *
 *   glia.status            how far this player is, and whether Stage 2 is open
 *   glia.next  {n}         the next Stage 1 cells for this player (closest to a verdict first)
 *   glia.answer {cellId, answer}   yes | no | unsure, one per player per cell
 *   glia.undo  {cellId}    take an answer back (only while the cell is open)
 *   glia.mine              this player's latest answers
 *   glia.pairs             Stage 2: merged segments not split yet (opens after UNLOCK_AFTER answers)
 *   glia.check {pairSegment}  the server reads the cell at every soma of the group;
 *                          all different = split, recorded for this player
 *
 * Nothing here sends a bell, writes chat, awards an Achievement or touches a
 * stat: a branch test site shares this data, and Ames has not asked for any.
 * gliaAction(action, args, {db, me, isAdmin, somaRoots}) is the whole surface;
 * `db` is restDb (service key) or memDb (tests).
 */
const UNLOCK_AFTER = 10;
const ANSWERS = ['yes', 'no', 'unsure'];
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEG = /^\d{15,20}$/;

function cellOut(t) {
  return {id: Number(t.id), index: t.sheet_index, segmentId: t.segment_id, soma: t.soma_coords, guess: t.guess || '',
    yes: Number(t.yes || 0), no: Number(t.no || 0), unsure: Number(t.unsure || 0), verdict: t.verdict || 'open'};
}

async function gliaAction(action, args, {db, me, isAdmin = false, somaRoots}) {
  if (!me || !UUID.test(String(me.id || ''))) fail(403, 'No Pyr profile.');
  const meId = String(me.id).toLowerCase();
  const answered = () => db.countAnswers(meId);
  const unlocked = async () => isAdmin || (await answered()) >= UNLOCK_AFTER;

  switch (action) {
    case 'glia.status': {
      const n = await answered();
      return {installed: true, answered: n, unlockAfter: UNLOCK_AFTER, unlocked: isAdmin || n >= UNLOCK_AFTER,
        split: await db.countSplits(meId), ...(await db.totals())};
    }
    case 'glia.next': {
      const n = Math.min(Math.max(parseInt(args.n, 10) || 5, 1), 20);
      return {cells: (await db.next(meId, n)).map(cellOut)};
    }
    case 'glia.answer': {
      const cellId = parseInt(args.cellId, 10);
      if (!Number.isFinite(cellId) || cellId <= 0) fail(400, 'Which cell?');
      if (!ANSWERS.includes(args.answer)) fail(400, 'Answer yes, no or not sure.');
      const cell = await db.tally(cellId);
      if (!cell) fail(404, 'That cell is not in the quest.');
      if (cell.verdict !== 'open' && !(await db.getAnswer(cellId, meId))) fail(409, 'That cell already has its answer. On to the next one!');
      await db.putAnswer({cell_id: cellId, user_id: meId, answer: args.answer, answered_at: new Date().toISOString()});
      return {cell: cellOut(await db.tally(cellId)), answered: await answered()};
    }
    case 'glia.undo': {
      const cellId = parseInt(args.cellId, 10);
      if (!Number.isFinite(cellId) || cellId <= 0) fail(400, 'Which cell?');
      await db.deleteAnswer(cellId, meId);
      return {answered: await answered()};
    }
    case 'glia.mine': {
      return {answers: (await db.myAnswers(meId, 8)).map(a => ({cellId: Number(a.cell_id), answer: a.answer, at: a.answered_at,
        index: a.sheet_index || '', segmentId: a.segment_id || ''}))};
    }
    case 'glia.pairs': {
      if (!(await unlocked())) fail(403, `Stage 2 opens after ${UNLOCK_AFTER} answers in Stage 1.`);
      const [cells, done] = await Promise.all([db.stage2Cells(), db.splitSegments()]);
      const doneSet = new Set(done);
      const groups = new Map();
      for (const c of cells) {
        if (doneSet.has(c.pair_segment)) continue;
        if (!groups.has(c.pair_segment)) groups.set(c.pair_segment, []);
        groups.get(c.pair_segment).push({index: c.sheet_index, at: c.soma_coords});
      }
      const pairs = [...groups].map(([segmentId, glia]) => ({segmentId, glia}))
        .sort((a, b) => a.glia.length - b.glia.length || a.segmentId.localeCompare(b.segmentId));
      return {pairs, split: await db.countSplits(meId)};
    }
    case 'glia.check': {
      const seg = String(args.pairSegment || '');
      if (!SEG.test(seg)) fail(400, 'Which segment?');
      if (!(await unlocked())) fail(403, `Stage 2 opens after ${UNLOCK_AFTER} answers in Stage 1.`);
      const cells = await db.groupCells(seg);
      if (cells.length < 2) fail(404, 'That segment is not in the quest.');
      const prior = await db.getSplit(seg);
      if (prior) return {split: true, already: true, roots: prior.roots};
      const roots = await somaRoots(cells.map(c => c.soma_coords));
      if (roots.some(r => !r)) return {split: false, unreadable: true, roots};
      const split = new Set(roots).size === roots.length;
      if (split) await db.putSplit({pair_segment: seg, user_id: meId, roots, checked_at: new Date().toISOString()});
      return {split, roots};
    }
    default:
      fail(400, `unknown action ${action}`);
  }
}

/* ── Reading the cell at a place, on the server ────────────────────────────
 * The finest scale of the Retina segmentation is compressed_segmentation;
 * one chunk is fetched (public bucket) and decoded as neuroglancer does
 * (sliceview/compressed_segmentation/decode_uint64.ts). Then the chunked graph
 * gives that supervoxel's current root. Coordinates are viewer voxels
 * (16, 16, 40 nm on Retina), as the sheet writes them. */
function readUint64(data, base, chunkSize, block, pos) {
  let grid = 0, sub = 0, gridStride = 1, subStride = 1;
  for (let i = 0; i < 3; i++) {
    grid += Math.floor(pos[i] / block[i]) * gridStride;
    gridStride *= Math.ceil(chunkSize[i] / block[i]);
    sub += (pos[i] % block[i]) * subStride;
    subStride *= block[i];
  }
  const h = base + grid * 2;
  const h0 = data[h], h1 = data[h + 1];
  const bits = (h0 >>> 24) & 0xff;
  let v = 0;
  if (bits) {
    const word = Math.floor(sub * bits / 32), bit = (sub * bits) % 32;
    v = (data[base + h1 + word] >>> bit) & ((1 << bits) - 1);
  }
  const o = base + (h0 & 0xffffff) + v * 2;
  return ((BigInt(data[o + 1]) << 32n) | BigInt(data[o])).toString();
}

function makeSomaRoots({caveToken, server = 'https://minnie.microns-daf.com', table = 'stroeh_mouse_retina', viewerNm = [16, 16, 40], fetchImpl = fetch}) {
  let info = null;
  const auth = {Authorization: `Bearer ${caveToken}`};
  const get = (url, init = {}) => fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(15000), ...init});
  async function supervoxel(place) {
    if (!info) {
      const r = await get(`${server}/segmentation/table/${table}/info`, {headers: auth});
      if (!r.ok) throw new Error(`info ${r.status}`);
      info = await r.json();
    }
    const s = info.scales[0];
    const vox = place.map((v, i) => Math.floor(v * viewerNm[i] / s.resolution[i]));
    if (vox.some((v, i) => v < s.voxel_offset[i] || v >= s.voxel_offset[i] + s.size[i])) return '0';
    const ch = s.chunk_sizes[0];
    const c0 = vox.map((v, i) => s.voxel_offset[i] + Math.floor((v - s.voxel_offset[i]) / ch[i]) * ch[i]);
    const c1 = c0.map((v, i) => Math.min(v + ch[i], s.voxel_offset[i] + s.size[i]));
    const base = info.data_dir.replace(/^gs:\/\//, 'https://storage.googleapis.com/').replace(/\/$/, '');
    const r = await get(`${base}/${s.key}/${c0[0]}-${c1[0]}_${c0[1]}-${c1[1]}_${c0[2]}-${c1[2]}`);
    if (!r.ok) throw new Error(`chunk ${r.status}`);
    const data = new Uint32Array(await r.arrayBuffer());
    if (s.encoding !== 'compressed_segmentation') throw new Error(`encoding ${s.encoding}`);
    return readUint64(data, data[0], c1.map((v, i) => v - c0[i]), s.compressed_segmentation_block_size || [8, 8, 8], vox.map((v, i) => v - c0[i]));
  }
  async function root(sv) {
    const r = await get(`${server}/segmentation/api/v1/table/${table}/node/${sv}/root?int64_as_str=1`, {headers: auth});
    if (!r.ok) throw new Error(`root ${r.status}`);
    return String((await r.json()).root_id);
  }
  return async (somas) => Promise.all(somas.map(async s => {
    try {
      const xyz = String(s || '').split(',').map(Number);
      if (xyz.length !== 3 || xyz.some(n => !Number.isFinite(n))) return null;
      const sv = await supervoxel(xyz);
      return sv && sv !== '0' ? await root(sv) : null;
    } catch (e) { return null; }
  }));
}

function restDb(sb, rpc) {
  const rows = path => sb(path);
  return {
    countAnswers: async id => (await rows(`muller_glia_answers?user_id=eq.${id}&select=cell_id&limit=10000`)).length,
    countSplits: async id => (await rows(`muller_glia_splits?user_id=eq.${id}&select=pair_segment&limit=1000`)).length,
    totals: async () => {
      const t = await rows('muller_glia_tally?select=verdict&verdict=neq.open&limit=10000');
      const s = await rows('muller_glia_splits?select=pair_segment&limit=1000');
      return {confirmed: t.filter(x => x.verdict === 'confirmed').length, flagged: t.filter(x => x.verdict === 'flagged').length, splitAll: s.length};
    },
    next: async (id, n) => { const r = await rpc('muller_glia_next', {p_user: id, p_n: n}); if (r.status >= 400) throw new Error(`supabase ${r.status}`); return r.body || []; },
    tally: async cellId => (await rows(`muller_glia_tally?id=eq.${cellId}&limit=1`))[0] || null,
    getAnswer: async (cellId, id) => (await rows(`muller_glia_answers?cell_id=eq.${cellId}&user_id=eq.${id}&limit=1`))[0] || null,
    putAnswer: row => sb('muller_glia_answers?on_conflict=cell_id,user_id', {method: 'POST', body: JSON.stringify(row), headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}}),
    deleteAnswer: (cellId, id) => sb(`muller_glia_answers?cell_id=eq.${cellId}&user_id=eq.${id}`, {method: 'DELETE', headers: {Prefer: 'return=minimal'}}),
    myAnswers: async (id, n) => {
      const a = await rows(`muller_glia_answers?user_id=eq.${id}&order=answered_at.desc&limit=${n}`);
      if (!a.length) return [];
      const c = await rows(`muller_glia_cells?id=in.(${a.map(x => x.cell_id).join(',')})&select=id,sheet_index,segment_id`);
      const by = new Map(c.map(x => [String(x.id), x]));
      return a.map(x => ({...x, ...(by.get(String(x.cell_id)) || {})}));
    },
    stage2Cells: () => rows('muller_glia_cells?stage=eq.2&select=sheet_index,soma_coords,pair_segment&order=sheet_index&limit=2000'),
    splitSegments: async () => (await rows('muller_glia_splits?select=pair_segment&limit=2000')).map(x => x.pair_segment),
    groupCells: seg => rows(`muller_glia_cells?stage=eq.2&pair_segment=eq.${seg}&select=sheet_index,soma_coords&order=sheet_index`),
    getSplit: async seg => (await rows(`muller_glia_splits?pair_segment=eq.${seg}&limit=1`))[0] || null,
    putSplit: row => sb('muller_glia_splits?on_conflict=pair_segment', {method: 'POST', body: JSON.stringify(row), headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}}),
  };
}

/** The same tables in memory, for the tests. */
function memDb({cells = []} = {}) {
  const s = {cells: cells.map((c, i) => ({id: i + 1, ...c})), answers: [], splits: []};
  const tally = c => {
    const a = s.answers.filter(x => x.cell_id === c.id);
    const yes = a.filter(x => x.answer === 'yes').length, no = a.filter(x => x.answer === 'no').length;
    return {...c, yes, no, unsure: a.length - yes - no, answers: a.length, verdict: yes >= 3 ? 'confirmed' : no >= 2 ? 'flagged' : 'open'};
  };
  return {
    _state: s,
    countAnswers: async id => s.answers.filter(a => a.user_id === id).length,
    countSplits: async id => s.splits.filter(x => x.user_id === id).length,
    totals: async () => { const t = s.cells.filter(c => c.stage === 1).map(tally); return {confirmed: t.filter(x => x.verdict === 'confirmed').length, flagged: t.filter(x => x.verdict === 'flagged').length, splitAll: s.splits.length}; },
    next: async (id, n) => s.cells.filter(c => c.stage === 1).map(tally)
      .filter(t => t.verdict === 'open' && !s.answers.some(a => a.cell_id === t.id && a.user_id === id))
      .sort((a, b) => b.answers - a.answers || a.id - b.id).slice(0, n),
    tally: async id => { const c = s.cells.find(x => x.id === id && x.stage === 1); return c ? tally(c) : null; },
    getAnswer: async (cellId, id) => s.answers.find(a => a.cell_id === cellId && a.user_id === id) || null,
    putAnswer: async row => { const i = s.answers.findIndex(a => a.cell_id === row.cell_id && a.user_id === row.user_id); if (i >= 0) s.answers[i] = row; else s.answers.push(row); },
    deleteAnswer: async (cellId, id) => { s.answers = s.answers.filter(a => !(a.cell_id === cellId && a.user_id === id)); },
    myAnswers: async (id, n) => s.answers.filter(a => a.user_id === id).slice(-n).reverse().map(a => { const c = s.cells.find(x => x.id === a.cell_id) || {}; return {...a, sheet_index: c.sheet_index, segment_id: c.segment_id}; }),
    stage2Cells: async () => s.cells.filter(c => c.stage === 2),
    splitSegments: async () => s.splits.map(x => x.pair_segment),
    groupCells: async seg => s.cells.filter(c => c.stage === 2 && c.pair_segment === seg),
    getSplit: async seg => s.splits.find(x => x.pair_segment === seg) || null,
    putSplit: async row => { if (!s.splits.some(x => x.pair_segment === row.pair_segment)) s.splits.push(row); },
  };
}

module.exports = {gliaAction, makeSomaRoots, readUint64, restDb, memDb, UNLOCK_AFTER};
