import { expect, test } from '@playwright/test';

test.setTimeout(180_000);

/**
 * At a hand's end the table used to jump: bridge's dummy played its last card into the last trick
 * and gave up its room, so that one trick moved up and grew (and a player's own hand, empty after
 * their last card, gave the middle its room too). The last trick now looks like the ones before.
 */
test('the last trick of a hand is the size the others were', async ({ page }) => {
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
  // (a deal everyone passes is dealt again: wait for a contract and the opening lead)
  await expect(page.locator('[data-zone="dummy"] .scard').first()).toBeVisible({ timeout: 60_000 });
  // the trick's card width, read only when nothing is moving; and whether the dummy still has cards
  const read = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.layer .layer-card[data-in="trick"]:not([data-leaving]) .card')] as HTMLElement[];
      // (cards flying and sizes changing are script animations and transitions; a pulsing seat is a CSS animation)
      const still = cards.length > 0 && document.getAnimations().every((a) => a.playState !== 'running' || a instanceof CSSAnimation);
      return {
        phase: (window as unknown as { __phase: () => string | null }).__phase(),
        dummy: document.querySelectorAll('[data-zone="dummy"] .scard').length,
        width: still ? Math.max(...cards.map((c) => c.offsetWidth)) : 0,
        top: still ? Math.round(document.querySelector('[data-zone="trick"]')!.getBoundingClientRect().top) : 0,
      };
    });
  const before = new Set<string>();
  const last = new Set<string>();
  await expect
    .poll(
      async () => {
        const r = await read();
        if (r.width) (r.dummy ? before : last).add(`${r.width}@${r.top}`);
        return r.phase;
      },
      { timeout: 150_000, intervals: [60] },
    )
    .toMatch(/roundOver|handOver|gameOver/);
  expect(before.size).toBeGreaterThan(0);
  // the last trick, once the dummy was empty: where and how big the tricks before it were
  for (const look of last) expect([...before]).toContain(look);
});
