const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareUpload}=require('./upload-policy');
const who={email:'player@example.invalid'};
const image={kind:'help',contentType:'image/png',data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64')};
test('public and player uploads cannot overwrite official assets',()=>{
 assert.throws(()=>prepareUpload(image,null,false),/Sign in/);
 assert.throws(()=>prepareUpload({...image,kind:'badges'},who,false),/Admins only/);
 const first=prepareUpload({...image,path:'../../badges/official.png',upsert:true},who,false);
 const second=prepareUpload(image,who,false);
 assert.match(first.path,/^help-screenshots\/[a-f0-9]{24}\/[a-f0-9-]+\.png$/);
 assert.notEqual(first.path,second.path);
});
test('SVG, MIME lies, unsupported formats and oversized uploads are rejected',()=>{
 assert.throws(()=>prepareUpload({...image,data:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')},who,false),/bytes/);
 assert.throws(()=>prepareUpload({...image,contentType:'text/html'},who,false),/format/);
 assert.throws(()=>prepareUpload({...image,data:Buffer.alloc(8*1024*1024+1).toString('base64')},who,false),/under 8/);
});
