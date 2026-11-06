const {test}=require('node:test');
const assert=require('node:assert/strict');
const review=require('./quest-review');

// The quest tab's real header (row 1 of "All Cells", read 2026-11-05).
const header=['Index','Soma Coords','Latest SegID','Cell Class','Cell Class (machine)','Confidence Cell Class (machine)','Cell Type','Cell Type (machine)','Confidence Cell Type (machine)','Start Link','Cilium status','Cilium split or merged?','Annotation share link','Share link missing annotation?','Annotator Name','Date (MM/DD/YYYY)','Annotator Notes','Review Notes & Feedback','Annotations reviewed by','Updated link','Review status','Player Link','Player Notes','Review accepted'];
const row=(o={})=>{
  const r=Array(24).fill('');
  Object.assign(r,{0:o.index??'A7',2:o.seg??'720575940572159335',10:'Cilium annotated',12:o.link??'https://pyr.example/#!old',14:o.name??'Nseraf',16:o.notes??'I think I found it',
    17:o.reviewNotes??'Found the correct BB and DC\nhere: https://pyr.example/#!fix',18:o.reviewer??'Celia',19:o.reviewLink??'https://pyr.example/#!review',20:o.status??'',21:o.playerLink??'',22:o.playerNotes??'',23:''});
  return r;
};
const letterIdx=L=>[...L].reduce((n,c)=>n*26+(c.charCodeAt(0)-64),0)-1;
/** An in-memory quest tab behind the Sheets API calls the review code makes. */
function fakeSheet(rows){
  const writes=[], reads=[];
  const slice=a1=>{
    const m=a1.split('!')[1].match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
    const c0=letterIdx(m[1]),r0=m[2]?+m[2]-1:0,c1=letterIdx(m[3]||m[1]),r1=m[4]?+m[4]-1:rows.length-1;
    const v=[];for(let r=r0;r<=Math.min(r1,rows.length-1);r++)v.push((rows[r]||[]).slice(c0,c1+1));return v;
  };
  const api=async(path,init)=>{
    if(path.includes('?fields=sheets.properties')) return {sheets:[{properties:{sheetId:0,title:'All Cells (Updated June 15th)'}}]};
    if(path.includes('values:batchUpdate')){
      for(const w of JSON.parse(init.body).data){writes.push(w);const m=w.range.split('!')[1].match(/^([A-Z]+)(\d+)$/);rows[+m[2]-1][letterIdx(m[1])]=w.values[0][0];}
      return {};
    }
    if(path.includes('values:batchGet')){
      const ranges=[...path.matchAll(/ranges=([^&]+)/g)].map(m=>decodeURIComponent(m[1]));
      reads.push(...ranges);return {valueRanges:ranges.map(r=>({values:slice(r)}))};
    }
    const range=decodeURIComponent(path.split('/values/')[1].split('?')[0]);reads.push(range);return {values:slice(range)};
  };
  return {api,writes,reads,rows};
}
function fakeDb(users){
  const notes=[];
  const sb=async(path,init)=>{
    if(path.startsWith('users?')) return users;
    if(path.startsWith('notifications?')) return notes.filter(n=>path.includes('target_id=eq.'+n.target_id));
    if(path==='notifications'){const r=JSON.parse(init.body);notes.push(r);return [r];}
    throw new Error('unexpected '+path);
  };
  return {sb,notes};
}

test('the header is mapped by name, review columns R to X',()=>{
  const {cols}=review.reviewHeader([header]);
  assert.deepEqual([cols.segment,cols.name,cols.link,cols.notes,cols.reviewNotes,cols.reviewer,cols.reviewLink,cols.reviewStatus,cols.playerLink,cols.playerNotes,cols.accepted],
    [2,14,12,16,17,18,19,20,21,22,23]);
  assert.equal(cols.status,10,'Cilium status stays its own column');
});

test('check sends a waiting review to its annotator and marks the row Review Sent',async()=>{
  const sheet=fakeSheet([header,row({status:'Complete',index:'A5',seg:'1'}),row({status:'Send Review'}),row({index:'A9',seg:'2'})]);
  const {sb,notes}=fakeDb([{id:'u1',display_name:'Nseraf',username:'nseraf'},{id:'u2',display_name:'Nseraf2',username:'x'}]);
  const out=await review.check({api:sheet.api,sb});
  assert.equal(out.checked,1);
  assert.equal(notes.length,1);
  assert.equal(notes[0].target_id,'u1');
  assert.equal(notes[0].target_type,'user');
  assert.ok(notes[0].title.startsWith(review.TITLE_START));
  assert.match(notes[0].body,/\*\*Celia\*\* looked over/);
  assert.match(notes[0].body,/> Found the correct BB and DC\n> here:/);
  assert.match(notes[0].body,/\[open it\]\(https:\/\/pyr\.example\/#!review\)/);
  assert.equal(review.segmentOfNotice(notes[0].body),'720575940572159335');
  assert.ok(!/[–—]/.test(notes[0].body),'no en or em dashes');
  assert.deepEqual(sheet.writes.map(w=>[w.range.split('!')[1],w.values[0][0]]),[['U3','Review Sent']]);
  // Efficient: header, the status column, and the one waiting row.
  assert.deepEqual(sheet.reads.map(r=>r.split('!')[1]),['A1:AZ10','U2:U','A3:AZ3']);
  // A second run finds nothing waiting.
  const again=await review.check({api:sheet.api,sb});
  assert.equal(again.checked,0);
  assert.equal(notes.length,1);
});

test('a name no player has, or two share, is left waiting',async()=>{
  const sheet=fakeSheet([header,row({status:'Send Review',name:'Nobody Here'})]);
  const {sb,notes}=fakeDb([]);
  const out=await review.check({api:sheet.api,sb});
  assert.equal(out.results[0].sent,false);
  assert.match(out.results[0].why,/no player/);
  assert.equal(notes.length,0);
  assert.equal(sheet.writes.length,0);
  const two=fakeDb([{id:'a',display_name:'Nobody Here'},{id:'b',display_name:'nobody-here'}]);
  const out2=await review.check({api:sheet.api,sb:two.sb});
  assert.match(out2.results[0].why,/2 players/);
});

test('a bell that was sent but whose row was not marked is not sent twice',async()=>{
  const sheet=fakeSheet([header,row({status:'Send Review'})]);
  const {sb,notes}=fakeDb([{id:'u1',display_name:'Nseraf'}]);
  await review.check({api:sheet.api,sb});
  sheet.rows[1][20]='Send Review';  // as if the status write had failed
  await review.check({api:sheet.api,sb});
  assert.equal(notes.length,1);
});

test('dry run and one-row checks',async()=>{
  const sheet=fakeSheet([header,row({status:'Send Review'}),row({status:'Send Review',seg:'5',index:'A8'})]);
  const {sb,notes}=fakeDb([{id:'u1',display_name:'Nseraf'}]);
  const dry=await review.check({api:sheet.api,sb,dryRun:true});
  assert.equal(dry.results.length,2);
  assert.equal(notes.length,0);
  assert.equal(sheet.writes.length,0);
  const one=await review.check({api:sheet.api,sb,only:'5'});
  assert.equal(one.results.length,1);
  assert.equal(sheet.rows[2][20],'Review Sent');
  assert.equal(sheet.rows[1][20],'Send Review');
});

test('the player replies: link and notes in their own columns, status Reviewed',async()=>{
  const sheet=fakeSheet([header,row({status:'Review Sent'})]);
  const me={id:'u1',display_name:'Nseraf',username:'nseraf'};
  const got=await review.get({segmentId:'720575940572159335'},{api:sheet.api,me});
  assert.equal(got.status,'Review Sent');
  const out=await review.reply({segmentId:'720575940572159335',link:'https://pyr.example/#!new',notes:'Moved the basal body.\nThanks!'},{api:sheet.api,me});
  assert.equal(out.status,'Reviewed');
  assert.deepEqual(sheet.writes.map(w=>[w.range.split('!')[1],w.values[0][0]]),
    [['V2','https://pyr.example/#!new'],['W2','Moved the basal body.\nThanks!'],['U2','Reviewed']]);
  await assert.rejects(review.reply({segmentId:'720575940572159335',notes:'again'},{api:sheet.api,me}),/already with the reviewer/);
});

test('a reply is refused on another player\'s row, a bad link, or nothing at all',async()=>{
  const sheet=fakeSheet([header,row({status:'Review Sent'})]);
  await assert.rejects(review.reply({segmentId:'720575940572159335',notes:'x'},{api:sheet.api,me:{id:'z',display_name:'AzureJay'}}),e=>e.status===403);
  const me={id:'u1',display_name:'Nseraf'};
  await assert.rejects(review.reply({segmentId:'720575940572159335',link:'javascript:alert(1)'},{api:sheet.api,me}),/single https link/);
  await assert.rejects(review.reply({segmentId:'720575940572159335',link:'',notes:'  '},{api:sheet.api,me}),/link, your notes, or both/);
  await assert.rejects(review.reply({segmentId:'720575940572159335',notes:'x'.repeat(1001)},{api:sheet.api,me}),/under 1000/);
  await assert.rejects(review.reply({segmentId:'99',notes:'x'},{api:sheet.api,me}),/not in the quest sheet/);
  const waiting=fakeSheet([header,row({status:'Send Review'})]);
  await assert.rejects(review.reply({segmentId:'720575940572159335',notes:'x'},{api:waiting.api,me}),/not waiting/);
  assert.equal(sheet.writes.length+waiting.writes.length,0);
});

test('a second round shows the player their last update',()=>{
  const {cols}=review.reviewHeader([header]);
  const r=review.rowView(row({playerLink:'https://pyr.example/#!v2',playerNotes:'Fixed it'}),cols,4);
  const {body}=review.reviewNotice(r,'Cilia Quest');
  assert.match(body,/\*\*Your last update\*\*/);
  assert.match(body,/> Fixed it/);
});

test('get gives the Start Link and soma for Jump to cell',async()=>{
 const r=row({name:'Nseraf',status:'Review Sent'});r[1]='24231, 54615, 1538';r[9]='https://spelunker.example/#!start';
 const sheet=fakeSheet([header,r]);
 const got=await review.get({segmentId:'720575940572159335'},{api:sheet.api,me:{display_name:'Nseraf'}});
 assert.equal(got.startLink,'https://spelunker.example/#!start');
 assert.equal(got.soma,'24231, 54615, 1538');
});
test('the morning note: one to each reviewer, only when something waits',async()=>{
 const rows=[header,row({status:'Reviewed',index:'A1',seg:'1',name:'Nseraf'}),row({status:'New Player',index:'A2',seg:'2',name:'Newbie'}),
  row({status:'Reviewed',index:'A3',seg:'3',name:'Annkri'}),row({status:'Complete',index:'A4',seg:'4'}),row({status:'Review Sent',index:'A5',seg:'5'})];
 const sheet=fakeSheet(rows);
 const {sb,notes}=fakeDb([]);
 const out=await review.digest({api:sheet.api,sb});
 assert.deepEqual([out.answered,out.newcomers,out.sent],[2,1,2]);
 assert.deepEqual(notes.map(n=>n.target_id),review.REVIEWERS.map(r=>r.id));
 assert.equal(notes[0].title,'📝 Cilia Quest reviews waiting: 2 updates, 1 new player quest');
 assert.match(notes[0].body,/\*\*2 players have sent an update\*\*/);
 assert.match(notes[0].body,/• \*\*A3\*\* from Annkri/);
 assert.match(notes[0].body,/\*\*1 quest from new players\*\*/);
 assert.match(notes[0].body,/\[Open the quest sheet\]\(https:\/\/docs\.google\.com\/spreadsheets\/d\/1CXRPE4rmH1SRQ3nqdyp9ULsMdQygJ-Ldjn3jN_jcqRU\/edit#gid=0\)/);
 assert.ok(!/[–—]/.test(notes[0].title+notes[0].body),'no en or em dashes');
 assert.equal(sheet.writes.length,0,'the note changes nothing in the sheet');
 // A quiet morning sends nothing.
 const quiet=fakeSheet([header,row({status:'Complete'})]);
 const db2=fakeDb([]);
 assert.equal((await review.digest({api:quiet.api,sb:db2.sb})).sent,0);
 assert.equal(db2.notes.length,0);
 // One update alone reads in the singular.
 assert.equal(review.digestNotice([{index:'A1',annotator:'X'}],[],'https://x').title,'📝 Cilia Quest reviews waiting: 1 update');
});
