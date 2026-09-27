const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorizeData,PUBLIC_USER_COLUMNS}=require('./community-data');
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
test('chat cannot forge a staff role, sender or official notice',()=>{
 const p=plan('chat_messages','POST','',{text:'hello',name:'Admin',rank:'admin',user_id:b});
 assert.equal(p.body.user_id,a);assert.equal(p.body.rank,'player');assert.equal(p.body.name,'Player');
 assert.throws(()=>plan('chat_messages','POST','',{text:'hello',notification_id:1}),/admin/);
 assert.throws(()=>plan('chat_messages','POST','',{text:'hello'},anon),/Sign in/);
});
