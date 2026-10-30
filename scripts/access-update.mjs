// The admins' daily note on access (Ames 2026-10-30): who asked and who was
// let in over the last 24 hours. A quiet day sends nothing. Called from
// daily-deploy-digest.mjs at its 4:30 pm run. No robot writes it, so it costs nothing.
const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCESS_TITLE = '🔑 Access update';
const RETINA_GRANT = '🎉 Congratulations! Your edit access has been granted!';
const DATASET_GRANT = '🔓 You have access to ';
// The open padlock on a dataset grant.
const ART = 'https://raw.githubusercontent.com/seung-lab/ng-extend/eyewire-ii-community/static/access/access-granted.png';

const names = list => [...new Set(list.map(n => String(n || 'Someone').trim()))].join(', ');

/** The note's text, or null when there is nothing to say. Each list holds {name, what}. */
export function accessBody(requests, approvals) {
  if (!requests.length && !approvals.length) return null;
  const section = (head, rows) => {
    const by = new Map();
    for (const r of rows) by.set(r.what, [...(by.get(r.what) || []), r.name]);
    return `**${head} (${rows.length})**\n\n` + [...by].map(([what, who]) => `- ${what}: ${names(who)}`).join('\n');
  };
  return [approvals.length ? section('Approved', approvals) : '', requests.length ? section('Requested', requests) : '']
    .filter(Boolean).join('\n\n');
}

export async function gatherAccess(get, sinceIso) {
  const since = encodeURIComponent(sinceIso);
  const retina = await get('access_requests', `select=player_name&submitted_at=gte.${since}`);
  const issues = await get('site_issues', `select=user_name,category,title&category=in.("Beta access","Dataset access")&created_at=gte.${since}`);
  const requests = [
    ...retina.map(r => ({ name: r.player_name, what: 'Retina' })),
    ...issues.map(i => ({ name: i.user_name, what: i.category === 'Beta access' ? 'Beta' : 'A dataset' })),
  ];
  const notes = await get('notifications', `select=title,target_id&target_type=eq.user&send_at=gte.${since}`
    + `&or=${encodeURIComponent(`(title.eq."${RETINA_GRANT}",title.like."${DATASET_GRANT}*")`)}`);
  const ids = [...new Set(notes.map(n => n.target_id).filter(Boolean))];
  const people = ids.length ? await get('users', `select=id,display_name,username&id=in.(${ids.join(',')})`) : [];
  const nameOf = id => { const p = people.find(x => x.id === id); return p?.display_name || p?.username || 'Someone'; };
  const approvals = notes.map(n => ({ name: nameOf(n.target_id),
    what: n.title === RETINA_GRANT ? 'Retina' : n.title.slice(DATASET_GRANT.length) }));
  return { requests, approvals };
}

export async function sendAccessUpdate({ get, post, now, day, dryRun, preview }) {
  const { requests, approvals } = await gatherAccess(get, new Date(now.getTime() - DAY_MS).toISOString());
  const body = accessBody(requests, approvals);
  if (!body) { console.log('[access update] nothing new today.'); return; }
  const title = `${ACCESS_TITLE}: ${day}`;
  if (dryRun || preview) { console.log(`[access update] would send "${title}":\n${body}`); return; }
  // Once a day, like the digest.
  const had = await get('notifications', `select=id&title=eq.${encodeURIComponent(title)}&limit=1`);
  if (had.length) { console.log('[access update] already sent today.'); return; }
  const admins = await get('admins', 'select=user_id,email');
  const emails = admins.map(a => a.email).filter(Boolean).map(e => `"${e}"`).join(',');
  const ids = new Set(admins.map(a => a.user_id).filter(Boolean));
  if (emails) for (const u of await get('users', `select=id&middleauth_email=in.(${emails})`)) ids.add(u.id);
  if (!ids.size) throw new Error('no admins to tell');
  await post('notifications', [...ids].map(id => ({ title, body, target_type: 'user', target_id: id, send_at: now.toISOString(), post_to_chat: false, image_url: ART, thumbnail_url: ART })));
  console.log(`[access update] sent to ${ids.size} admin(s).`);
}
