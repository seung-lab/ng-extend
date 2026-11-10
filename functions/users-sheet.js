'use strict';
/**
 * Our own Pyr users sheet (Ames 2026-11-09: "we should just have our own
 * users spreadsheet then Celia can have her own"; "make our own Pyr users
 * sheet"). The game owns it and rewrites the whole Users tab each time:
 * every hour (ewUsersSheet) and on an admin's "Update the sheet now" (the
 * Access page, ewQuestReview action usersSheet). Hand edits there are
 * overwritten; notes belong on the Access page.
 *
 * One row per person on Pilot testers or who asked for the beta, from the
 * view access_hub_people (supabase-access-hub.sql), plus CAVE IDs from users.
 * Chat is a count only (Ames: "chat counts are ok just not chat messages").
 */
const USERS_SHEET_ID = '10VW3cSrtK8y0pLlivJnQIuMAp65_B-eDJAVb3DbpKBs';
const TAB = 'Users';

const PEOPLE_COLS = 'email,user_id,name,username,request_id,asked_at,from_site,gave_email,ew_name,ew_rank,found_us,their_note,pilot_enabled,let_in_at,from_list,joined_at,tutorial_at,tutorials,first_edit_at,last_edit_at,edits,last_dataset,edits_30d,cells,cells_30d,chats_30d,help_asked,help_answered_for,help_given';

const HEADERS = ['Name', 'Email', 'Step', 'Pyr username', 'EyeWire username', 'EyeWire rank', 'CAVE ID',
  'Asked', 'Let in', 'Signed in', 'First tutorial done', 'Tutorials finished', 'First edit', 'Last edit', 'Last dataset',
  'Edits', 'Edits, 30 days', 'Cells done', 'Cells done, 30 days', 'Help asked', 'Help asked, answered', 'Help given',
  'Chat messages, 30 days', 'How they found us', 'Added from a pasted list', 'Their note when they asked'];

// The steps, in the Access page's words and order.
const STEPS = ['Asked', 'Let in', 'Signed in', 'Tutorial done', 'Editing', 'Removed or paused'];
function stepOf(p, mark) {
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
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const yes = (b) => (b ? 'Yes' : '');
// A cell a sheet would read as a formula is kept as text.
const text = (v) => { const s = String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 500); return /^[=+\-@]/.test(s) ? "'" + s : s; };
const isTest = (email) => /@example\.(org|com|net)$|\.invalid$/i.test(String(email || ''));

function rows(people, caveIds = {}, marks = {}) {
  const out = people.filter(p => p.email && !isTest(p.email)).map(p => {
    const step = stepOf(p, marks[p.email]);
    return { step, row: [
      text(p.name), text(p.email), step, text(p.username), text(p.ew_name), text(p.ew_rank), p.user_id && caveIds[p.user_id] != null ? String(caveIds[p.user_id]) : '',
      day(p.asked_at), day(p.let_in_at), day(p.joined_at), day(p.tutorial_at), p.tutorials || 0, day(p.first_edit_at), day(p.last_edit_at), dsName(p.last_dataset),
      p.edits || 0, p.edits_30d || 0, p.cells || 0, p.cells_30d || 0, p.help_asked || 0, p.help_answered_for || 0, p.help_given || 0,
      p.chats_30d || 0, text(p.found_us), yes(p.from_list), text(p.their_note),
    ] };
  });
  out.sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step) || String(a.row[0] || a.row[1]).localeCompare(String(b.row[0] || b.row[1])));
  return out.map(x => x.row);
}

/** Rewrite the Users tab. io: { api (sheets), sb (service key), marks? } */
async function syncUsersSheet(io, { sheetId = USERS_SHEET_ID, now = new Date() } = {}) {
  const people = await io.sb(`access_hub_people?select=${PEOPLE_COLS}&order=email&limit=5000`);
  const users = await io.sb('users?select=id,cave_user_id&cave_user_id=not.is.null&limit=5000');
  const caveIds = Object.fromEntries((users || []).map(u => [u.id, u.cave_user_id]));
  const marks = io.marks ? await io.marks.all().catch(() => ({})) : {};
  const body = rows(people || [], caveIds, marks);
  const stamp = `Updated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC by Pyr. Hand edits here are replaced every hour.`;
  const values = [HEADERS, ...body, [], [stamp]];
  const range = (r) => encodeURIComponent(`'${TAB}'!${r}`);
  await io.api(`${sheetId}/values/${range('A1:AZ20000')}:clear`, { method: 'POST', body: '{}' });
  await io.api(`${sheetId}/values/${range('A1')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
  return { people: body.length, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
}

module.exports = { syncUsersSheet, rows, stepOf, HEADERS, USERS_SHEET_ID };
