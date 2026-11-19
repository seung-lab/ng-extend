'use strict';
const {requirePilot, fail} = require('./pilot-access');
const fields = {
  pilot_members: 'email,enabled',
  proofreading_tasks: 'segment_id,dataset,nucleus_coords,soma_coords,notes,source_sheet_url,claim_point_x,claim_point_y,claim_point_z,supervoxel_id',
  tutorial_practice_examples: 'title,kind,dataset,pcg_server,pcg_table,state_url,supervoxel_a,supervoxel_b,root_a,root_b,point_a,point_b,enabled',
  tutorial_practice_waitlist: 'kind',
  edit_log: 'task_id,operation,segment_before,segment_after,coordinates,metadata,dataset,success',
  activity_feed: 'action,segment_id',
  help_requests: 'segment_id,position,note,issue_type,dataset,resolved,cell_type,nickname,screenshot_url,annotation_layer,view_url',
  help_responses: 'request_id,note,url,annotation_layer,screenshot_url,resolved',
  issue_tags: 'dataset,segment_id,position,tag_type,subtype,annotation_layer,screenshot_url,note,status',
  segment_tags: 'segment_id,tag,notes,source,dataset',
  special_badges: 'name,description,slug,image_url,thumbnail_url',
  special_badge_awards: 'badge_id,user_id,reason',
  badge_awards: 'track,badge_id',
  client_errors: 'message,stack,source,component,url,dataset,user_agent,build',
  // One row each time a player finishes a tutorial or cuts a sandbox merger
  // (supabase-tutorial-completions.sql). The player is stamped here.
  tutorial_completions: 'tutorial,item,practice_asked,practice_made',
};
const OWNER = {help_requests:'user_id',issue_tags:'user_id',segment_tags:'created_by'};
const INSERT_ONLY = new Set(['edit_log','activity_feed','help_responses','client_errors','badge_awards','tutorial_completions']);
const conflicts = {pilot_members:'email',tutorial_practice_waitlist:'user_id,kind',special_badge_awards:'badge_id,user_id',badge_awards:'user_id,track,badge_id'};
function authorizePilotData(input,ctx) {
  if (!Object.hasOwn(fields,input.table)) return null;
  const table=input.table, method=String(input.method||'GET').toUpperCase(), query=new URLSearchParams(String(input.query||''));
  const read=['GET','HEAD'].includes(method);
  if (!['GET','HEAD','POST','PATCH','DELETE'].includes(method)) fail(405,'Unsupported method');
  // Public reads keep using Supabase. This route only exposes the invite roster
  // to admins; ordinary callers can check their own membership.
  if(read) {
    if(table!=='pilot_members') fail(400,'Use the public read endpoint.');
    if(!ctx.who) fail(401,'Sign in first.');
    if(!ctx.isAdmin) {query.delete('and');query.delete('or');query.set('email','eq.'+ctx.who.email);}
    query.set('select',ctx.isAdmin?'email,enabled,created_at':'enabled');
    query.set('limit','500');
    return {table,method,query};
  }
  requirePilot(ctx);
  if(query.toString().length>12000) fail(400,'Query too large');
  query.delete('columns');query.delete('and');query.delete('or');
  for(const key of query.keys()) if(!['id','user_id','task_id','badge_id','email','kind','select','on_conflict'].includes(key)) fail(400,'Unsupported write filter');
  query.set('select','*');
  if(query.has('on_conflict') && query.get('on_conflict')!==conflicts[table]) fail(400,'Unsupported conflict target');
  if(method!=='POST' && !query.has('id') && !['pilot_members','tutorial_practice_waitlist','special_badge_awards'].includes(table)) fail(400,'A row id is required.');
  if(INSERT_ONLY.has(table) && method!=='POST') fail(403,'This record is append only.');
  // One row at a time, and only an exact match: "id=not.is.null" once chose every
  // row of a shared table (security review 2026-11-13, finding 1).
  if(method!=='POST') for(const key of ['id','user_id','task_id','badge_id','kind']) {
    const values=query.getAll(key);
    if(values.length>1 || (values.length && !/^eq\.[A-Za-z0-9_-]{1,64}$/.test(values[0]))) fail(400,'Choose a single row.');
  }
  // Shared help and tags: a player removes only their own, and labels imported
  // from the lab's sheets are an admin's to change. Marking someone else's
  // request solved stays open to every tester; that is how help works.
  const shared=method!=='POST' && !ctx.isAdmin && Object.hasOwn(OWNER,table);
  const own=shared ? OWNER[table]+'.eq.'+ctx.me.id : '';
  const notImported='or(source.is.null,source.neq.spreadsheet_import)';
  if(shared && method==='DELETE') query.set('and','('+own+(table==='segment_tags'?','+notImported:'')+')');
  if(['pilot_members','special_badges','tutorial_practice_examples'].includes(table) && !ctx.isAdmin) fail(403,'Admins only');
  if(table==='proofreading_tasks') {
    if(method==='POST' && !ctx.isAdmin) fail(403,'Use the atomic cell claim action.');
    if(method==='DELETE') fail(403,'Task deletion is not supported here.');
    if(method==='PATCH') query.set('and','(assigned_to.eq.'+ctx.me.id+')');
  }
  if(table==='tutorial_practice_examples' && method!=='POST') query.set('and','(status.not.in.(in_use,resetting))');
  if(table==='tutorial_practice_waitlist' || table==='badge_awards') query.set('and','(user_id.eq.'+ctx.me.id+')');
  if(table==='special_badge_awards' && !ctx.isAdmin) {
    if(method!=='POST') fail(403,'Admins only');
    query.set('and','(user_id.eq.'+ctx.me.id+')');
  }
  if(table==='pilot_members') {
    const email=query.get('email');
    if(method!=='POST' && (!email || !/^eq\.[^\s(),]+@[^\s(),]+$/.test(email))) fail(400,'Choose a single sign-in email.');
  }
  if(method==='DELETE') return {table,method,query};
  const rows=Array.isArray(input.body)?input.body:[input.body];
  if(shared && method==='PATCH') {
    if(table==='segment_tags') query.set('and','('+notImported+')');
    else {
      const key=table==='help_requests'?'resolved':'status', solved=table==='help_requests'?true:'resolved';
      const onlySolves=rows.every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).filter(k=>fields[table].split(',').includes(k)).every(k=>k===key&&v[k]===solved));
      if(!onlySolves) query.set('and','('+own+')');
    }
  }
  if(!rows.length||rows.length>(ctx.isAdmin?500:100)) fail(400,'Invalid row count');
  const body=rows.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)) fail(400,'Invalid row');
    const row=Object.fromEntries(Object.entries(value).filter(([k])=>fields[table].split(',').includes(k)));
    const me=ctx.me.id, name=ctx.me.username||ctx.me.display_name||'Player';
    if(table==='pilot_members') {
      if(method==='POST') {
        row.email=String(row.email||'').trim().toLowerCase();
        if(!/^[^\s(),]+@[^\s(),]+\.[^\s(),]+$/.test(row.email)||row.email.length>254) fail(400,'Enter the tester’s sign-in email.');
        row.added_by=me;
      } else delete row.email;
    }
    if(['edit_log','activity_feed','help_requests','help_responses','issue_tags','client_errors','badge_awards','tutorial_practice_waitlist','tutorial_completions'].includes(table) && method==='POST') row.user_id=me;
    if(table==='tutorial_completions') {
      row.tutorial=Number(row.tutorial);
      if(!Number.isInteger(row.tutorial)||row.tutorial<1||row.tutorial>50) fail(400,'Unknown tutorial');
      row.item=typeof row.item==='string'?row.item.slice(0,80):null;
      for(const k of ['practice_asked','practice_made']) { const n=Number(row[k]); row[k]=Number.isInteger(n)&&n>=0&&n<=50?n:0; }
      if(row.practice_made>row.practice_asked) row.practice_made=row.practice_asked;
    }
    if(['activity_feed','help_requests','help_responses','issue_tags'].includes(table) && method==='POST') row.user_name=name;
    if(['segment_tags','special_badges','tutorial_practice_examples'].includes(table) && method==='POST') row.created_by=me;
    // The requester's view: one https link, or nothing. It was missing from
    // the list above, so every request lost its view, and with it whatever
    // the requester had drawn, until 2026-10-07.
    if(table==='help_requests' && 'view_url' in row && !(typeof row.view_url==='string' && /^https:\/\/[^\s"'<>]+$/.test(row.view_url) && row.view_url.length<=2000)) delete row.view_url;
    if(['help_requests','issue_tags'].includes(table) && (row.resolved===true||row.status==='resolved')) {
      row.resolved_by=me;row.resolved_by_name=name;row.resolved_at=ctx.now;
    }
    if(table==='segment_tags') {
      if(method==='POST') row.source=ctx.isAdmin && row.source==='spreadsheet_import'?'spreadsheet_import':'user_created';
      else if(!ctx.isAdmin) delete row.source;
    }
    if(table==='special_badge_awards') {
      if(!ctx.isAdmin) {row.user_id=me;row.awarded_by=null;} else row.awarded_by=me;
    }
    if(table==='proofreading_tasks') {
      if(method==='PATCH') {
        for(const key of Object.keys(row)) if(key!=='segment_id') fail(403,'Use the atomic claim action.');
      } else row.status='pending';
    }
    if(table==='tutorial_practice_examples') {
      if(Object.keys(value).some(k=>['status','claimed_by','claimed_at','expires_at','reset_nonce','baseline_at','last_reset_at','reset_failures'].includes(k))) fail(403,'Use the verified practice action.');
      if(method==='POST') {
        if(row.pcg_server!=='https://minnie.microns-daf.com'||row.pcg_table!=='pinky_nf_v2') fail(400,'Only the reviewed Pinky practice sandbox is enabled.');
        row.status='needs_reset';
      } else if(Object.keys(row).some(k=>!['title','enabled'].includes(k))) fail(403,'Practice geometry requires a reviewed migration.');
    }
    if(!Object.keys(row).length) fail(400,'No permitted fields');
    return row;
  });
  return {table,method,query,body:Array.isArray(input.body)?body:body[0]};
}
module.exports={authorizePilotData,conflicts};
