// Builds: extension pages (Vite) + content/background (esbuild) + harness.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { copyDir } from './copy-dir.mjs';

const target = process.argv[2] ?? 'all';

async function buildExtension() {
  await vite({ mode: 'production', logLevel: 'warn' });
  const common = { bundle: true, minify: true, target: 'chrome116', legalComments: 'none', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } };
  await esbuild({ ...common, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' });
  await esbuild({ ...common, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' });
  const size = (f) => (statSync(f).size / 1024).toFixed(1) + ' KB';
  console.log('extension → dist/  content.js', size('dist/content.js'), ' background.js', size('dist/background.js'));
}

async function buildHarness() {
  await vite({ mode: 'harness', logLevel: 'warn' });
  await esbuild({ bundle: true, minify: true, target: 'chrome116', entryPoints: ['src/harness/frameAgent.ts'], outfile: 'dist-harness/harness-agent.js', format: 'iife', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
  mkdirSync('dist-harness/fixtures', { recursive: true });
  copyDir('fixtures/sites', 'dist-harness/fixtures');
  if (existsSync('eval/pages')) copyDir('eval/pages', 'dist-harness/fixtures/eval');
  console.log('harness → dist-harness/  fixtures:', readdirSync('dist-harness/fixtures').length);
}

if (target === 'all' || target === 'extension') await buildExtension();
if (target === 'all' || target === 'harness') await buildHarness();
