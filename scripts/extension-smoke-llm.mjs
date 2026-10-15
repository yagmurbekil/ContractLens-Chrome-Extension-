// Real extension + real backend (LLM mode) + mock OpenAI-compatible LLM + real Page Agent locator,
// on a long document so that chunk selection and the Page Agent section locator are exercised.
// Usage: npm run build && node scripts/extension-smoke-llm.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { copyDir } from './copy-dir.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const LOG = 'dist-e2e-mock-llm.log';
rmSync(LOG, { force: true });
rmSync('dist-e2e', { recursive: true, force: true });
copyDir('dist', 'dist-e2e');
const manifest = JSON.parse(readFileSync('dist-e2e/manifest.json', 'utf8'));
manifest.host_permissions.push('http://127.0.0.1:4173/*');
writeFileSync('dist-e2e/manifest.json', JSON.stringify(manifest, null, 2));

// Long page: GitHub ToS + Zulip ToS rendered pages concatenated (> 48k chars budget).
const a = readFileSync('eval/pages/github-tos.html', 'utf8');
const b = readFileSync('eval/pages/zulip-tos.html', 'utf8');
const body = (h) => /<article>([\s\S]*)<\/article>/.exec(h)[1];
writeFileSync('dist-harness/fixtures/long-terms.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Terms of Service (long test page)</title></head><body><main><article>${body(a)}${body(b)}</article></main><p><button onclick="window.__acceptedTerms=true">Accept all</button></p></body></html>`);

const procs = [];
const start = (cmd, args, env = {}) => procs.push(spawn(cmd, args, { env: { ...process.env, ...env }, stdio: process.env.DEBUG ? 'inherit' : 'ignore', shell: process.platform === 'win32' }));
start('node', ['scripts/mock-llm.mjs'], { MOCK_PORT: '9999', MOCK_LOG: LOG, MOCK_DELAY_MS: process.env.MOCK_DELAY_MS ?? '35000' });
start('node', ['scripts/serve-harness.mjs']);
start('npx', ['tsx', 'src/backend/index.ts'], { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'mock-key-not-secret', OPENAI_BASE_URL: 'http://127.0.0.1:9999/v1', OPENAI_MODEL: 'mock-model', PORT: '8787', HOST: '127.0.0.1', ENABLE_AGENT_PROXY: 'true' });
await sleep(3000);

let failed = 0;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 420, height: 900 }, args: [`--disable-extensions-except=${process.cwd()}/dist-e2e`, `--load-extension=${process.cwd()}/dist-e2e`] });
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  // The Page Agent locator is opt-in since settings v2; enable it for this test.
  const cfgPage = await ctx.newPage();
  await cfgPage.goto(`chrome-extension://${extId}/sidepanel.html`);
  await cfgPage.evaluate(() => chrome.storage.local.set({ settings: { settingsVersion: 2, backendUrl: 'http://localhost:8787', usePageAgentLocator: true, privacyAcknowledged: false } }));
  await cfgPage.close();
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/fixtures/long-terms.html');
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, page.url());
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('[data-testid=doc-type]');
  const notice = await popup.locator('[data-testid=privacy-notice]').innerText();
  check('privacy notice names the LLM provider before sending', /mock-model/.test(notice), notice.slice(0, 120));
  await popup.check('[data-testid=privacy-ack]');
  await popup.click('[data-testid=analyze-btn]');
  const t0 = Date.now();
  await popup.waitForSelector('[data-testid=state-result]', { timeout: 600000 });
  check('analysis that takes longer than 30 s completes (service worker stays alive)', Date.now() - t0 > 30000, `${Math.round((Date.now() - t0) / 1000)} s`);
  await popup.screenshot({ path: 'docs/screenshots/extension-popup-llm-mock-long.png', fullPage: true });
  const status = await popup.getAttribute('[data-testid=state-result]', 'data-status');
  const demo = await popup.locator('[data-testid=demo-badge]').count();
  check('LLM mode (no demo badge)', demo === 0);
  // The mock adds one fabricated quote per chunk, so 'uncertain' (too many unverified findings) is also correct.
  check('report produced (ok or uncertain)', status === 'ok' || status === 'uncertain', status);
  check('verified findings rendered', (await popup.locator('[data-testid=evidence-verified]').count()) > 0);

  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForSelector('[data-testid=full-report]');
  const reportText = await panel.locator('[data-testid=full-report]').innerText();
  check('fabricated quote rejected and listed as unverified', reportText.includes('Doğrulanamayan') && !(await panel.locator('[data-evidence=verified]', { hasText: 'kidneys' }).count()));
  check('review scope disclosed (candidates sent to the LLM)', /aday maddeyi değerlendirdi/.test(reportText));
  await panel.screenshot({ path: 'docs/screenshots/extension-report-llm-mock-long.png', fullPage: true });

  const lines = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const agentCalls = lines.filter((l) => l.agent);
  check('Page Agent locator ran through the backend proxy', agentCalls.length > 0, `${agentCalls.length} agent LLM calls`);
  const forbidden = ['click_element_by_index', 'input_text', 'select_dropdown_option', 'execute_javascript', 'ask_user'];
  check('agent tool list contained no state-changing tools', agentCalls.every((c) => forbidden.every((t) => !c.toolsJson.includes(`"${t}"`))));
  check('server always forced its own model and key', lines.every((l) => l.model === 'mock-model' && l.auth));
  const accepted = await page.evaluate(() => window.__acceptedTerms);
  check('no accept button clicked', accepted === undefined);
} catch (e) {
  check('unexpected error', false, e.message);
} finally {
  await ctx.close();
  for (const p of procs) p.kill();
  writeFileSync('docs/screenshots/extension-smoke-llm-results.json', JSON.stringify({ ranAt: new Date().toISOString(), failed, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
