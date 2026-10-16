import { expect, test } from '@playwright/test';

test.setTimeout(180_000);

/**
 * Cribbage's count grows card by card in the middle, beside the deck, the starter and the crib.
 * It used to push them sideways with every card, wrap onto a second row (everything shrinking)
 * and spring back at each new count. Its room is kept now: the piles beside it stay put.
 */
test('the pegging count grows without moving the piles beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 461 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="cribbage"]').first().click();
  await page.click('text=+ Add bot');
  // Hana watches: two bots play
  await page.click('button[aria-label="Sit Hana out"]');
  await page.click('text=+ Add bot');
  await page.locator('button:has-text("Deal")').first().click();
  // where the deck, starter and crib sit (read only when nothing is moving), through the pegging
  const read = () =>
    page.evaluate(() => {
      const still = document.getAnimations().every((a) => a.playState !== 'running' || a instanceof CSSAnimation);
      const at = (id: string) => {
        const z = document.querySelector(`[data-zone="${id}"]`);
        if (!z) return '-';
        const r = z.getBoundingClientRect();
        // (the pile's own room, its card's size: the card layer draws its cards in it)
        const c = z.querySelector('.frame') as HTMLElement | null;
        return `${Math.round(r.left)},${Math.round(r.top)},${c?.offsetWidth ?? 0}`;
      };
      return {
        phase: (window as unknown as { __phase: () => string | null }).__phase(),
        count: document.querySelectorAll('.layer .layer-card[data-in="pegging"]:not([data-leaving])').length,
        look: still ? ['deck', 'starter', 'crib'].map(at).join(' ') : null,
      };
    });
  const looks = new Set<string>();
  const counts = new Set<number>();
  await expect
    .poll(
      async () => {
        const r = await read();
        if (r.phase === 'peg' && r.look) {
          looks.add(r.look);
          counts.add(r.count);
        }
        return r.phase;
      },
      { timeout: 150_000, intervals: [60] },
    )
    .toBe('show');
  // the count went up and back down (a new count) while the piles beside it stayed where they were
  expect(Math.max(...counts)).toBeGreaterThanOrEqual(3);
  expect([...looks]).toHaveLength(1);
});
