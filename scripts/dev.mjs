import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
// wrangler dev needs the assets directory to exist; Vite serves the frontend in development.
mkdirSync('dist', { recursive: true });
const children = [
  spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', '8787'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  children.forEach(child => child.kill()); process.exitCode = code;
}
children.forEach(child => { child.on('error', () => stop(1)); child.on('exit', code => stop(code || 0)); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
