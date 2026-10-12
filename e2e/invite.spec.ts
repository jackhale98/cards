import { expect, test } from '@playwright/test';

test('an invite link fills in the table code', async ({ page }) => {
  await page.goto('/?net=local&join=ABCDE');
  await expect(page.locator('input[aria-label="Table code"]')).toHaveValue('ABCDE');
  await expect(page.locator('.invited')).toContainText('ABCDE');
  // the code moves out of the query (so it doesn't come back later), other flags stay
  expect(new URL(page.url()).search).toBe('?net=local');
  // a second invite opened while the home screen is up fills in the new code
  await page.evaluate(() => (location.hash = '#/join/QWERT'));
  await expect(page.locator('input[aria-label="Table code"]')).toHaveValue('QWERT');
});

test('the host shares a link with the code in it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?net=local');
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await page.fill('input[aria-label="Your name"]', 'Host');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  const code = page.url().split('/').pop()!;
  await page.click('text=Share invite');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain(`join=${code}`);
});
