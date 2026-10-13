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
  for (let i = 0; i < 3; i++) await page.locator('.hand .slot').nth(i).click();
  await page.click('button:has-text("Pass")');
  await expect.poll(() => page.workers().length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('.hand .slot')).toHaveCount(13, { timeout: 15_000 });
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
