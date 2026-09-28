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
  const source=sourceFor(input),fields=sheetValues(input,me,task,new Date().toISOString());
  const meta=await sheetsApi(credential,source.id+'?fields=sheets.properties');
  const sheet=meta.sheets.find(s=>s.properties.sheetId===source.gid);
  if(!sheet) throw new Error('Registered sheet tab missing');
  const title=sheet.properties.title;
  const range="'"+title.replace(/'/g,"''")+"'!A1:AZ20000";
  const grid=await sheetsApi(credential,source.id+'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMATTED_VALUE');
  const plan=planSheetUpdate(grid.values||[],title,input.segmentId,fields);
  if(plan.data.length) await sheetsApi(credential,source.id+'/values:batchUpdate',{method:'POST',body:JSON.stringify(plan)});
  return {ok:true,updated:plan.data.length};
}
module.exports={syncSheet,sheetsApi};
