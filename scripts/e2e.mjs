// Starts the fixture/harness server, runs Cypress, stops the server.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const server = spawn('node', ['scripts/serve-harness.mjs'], { stdio: 'inherit' });
await sleep(800);
const args = ['cypress', 'run', '--browser', process.env.CYPRESS_BROWSER ?? 'electron', ...process.argv.slice(2)];
// shell:true lets Windows resolve npx.cmd
const cy = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
cy.on('exit', (code) => {
  server.kill();
  process.exit(code ?? 1);
});
