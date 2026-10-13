import { expect, test } from '@playwright/test';

/** After a hand, step back through it as you saw it, then return to the game. */
test('replay the last hand, then get back to the game', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="holdem"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Texas Hold\'em")');
  await expect(page.locator('.hand .slot')).toHaveCount(2);
  // the quickest hand there is: fold as soon as we can (checking if there's nothing to call)
  const fold = page.getByRole('button', { name: 'Fold', exact: true });
  const check = page.getByRole('button', { name: 'Check', exact: true });
  const replay = page.getByRole('button', { name: /^Replay (this )?hand$/ });
  await expect
    .poll(
      async () => {
        if (await replay.isVisible()) return true;
        if (await fold.isVisible()) await fold.click();
        else if (await check.isVisible()) await check.click();
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await replay.click();
  const bar = page.locator('[role="toolbar"][aria-label="Replay"]');
  await expect(bar).toContainText('Last hand');
  await expect(bar).toContainText(/Move 1 of \d+/);
  // our own two cards, from the deal on
  await expect(page.locator('.hand .slot')).toHaveCount(2);
  await bar.locator('button[aria-label="Forward a move"]').click();
  await expect(bar).toContainText(/Move 2 of/);
  await bar.locator('button[aria-label="Back a move"]').click();
  await expect(bar).toContainText(/Move 1 of/);
  await page.keyboard.press('ArrowRight');
  await expect(bar).toContainText(/Move 2 of/);
  await bar.locator('button', { hasText: /back/i }).click();
  await expect(bar).toHaveCount(0);
});
