'use strict';
/**
 * Nicknames (Nseraf, report 602; Ames 2026-11-21: "Nickname it is"). A
 * player's own name for a cell, such as "cell I merged a branch into", that is
 * not a cell type: it never goes to CAVE or the lab, and only that player sees
 * it. It follows the cell through merges and cuts: the row keeps every ID the
 * cell has had (ids) and a supervoxel inside it (anchor_sv), from which the
 * game finds the cell's ID now. Table: supabase-nicknames.sql.
 *
 *   nicknames.list   this player's nicknames
 *   nicknames.set    { segId, nickname, anchorSv?, ids?, dataset? }: segId is
 *                    the cell's first ID (the key); an empty nickname deletes
 *   nicknames.track  { segId, ids }: IDs the cell has had since, added
 */

const ID = /^\d{15,20}$/;
const SV = /^\d{1,20}$/;
const MAX_IDS = 50;
const MAX_LEN = 80;
const MAX_ROWS = 2000;

function bad(message, status = 400) { const e = new Error(message); e.status = status; return e; }
const eq = v => 'eq.' + encodeURIComponent(String(v));
const cleanIds = list => (Array.isArray(list) ? list : []).map(String).filter(x => ID.test(x));

async function nicknamesAction(action, args, io) {
  const { sb, me } = io;
  if (!me || !me.id) throw bad('Your Pyr profile is not ready yet. Reload the page, then try again.', 403);
  args = args && typeof args === 'object' ? args : {};

  if (action === 'nicknames.list') {
    const rows = await sb(`ew_cell_nicknames?user_id=${eq(me.id)}&select=seg_id,ids,anchor_sv,nickname,dataset,updated_at&order=updated_at.desc&limit=${MAX_ROWS}`);
    return { nicknames: rows };
  }

  const segId = String(args.segId || '');
  if (!ID.test(segId)) throw bad('Not a segment ID.');
  const had = (await sb(`ew_cell_nicknames?user_id=${eq(me.id)}&seg_id=${eq(segId)}&select=id,ids,anchor_sv&limit=1`))[0];
  const merge = extra => [...new Set([segId, ...((had && had.ids) || []), ...cleanIds(extra)])].slice(-MAX_IDS);

  if (action === 'nicknames.set') {
    const nickname = String(args.nickname || '').replace(/\s+/g, ' ').trim();
    if (nickname.length > MAX_LEN) throw bad(`A nickname is ${MAX_LEN} characters at most.`);
    if (!nickname) {
      if (had) await sb(`ew_cell_nicknames?id=eq.${had.id}`, { method: 'DELETE' });
      return { saved: true, deleted: true };
    }
    const anchor = args.anchorSv != null && SV.test(String(args.anchorSv)) ? String(args.anchorSv) : (had ? had.anchor_sv : null);
    const fields = { nickname, ids: merge(args.ids), anchor_sv: anchor, updated_at: new Date().toISOString() };
    if (args.dataset) fields.dataset = String(args.dataset).slice(0, 64);
    if (had) await sb(`ew_cell_nicknames?id=eq.${had.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    else {
      const count = await sb(`ew_cell_nicknames?user_id=${eq(me.id)}&select=id&limit=${MAX_ROWS}`);
      if (count.length >= MAX_ROWS) throw bad(`You have ${MAX_ROWS} nicknames, the most allowed. Clear one first.`);
      await sb('ew_cell_nicknames', { method: 'POST', body: JSON.stringify({ user_id: me.id, seg_id: segId, ...fields }) });
    }
    return { saved: true, ids: fields.ids };
  }

  if (action === 'nicknames.track') {
    if (!had) return { saved: false };
    const ids = merge(args.ids);
    await sb(`ew_cell_nicknames?id=eq.${had.id}`, { method: 'PATCH', body: JSON.stringify({ ids }) });
    return { saved: true, ids };
  }

  throw bad(`unknown action ${action}`);
}

module.exports = { nicknamesAction, MAX_LEN };
