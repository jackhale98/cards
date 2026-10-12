import { expect, test } from '@playwright/test';

for (const size of [
  { name: 'phone', width: 852, height: 393 },
  { name: 'portrait phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 720 },
]) {
  test(`the deal button and settings stay on screen (${size.name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?net=local');
    await page.fill('input[aria-label="Your name"]', 'Tester');
    await page.click('text=Start a table');
    await page.waitForURL(/#\/room\//);
    await page.click('text=+ Add bot');
    const deal = page.locator('.dealbar button.primary');
    const onScreen = async () => {
      const r = (await deal.boundingBox())!;
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeLessThanOrEqual(size.height + 1);
      expect(r.x + r.width).toBeLessThanOrEqual(size.width + 1);
    };
    expect(await page.evaluate(() => document.querySelector('.lobby')!.scrollWidth)).toBeLessThanOrEqual(size.width);
    await onScreen();
    // scrolled to the far end of the game list, it's still there
    await page.evaluate(() => document.querySelector('.lobby')!.scrollTo(0, 1e6));
    await onScreen();
    // settings open from the bar, and dealing works from it
    await page.click('.dealbar button[aria-label="Settings"]');
    await expect(page.locator('.options')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.sheet').waitFor({ state: 'detached' }).catch(() => {});
    if (await page.locator('.options').isVisible()) await page.locator('button[aria-label="Close"]').first().click();
    await deal.click();
    await page.locator('.table').waitFor();
  });
}

for (const size of [
  { name: 'phone', width: 852, height: 393 },
  { name: 'portrait phone', width: 390, height: 844 },
]) {
  test(`jumping to a kind of game lands it clear of the top of the screen (${size.name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?net=local');
    await page.fill('input[aria-label="Your name"]', 'Tester');
    await page.click('text=Start a table');
    await page.waitForURL(/#\/room\//);
    await page.click('.cat:has-text("Rummy")');
    const sec = page.locator('.sec', { hasText: 'Rummy' });
    // lands in the upper middle of the screen (smooth scrolling: wait for it to get there)
    const y = async () => (await sec.boundingBox())!.y;
    await expect.poll(async () => { const v = await y(); return v > size.height * 0.15 && v < size.height * 0.5; }, { timeout: 4000 }).toBe(true);
    const bar = (await page.locator('.dealbar').boundingBox())!.y;
    // and its first games show above the deal bar
    expect((await page.locator('[data-game="canasta"]').boundingBox())!.y).toBeLessThan(bar);
  });
}

test('on a phone on its side, the table code stays in view while scrolling the games', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('.lobby').waitFor();
  await page.evaluate(() => document.querySelector('.lobby')!.scrollTo(0, 1e6));
  await page.waitForTimeout(300);
  const code = (await page.locator('.invite .code').boundingBox())!;
  expect(code.y).toBeGreaterThanOrEqual(0);
  expect(code.y + code.height).toBeLessThanOrEqual(393);
  // the rest of the panel (Share, TV, Leave) is reached by scrolling it, and isn't under the deal bar
  const leave = page.locator('.invite button:has-text("Leave")');
  await leave.scrollIntoViewIfNeeded();
  const bar = (await page.locator('.dealbar').boundingBox())!;
  const l = (await leave.boundingBox())!;
  expect(l.y + l.height).toBeLessThanOrEqual(bar.y);
});
