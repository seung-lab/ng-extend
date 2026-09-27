import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resetDue,operationsAfter,validateResetExample,parsePcgStamp} from './practice-reset-policy.mjs';
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
