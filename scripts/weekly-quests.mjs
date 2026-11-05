/**
 * weekly-quests.mjs
 * The week's Cilia Quest champions, for the Weekly Champions broadcast
 * (Ames 2026-11-05). Counted the way the leaderboard's Quests tab and the
 * profile count them (src/annotation_quests.ts questCounts, src/store.ts
 * loadQuestBoard): a sheet row whose status says the cilium was annotated or
 * that there is none, by the annotator's name, on the sheet's Date (M/D/YYYY,
 * a US Eastern day).
 *
 * The lab's sheet is private, so the rows come from the copy the server
 * keeps in ew_quest_sheet_rows (supabase-quest-sheet-mirror.sql).
 */

export const QUEST = 'retina_cilia';

/** Keep in step with questCounts in src/annotation_quests.ts. */
export const questCounts = (status) => /^\s*(cilium annotated|no cilium)/i.test(String(status ?? ''));
/** Keep in step with nameKey in src/annotation_quests.ts. */
export const nameKey = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** M/D/YYYY to YYYY-MM-DD, or null. */
export function sheetDay(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const t = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/** Quests per annotator in the week starting weekStart (a Monday,
 *  YYYY-MM-DD), most first; ties by name. [{key, name, count}] */
export function countQuestWeek(rows, weekStart) {
  const start = new Date(`${weekStart}T00:00:00Z`).getTime();
  const days = new Set(Array.from({ length: 7 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10)));
  const by = new Map();
  for (const r of rows) {
    const key = nameKey(r.annotator);
    if (!key || !questCounts(r.status) || !days.has(sheetDay(r.quest_date))) continue;
    const c = by.get(key) ?? { key, name: String(r.annotator).trim(), count: 0 };
    c.count++;
    by.set(key, c);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The week's top questers with the players behind the names:
 * [{user_id, name, count}]. A name no player matches keeps the sheet's
 * spelling and a stand in id (it shows, but opens no profile).
 * get(path) is a Supabase REST GET with the service key.
 */
export async function topQuesters(get, weekStart, limit = 20) {
  const rows = await get(`ew_quest_sheet_rows?quest=eq.${QUEST}&select=annotator,status,quest_date&limit=5000`);
  const top = countQuestWeek(rows, weekStart).slice(0, limit);
  if (!top.length) return [];
  const list = top.map(t => `"${t.name.replace(/["\\]/g, '')}"`).join(',');
  const enc = encodeURIComponent(`(${list})`);
  const [byName, byUser] = await Promise.all([
    get(`users?select=id,display_name,username&display_name=in.${enc}`).catch(() => []),
    get(`users?select=id,display_name,username&username=in.${enc}`).catch(() => []),
  ]);
  const players = new Map();
  for (const u of [...byName, ...byUser]) {
    for (const k of [nameKey(u.display_name), nameKey(u.username)]) if (k && !players.has(k)) players.set(k, u);
  }
  return top.map(t => {
    const u = players.get(t.key);
    return { user_id: u?.id ?? `sheet:${t.key}`, name: u?.display_name || t.name, count: t.count };
  });
}
