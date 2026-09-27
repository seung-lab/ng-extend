// Runs only in the isolated, unprivileged model job. The publisher independently validates this data.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{encoding:'utf8'});
const changed=git('diff','--name-only','-z','HEAD').split('\0');
const added=git('ls-files','--others','--exclude-standard','-z').split('\0');
const names=[...new Set([...changed,...added])].filter(p=>p&&!p.startsWith('.triage/'));
const files=names.map(path=>{
 if(!fs.existsSync(path))return {path,content:null};
 if(!fs.lstatSync(path).isFile()||fs.lstatSync(path).isSymbolicLink())throw Error('Only regular files may be published');
 return {path,content:fs.readFileSync(path).toString('base64')};
});
const summary=fs.readFileSync('.triage/triage-summary.md','utf8');
fs.mkdirSync('model-output',{recursive:true});
fs.writeFileSync('model-output/result.json',JSON.stringify({summary,files}));
