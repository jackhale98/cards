import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * An accessibility scan (axe) of the main screens: labels, roles, names, contrast and the like.
 * Serious and critical problems fail the test.
 */
async function scan(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map(
    (v) =>
      `${where}: ${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 4)
        .map((n) => `   ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`)
        .join('\n')}`,
  );
  expect(report, report.join('\n')).toEqual([]);
}

test('home, lobby and a table pass an accessibility scan', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await expect(page.getByText('Start a table')).toBeVisible();
  await scan(page, 'home');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await scan(page, 'lobby');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  await page.waitForTimeout(800);
  await scan(page, 'table');
  await page.click('button[aria-label="Menu"]');
  await scan(page, 'menu');
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="Scores and log"]');
  await scan(page, 'scores');
});

test('keyboard: pop-ups take focus, keep it, close on Escape and give it back', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
  // cards are named in words, and the table says whose turn it is
  await expect(page.locator('.hand .card').first()).toHaveAttribute('aria-label', /^(\d+|jack|queen|king|ace) of (spades|hearts|diamonds|clubs)$/);
  await expect(page.locator('.sr-only[aria-live]')).toContainText('Your turn');
  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  // Tab around many times: focus never leaves the sheet
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(menu).toBeFocused();
});
