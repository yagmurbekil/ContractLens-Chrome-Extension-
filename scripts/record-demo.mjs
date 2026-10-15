// FALLBACK demo recorder (Playwright). The primary recording path is Cypress:
//   npm run e2e -- --spec cypress/e2e/demo-video.cy.ts   → cypress/videos/demo-video.cy.ts.mp4
// This script reproduces the exact same steps as cypress/e2e/demo-video.cy.ts with Playwright and
// exists because the build sandbox could not download the Cypress binary. It is labelled as such.
// Usage: npm run build:harness && node scripts/record-demo.mjs
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT = 'docs/demo';
mkdirSync(OUT, { recursive: true });
const server = spawn('node', ['scripts/serve-harness.mjs'], { stdio: 'ignore' });
await sleep(800);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/tmp`, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
const base = 'http://127.0.0.1:4173/harness.html';
const started = Date.now();
const pause = (ms = 1200) => page.waitForTimeout(Math.round(ms * 1.7)); // slower than the Cypress spec for readability
const open = async (fixture) => {
  await page.goto(`${base}?fixture=${fixture}&mode=demo`);
  await page.waitForSelector('[data-testid=page-meta]');
};
try {
  // 1. Open a legal document; type is detected
  await open('subscription.html');
  await page.waitForSelector('[data-testid=doc-type][data-type=subscription_terms]');
  await pause(1800);
  // 2. Analyze → verified risky clause
  await page.check('[data-testid=privacy-ack]');
  await pause(600);
  await page.click('[data-testid=analyze-btn]');
  await page.waitForSelector('[data-testid=state-result]');
  await pause(2200);
  // 3. Quote + Turkish explanation, source shown in page
  await page.click('[data-testid=full-report-btn]');
  const card = page.locator('[data-testid=full-report] [data-category=auto_renewal]');
  await card.waitFor();
  await pause(2500);
  await card.getByText('Sayfada kaynağı göster').click();
  await pause(2500);
  // 4. Incomplete page → honest uncertainty
  await open('ambiguous.html');
  await pause(800);
  await page.check('[data-testid=privacy-ack]');
  await page.click('[data-testid=analyze-btn]');
  await page.locator('[data-testid=score-block]', { hasText: 'Yetersiz veri' }).waitFor();
  await pause(3000);
  // 5. Prompt injection page
  await open('injection.html');
  await page.waitForSelector('[data-testid=injection-warning-pre]');
  await pause(1800);
  await page.check('[data-testid=privacy-ack]');
  await page.click('[data-testid=analyze-btn]');
  await page.waitForSelector('[data-testid=injection-warning]');
  const accepted = await page.frameLocator('#cl-frame').locator('body').evaluate(() => window.__acceptedTerms);
  if (accepted !== undefined) throw new Error('Accept button was clicked!');
  await pause(3000);
  await page.click('[data-testid=full-report-btn]');
  await page.waitForSelector('[data-testid=full-report] [data-testid=injection-warning]');
  await pause(3500);
} finally {
  await ctx.close();
  await browser.close();
  server.kill();
}
const webm = readdirSync(`${OUT}/tmp`).find((f) => f.endsWith('.webm'));
renameSync(`${OUT}/tmp/${webm}`, `${OUT}/contractlens-demo-playwright.webm`);
rmSync(`${OUT}/tmp`, { recursive: true, force: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/contractlens-demo-playwright.webm`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', `${OUT}/contractlens-demo-playwright.mp4`]);
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/contractlens-demo-playwright.mp4`]).toString().trim();
console.log(`recorded ${OUT}/contractlens-demo-playwright.mp4 — ${Number(dur).toFixed(1)} s (script ran ${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (Number(dur) > 90) process.exit(1);
