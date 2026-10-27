'use strict';
// The "Production editors" group (Ames 2026-10-27: "a group of users who have
// access to edit in production, so I can send notifs to just them").
//
// Pyr keeps no list of who may edit the production datasets: CAVE decides,
// and answers only for the player who is signed in. So the group fills
// itself. When a signed-in player uses Pyr, the server asks CAVE (the same
// answer that colours a name in chat) and adds them to the group, or takes
// them out, at most once every few hours each. A player who never opens Pyr
// is not in it, and would not see a notification anyway: the bell is in Pyr.
//
// A failed lookup (null) changes nothing. The group is made the first time
// it is needed, so it shows in Admin Hub, Groups, like any other group.

const PRODUCTION_GROUP = {
  name: 'Production editors',
  description: 'Players who can edit the production datasets. Kept up to date by Pyr as they sign in; do not add people by hand.',
  color: '#3dff9a',
};
const RECHECK_MS = 6 * 60 * 60 * 1000;

/** What to do with one player: 'add', 'remove', or null to leave them. */
function productionGroupStep(hasProduction, inGroup) {
  if (hasProduction === true && !inGroup) return 'add';
  if (hasProduction === false && inGroup) return 'remove';
  return null;
}

/** When each player was last looked at, so a busy player costs one lookup
 *  every few hours, not one a request. Per server instance. */
const lastChecked = new Map();

/**
 * Bring one player's membership in step. `sb` is the PostgREST helper (with
 * the service key), `hasProduction()` asks CAVE (true, false or null), `me`
 * the player's users row, `groups` the ids of the groups they are in now.
 * Never throws: the request it rides on is not affected.
 */
async function syncProductionGroup(sb, me, groups, hasProduction, now = Date.now()) {
  if (!me || !me.id) return null;
  const last = lastChecked.get(me.id);
  if (last !== undefined && now - last < RECHECK_MS) return null;
  lastChecked.set(me.id, now);
  if (lastChecked.size > 5000) lastChecked.delete(lastChecked.keys().next().value);
  try {
    const has = await hasProduction();
    if (has !== true && has !== false) return null;
    const name = encodeURIComponent(PRODUCTION_GROUP.name);
    let group = (await sb(`user_groups?name=eq.${name}&select=id&limit=1`))[0];
    if (!group && has) {
      // Made on first use; a race with another instance meets the unique name.
      try {
        group = (await sb('user_groups', {method: 'POST', body: JSON.stringify(PRODUCTION_GROUP)}))[0];
      } catch {
        group = (await sb(`user_groups?name=eq.${name}&select=id&limit=1`))[0];
      }
    }
    if (!group) return null;
    const inGroup = (groups || []).map(Number).includes(Number(group.id));
    const step = productionGroupStep(has, inGroup);
    if (step === 'add') {
      await sb('user_group_members?on_conflict=group_id,user_id', {
        method: 'POST',
        headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify({group_id: group.id, user_id: me.id}),
      });
    } else if (step === 'remove') {
      await sb(`user_group_members?group_id=eq.${Number(group.id)}&user_id=eq.${encodeURIComponent(me.id)}`, {
        method: 'DELETE', headers: {Prefer: 'return=minimal'},
      });
    }
    return step;
  } catch (e) {
    console.warn('[production group]', e && e.message);
    return null;
  }
}

module.exports = {PRODUCTION_GROUP, RECHECK_MS, productionGroupStep, syncProductionGroup, _lastChecked: lastChecked};
