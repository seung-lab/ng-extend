const crypto=require('node:crypto');
const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
function prepareUpload(input, who, isAdmin) {
 if(!who)error(401,'Sign in first.');
 if(!['help','notifications','badges'].includes(input.kind))error(400,'Invalid upload kind.');
 if(input.kind!=='help'&&!isAdmin)error(403,'Admins only.');
 if(typeof input.data!=='string'||input.data.length>12*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))error(400,'Invalid image data.');
 const bytes=Buffer.from(input.data,'base64');
 if(!bytes.length||bytes.length>8*1024*1024)error(413,'Images must be under 8 MB.');
 const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const gif=['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6));
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 const detected=png?['image/png','png']:jpeg?['image/jpeg','jpg']:gif?['image/gif','gif']:webp?['image/webp','webp']:null;
 if(!detected||input.contentType!==detected[0])error(400,'Image bytes do not match a supported image format.');
 const owner=crypto.createHash('sha256').update(who.email).digest('hex').slice(0,24);
 const prefix=input.kind==='help'?'help-screenshots':input.kind;
 return {bytes,contentType:detected[0],path:`${prefix}/${owner}/${crypto.randomUUID()}.${detected[1]}`};
}
module.exports={prepareUpload};
