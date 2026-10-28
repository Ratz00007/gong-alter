// Diagram screenshot runner — sanctioned for embedded-diagram PNGs (SKILL.md:
// "Or via Playwright directly: page.screenshot(...)"). NOT used for any document-level PDF.
const path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const chromium = pw.chromium || pw;

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.error('usage: node snap.js <input.html> <output.png> [selector]'); process.exit(2); }
  const htmlPath = path.resolve(args[0]);
  const outPath = path.resolve(args[1]);
  const selector = args[2] || '.canvas';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 }, deviceScaleFactor: 2 });
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  try { await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 8000 }); }
  catch (e) { /* diagrams without wiring script still render */ }
  await page.waitForTimeout(200);
  const el = await page.$(selector);
  if (!el) { console.error('selector not found: ' + selector); await browser.close(); process.exit(3); }
  await el.screenshot({ path: outPath });
  await browser.close();
  console.log('saved ' + outPath);
})().catch((e) => { console.error(e); process.exit(1); });
