const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const target = path.join(root, 'node_modules', 'neuroglancer', 'src', 'neuroglancer');
const link = path.join(root, 'third_party', 'neuroglancer');

console.log('root:', root);
console.log('target:', target);
console.log('link:', link);
console.log('target exists:', fs.existsSync(target));
console.log('link exists:', fs.existsSync(link));

if (fs.existsSync(link)) {
  const stat = fs.statSync(link);
  if (stat.isDirectory()) {
    fs.rmdirSync(link, {recursive: true});
  } else {
    fs.unlinkSync(link);
  }
  console.log('removed old link/file');
}

fs.symlinkSync(target, link, 'junction');
console.log('junction created!');

// Verify it works
const testPath = path.join(link, 'datasource', 'boss', 'bossauth.html');
console.log('test path exists:', fs.existsSync(testPath));
