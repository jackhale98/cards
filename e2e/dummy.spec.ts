import { expect, test } from '@playwright/test';
import { cardsLanded } from './wait';

test.setTimeout(120_000);

/**
 * Bridge's dummy is a whole hand face up on the table. As the declarer plays from it, the cards
 * left stay in one row, never shrinking (gaps used to open and close as it wrapped at set counts,
 * so the whole dummy jumped about), and grow into the room the others took as far as the middle
 * has height to spare (a short screen has none: the table's sizes use it all).
 */
for (const [where, size, grows] of [
  ['a phone', { width: 1000, height: 461 }, false],
  ['a tablet', { width: 1100, height: 720 }, true],
] as const)
  test(`the dummy keeps its look as cards are played from it, on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
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
    // (read only once the cards have settled: mid-way through growing, a card is between two sizes,
    // and a busy machine can catch the table half-way through fitting itself. So a reading counts
    // only when no card is animating and the same look holds a moment later.)
    const look = () =>
      dummy.evaluateAll(async (els) => {
        const read = () => {
          if (els.some((el) => !el.isConnected || el.getAnimations({ subtree: true }).some((a) => a.playState === 'running'))) return null;
          // (a card on its way out of the dummy can be caught with no size: it isn't part of the dummy's look)
          const cards = (els as HTMLElement[]).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
          // the dummy's own card size (offsetWidth): the whole middle may be scaled down a moment to fit
          // the room (when the tip wraps onto a second line, say), which shrinks every pile alike
          return {
            n: cards.length,
            widths: [...new Set(cards.map((el) => el.offsetWidth))],
            rows: new Set(cards.map((el) => Math.round(el.getBoundingClientRect().top))).size,
          };
        };
        const first = read();
        await new Promise((done) => setTimeout(done, 200));
        const again = read();
        return first && again && JSON.stringify(first) === JSON.stringify(again) ? first : { n: 0, widths: [], rows: 0 };
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
    // from thirteen cards down to a few: one row, one card size at a time, and never smaller
    expect(seen.every((x) => x.rows === 1)).toBe(true);
    expect(seen.every((x) => x.widths.length === 1)).toBe(true);
    const sizes = [...seen].sort((a, b) => b.n - a.n).map((x) => x.widths[0]);
    // (a pixel or two either way as the rest of the table settles is not the dummy jumping)
    expect(sizes.every((w, i) => i === 0 || w >= sizes[i - 1] - 2)).toBe(true);
    if (grows) expect(sizes.at(-1)!).toBeGreaterThan(sizes[0]);
  });

/**
 * On a table screen there's no room to spare in the middle, so the dummy holds one size and one
 * place all hand. (Once it was narrow enough to move up beside the trick, the height that freed let
 * its cards grow, which pushed it back onto its own row, and they shrank again: with every card of
 * the last few tricks.)
 */
test('on a table screen the dummy holds its size and place through every trick', async ({ context }) => {
  const host = await context.newPage();
  await host.setViewportSize({ width: 852, height: 393 });
  await host.goto('/?net=local');
  await host.fill('input[aria-label="Your name"]', 'Hana');
  await host.click('text=Start a table');
  await host.waitForURL(/#\/room\//);
  const code = host.url().split('/').pop()!;
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(`/?net=local#/display/${code}`);
  await host.locator('[data-game="bridge"]').first().click();
  for (let i = 0; i < 3; i++) await host.click('text=+ Add bot');
  // Hana watches: four bots play
  await host.click('button[aria-label="Sit Hana out"]');
  await host.click('text=+ Add bot');
  await host.click('button:has-text("Deal Contract Bridge")');
  const dummy = tv.locator('[data-zone="dummy"]');
  await expect(dummy.locator('.scard').first()).toBeVisible({ timeout: 60_000 });
  // (once it has come down: its cards fly in from the seat and the trick eases smaller to make room)
  await cardsLanded(tv);
  await tv.waitForFunction(() =>
    document.getAnimations().every((a) => !(a instanceof CSSTransition) || !['--cw', 'transform'].includes(a.transitionProperty) || a.playState !== 'running'),
  );
  const seen: { widths: number[]; left: number; width: number; scaled: boolean }[] = [];
  let fewest = 13;
  // (sampled often, through the end of each trick, down to the last two cards)
  await expect
    .poll(
      async () => {
        const at = await dummy.evaluate((el) => {
          const cards = [...el.querySelectorAll<HTMLElement>('.scard')].filter((c) => c.offsetWidth > 0);
          const box = el.getBoundingClientRect();
          // (whether the middle had to be shrunk to fit, rather than sized to fit from the start)
          const scaled = !!(el.closest('.zones') as HTMLElement | null)?.style.transform;
          return { n: cards.length, widths: [...new Set(cards.map((c) => c.offsetWidth))], left: box.left, width: box.width, scaled };
        });
        if (at.n) {
          fewest = Math.min(fewest, at.n);
          seen.push(at);
        }
        return fewest;
      },
      { timeout: 120_000, intervals: [50] },
    )
    .toBeLessThanOrEqual(2);
  // sized to fit from the start: never shrunk to fit after
  expect(seen.filter((x) => x.scaled)).toEqual([]);
  // one card size, one width and one place throughout (a pixel or two of rounding aside)
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  expect(seen.every((x) => x.widths.length === 1)).toBe(true);
  expect(spread(seen.map((x) => x.widths[0]))).toBeLessThanOrEqual(2);
  // (on failure: each width it took, in turn)
  const widths = seen.map((x) => Math.round(x.width)).filter((w, i, xs) => i === 0 || w !== xs[i - 1]);
  expect(spread(seen.map((x) => x.width)), `widths: ${widths.join(' → ')}`).toBeLessThanOrEqual(2);
  expect(spread(seen.map((x) => x.left))).toBeLessThanOrEqual(2);
});
