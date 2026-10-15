import { expect, test, type Page } from '@playwright/test';

/**
 * The production build, served with the real site's headers (public/_headers): the
 * Content-Security-Policy must let everything the app does through, and stop what it should.
 */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('the security policy lets a whole game through, and blocks injected scripts', async ({ page }) => {
  const violations = await watchCsp(page);
  const res = await page.goto('/?net=local');
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
  // Cloudflare Pages adds its Web Analytics script to every page: the policy lets it run
  expect(res?.headers()['content-security-policy']).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
  await page.setViewportSize({ width: 852, height: 393 });
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  // the invite QR code (an image made on the phone)
  await expect(page.locator('img.qr')).toBeVisible();
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  // pass three: the bots answer from their worker (rules loaded on demand)
  for (let i = 0; i < 3; i++)
    await page
      .locator('.hand .slot')
      .nth(i)
      .click({ position: { x: 14, y: 50 } }); // (its visible edge: the next card covers the middle)
  await page.click('button:has-text("Pass")');
  await expect.poll(() => page.workers().length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('.hand .slot')).toHaveCount(13, { timeout: 15_000 });
  // saving the game as a spreadsheet (a file made in the page)
  await page.click('button[aria-label="Menu"]');
  await page.click('text=Save this game');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Spreadsheet")')]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  // the card backs and cloths (pictures made on the fly)
  await page.click('button[aria-label="Menu"]');
  await page.click('text=Card backs & cloth');
  await page.locator('.sheet').waitFor();
  expect(await violations()).toEqual([]);

  // the TV screen
  await page.goto('/?net=local#/tv');
  await page.locator('[aria-label="Pairing code"]').waitFor();
  expect(await violations()).toEqual([]);

  // and a script slipped into the page doesn't run
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.head.append(s);
  });
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect((await violations()).some((v) => v.startsWith('script-src'))).toBe(true);
});

test('Hard bridge bots load their double-dummy solver (WebAssembly) under the policy, in their worker only', async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="bridge"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button[aria-label="Settings"]');
  await page.locator('.sheet .opt', { hasText: 'Bots' }).locator('button', { hasText: 'Hard' }).click();
  await page.keyboard.press('Escape');
  await page.click('button:has-text("Deal Contract Bridge")');
  await page.locator('.table').waitFor();
  const ready = async () => {
    for (const w of page.workers()) if (await w.evaluate(() => (globalThis as { __ddsReady?: boolean }).__ddsReady ?? false)) return true;
    return false;
  };
  await expect.poll(ready, { timeout: 20_000 }).toBe(true);
  // (the page itself, where the host runs the rules, never fetches it)
  expect(await page.evaluate(() => (globalThis as { __ddsReady?: boolean }).__ddsReady ?? false)).toBe(false);
  expect(await violations()).toEqual([]);
});
