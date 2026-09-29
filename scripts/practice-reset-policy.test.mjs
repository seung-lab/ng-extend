import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resetDue,operationsAfter,validateResetExample,validateIntroFixture,parsePcgStamp} from './practice-reset-policy.mjs';
test('manual resets never steal an active practice session or a fresh reset',()=>{
 const now=Date.now();
 assert.equal(resetDue({status:'in_use',expires_at:new Date(now+60000).toISOString()},now,true),false);
 assert.equal(resetDue({status:'in_use'},now,true),false);
 assert.equal(resetDue({status:'resetting',updated_at:new Date(now).toISOString()},now,true),false);
 assert.equal(resetDue({status:'in_use',expires_at:new Date(now-1).toISOString()},now),true);
});
test('CAVE operation formats are filtered against the reviewed baseline',()=>{
 const rows=[{operation_id:1,timestamp:1},{operation_id:2,timestamp:3}];
 const expected=[{operationId:2,at:3000}];
 assert.deepEqual(operationsAfter({'123':rows},'123',new Date(2000).toISOString()),expected);
 assert.deepEqual(operationsAfter({operation_id:{0:1,1:2},timestamp:{0:1,1:3}},'123',new Date(2000).toISOString()),expected);
 for(const stamp of [1790467200,'1790467200',1790467200000,'2026-09-27 00:00:00.000000','2026-09-27T00:00:00Z']) assert.equal(parsePcgStamp(stamp),1790467200000);
 assert.throws(()=>validateResetExample({id:'x'},{}));
});
test('intro fixtures stay in the intro sandbox table',()=>{
 const ok={pcg_server:'https://minnie.microns-daf.com',pcg_table:'pinky_training6',roots:['648518346353862024'],baseline_at:'2026-09-29T14:03:21Z'};
 assert.equal(validateIntroFixture(ok),'https://minnie.microns-daf.com/segmentation/api/v1/table/pinky_training6');
 assert.throws(()=>validateIntroFixture({...ok,pcg_table:'minnie65_public'}));
 assert.throws(()=>validateIntroFixture({...ok,roots:['1; drop']}));
 assert.throws(()=>validateIntroFixture({...ok,baseline_at:'soon'}));
});
