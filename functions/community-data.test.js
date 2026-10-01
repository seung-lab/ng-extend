const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorizeData,isPersonalProfileEdit,PUBLIC_USER_COLUMNS}=require('./community-data');
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const user={who:{email:'player@example.invalid',caveId:123},me:{id:a,display_name:'Player'},groups:[4],isAdmin:false,now:'2026-09-27T00:00:00.000Z'};
const anon={groups:[],isAdmin:false,now:user.now};
function plan(table,method='GET',query='',body,ctx=user){return authorizeData({table,method,query,body},ctx);}
test('anonymous cannot enumerate private email or internal triage',()=>{
 assert.throws(()=>plan('users','GET','select=middleauth_email',undefined,anon),/Sign in/);
 assert.throws(()=>plan('feedback_triage','GET','',undefined,anon),/Admins only/);
 assert.throws(()=>plan('site_issues','GET','',undefined,anon),/Sign in/);
 assert.equal(plan('users','GET','',undefined,anon).query.get('select'),PUBLIC_USER_COLUMNS);
 assert.equal(plan('admins','GET','',undefined,anon).query.get('and'),'(id.is.null)');
});
test('hostile query cannot remove notification or private-link ownership',()=>{
 for(const table of ['working_links','notifications']){
   const filter = table === 'working_links' ? 'user_id' : 'target_id';
   const p=plan(table,'GET',`and=(id.neq.null)&or=(id.neq.null)&${filter}=eq.${b}`);
   assert.match(p.query.get('and'),new RegExp(a));
   assert.doesNotMatch(p.query.get('and'),/neq.null/);
 }
 const p=plan('notifications','GET','',undefined,anon);
 assert.match(p.query.get('and'),/target_type.eq.all/);
 assert.doesNotMatch(p.query.get('and'),/target_type.eq.user/);
});
test('profile mutations cannot reassign identity or edit someone else',()=>{
 const p=plan('users','PATCH',`id=eq.${b}`,{id:b,middleauth_email:'victim@example.invalid',cave_user_id:999,total_edits:999999,display_name:'Player'});
 assert.equal(p.query.get('and'),`(id.eq.${a})`);
 assert.deepEqual(p.body,{cave_user_id:123,total_edits:999999,display_name:'Player'});
 assert.throws(()=>plan('users','POST','on_conflict=id',{id:b,display_name:'Player'}),/conflict/);
});
test('new profiles derive identity exclusively from verification',()=>{
 const lookup=plan('users','GET','select=id&middleauth_email=eq.player@example.invalid',undefined,{...user,me:null});
 assert.equal(lookup.query.get('and'),'(id.is.null)');
 const p=plan('users','POST','select=id',{middleauth_email:'victim@example.invalid',cave_user_id:999,display_name:'New'}, {...user,me:null});
 assert.deepEqual(p.body,{display_name:'New',middleauth_email:user.who.email,cave_user_id:123});
});
test('group enrollment and direct triage writes require authority',()=>{
 const permitted=plan('user_group_members','POST','on_conflict=group_id,user_id',{group_id:4,user_id:b},{...user,isAdmin:true});
 assert.equal(permitted.body.added_by,a);
 assert.throws(()=>plan('user_group_members','POST','',{group_id:4,user_id:a}),/Admins only/);
 assert.throws(()=>plan('feedback_triage','PATCH','',{impl_state:'deploy_queued'}),/verified action/);
 assert.throws(()=>plan('working_links','POST','',{shared_group_id:999}),/member/);
});
test('upsert forces the authenticated owner and accepts only the compound read key',()=>{
 const p=plan('notification_reads','POST','on_conflict=notification_id,user_id&columns="id","user_id","notification_id","dismissed"',[{id:5,user_id:b,notification_id:7,dismissed:true}]);
 assert.equal(p.query.has('columns'),false);
 assert.deepEqual(p.body,[{notification_id:7,dismissed:true,user_id:a}]);
 assert.throws(()=>plan('notification_reads','POST','on_conflict=id',{id:5,notification_id:7}),/conflict/);
});
test('projections cannot bypass privacy through aliases or relationships',()=>{
 for(const select of ['email:middleauth_email','other:admins(*)','*,admins(*)','users(*)']) assert.throws(()=>plan('users','GET','select='+select),/projection/);
 assert.throws(()=>plan('../admins'),/Unsupported table/);
 assert.throws(()=>plan('users','GET','limit=100000'),/Invalid limit/);
});
test('report ownership and displayed author are server-derived',()=>{
 const p=plan('site_issues','POST','',{message:'A test',user_id:b,user_name:'Nurro'});
 assert.deepEqual(p.body,{message:'A test',user_id:a,user_name:'Player'});
});
test('players delete only their own chat messages; admins any; nobody edits',()=>{
 const own=plan('chat_messages','DELETE','id=eq.7');
 assert.equal(own.query.get('and'),`(user_id.eq.${a})`);
 // A hostile scope cannot widen it.
 const hostile=plan('chat_messages','DELETE',`id=eq.7&and=(user_id.eq.${b})`);
 assert.equal(hostile.query.get('and'),`(user_id.eq.${a})`);
 const adm=plan('chat_messages','DELETE','id=eq.7',undefined,{...user,isAdmin:true});
 assert.equal(adm.query.has('and'),false);
 assert.throws(()=>plan('chat_messages','DELETE',''),/message id/);
 assert.throws(()=>plan('chat_messages','PATCH','id=eq.7',{text:'edited'}),/Admins only/);
 assert.throws(()=>plan('chat_messages','DELETE','id=eq.7',undefined,anon),/Sign in/);
});
test('chat presence identity and time are server-derived',()=>{
 const p=plan('chat_presence','POST','on_conflict=user_id',{user_id:b,name:'Admin',last_seen_at:'2099-01-01T00:00:00Z',joined_at:'2000-01-01T00:00:00Z'});
 assert.deepEqual(p.body,{user_id:a,name:'Player',last_seen_at:user.now});
 assert.throws(()=>plan('chat_presence','POST','',{}),/conflict/);
 assert.throws(()=>plan('chat_presence','PATCH','',{}),/heartbeat/);
 assert.throws(()=>plan('chat_presence','POST','on_conflict=user_id',{},anon),/Sign in/);
 const leave=plan('chat_presence','DELETE',`user_id=eq.${b}`);
 assert.equal(leave.query.get('and'),`(user_id.eq.${a})`);
 assert.equal(plan('chat_presence','GET','last_seen_at=gte.2026-09-27T00:00:00Z',undefined,anon).table,'chat_presence');
});
test('saved-link screenshots must be our own uploads',()=>{
 const ok='https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads/eyewire-ii/x.png';
 assert.equal(plan('working_links','POST','',{title:'t',url:'https://x.test/#!a',screenshot_url:ok}).body.screenshot_url,ok);
 for(const bad of ['https://evil.test/x.png','http://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/x.png','javascript:alert(1)'])
   assert.throws(()=>plan('working_links','POST','',{title:'t',url:'https://x.test/',screenshot_url:bad}),/uploaded through EyeWire/);
 assert.equal(plan('working_links','PATCH','id=eq.3',{screenshot_url:null}).body.screenshot_url,null);
});
test('chat cannot forge a staff role, sender or official notice',()=>{
 const p=plan('chat_messages','POST','',{text:'hello',name:'Admin',rank:'admin',user_id:b});
 assert.equal(p.body.user_id,a);assert.equal(p.body.rank,'player');assert.equal(p.body.name,'Player');
 assert.throws(()=>plan('chat_messages','POST','',{text:'hello',notification_id:1}),/admin/);
 assert.throws(()=>plan('chat_messages','POST','',{text:'hello'},anon),/Sign in/);
});
test('chat reactions are your own, from the offered set, and removable only by you',()=>{
 const p=plan('chat_reactions','POST','',{message_id:'33333333-3333-4333-8333-333333333333',emoji:'\u{1F525}',user_id:b,name:'Admin'});
 assert.equal(p.body.user_id,a);assert.equal(p.body.name,'Player');assert.equal(p.body.message_id,'33333333-3333-4333-8333-333333333333');
 assert.throws(()=>plan('chat_reactions','POST','',{message_id:'33333333-3333-4333-8333-333333333333',emoji:'<script>'}),/Unsupported reaction/);
 assert.throws(()=>plan('chat_reactions','POST','',{message_id:42,emoji:'\u{1F525}'}),/Unknown message/);
 assert.throws(()=>plan('chat_reactions','POST','',{message_id:'33333333-3333-4333-8333-333333333333',emoji:'\u{1F525}'},anon),/Sign in/);
 assert.throws(()=>plan('chat_reactions','PATCH','id=eq.1',{emoji:'\u{1F525}'}),/cannot be edited/);
 assert.throws(()=>plan('chat_reactions','DELETE','message_id=eq.42'),/message and emoji/);
 const del=plan('chat_reactions','DELETE',`message_id=eq.42&emoji=eq.x&user_id=eq.${b}`);
 assert.equal(del.query.get('and'),`(user_id.eq.${a})`);
 assert.equal(plan('chat_reactions','GET','message_id=in.(1,2)',undefined,anon).table,'chat_reactions');
});
test('site issues can carry a console log, within a size limit',()=>{
 const p=plan('site_issues','POST','',{category:'bug',message:'m',console_log:'10:00:00 WARN x'});
 assert.equal(p.body.console_log,'10:00:00 WARN x'); assert.equal(p.body.user_id,a);
 assert.throws(()=>plan('site_issues','POST','',{category:'bug',message:'m',console_log:'x'.repeat(40001)}),/too large/);
 assert.throws(()=>plan('site_issues','POST','',{category:'bug',message:'m',console_log:{a:1}}),/too large/);
});
test('user settings are owner only, bounded, and upsert on user_id',()=>{
 const r=plan('user_settings','GET',`user_id=eq.${b}`);
 assert.equal(r.query.get('and'),`(user_id.eq.${a})`);
 assert.throws(()=>plan('user_settings','GET','',undefined,anon),/Sign in/);
 const w=plan('user_settings','POST','on_conflict=user_id',{user_id:b,settings:{chatMuted:true},evil:1});
 assert.equal(w.body.user_id,a);
 assert.deepEqual(w.body.settings,{chatMuted:true});
 assert.equal(w.body.evil,undefined);
 assert.throws(()=>plan('user_settings','POST','on_conflict=user_id',{settings:'x'}),/object/);
 assert.throws(()=>plan('user_settings','POST','on_conflict=user_id',{settings:{big:'x'.repeat(40000)}}),/too large/);
 assert.throws(()=>plan('user_settings','DELETE',''),/replaced/);
 assert.throws(()=>plan('user_settings','POST','on_conflict=id',{settings:{}}),/conflict/);
});
test('username and profile edits are personal; stats and other tables are not',()=>{
 assert.equal(isPersonalProfileEdit({table:'users',method:'PATCH',body:{username:'amy_r',updated_at:'x'}}),true);
 assert.equal(isPersonalProfileEdit({table:'users',method:'PATCH',body:{flag:'🇺🇸',bio:'hi'}}),true);
 assert.equal(isPersonalProfileEdit({table:'users',method:'PATCH',body:{username:'a',total_edits:999}}),false);
 assert.equal(isPersonalProfileEdit({table:'users',method:'PATCH',body:{last_edit_at:'x'}}),false);
 assert.equal(isPersonalProfileEdit({table:'chat_messages',method:'POST',body:{text:'x'}}),false);
 assert.equal(isPersonalProfileEdit({table:'users',method:'PATCH',body:{}}),false);
 const p=plan('users','PATCH',`id=eq.${b}`,{username:'amy_r'});
 assert.equal(p.query.get('and'),`(id.eq.${a})`);
});
test('saved views: owner only, one per dataset, bounded',()=>{
 const r=plan('user_views','GET',`user_id=eq.${b}&dataset=eq.pni_mec`);
 assert.equal(r.query.get('and'),`(user_id.eq.${a})`);
 assert.throws(()=>plan('user_views','GET','',undefined,anon),/Sign in/);
 const w=plan('user_views','POST','on_conflict=user_id,dataset',{user_id:b,dataset:'pni_mec',state:{layers:[]}});
 assert.equal(w.body.user_id,a); assert.deepEqual(w.body.state,{layers:[]});
 assert.throws(()=>plan('user_views','POST','on_conflict=user_id,dataset',{dataset:'x y',state:{}}),/dataset/);
 assert.throws(()=>plan('user_views','POST','on_conflict=user_id,dataset',{dataset:'d',state:[1]}),/viewer state/);
 assert.throws(()=>plan('user_views','POST','on_conflict=user_id,dataset',{dataset:'d',state:{big:'x'.repeat(250000)}}),/too large/);
 assert.throws(()=>plan('user_views','POST','on_conflict=id',{dataset:'d',state:{}}),/conflict/);
});
test('a player can report their own annotations total, as a sane counter',()=>{
 const p=plan('users','PATCH',`id=eq.${a}`,{total_annotations:42});
 assert.equal(JSON.stringify(p.body??p.rows).includes('"total_annotations":42'),true);
 assert.throws(()=>plan('users','PATCH',`id=eq.${a}`,{total_annotations:-1}),/Invalid counter/);
 assert.equal(plan('users','GET','select=total_annotations',undefined,anon).query.get('select'),'total_annotations');
});
test('silver favorites: a short list of badge slugs, nothing else',()=>{
 const p=plan('users','PATCH',`id=eq.${a}`,{favorite_badges:['chisel','special-12']});
 assert.equal(JSON.stringify(p.body??p.rows).includes('"favorite_badges":["chisel","special-12"]'),true);
 assert.throws(()=>plan('users','PATCH',`id=eq.${a}`,{favorite_badges:'chisel'}),/Invalid favorites/);
 assert.throws(()=>plan('users','PATCH',`id=eq.${a}`,{favorite_badges:['a','b','c','d','e','f']}),/Invalid favorites/);
 assert.throws(()=>plan('users','PATCH',`id=eq.${a}`,{favorite_badges:['<script>']}),/Invalid favorites/);
});
