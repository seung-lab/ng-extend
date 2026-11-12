'use strict';
/**
 * Our own Pyr users sheet (Ames 2026-11-09: "we should just have our own
 * users spreadsheet then Celia can have her own"; "make our own Pyr users
 * sheet"). The game owns it and rewrites the whole Users tab each time:
 * every hour (ewUsersSheet) and on an admin's "Update the sheet now" (the
 * Access page, ewQuestReview action usersSheet). Hand edits there are
 * overwritten, except in the two hand columns, Known name and Other email
 * (Celia 2026-11-10: "manual input columns for Name and secondary email,
 * since we have known information for some players that is different from
 * their Pyr or account usernames/emails"). Each rewrite reads those first
 * and puts them back on the same person's row, by email; a person no longer
 * listed keeps their row at the bottom, so nothing typed is lost.
 * Can edit: the datasets a player can edit, from CAVE (Celia: "which
 * datasets they have edit access on"); when CAVE can't say, the last value
 * stays.
 *
 * One row per person on Pilot testers or who asked for the beta, from the
 * view access_hub_people (supabase-access-hub.sql), plus CAVE IDs from users.
 * Chat is a count only (Ames: "chat counts are ok just not chat messages").
 */
const USERS_SHEET_ID = '10VW3cSrtK8y0pLlivJnQIuMAp65_B-eDJAVb3DbpKBs';
const TAB = 'Users';

const PEOPLE_COLS = 'email,user_id,name,username,request_id,asked_at,from_site,gave_email,ew_name,ew_rank,found_us,their_note,pilot_enabled,let_in_at,from_list,joined_at,tutorial_at,tutorials,first_edit_at,last_edit_at,edits,last_dataset,edits_30d,cells,cells_30d,chats_30d,help_asked,help_answered_for,help_given,is_admin';

const KNOWN = 'Known name', OTHER = 'Other email', CAN_EDIT = 'Can edit';
const HEADERS = ['Name', 'Email', KNOWN, OTHER, 'Step', 'Pyr username', 'EyeWire username', 'EyeWire rank', 'CAVE ID', CAN_EDIT,
  'Asked', 'Let in', 'Signed in', 'First tutorial done', 'Tutorials finished', 'First edit', 'Last edit', 'Last dataset',
  'Edits', 'Edits, 30 days', 'Cells done', 'Cells done, 30 days', 'Help asked', 'Help asked, answered', 'Help given',
  'Chat messages, 30 days', 'How they found us', 'Added from a pasted list', 'Their note when they asked'];

// The steps, in the Access page's words and order.
const STEPS = ['Asked', 'Let in', 'Signed in', 'Tutorial done', 'Editing', 'Admin', 'Removed or paused'];
function stepOf(p, mark) {
  if (p.is_admin) return 'Admin'; // Ames 2026-11-10: "show admins as Admin"
  if (p.pilot_enabled === false) return 'Removed or paused';
  if (!p.pilot_enabled) {
    if (mark && mark.mark === 'removed' && (!p.asked_at || String(mark.at) > String(p.asked_at))) return 'Removed or paused';
    return p.request_id ? 'Asked' : 'Removed or paused';
  }
  if (!p.user_id) return 'Let in';
  if (p.edits > 0) return 'Editing';
  if (p.tutorial_at) return 'Tutorial done';
  return 'Signed in';
}

// Dataset ids in the game's own short names (src/datasets.ts); others as is.
const DATASETS = {
  stroeh_mouse_retina: 'EyeWire II (Retina)', eyewire_ii: 'EyeWire II (Retina)', eyewire_ii_retina: 'EyeWire II (Retina)',
  pni_mec: 'MEC', zheng_ca3: 'CA3', minnie65_public: 'MICrONS', flywire_fafb_public: 'FlyWire', flywire_fafb_production: 'FlyWire',
  brain_and_nerve_cord: 'BANC',
};
const dsName = (d) => !d ? '' : DATASETS[d] || (/^pinky/.test(d) ? 'Sandbox' : d);
// CAVE's dataset names (permissions_v2 keys, src/datasets.ts caveDataset).
const CAVE_DATASETS = {
  'stroeh-mouse-retina': 'Retina', HiMC: 'MEC', 'zheng-mouse-hc': 'CA3', BANC: 'BANC', fafb: 'FlyWire',
  flywire_public: 'FlyWire public', minnie65: 'MICrONS', microns_public: 'MICrONS public', pinky100: 'Sandbox',
};
const caveName = (d) => CAVE_DATASETS[d] || d;
/** "Retina, MEC": the datasets a CAVE permissions answer lets them edit. */
function editList(perms) {
  if (!perms) return null;
  const merged = {};
  for (const src of [perms.permissions_v2_ignore_tos, perms.permissions_v2]) {
    for (const [ds, list] of Object.entries(src || {})) merged[ds] = [...new Set([...(merged[ds] || []), ...(Array.isArray(list) ? list : [])])];
  }
  // Practice datasets everyone gets (sandboxes, pinky100, debug sets) would
  // bury the real ones, so they are left out.
  const practice = (ds) => /sandbox|^pinky|^fake_/i.test(ds);
  return [...new Set(Object.keys(merged).filter(ds => !practice(ds) && merged[ds].includes('edit')).map(caveName))].sort().join(', ');
}
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const yes = (b) => (b ? 'Yes' : '');
// A cell a sheet would read as a formula is kept as text.
const text = (v) => { const s = String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 500); return /^[=+\-@]/.test(s) ? "'" + s : s; };
const isTest = (email) => /@example\.(org|com|net)$|\.invalid$/i.test(String(email || ''));

/** kept: {email: {known, other, canEdit}} read back from the sheet; canEdit:
 *  {user_id: "Retina, MEC"} from CAVE (null or missing: CAVE couldn't say). */
function rows(people, caveIds = {}, marks = {}, kept = {}, canEdit = {}) {
  const listed = new Set();
  // People we only emailed (no request, not let in, never signed in) stay
  // off the sheet; the Access page lists them on their own.
  const out = people.filter(p => p.email && !isTest(p.email) && (p.request_id || p.pilot_enabled != null || p.user_id || p.is_admin)).map(p => {
    const step = stepOf(p, marks[p.email]);
    const k = kept[String(p.email).toLowerCase()] || {};
    listed.add(String(p.email).toLowerCase());
    const edit = p.user_id && typeof canEdit[p.user_id] === 'string' ? canEdit[p.user_id] : (k.canEdit || '');
    return { step, row: [
      text(p.name), text(p.email), text(k.known), text(k.other), step, text(p.username), text(p.ew_name), text(p.ew_rank), p.user_id && caveIds[p.user_id] != null ? String(caveIds[p.user_id]) : '',
      text(edit), day(p.asked_at), day(p.let_in_at), day(p.joined_at), day(p.tutorial_at), p.tutorials || 0, day(p.first_edit_at), day(p.last_edit_at), dsName(p.last_dataset),
      p.edits || 0, p.edits_30d || 0, p.cells || 0, p.cells_30d || 0, p.help_asked || 0, p.help_answered_for || 0, p.help_given || 0,
      p.chats_30d || 0, text(p.found_us), yes(p.from_list), text(p.their_note),
    ] };
  });
  out.sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step) || String(a.row[0] || a.row[1]).localeCompare(String(b.row[0] || b.row[1])));
  // Typed in for someone no longer listed: kept, at the bottom.
  const gone = Object.entries(kept).filter(([e, k]) => !listed.has(e) && (k.known || k.other)).sort(([a], [b]) => a.localeCompare(b))
    .map(([e, k]) => { const r = new Array(HEADERS.length).fill(''); r[1] = text(e); r[2] = text(k.known); r[3] = text(k.other); r[4] = NOT_LISTED; return r; });
  return [...out.map(x => x.row), ...gone];
}
const NOT_LISTED = 'Not listed now';

/** What the hand columns hold now, by email, from the tab's current values. */
function readKept(values) {
  const head = (values && values[0]) || [];
  const at = (h) => head.indexOf(h);
  const iEmail = at('Email'), iKnown = at(KNOWN), iOther = at(OTHER), iEdit = at(CAN_EDIT);
  const kept = {};
  if (iEmail < 0) return kept;
  for (const r of values.slice(1)) {
    const email = String(r[iEmail] || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const cell = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const k = { known: cell(iKnown), other: cell(iOther), canEdit: cell(iEdit) };
    if (k.known || k.other || k.canEdit) kept[email] = k;
  }
  return kept;
}

/** Each signed in player's CAVE edit access, a few at a time. */
async function editAccess(caveIds, io) {
  if (!io.cavePerms) return {};
  const ids = Object.entries(caveIds);
  const out = {};
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async ([uid, cave]) => {
      try { const list = editList(await io.cavePerms(cave)); if (list != null) out[uid] = list; } catch (e) { /* the last value stays */ }
    }));
  }
  return out;
}

/** Rewrite the Users tab. io: { api (sheets), sb (service key), marks? } */
async function syncUsersSheet(io, { sheetId = USERS_SHEET_ID, now = new Date() } = {}) {
  const people = await io.sb(`access_hub_people?select=${PEOPLE_COLS}&order=email&limit=5000`);
  const users = await io.sb('users?select=id,cave_user_id&cave_user_id=not.is.null&limit=5000');
  const caveIds = Object.fromEntries((users || []).map(u => [u.id, u.cave_user_id]));
  const marks = io.marks ? await io.marks.all().catch(() => ({})) : {};
  const range = (r) => encodeURIComponent(`'${TAB}'!${r}`);
  // The hand columns, read before anything is cleared. If they can't be
  // read, stop: a rewrite now would wipe them.
  const now_ = await io.api(`${sheetId}/values/${range('A1:AZ20000')}`, { method: 'GET' });
  const kept = readKept((now_ && now_.values) || []);
  const inList = new Set((people || []).map(p => p.user_id).filter(Boolean));
  const canEdit = await editAccess(Object.fromEntries(Object.entries(caveIds).filter(([u]) => inList.has(u))), io);
  const body = rows(people || [], caveIds, marks, kept, canEdit);
  const stamp = `Updated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC by Pyr. Type only in ${KNOWN} and ${OTHER}: they are kept. Everything else is replaced every hour.`;
  const values = [HEADERS, ...body, [], [stamp]];
  await io.api(`${sheetId}/values/${range('A1:AZ20000')}:clear`, { method: 'POST', body: '{}' });
  await io.api(`${sheetId}/values/${range('A1')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
  return { people: body.length, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
}

/** Who can edit which dataset, as the sheet's Can edit column says (CAVE,
 *  read every hour), by email: {email: "Retina, MEC"}. The Access page's
 *  Dataset access count (Ames 2026-11-10: "more than 4 ppl have dataset
 *  access"). Read only. */
async function readCanEdit(io, { sheetId = USERS_SHEET_ID } = {}) {
  const got = await io.api(`${sheetId}/values/${encodeURIComponent(`'${TAB}'!A1:AZ20000`)}`, { method: 'GET' });
  const kept = readKept((got && got.values) || []);
  const out = {};
  for (const [email, k] of Object.entries(kept)) if (k.canEdit) out[email] = k.canEdit;
  return out;
}

module.exports = { syncUsersSheet, readCanEdit, rows, stepOf, readKept, editList, HEADERS, USERS_SHEET_ID };
