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
