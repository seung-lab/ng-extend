'use strict';
const SOURCES = Object.freeze({
  stroeh_mouse_retina: {id:'1H9KV0-CDGAzd3nvM0Vp1iXun9okwkpe-7tHhpkJbfWc', gid:37544110},
  pinky_nf_v2: {id:'1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU', gid:0},
});
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
function sourceFor(input) {
  if (!Object.hasOwn(SOURCES,input.dataset)) fail(400,'This dataset has no registered source sheet.');
  if (!/^\d{1,20}$/.test(String(input.segmentId))) fail(400,'Invalid segment ID.');
  if (!['claim','complete','coordinates'].includes(input.action)) fail(400,'Invalid sheet action.');
  return SOURCES[input.dataset];
}
function sheetValues(input, me, task, now) {
  sourceFor(input);
  if (!me || task?.assigned_to !== me.id || task.dataset !== input.dataset || task.segment_id !== input.segmentId) fail(403,'Only your own claimed cell can be synced.');
  if (!['assigned','in_progress','completed'].includes(task.status)) fail(409,'Claim this cell before syncing.');
  if (input.action === 'complete' && task.status !== 'completed') fail(409,'Complete this cell before syncing.');
  const name = String(me.display_name || me.username || 'Player').slice(0,120);
  const coords = String(input.action === 'coordinates' ? input.coordinates || '' : task.soma_coords || '').trim();
  if (coords && !/^\[?\s*-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?\s*\]?$/.test(coords)) fail(400,'Enter three numeric coordinates.');
  const fields = input.action === 'coordinates' ? [] : [[['proofreader','claimedby','completedby'],name]];
  if (input.action === 'complete') {
    fields.push([['status'],'Complete'],[['datecomplete','completedtime'],now]);
    if (task.final_segment_id && /^\d{1,20}$/.test(task.final_segment_id)) fields.push([['finalseg'],task.final_segment_id]);
  }
  if (input.action !== 'claim' && coords) fields.push([['correctedsoma','somacoord'],coords]);
  return fields;
}
function planSheetUpdate(grid, title, segmentId, fields) {
  const firstColumn = (header,patterns) => {for (const p of patterns) {const n=header.findIndex(h=>h.includes(p)); if(n>=0)return n;} return -1;};
  let header, headerRow=-1, segCol=-1;
  for(let i=0;i<Math.min(grid.length,10);i++) {
    const h=grid[i].map(norm), col=firstColumn(h,['startseg','segmentid','segment','segid']);
    if(col>=0) {header=h;headerRow=i;segCol=col;break;}
  }
  if(segCol<0) fail(409,'The sheet needs a Segment ID column.');
  const matches=[];
  for(let i=headerRow+1;i<grid.length;i++) if(String(grid[i][segCol]??'').trim()===segmentId) matches.push(i);
  if(matches.length!==1) fail(409,matches.length ? 'This segment appears more than once in the source sheet.' : 'This segment is missing from the source sheet.');
  const row=matches[0], data=[];
  for(const [patterns,value] of fields) {
    const col=firstColumn(header,patterns);
    // Preserve the sheet owner's existing data. Retrying a write is harmless.
    if(col<0 || String(grid[row][col]??'').trim()) continue;
    let letters='',n=col;
    do {letters=String.fromCharCode(65+n%26)+letters; n=Math.floor(n/26)-1;} while(n>=0);
    data.push({range:`'${title.replace(/'/g,"''")}'!${letters}${row+1}`,values:[[String(value)]]});
  }
  return {valueInputOption:'RAW',data};
}
module.exports={SOURCES,sourceFor,sheetValues,planSheetUpdate};
