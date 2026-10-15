// Loads the REAL unpacked extension (dist/) into Chromium via Playwright and
// drives popup.html / sidepanel.html against local fixture pages.
//
// Only difference from the shipped build: dist-e2e/manifest.json adds the host
// permission http://127.0.0.1:4173/* because automation cannot click the
// toolbar icon to grant `activeTab`. Code is byte-identical.
//
// Prereqs: `npm run build` ; backend + fixture server are started here.
// Usage: node scripts/extension-smoke.mjs [--llm-mock]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { copyDir } from './copy-dir.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });
rmSync('dist-e2e', { recursive: true, force: true });
copyDir('dist', 'dist-e2e');
const manifest = JSON.parse(readFileSync('dist-e2e/manifest.json', 'utf8'));
manifest.host_permissions.push('http://127.0.0.1:4173/*');
writeFileSync('dist-e2e/manifest.json', JSON.stringify(manifest, null, 2));

const procs = [];
function start(cmd, args, env = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  p.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(`[${args[0]}] ${d}`));
  p.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(`[${args[0]}] ${d}`));
  procs.push(p);
  return p;
}
start('node', ['scripts/serve-harness.mjs']);
start('npx', ['tsx', 'src/backend/index.ts'], { LLM_PROVIDER: 'none', PORT: '8787', HOST: '127.0.0.1' });
await sleep(2500);

const results = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 420, height: 900 },
  args: [`--disable-extensions-except=${process.cwd()}/dist-e2e`, `--load-extension=${process.cwd()}/dist-e2e`],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  check('service worker registered', Boolean(extId), extId);

  for (const [fixture, expect] of [
    ['subscription.html', { status: 'ok', minFindings: 3, injection: false }],
    ['turkce-sozlesme.html', { status: 'ok', minFindings: 3, injection: false }],
    ['injection.html', { status: 'ok', minFindings: 1, injection: true }],
    ['benign.html', { status: 'ok', minFindings: 0, maxFindings: 0, injection: false }],
    ['ambiguous.html', { status: 'insufficient_data', injection: false }],
  ]) {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:4173/fixtures/${fixture}`);
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, page.url());
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await popup.waitForSelector('[data-testid=doc-type]', { timeout: 15000 });
    const docType = await popup.getAttribute('[data-testid=doc-type]', 'data-type');
    await popup.check('[data-testid=privacy-ack]');
    await popup.click('[data-testid=analyze-btn]');
    await popup.waitForSelector('[data-testid=state-result]', { timeout: 30000 });
    const status = await popup.getAttribute('[data-testid=state-result]', 'data-status');
    const nFindings = await popup.locator('[data-testid=finding]').count();
    const demoBadge = await popup.locator('[data-testid=demo-badge]').count();
    const disclaimer = await popup.locator('[data-testid=disclaimer]').innerText();
    const injWarn = await popup.locator('[data-testid=injection-warning]').count();
    await popup.screenshot({ path: `${SHOTS}/extension-popup-${fixture.replace('.html', '')}.png`, fullPage: true });

    check(`${fixture}: document type detected`, Boolean(docType), docType);
    check(`${fixture}: status ${expect.status}`, status === expect.status, status);
    if (expect.minFindings !== undefined) check(`${fixture}: ≥${expect.minFindings} verified findings in popup`, nFindings >= Math.min(3, expect.minFindings), String(nFindings));
    if (expect.maxFindings !== undefined) check(`${fixture}: no findings`, nFindings <= expect.maxFindings, String(nFindings));
    check(`${fixture}: demo mode clearly labelled`, demoBadge === 1);
    check(`${fixture}: disclaimer visible`, disclaimer.includes('hukuki tavsiye vermez'));
    check(`${fixture}: injection warning ${expect.injection ? 'shown' : 'absent'}`, (injWarn > 0) === expect.injection);

    // Side panel page renders the stored report.
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
    await panel.waitForSelector('[data-testid=full-report]', { timeout: 10000 });
    await panel.screenshot({ path: `${SHOTS}/extension-report-${fixture.replace('.html', '')}.png`, fullPage: true });
    check(`${fixture}: full report renders`, true);
    if (nFindings > 0) {
      const quote = await panel.locator('[data-testid=original-quote]').first().innerText();
      await panel.locator('text=Sayfada kaynağı göster').first().click();
      await sleep(300);
      const selected = await page.evaluate(() => String(window.getSelection()));
      const probe = quote.replace(/[“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      check(`${fixture}: "show source" selects the quote in the page`, selected.replace(/\s+/g, ' ').includes(probe), selected.slice(0, 60));
    }

    const sideEffects = await page.evaluate(() => ({ accepted: window.__acceptedTerms, cookie: window.__cookieAccepted, title: document.title }));
    check(`${fixture}: no consent/accept button clicked`, sideEffects.accepted === undefined && sideEffects.cookie === undefined && sideEffects.title !== 'ACCEPTED');
    await Promise.all([page.close(), popup.close(), panel.close()]);
  }

  // Unsupported page state
  const blank = await ctx.newPage();
  await blank.goto(`chrome-extension://${extId}/sidepanel.html`);
  // Without the `tabs` permission URLs are hidden; the most recently opened tab is the extension page.
  const internalTab = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));
  const popup2 = await ctx.newPage();
  await popup2.goto(`chrome-extension://${extId}/popup.html?tabId=${internalTab}`);
  await popup2.waitForSelector('[data-testid=state-unsupported]', { timeout: 10000 });
  check('unsupported page state shown for extension pages', true);
} catch (e) {
  check('unexpected error', false, e.message);
} finally {
  await ctx.close();
  for (const p of procs) p.kill();
  writeFileSync(`${SHOTS}/extension-smoke-results.json`, JSON.stringify({ ranAt: new Date().toISOString(), failed, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
