const crypto=require('node:crypto');
const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
// Files on a To do card (Ames 2026-11-09: "can you let me attach a file?").
// Any file up to 7 MB, admins only, in their own bucket (admin-files, which
// takes any type). Types a browser would run or draw (HTML, SVG, scripts) are
// stored as plain bytes, so opening one downloads it instead.
const FILE_MAX_MB=7;
const FILE_TYPES=new Set(['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain','text/csv','application/json','application/zip',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint',
 'video/mp4','video/quicktime','audio/mpeg','audio/wav']);
function fileName(name){
 const n=String(name||'').normalize('NFKD').replace(/[^\w.\- ]+/g,'').replace(/\s+/g,'_').replace(/^[.\-_]+/,'').slice(-80);
 return n||'file';
}
function prepareFileUpload(input, who, isAdmin) {
 if(!who)error(401,'Sign in first.');
 if(!isAdmin)error(403,'Admins only.');
 if(typeof input.data!=='string'||input.data.length>Math.ceil(FILE_MAX_MB*1024*1024/3)*4+8||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))error(400,'Invalid file data.');
 const bytes=Buffer.from(input.data,'base64');
 if(!bytes.length)error(400,'That file is empty.');
 if(bytes.length>FILE_MAX_MB*1024*1024)error(413,`Files must be under ${FILE_MAX_MB} MB.`);
 const contentType=FILE_TYPES.has(input.contentType)?input.contentType:'application/octet-stream';
 const owner=crypto.createHash('sha256').update(who.email).digest('hex').slice(0,24);
 return {bytes,contentType,bucket:'admin-files',path:`todo-files/${owner}/${crypto.randomUUID()}/${fileName(input.name)}`};
}
function prepareUpload(input, who, isAdmin, isBlogAuthor) {
 if(!who)error(401,'Sign in first.');
 if(input.kind==='todo-file')return prepareFileUpload(input,who,isAdmin);
 if(!['help','notifications','badges','blog','reply','todo','instructions'].includes(input.kind))error(400,'Invalid upload kind.');
 if(input.kind==='blog'){if(!isBlogAuthor)error(403,'Only blog authors can add images to posts.');}
 else if(input.kind!=='help'&&!isAdmin)error(403,'Admins only.');
 if(typeof input.data!=='string'||input.data.length>12*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))error(400,'Invalid image data.');
 const bytes=Buffer.from(input.data,'base64');
 // Notification and badge images: 3 MB (Ames 2026-09-30). Player screenshots
 // keep 8 MB: a full-screen PNG on a large display can pass 3 MB.
 const maxMB=input.kind==='help'?8:3;
 if(!bytes.length||bytes.length>maxMB*1024*1024)error(413,`Images must be under ${maxMB} MB.`);
 const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const gif=['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6));
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 const detected=png?['image/png','png']:jpeg?['image/jpeg','jpg']:gif?['image/gif','gif']:webp?['image/webp','webp']:null;
 if(!detected||input.contentType!==detected[0])error(400,'Image bytes do not match a supported image format.');
 const owner=crypto.createHash('sha256').update(who.email).digest('hex').slice(0,24);
 // Images in replies to submitters (Ames 2026-10-20): admins only, in their
 // own folder, deleted after 7 days by scripts/cleanup-screenshots.mjs.
 // To do board images (Ames 2026-10-21): admins only, kept.
 // Pictures in in-game instructions (Ames 2026-11-06, Add image): admins only, kept.
 const prefix=input.kind==='help'?'help-screenshots':input.kind==='reply'?'reply-images':input.kind==='todo'?'todo-images':input.kind;
 return {bytes,contentType:detected[0],path:`${prefix}/${owner}/${crypto.randomUUID()}.${detected[1]}`};
}
module.exports={prepareUpload,fileName,FILE_MAX_MB};
