#!/usr/bin/env node
// Cross-platform dev server launcher (works on Windows PowerShell + bash)
// Equivalent to the bash-only `npm run dev-server` script.

const { spawn } = require('child_process');
const fs = require('fs');

const defines = {
  CONFIG:           'config/ng-extend.json',
  STATE_SERVERS:    'config/state_servers.json',
  CUSTOM_BINDINGS:  'config/custom-keybinds.json',
  DATASETS:         'config/datastack-dataset.json',
  DEFAULT_SETTINGS: 'config/default-settings.json',
};

const args = ['./node_modules/neuroglancer/config/esbuild-cli.js'];

for (const [name, file] of Object.entries(defines)) {
  const content = fs.readFileSync(file, 'utf8').replace(/\s+/g, '');
  args.push(`--define`);
  args.push(`${name}=${content}`);
}

args.push('--config=dev', '--serve', '--watch');

console.log('Starting dev server...');
const proc = spawn(process.execPath, args, { stdio: 'inherit', shell: false });
proc.on('exit', code => process.exit(code ?? 0));
