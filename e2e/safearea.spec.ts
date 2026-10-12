import { expect, test } from '@playwright/test';

/**
 * An app added to the Home Screen draws under the phone's status bar and home bar; the page gets
 * their size from env(safe-area-inset-*), which a desktop browser can't fake. The app reads them
 * through --safe-* variables, so set those as an iPhone would.
 */
test('sheets stay clear of the status bar and home bar (iPhone, from the Home Screen)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?net=local');
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty('--safe-t', '47px');
    s.setProperty('--safe-b', '34px');
  });
  await page.click('button[aria-label="How Lamplight works"]');
  const sheet = page.locator('.sheet').first();
  await sheet.waitFor();
  await page.waitForTimeout(400); // (it pops in)
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(47);
  expect(box.y + box.height).toBeLessThanOrEqual(844 - 34);
  // the title is the first thing under the status bar
  const title = (await sheet.locator('h3').boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(47);
});

test('…and on its side, clear of the notch', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty('--safe-l', '59px');
    s.setProperty('--safe-r', '59px');
    s.setProperty('--safe-b', '21px');
  });
  await page.click('button[aria-label="How Lamplight works"]');
  const sheet = page.locator('.sheet').first();
  await sheet.waitFor();
  await page.waitForTimeout(400);
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(59);
  expect(box.x + box.width).toBeLessThanOrEqual(852 - 59);
  expect(box.y + box.height).toBeLessThanOrEqual(393 - 21);
});
