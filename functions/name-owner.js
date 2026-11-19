'use strict';
// Whose name is it? (security review 2026-11-13, finding 3)
//
// The lab's quest sheet says whose cell a row is by Annotator Name alone, and
// a player may change their own display name. Matched on the name only, a
// player who took another's name could release their quest, overwrite their
// submission, or answer their review.
//
// The sheet has no player id column, so the name has to be made safe to
// trust instead:
//   1. Renaming to a name another player already carries is refused
//      (nameTaken, called by ewCommunityData on a profile edit).
//   2. Where two accounts still share a name (a new sign in whose Google name
//      matches), the sheet rows under it belong to the account that had the
//      name first, the older one (ownsName). The newer one is told to pick
//      another name.
// Names are compared the way the sheet compares them: letters and digits
// only, lower case (sheet-policy.js nameKey).
const {nameKey} = require('./sheet-policy');
const LIMIT = 1000;

/** Every account carrying one of these names, as display name or username. */
async function carriers(sb, names) {
  const keys = [...new Set(names.map(nameKey).filter(Boolean))];
  const found = new Map();
  let unsure = false;
  for (const key of keys) {
    const like = [...key.slice(0, 80)].map(c => encodeURIComponent(c)).join('*');
    const rows = await sb(`users?or=(display_name.ilike.*${like}*,username.ilike.*${like}*)&select=id,display_name,username,created_at&order=created_at.asc&limit=${LIMIT}`);
    // More look-alikes than one read returns: an exact match may be hidden.
    if (rows.length >= LIMIT) unsure = true;
    for (const u of rows) if (nameKey(u.display_name) === key || nameKey(u.username) === key) found.set(u.id, u);
  }
  return {users: [...found.values()], unsure};
}

/** Does another player already carry one of these names? */
async function nameTaken(sb, selfId, names) {
  const {users, unsure} = await carriers(sb, names);
  return unsure || users.some(u => u.id !== selfId);
}

/**
 * May this player act on sheet rows written under their name? Yes when no
 * other account carries it, or when theirs is the oldest that does.
 */
async function ownsName(sb, me) {
  if (!me || !me.id) return false;
  const {users, unsure} = await carriers(sb, [me.display_name, me.username]);
  if (unsure) return false;
  const others = users.filter(u => u.id !== me.id);
  if (!others.length) return true;
  const self = users.find(u => u.id === me.id);
  const at = u => Date.parse(u && u.created_at) || NaN;
  const mine = at(self);
  return Number.isFinite(mine) && others.every(u => Number.isFinite(at(u)) && at(u) > mine);
}

const SHARED_NAME = 'Another player already uses this name, so Pyr cannot tell whose cell this is. Change your display name in your profile, or ask an admin for help.';
const NAME_TAKEN = 'Another player already uses that name. Please choose a different one.';
module.exports = {nameTaken, ownsName, SHARED_NAME, NAME_TAKEN};
