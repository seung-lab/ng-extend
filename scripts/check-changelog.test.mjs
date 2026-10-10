import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readEntries,verdict} from './check-changelog.mjs';

const NOW=Date.parse('2026-10-10T16:00:00Z');
const file=entries=>JSON.stringify({about:'x',entries});
const e=(at,title,items=['A plain sentence.'])=>({at,title,items});

test('the file must be well formed, and nothing may be dated in the future',()=>{
 assert.equal(readEntries(file([e('2026-10-10T15:45:00Z','Bigger pictures')]),NOW).length,1);
 assert.equal(readEntries(file([e('2026-10-10T16:10:00Z','A few minutes ahead is fine')]),NOW).length,1);
 // The entry that showed as new on every page load: dated 23:00 on the day.
 assert.throws(()=>readEntries(file([e('2026-10-10T23:00:00Z','A daily note of what changed')]),NOW),/dated in the future/);
 assert.throws(()=>readEntries('{"entries":[',NOW),/not valid JSON/);
 assert.throws(()=>readEntries(file([e('2026-10-10T15:00:00Z','')]),NOW),/no title/);
 assert.throws(()=>readEntries(file([e('2026-10-10T15:00:00Z','No sentences',[])]),NOW),/at least one sentence/);
 assert.throws(()=>readEntries(file([e('soon','Bad time')]),NOW),/no readable/);
 assert.throws(()=>readEntries(file([e('2026-10-10T15:00:00Z','A dash',['One thing — another.'])]),NOW),/long dash/);
});

test('a push that changes what players get must add an entry',()=>{
 const before=[e('2026-10-09T16:22:00Z','The 2D image arrives sooner')];
 const withNew=[e('2026-10-10T15:45:00Z','Bigger pictures'),...before];
 const run=(changedFiles,entriesNow,messages='Fix a thing')=>verdict({changedFiles,entriesBefore:before,entriesNow,messages});
 assert.equal(run(['src/store.ts','static/changelog.json'],withNew).ok,true);
 assert.equal(run(['src/store.ts'],before).ok,false);                        // forgot the entry
 assert.deepEqual(run(['src/store.ts','scripts/x.mjs'],before).visible,['src/store.ts']);
 assert.equal(run(['static/changelog.json','src/a.vue'],before).ok,false);   // touched the file, added nothing
 assert.equal(run(['src/store.ts'],before,'Refactor the store\n\n[no player change]').ok,true);
 assert.equal(run(['scripts/x.mjs','functions/index.js','docs/a.md','.github/workflows/y.yml'],before).ok,true);
 assert.equal(run(['static/changelog.json'],withNew).ok,true);
 assert.equal(run(['third_party/neuroglancer/a.ts'],before).ok,false);
 assert.equal(run(['src/components/AdminHub.vue','src/components/TriagePage.vue'],before).ok,true);   // admins only
});
