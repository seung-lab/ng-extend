'use strict';
const SOURCES = Object.freeze({
  // completeStatuses: the ways a cell can end, exactly as the sheet's Status
  // dropdown spells them (read from the sheet 2026-10-03: WIP, Complete,
  // Complete (cut off), Need Help, Not BC, Can't Complete; WIP and Need Help
  // are not endings). The Complete form sends one of these; nothing else is
  // ever written to Status. A source without the list writes plain Complete.
  stroeh_mouse_retina: {id:'10cPvkLYU5zGDe7AJ6SHjhMcfdqXyiPM4W4qgob2g70w', gid:37544110,
    completeStatuses:['Complete','Complete (cut off)','Not BC',"Can't Complete"]},
  pinky_nf_v2: {id:'1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU', gid:0},
  // MEC (Ames 2026-09-28): no segment IDs in this sheet. Rows are found by
  // "Starting XYZ Coords", which the importer stores as the task's claim point.
  pni_mec: {id:'1cGit_jEzUa3idCqM0w_KRW4P42KKN9RnPK4Zafa9Nzw', gid:869365415, matchBy:'startcoords'},
});
/** Header patterns for the column a row is matched on. */
/** Status values that mean "still being worked on": completing the cell
 *  replaces them. Any other existing Status is the sheet owner's and stays. */
const UNFINISHED_STATUSES = ['WIP','Need Help'];
const SEGMENT_HEADERS = ['startseg','segmentid','segment','segid'];
const START_COORD_HEADERS = ['startingxyz','startingcoord','startcoord'];
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
function sourceFor(input) {
  if (!Object.hasOwn(SOURCES,input.dataset)) fail(400,'This dataset has no registered source sheet.');
  if (!/^\d{1,20}$/.test(String(input.segmentId))) fail(400,'Invalid segment ID.');
  if (!['claim','complete','coordinates','release','reopen'].includes(input.action)) fail(400,'Invalid sheet action.');
  return SOURCES[input.dataset];
}
/** Letters and digits only, lower case: "Krzysztof Kruk" and "KrzysztofKruk" are one name. */
const nameKey = v => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/**
 * How the sheet already spells this player's name, if it does.
 * Pyr knows a player by the name from their sign in ("Krzysztof Kruk"); the
 * lab's sheet may hold the same name written another way ("KrzysztofKruk",
 * 4,461 rows). Writing Pyr's spelling made a second person in the sheet
 * (Krzysztof 2026-10-08). So: among the names already in the Proofreader
 * column, the ones that are this player's display name apart from spaces,
 * punctuation and capitals; the most used of those wins, the player's own
 * spelling on a tie. Never a different name: a username or a nickname in the
 * sheet is not matched. Returns '' when the sheet has no such spelling.
 *   existing  Proofreader values already in the sheet (repeats count)
 */
function sheetSpelling(displayName, existing) {
  const own = String(displayName ?? '').trim(), key = nameKey(own);
  if (!key) return '';
  const count = new Map();
  for (const raw of existing || []) {
    const v = String(raw ?? '').trim();
    if (v && nameKey(v) === key) count.set(v,(count.get(v)||0)+1);
  }
  let best = '', n = 0;
  for (const [v,c] of count) if (c > n || (c === n && v === own)) { best = v; n = c; }
  return best.slice(0,120);
}
function sheetValues(input, me, task, now) {
  sourceFor(input);
  if (!me || task?.assigned_to !== me.id || task.dataset !== input.dataset || task.segment_id !== input.segmentId) fail(403,'Only your own claimed cell can be synced.');
  if (!['assigned','in_progress','completed'].includes(task.status)) fail(409,'Claim this cell before syncing.');
  if (input.action === 'complete' && task.status !== 'completed') fail(409,'Complete this cell before syncing.');
  // Letting a claim go takes the player's name off the row again (Annkri
  // 2026-10-08: "after releasing a cell I am still marked as proofreader in
  // the sheet"). Sent just BEFORE the claim is released, while it is still
  // theirs. Only their own name is cleared, however the sheet spells it, and
  // only on a row that is not finished or waiting on a gamemaster.
  // Reopening a cell the player completed (sent just AFTER the claim is open
  // again): its finished Status goes back to WIP. Nothing is erased; the date,
  // final ID and link stay until the cell is completed again, and are then
  // replaced (see `whenReopened` below). Only on the player's own row.
  if (input.action === 'reopen') {
    if (task.status === 'completed') fail(409,'Reopen this cell before syncing.');
    const mine = [...new Set([me.sheet_name, me.display_name, me.username].map(nameKey).filter(Boolean))];
    const finished = SOURCES[input.dataset].completeStatuses || ['Complete'];
    return [[['status'],'WIP',{replaceValues:finished,requireName:mine,onlyReplace:true}]];
  }
  if (input.action === 'release') {
    if (task.status === 'completed') fail(409,'A completed cell keeps its proofreader.');
    const mine = [...new Set([me.sheet_name, me.display_name, me.username].map(nameKey).filter(Boolean))];
    return [
      [['proofreader','claimedby'],'',{clearIfName:mine}],
      [['datestarted','dateclaimed'],'',{clearWithName:true}],
    ];
  }
  // The player's name as the sheet already spells it (see sheetSpelling), or
  // their display name. Nobody's name in the sheet is swapped for another one
  // (Ames 2026-10-08: "we don't want to replace their name in the sheet").
  const name = String(me.sheet_name || me.display_name || me.username || 'Player').slice(0,120);
  const coords = String(input.action === 'coordinates' ? input.coordinates || '' : task.soma_coords || '').trim();
  if (coords && !/^\[?\s*-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?\s*\]?$/.test(coords)) fail(400,'Enter three numeric coordinates.');
  // On completion the completer IS the proofreader: replace a name left by an
  // earlier claim (Amy's claim stayed on a row Celia completed, 2026-09-28),
  // but only while the row is not already marked complete.
  const fields = input.action === 'coordinates' ? [] : [[['proofreader','claimedby','completedby'],name,input.action === 'complete' ? {replaceUntilStatus:true} : undefined]];
  const isDate = {userEntered:/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(now))};
  // "Date Started" is the day the cell was claimed (MEC sheet, Ames 2026-09-28).
  if (input.action === 'claim') fields.push([['datestarted','dateclaimed'],now,isDate]);
  if (input.action === 'complete') {
    // A plain M/D/YYYY date is entered like a person typing it, so the sheet
    // stores a real date (9/28/2026), not an ISO timestamp as text.
    // "Date Complete" (retina) or "Date Ended" (MEC).
    // The status the proofreader chose (Nseraf 2026-09-30: most retina cells
    // are "Complete (cut off)", and the form could only write "Complete").
    // It must be one of this sheet's own options, character for character.
    const allowed = SOURCES[input.dataset].completeStatuses || ['Complete'];
    // Plain text only: String(['Complete']) is 'Complete', and a list must not pass as one.
    const status = input.status == null || input.status === '' ? 'Complete' : input.status;
    if (typeof status !== 'string' || !allowed.includes(status)) fail(400,'That status is not one of this sheet\'s options.');
    // whenReopened: on a row the player reopened (Status WIP, their own
    // name), the date, final ID and link from the first completion are
    // replaced by this one's. On any other row a filled cell is kept.
    const mineKeys = [...new Set([me.sheet_name, me.display_name, me.username].map(nameKey).filter(Boolean))];
    const again = {whenReopened:mineKeys};
    fields.push([['status'],status,{replaceValues:UNFINISHED_STATUSES}],[['datecomplete','completedtime','dateended'],now,{...isDate,...again}]);
    if (task.final_segment_id && /^\d{1,20}$/.test(task.final_segment_id)) fields.push([['finalseg'],task.final_segment_id,again]);
    // The proofreader's view of the finished cell (Amy 2026-09-28): the
    // retina sheet's "Final Link" column. https only, no spaces or quotes;
    // written RAW like every field, so it can never become a formula.
    const link = String(input.link ?? '').trim();
    if (link) {
      if (link.length > 2000 || !/^https:\/\/[^\s"'<>]+$/i.test(link)) fail(400,'The link must be a single https link.');
      fields.push([['finallink','finalnglink'],link,again]);
    }
    // Optional note from the Complete form, for the sheet's Notes column.
    const notes = String(input.notes ?? '').replace(/\s+/g,' ').trim();
    if (notes) {
      if (notes.length > 1000) fail(400,'Keep the note under 1000 characters.');
      fields.push([['notes'],notes]);
    }
  }
  // Completion writes exactly Proofreader, Status, Date Complete, Final SegID,
  // Final Link and Notes (Amy 2026-09-28). Coordinates go only to a
  // "Corrected soma" column, never the original "Soma or stem Coords".
  if (input.action === 'coordinates' && coords) fields.push([['correctedsoma'],coords]);
  return fields;
}
/** "129296, 128864, 6565" or "[129296 128864 6565]" -> "129296,128864,6565". */
const pointKey = v => {
  const n = String(v ?? '').match(/-?\d+(?:\.\d+)?/g);
  return n && n.length === 3 ? n.map(x => String(Math.round(Number(x)))).join(',') : '';
};
/**
 * `match` is the segment ID (string), or {segmentId, point} where `point`
 * ([x,y,z], the task's claim point) finds the row on a sheet whose source
 * has matchBy 'startcoords'.
 */
function planSheetUpdate(grid, title, match, fields) {
  const firstColumn = (header,patterns) => {for (const p of patterns) {const n=header.findIndex(h=>h.includes(p)); if(n>=0)return n;} return -1;};
  const byPoint = typeof match === 'object' && match !== null && Array.isArray(match.point);
  const segmentId = typeof match === 'string' ? match : String(match?.segmentId ?? '');
  const want = byPoint ? pointKey(match.point.join(',')) : segmentId;
  if (byPoint && !want) fail(409,'This cell has no starting point to find it in the sheet.');
  let header, headerRow=-1, keyCol=-1;
  for(let i=0;i<Math.min(grid.length,10);i++) {
    const h=grid[i].map(norm), col=firstColumn(h,byPoint ? START_COORD_HEADERS : SEGMENT_HEADERS);
    if(col>=0) {header=h;headerRow=i;keyCol=col;break;}
  }
  if(keyCol<0) fail(409,byPoint ? 'The sheet needs a Starting XYZ Coords column.' : 'The sheet needs a Segment ID column.');
  const matches=[];
  for(let i=headerRow+1;i<grid.length;i++) {
    const cell=grid[i][keyCol];
    if(byPoint ? pointKey(cell)===want : String(cell??'').trim()===segmentId) matches.push(i);
  }
  const what = byPoint ? 'This cell' : 'This segment';
  if(matches.length!==1) fail(409,matches.length ? `${what} appears more than once in the source sheet.` : `${what} is missing from the source sheet.`);
  const row=matches[0], data=[], userEnteredData=[];
  const statusCol=firstColumn(header,['status']);
  // "Empty" for the Proofreader rule includes an in-progress Status: the cell is not finished yet.
  const statusNow=statusCol<0 ? '' : String(grid[row][statusCol]??'').trim();
  const statusEmpty=!statusNow || UNFINISHED_STATUSES.includes(statusNow);
  // A release may clear a claim that is still open: no Status yet, or WIP.
  // "Need Help" and every finished Status keep the name they have.
  const openClaim=!statusNow || statusNow==='WIP';
  let nameCleared=false;
  // Whose row this is, for the rules that only apply to the player's own.
  const nameCol=firstColumn(header,['proofreader','claimedby','completedby']);
  const rowName=nameCol<0 ? '' : nameKey(grid[row][nameCol]);
  const rangeOf=col=>{let letters='',n=col; do {letters=String.fromCharCode(65+n%26)+letters; n=Math.floor(n/26)-1;} while(n>=0); return `'${title.replace(/'/g,"''")}'!${letters}${row+1}`;};
  for(const [patterns,value,opts] of fields) {
    const col=firstColumn(header,patterns);
    if(col<0) continue;
    const existing=String(grid[row][col]??'').trim();
    if(opts?.clearIfName) {
      // Only the releasing player's own name, never someone else's.
      if(existing && openClaim && opts.clearIfName.includes(nameKey(existing))) { data.push({range:rangeOf(col),values:[['']]}); nameCleared=true; }
      continue;
    }
    if(opts?.clearWithName) {
      if(existing && nameCleared) data.push({range:rangeOf(col),values:[['']]});
      continue;
    }
    // Preserve the sheet owner's existing data. Retrying a write is harmless.
    // Exception: the Proofreader on completion, while Status is still empty.
    // Exception: a Status that only says the cell was in progress.
    if(opts?.requireName && !opts.requireName.includes(rowName)) continue;
    // onlyReplace: change a value that is there, never fill an empty cell.
    if(opts?.onlyReplace && !existing) continue;
    const replaceable = (opts?.replaceUntilStatus && statusEmpty && existing!==String(value))
      || (opts?.replaceValues?.includes(existing) && existing!==String(value))
      || (opts?.whenReopened && statusNow==='WIP' && opts.whenReopened.includes(rowName) && existing!==String(value));
    if(existing && !replaceable) continue;
    let letters='',n=col;
    do {letters=String.fromCharCode(65+n%26)+letters; n=Math.floor(n/26)-1;} while(n>=0);
    (opts?.userEntered ? userEnteredData : data).push({range:`'${title.replace(/'/g,"''")}'!${letters}${row+1}`,values:[[String(value)]]});
  }
  // userEnteredData holds only validated M/D/YYYY dates; everything else is RAW.
  return {valueInputOption:'RAW',data,userEnteredData};
}
module.exports={SOURCES,SEGMENT_HEADERS,START_COORD_HEADERS,sourceFor,sheetValues,sheetSpelling,nameKey,planSheetUpdate,pointKey};
