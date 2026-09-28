'use strict';
const {sourceFor,sheetValues,planSheetUpdate}=require('./sheet-policy');
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
async function syncSheet(input,me,task,credential) {
  // The retina sheet's dates read M/D/YYYY (9/28/2026); the lab is on US Eastern time.
  const today=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric'}).format(new Date());
  const source=sourceFor(input),fields=sheetValues(input,me,task,today);
  const meta=await sheetsApi(credential,source.id+'?fields=sheets.properties');
  const sheet=meta.sheets.find(s=>s.properties.sheetId===source.gid);
  if(!sheet) throw new Error('Registered sheet tab missing');
  const title=sheet.properties.title;
  const range="'"+title.replace(/'/g,"''")+"'!A1:AZ20000";
  const grid=await sheetsApi(credential,source.id+'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMATTED_VALUE');
  // MEC's sheet has no segment IDs: its rows are found by the task's claim point.
  const match=source.matchBy==='startcoords'
    ? {segmentId:input.segmentId,point:[task?.claim_point_x,task?.claim_point_y,task?.claim_point_z]}
    : input.segmentId;
  const plan=planSheetUpdate(grid.values||[],title,match,fields);
  if(plan.data.length) await sheetsApi(credential,source.id+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:plan.data})});
  if(plan.userEnteredData.length) await sheetsApi(credential,source.id+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'USER_ENTERED',data:plan.userEnteredData})});
  return {ok:true,updated:plan.data.length+plan.userEnteredData.length};
}
module.exports={syncSheet,sheetsApi};
