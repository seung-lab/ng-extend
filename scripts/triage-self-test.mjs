// Trusted consumer of the isolated model job's artifact. No write credentials.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {validateResult} from './triage-policy.mjs';
const result=JSON.parse(fs.readFileSync('model-output/result.json','utf8'));
validateResult(result);
assert.equal(result.files.length,1);
assert.equal(result.files[0].path,'docs/triage-self-test.md');
assert.equal(Buffer.from(result.files[0].content,'base64').toString('utf8').trim(),'EyeWire triage self-test passed.');
assert.match(result.summary,/Self-test completed/);
console.log('Triage model, file tools, artifact export and trusted validation passed. No report, message, branch or deployment was created.');
