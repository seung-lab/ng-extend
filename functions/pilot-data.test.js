const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requirePilot,pilotContext}=require('./pilot-access');
const {authorizePilotData}=require('./pilot-data');
const ctx={who:{email:'pilot@example.invalid'},me:{id:'11111111-1111-4111-8111-111111111111',display_name:'Pilot'},isPilot:true,isAdmin:false,now:'2026-09-28T12:00:00Z'};
const plan=(table,method,body,query='id=eq.1',context=ctx)=>authorizePilotData({table,method,body,query},context);
test('sign-in and a profile do not confer membership',()=>{
 assert.throws(()=>requirePilot({...ctx,isPilot:false}),/invited testers/);
 assert.throws(()=>requirePilot({...ctx,who:null}),/Sign in/);
 assert.doesNotThrow(()=>requirePilot({...ctx,isPilot:false,isAdmin:true}));
 for(const table of ['edit_log','help_requests','segment_tags','tutorial_practice_waitlist','proofreading_tasks'])
  assert.throws(()=>plan(table,'POST',{},'',{...ctx,isPilot:false}),/invited testers/);
});
test('membership is read afresh for each request and cannot be self-assigned',async()=>{
 let enabled=true;
 const sb=async(path)=>path.startsWith('users?')?[ctx.me]:path.startsWith('pilot_members?')&&enabled?[{email:ctx.who.email}]:[];
 assert.equal((await pilotContext(sb,ctx.who)).isPilot,true); enabled=false;
 assert.equal((await pilotContext(sb,ctx.who)).isPilot,false);
 assert.throws(()=>plan('pilot_members','POST',{email:ctx.who.email},''),/Admins only/);
 assert.throws(()=>plan('pilot_members','PATCH',{enabled:true},'email=like.*',{...ctx,isAdmin:true}),/single sign-in email/);
});
test('writes derive authors and resolution identity; client claims cannot bypass transactions',()=>{
 const p=plan('help_requests','POST',{user_id:'someone-else',user_name:'Admin',note:'help'},'');
 assert.equal(p.body.user_id,ctx.me.id);assert.equal(p.body.user_name,'Pilot');
 assert.throws(()=>plan('proofreading_tasks','POST',{assigned_to:ctx.me.id},''),/atomic/);
 assert.throws(()=>plan('proofreading_tasks','PATCH',{soma_coords:'1,2,3'}),/atomic/);
 const cached=plan('proofreading_tasks','PATCH',{segment_id:'123',assigned_to:'someone-else'});
 assert.equal(cached.body.assigned_to,undefined);assert.match(cached.query.get('and'),/assigned_to.eq/);
});
test('even an admin cannot clear a live practice lease through generic writes',()=>{
 const admin={...ctx,isAdmin:true};
 assert.throws(()=>plan('tutorial_practice_examples','PATCH',{status:'ready'},'id=eq.1',admin),/verified practice action/);
 const p=plan('tutorial_practice_examples','PATCH',{enabled:false},'id=eq.1&or=(id.neq.null)',admin);
 assert.equal(p.query.has('or'),false);assert.equal(p.query.get('and'),'(status.not.in.(in_use,resetting))');
 assert.throws(()=>plan('tutorial_practice_examples','PATCH',{baseline_at:ctx.now},'id=eq.1',admin),/verified practice/);
});
test('member queries cannot read the invite list or change other users waitlist rows',()=>{
 const p=plan('pilot_members','GET',null,'email=like.*&or=(email.neq.null)');
 assert.equal(p.query.get('email'),'eq.'+ctx.who.email);assert.equal(p.query.get('or'),null);assert.equal(p.query.get('select'),'enabled');
 const q=plan('tutorial_practice_waitlist','POST',{kind:'cut',user_id:'other'},'on_conflict=user_id,kind');
 assert.equal(q.body.user_id,ctx.me.id);
 assert.throws(()=>plan('tutorial_practice_waitlist','POST',{kind:'cut'},'on_conflict=kind'),/conflict/);
});
