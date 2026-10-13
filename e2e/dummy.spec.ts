import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

/**
 * Bridge's dummy is a whole hand face up on the table. As the declarer plays from it, the cards
 * left keep their size and stay in one row (they used to grow, spread out and wrap at set
 * counts, so the whole dummy jumped about).
 */
test('the dummy keeps its look as cards are played from it', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 461 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="bridge"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  // Hana watches: four bots play
  await page.click('button[aria-label="Sit Hana out"]');
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Contract Bridge")');
  const dummy = page.locator('[data-zone="dummy"] .scard');
  // (a deal everyone passes is dealt again: wait for a contract and the opening lead)
  await expect(dummy.first()).toBeVisible({ timeout: 60_000 });
  const look = () =>
    dummy.evaluateAll((els) => {
      const r = els.map((el) => el.getBoundingClientRect());
      return { n: r.length, widths: [...new Set(r.map((x) => Math.round(x.width)))], rows: new Set(r.map((x) => Math.round(x.top))).size };
    });
  const seen: { n: number; widths: number[]; rows: number }[] = [];
  await expect
    .poll(
      async () => {
        const l = await look();
        if (l.n && !seen.some((x) => x.n === l.n)) seen.push(l);
        return Math.min(...seen.map((x) => x.n));
      },
      { timeout: 90_000, intervals: [100] },
    )
    .toBeLessThanOrEqual(3);
  // from thirteen cards down to a few: one card size, one row
  expect(new Set(seen.flatMap((x) => x.widths)).size).toBe(1);
  expect(seen.every((x) => x.rows === 1)).toBe(true);
});
