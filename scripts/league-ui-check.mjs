import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:5174/#league');
    await page.getByRole('button', { name: 'Play as Guest' }).waitFor();
    await page.screenshot({ path: `.league/${name}-entry-refresh.png`, fullPage: true });
    await page.getByRole('button', { name: 'Play as Guest' }).click();
    await page.getByRole('button', { name: 'Create duel invitation' }).waitFor();
    await page.locator('.lg-play-art img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.league/${name}-league-refresh.png`, fullPage: true });
    for (const tab of ['Friends', 'Battle history', 'Trainer profile', 'Overview']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: ${tab} overflow`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: entry, guest login, all League tabs, desktop/mobile overflow, no browser exceptions.');
} finally { await browser.close(); }
