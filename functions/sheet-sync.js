'use strict';
const {sourceFor,sheetValues,planSheetUpdate,pointKey,SEGMENT_HEADERS,START_COORD_HEADERS}=require('./sheet-policy');
const SHEETS_IDENTITY='eyewire-ii-spreadsheet@eyewire-ii.iam.gserviceaccount.com';
let cached;
async function sheetsToken(credential) {
  if(cached && cached.expires > Date.now()+60000) return cached.token;
  const adc=await credential.getAccessToken();
  const r=await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SHEETS_IDENTITY}:generateAccessToken`, {
    method:'POST',headers:{Authorization:`Bearer ${adc.access_token}`,'Content-Type':'application/json'},
    body:JSON.stringify({scope:['https://www.googleapis.com/auth/spreadsheets'],lifetime:'600s'}),
    redirect:'error',signal:AbortSignal.timeout(15000),
  });
  if(!r.ok) throw new Error(`Sheet identity unavailable (${r.status})`);
  const data=await r.json(); cached={token:data.accessToken,expires:Date.parse(data.expireTime)}; return cached.token;
}
async function sheetsApi(credential,path,init={}) {
  const token=await sheetsToken(credential);
  const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+path,{
    ...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    redirect:'error',signal:AbortSignal.timeout(20000),
  });
  if(!r.ok) { const error=await r.json().catch(()=>({})); throw new Error(`Sheet request failed (${r.status}): ${String(error.error?.message||'').slice(0,300)}`); }
  return r.json();
}
const colLetters=n=>{let s='';do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;};
const normHeader=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
/**
 * Read only what a write needs (Amy 2026-09-30: "read only the SegID column").
 * It used to read the whole tab (A1:AZ20000, ~14,000 retina rows) on every
 * claim and completion. Now: the first 10 rows (to find the header), the one
 * key column (Start SegID, or Starting XYZ on MEC), then the single matching
 * row. The result is laid out like the full grid, so planSheetUpdate's
 * matching and never-overwrite rules are unchanged.
 */
async function readRowsForMatch(api,sourceId,title,byPoint,want) {
  const q="'"+title.replace(/'/g,"''")+"'";
  const get=range=>api(sourceId+'/values/'+encodeURIComponent(q+'!'+range)+'?valueRenderOption=FORMATTED_VALUE').then(r=>r.values||[]);
  const head=await get('A1:AZ10');
  const patterns=byPoint?START_COORD_HEADERS:SEGMENT_HEADERS;
  let headerRow=-1,keyCol=-1;
  for(let i=0;i<head.length&&keyCol<0;i++){
    const h=(head[i]||[]).map(normHeader);
    for(const p of patterns){const n=h.findIndex(x=>x.includes(p));if(n>=0){headerRow=i;keyCol=n;break;}}
  }
  if(keyCol<0) return head;  // planSheetUpdate reports the missing column
  const L=colLetters(keyCol),first=headerRow+2;
  const column=await get(`${L}${first}:${L}`);
  const grid=head.map(r=>r||[]);
  for(let k=0;k<column.length;k++){
    const i=headerRow+1+k;
    if(!grid[i]) grid[i]=[];
    grid[i][keyCol]=column[k]?.[0]??'';
  }
  for(let i=0;i<grid.length;i++) if(!grid[i]) grid[i]=[];
  const hits=[];
  for(let i=headerRow+1;i<grid.length;i++){
    const cell=grid[i][keyCol];
    if(byPoint?pointKey(cell)===want:String(cell??'').trim()===want) hits.push(i);
  }
  if(hits.length===1&&hits[0]>=head.length){
    const full=await get(`A${hits[0]+1}:AZ${hits[0]+1}`);
    grid[hits[0]]=full[0]||[];
  }
  return grid;
}
async function syncSheet(input,me,task,credential,api=(path,init)=>sheetsApi(credential,path,init)) {
  // The retina sheet's dates read M/D/YYYY (9/28/2026); the lab is on US Eastern time.
  const today=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric'}).format(new Date());
  const source=sourceFor(input),fields=sheetValues(input,me,task,today);
  const meta=await api(source.id+'?fields=sheets.properties');
  const sheet=meta.sheets.find(s=>s.properties.sheetId===source.gid);
  if(!sheet) throw new Error('Registered sheet tab missing');
  const title=sheet.properties.title;
  // MEC's sheet has no segment IDs: its rows are found by the task's claim point.
  const byPoint=source.matchBy==='startcoords';
  const match=byPoint
    ? {segmentId:input.segmentId,point:[task?.claim_point_x,task?.claim_point_y,task?.claim_point_z]}
    : input.segmentId;
  const want=byPoint?pointKey(match.point.join(',')):String(input.segmentId);
  const grid=await readRowsForMatch(api,source.id,title,byPoint,want);
  const plan=planSheetUpdate(grid,title,match,fields);
  if(plan.data.length) await api(source.id+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:plan.data})});
  if(plan.userEnteredData.length) await api(source.id+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'USER_ENTERED',data:plan.userEnteredData})});
  return {ok:true,updated:plan.data.length+plan.userEnteredData.length};
}
module.exports={syncSheet,sheetsApi};
