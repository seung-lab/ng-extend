'use strict';

// Pure policy builder: tested without credentials, a database, or production writes.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Screenshots only ever point at our own public storage (ewSecureUpload output).
const OWN_STORAGE = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/';
// Chat reactions on offer; keep in step with CHAT_REACTION_EMOJI in src/store.ts.
const REACTION_EMOJI = new Set(['👍', '❤️', '🔥', '😂', '🎉', '🧠']);
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const PUBLIC_USER_COLUMNS = 'id,display_name,flag,bio,total_edits,total_merges,total_splits,cells_completed,current_streak,longest_streak,last_edit_date,created_at,updated_at,favorite_badge,avatar_json,avatar_thumbnail_url,avatar_coins_spent,avatar_updated_at,tutorial_active,tutorial_1_step,tutorial_2_step,tutorial_3_step,cave_user_id,username,last_edit_at,last_cave_sync_at';
const columns = {
  users: PUBLIC_USER_COLUMNS+',middleauth_email',
  admins: 'id,user_id,email,created_at',
  notifications: 'id,title,body,image_url,thumbnail_url,send_at,expires_at,target_type,target_id,post_to_chat,created_at,created_by,chat_posted_at',
  notification_reads: 'id,notification_id,user_id,read_at,dismissed,dismissed_at',
  working_links: 'id,user_id,title,note,starred,url,dataset,position_x,position_y,position_z,visible_segments,is_public,shared_group_id,created_at,updated_at,screenshot_url',
  // Who is in chat right now. Public: usernames are already public in chat.
  chat_presence: 'user_id,name,last_seen_at,joined_at',
  feedback_triage: 'id,source,source_id,source_excerpt,recommendation,rationale,proposed_message,spec,status,reviewed_by,reviewed_at,created_at,slack_channel,slack_ts,result_note,done_slack_ts,approver_slack_id,approver_note,decision_slack_ts,impl_state,impl_branch,impl_summary,impl_run_url,impl_attempts,impl_started_at,preview_url,feedback_log,last_reply_ts,last_nag_at,nag_count,tested_by,tested_at',
  site_issues: 'id,category,message,url,dataset,user_id,user_name,created_at,screenshot_url,console_log',
  user_groups: 'id,name,description,color,created_at,created_by',
  user_group_members: 'id,group_id,user_id,added_at,added_by',
  chat_messages: 'id,user_id,name,rank,text,created_at,dataset,notification_id',
  // Emoji reactions on chat messages. Public, like the messages themselves.
  chat_reactions: 'id,message_id,user_id,name,emoji,created_at',
};
const writable = {
  users: 'display_name,username,flag,bio,favorite_badge,avatar_json,avatar_thumbnail_url,avatar_coins_spent,avatar_updated_at,tutorial_active,tutorial_1_step,tutorial_2_step,tutorial_3_step,last_edit_at,updated_at,total_edits,total_merges,total_splits,cells_completed,current_streak,longest_streak,last_edit_date',
  working_links: 'title,note,starred,url,dataset,position_x,position_y,position_z,visible_segments,is_public,shared_group_id,updated_at,screenshot_url',
  // Nothing from the client is kept: every field is set below from identity.
  chat_presence: 'last_seen_at',
  notification_reads: 'notification_id,dismissed,dismissed_at',
  user_groups: 'name,description,color',
  user_group_members: 'group_id,user_id',
  site_issues: 'category,message,url,dataset,screenshot_url,console_log',
  chat_messages: 'text,dataset,notification_id',
  chat_reactions: 'message_id,emoji',
};
function authorizeData(input, ctx) {
  const {table} = input;
  if (!Object.hasOwn(columns, table)) fail(400, 'Unsupported table');
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET','HEAD','POST','PATCH','DELETE'].includes(method)) fail(405, 'Unsupported method');
  const read = method === 'GET' || method === 'HEAD';
  const query = new URLSearchParams(String(input.query || ''));
  if (query.toString().length > 12000) fail(400, 'Query too large');
  // PostgREST clients attach a columns hint for bulk inserts. Derive columns
  // from our sanitized body instead of trusting or forwarding that hint.
  query.delete('columns');
  const allowedColumns = new Set(columns[table].split(','));
  for (const [key,value] of query) {
    if (!['select','order','limit','offset','or','and','on_conflict'].includes(key) && !allowedColumns.has(key)) fail(400, 'Unsupported filter');
    if (value.length > 4096) fail(400, 'Filter too large');
  }
  let select = query.get('select') || '*';
  const adminMemberProjection = ctx.isAdmin && table === 'user_group_members' && select === 'user_id,added_at,users!user_group_members_user_id_fkey(display_name,middleauth_email)';
  if (!adminMemberProjection && select !== '*' && select.split(',').some(c => !allowedColumns.has(c))) fail(400, 'Unsupported projection');
  // Never merge caller-controlled logical syntax into an authorization expression.
  // Existing simple filters and OR searches still narrow these mandatory scopes.
  query.delete('and');
  const scope = (...clauses) => query.set('and', '('+clauses.join(',')+')');
  const me = ctx.me;
  const groups = (ctx.groups || []).map(String).filter(x => /^\d+$/.test(x));
  const own = () => { if (!me || !UUID.test(me.id)) fail(401, 'Sign in to EyeWire II first.'); return me.id; };
  const admin = () => { if (!ctx.isAdmin) fail(403, 'Admins only'); };
  if (read) {
    const limit = Number(query.get('limit') ?? 500);
    if (!Number.isInteger(limit) || limit < 0 || limit > 500) fail(400, 'Invalid limit');
    query.set('limit', String(limit));
    if (table === 'users' && !ctx.isAdmin) {
      if (select.includes('middleauth_email') || query.toString().includes('middleauth_email')) {
        if (!ctx.who) fail(401, 'Sign in to EyeWire II first.');
        scope(me ? 'id.eq.'+own() : 'id.is.null');
      }
      if (select === '*') select = PUBLIC_USER_COLUMNS;
    } else if (table === 'admins' && !ctx.isAdmin) {
      // Supports the existing maybeSingle admin-status check without exposing addresses.
      scope('id.is.null');
    } else if (table === 'feedback_triage') {
      admin();
    } else if (table === 'site_issues' && !ctx.isAdmin) {
      scope('user_id.eq.'+own());
    } else if (table === 'notification_reads') {
      scope('user_id.eq.'+own());
    } else if (table === 'notifications' && !ctx.isAdmin) {
      const targets = ['target_type.eq.all'];
      if (me) targets.push(`and(target_type.eq.user,target_id.eq.${own()})`);
      if (groups.length) targets.push(`and(target_type.eq.group,target_id.in.(${groups.join(',')}))`);
      scope(`or(${targets.join(',')})`, 'send_at.lte.'+ctx.now, `or(expires_at.is.null,expires_at.gt.${ctx.now})`);
    } else if (table === 'working_links' && !ctx.isAdmin) {
      const visible = ['is_public.eq.true'];
      if (me) visible.push('user_id.eq.'+own());
      if (groups.length) visible.push(`shared_group_id.in.(${groups.join(',')})`);
      scope('or('+visible.join(',')+')');
    }
    query.set('select', select);
    query.delete('on_conflict');
    return {table,method,query,body:undefined};
  }
  if (!Object.hasOwn(writable, table)) fail(403, 'Use the verified action for this change.');
  if (['user_groups','user_group_members'].includes(table)) admin();
  else if (!(table === 'users' && method === 'POST' && ctx.who?.email)) own();
  if (table === 'site_issues' && method !== 'POST') admin();
  if (table === 'chat_messages' && method !== 'POST') {
    if (!query.has('id')) fail(400,'A message id is required.');
    // Anyone may delete a message they wrote; only admins delete others' or edit.
    if (method === 'DELETE' && !ctx.isAdmin) scope('user_id.eq.'+own());
    else admin();
  }
  if (table === 'chat_reactions') {
    // Add your own reaction, or remove one of your own. Never edit.
    if (method === 'PATCH') fail(405, 'Reactions cannot be edited.');
    if (method === 'DELETE') {
      if (!query.has('message_id') || !query.has('emoji')) fail(400, 'A message and emoji are required.');
      scope('user_id.eq.'+own());
    }
  }
  if (table === 'chat_presence') {
    // Heartbeat upsert on the owner's own row, or DELETE of it on leave.
    if (method === 'PATCH') fail(405, 'Use the heartbeat.');
    if (method === 'POST' && query.get('on_conflict') !== 'user_id') fail(400, 'Unsupported conflict target');
    if (method === 'DELETE') scope('user_id.eq.'+own());
  }
  if (table === 'users') {
    if (method === 'DELETE') fail(403, 'Profile deletion is not supported here.');
    if (method !== 'POST') scope('id.eq.'+own());
    else if (!ctx.who?.email) fail(401, 'Verified identity required.');
  } else if (table === 'working_links' || table === 'notification_reads') scope('user_id.eq.'+own());
  const validConflict = (table === 'notification_reads' && query.get('on_conflict') === 'notification_id,user_id') ||
    (table === 'chat_presence' && query.get('on_conflict') === 'user_id') ||
    (table === 'user_group_members' && ctx.isAdmin && query.get('on_conflict') === 'group_id,user_id');
  if (query.has('on_conflict') && !validConflict) fail(400, 'Unsupported conflict target');
  if (method === 'DELETE') return {table,method,query};
  const values = Array.isArray(input.body) ? input.body : [input.body];
  if (!values.length || values.length > 100) fail(400, 'Invalid row count');
  const fields = new Set(writable[table].split(','));
  const rows = values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid row');
    const row = Object.fromEntries(Object.entries(value).filter(([k]) => fields.has(k)));
    if (table === 'users') {
      if (typeof row.display_name === 'string' && /^(nurro|admin|administrator|moderator|staff)$/i.test(row.display_name.trim()) && !ctx.isAdmin) fail(400, 'That display name is reserved.');
      if (method === 'POST') { row.middleauth_email = ctx.who.email; row.cave_user_id = ctx.who.caveId || null; }
      else if ('cave_user_id' in value) row.cave_user_id = ctx.who.caveId || null;
      // Compatibility: own counters remain client-reported until CAVE-authoritative
      // reconciliation is available. They can never be written for another user.
      for (const field of ['total_edits','total_merges','total_splits','cells_completed','current_streak','longest_streak']) {
        if (field in row && (!Number.isSafeInteger(row[field]) || row[field]<0 || row[field]>1000000000)) fail(400,'Invalid counter');
      }
    }
    if (['working_links','notification_reads'].includes(table)) row.user_id = own();
    if (table === 'site_issues') {
      row.user_id=own(); row.user_name=me.display_name || 'Player';
      if (row.console_log != null && (typeof row.console_log !== 'string' || row.console_log.length > 40000)) fail(400, 'Console log too large.');
    }
    if (table === 'chat_messages') {
      if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 5000) fail(400,'Message must contain 1–5000 characters.');
      if (row.notification_id != null && !ctx.isAdmin) fail(403,'Official announcements require an admin.');
      row.name=me.username || me.display_name || 'Player'; row.rank=ctx.isAdmin?'admin':'player'; row.user_id=own();
      row.dataset=typeof row.dataset==='string'?row.dataset.slice(0,128):null;
    }
    if (table === 'working_links' && row.shared_group_id != null && !ctx.isAdmin && !groups.includes(String(row.shared_group_id))) fail(403, 'You are not a member of that group.');
    if (table === 'working_links' && 'url' in row && !/^https:\/\//i.test(String(row.url))) fail(400, 'Saved links must use HTTPS.');
    if (table === 'working_links' && row.screenshot_url != null &&
        (typeof row.screenshot_url !== 'string' || !row.screenshot_url.startsWith(OWN_STORAGE) || row.screenshot_url.length > 1024)) {
      fail(400, 'Screenshots must be uploaded through EyeWire II.');
    }
    if (table === 'chat_reactions') {
      if (typeof row.message_id !== 'string' || !UUID.test(row.message_id)) fail(400, 'Unknown message.');
      if (!REACTION_EMOJI.has(row.emoji)) fail(400, 'Unsupported reaction.');
      row.user_id = own(); row.name = me.username || me.display_name || 'Player';
    }
    if (table === 'chat_presence') {
      // Identity and time are the server's; the client only says "I'm here".
      for (const k of Object.keys(row)) delete row[k];
      row.user_id = own(); row.name = me.username || me.display_name || 'Player'; row.last_seen_at = ctx.now;
    }
    if (table === 'user_groups' && method === 'POST') row.created_by = own();
    if (table === 'user_group_members' && method === 'POST') row.added_by = own();
    if (!Object.keys(row).length) fail(400, 'No permitted fields');
    return row;
  });
  query.set('select', select);
  return {table,method,query,body:Array.isArray(input.body) ? rows : rows[0]};
}
module.exports={authorizeData,PUBLIC_USER_COLUMNS};
