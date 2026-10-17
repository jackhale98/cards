import { expect, test, type Page } from '@playwright/test';
import { cardsLanded } from './wait';

test.setTimeout(120_000);

/**
 * Bridge's dummy, through a whole hand dealt from a fixed seed and played a step at a time (`?seed`,
 * `&still`, `__advance`: development builds), looked at once each time it changes.
 */
async function bridge(page: Page) {
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  const code = page.url().split('/').pop()!;
  await page.locator('[data-game="bridge"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  // Hana watches: four bots play
  await page.click('button[aria-label="Sit Hana out"]');
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Contract Bridge")');
  await page.locator('.table').waitFor();
  return code;
}
/** How many cards the dummy has (none until the opening lead), and whether the hand's over. */
const dummyNow = (host: Page) =>
  host.evaluate(() => {
    const s = JSON.parse((window as unknown as { __snapshot: () => string }).__snapshot()).snap.state;
    return { n: (s.zones.dummy?.cards.length ?? 0) as number, over: /handOver|roundOver|gameOver/.test(s.phase) };
  });
/** Step on until the dummy's card count changes (or the hand ends). */
async function nextDummy(host: Page) {
  const was = (await dummyNow(host)).n;
  for (let i = 0; i < 200; i++) {
    if (!(await host.evaluate(() => (window as unknown as { __advance: (n: number) => number }).__advance(1)))) return;
    const now = await dummyNow(host);
    if (now.over || (now.n !== was && now.n > 0)) return;
  }
}

/**
 * As the declarer plays from it, the cards left stay in one row, never shrinking (gaps used to
 * open and close as it wrapped at set counts, so the whole dummy jumped about), and grow into the
 * room the others took as far as the middle has height to spare (a short screen has none: the
 * table's sizes use it all).
 */
for (const [where, size, grows] of [
  ['a phone', { width: 1000, height: 461 }, false],
  ['a tablet', { width: 1100, height: 720 }, true],
] as const)
  test(`the dummy keeps its look as cards are played from it, on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
    await bridge(page);
    const dummy = page.locator('[data-zone="dummy"] .scard');
    const look = () =>
      dummy.evaluateAll((els) => {
        // (a card on its way out of the dummy can be caught with no size: it isn't part of the dummy's look)
        const cards = (els as HTMLElement[]).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
        // the dummy's own card size (offsetWidth): the whole middle may be scaled down a moment to fit
        // the room (when the tip wraps onto a second line, say), which shrinks every pile alike
        return {
          n: cards.length,
          widths: [...new Set(cards.map((el) => el.offsetWidth))],
          rows: new Set(cards.map((el) => Math.round(el.getBoundingClientRect().top))).size,
        };
      });
    const seen: { n: number; widths: number[]; rows: number }[] = [];
    for (let i = 0; i < 20; i++) {
      await nextDummy(page);
      const { n, over } = await dummyNow(page);
      if (over || (n && n <= 2)) break;
      if (!n) continue;
      await cardsLanded(page);
      seen.push(await look());
    }
    expect(Math.min(...seen.map((x) => x.n))).toBeLessThanOrEqual(3);
    // from thirteen cards down to a few: one row, one card size at a time, and never smaller
    expect(seen.every((x) => x.rows === 1)).toBe(true);
    expect(seen.every((x) => x.widths.length === 1)).toBe(true);
    const sizes = seen.map((x) => x.widths[0]);
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
  const code = await bridge(host);
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(`/?net=local#/display/${code}`);
  await tv.locator('.table.display').waitFor();
  const dummy = tv.locator('[data-zone="dummy"]');
  const seen: { n: number; widths: number[]; left: number; width: number; scaled: boolean }[] = [];
  // (each card of every trick, down to the dummy's last two)
  for (let i = 0; i < 200; i++) {
    const before = await dummyNow(host);
    if (before.over || (before.n && before.n <= 2)) break;
    if (!(await host.evaluate(() => (window as unknown as { __advance: (n: number) => number }).__advance(1)))) break;
    if (!(await dummyNow(host)).n) continue;
    await cardsLanded(tv);
    seen.push(
      await dummy.evaluate((el) => {
        const cards = [...el.querySelectorAll<HTMLElement>('.scard')].filter((c) => c.offsetWidth > 0);
        const box = el.getBoundingClientRect();
        // (whether the middle had to be shrunk to fit, rather than sized to fit from the start)
        const scaled = !!(el.closest('.zones') as HTMLElement | null)?.style.transform;
        return { n: cards.length, widths: [...new Set(cards.map((c) => c.offsetWidth))], left: box.left, width: box.width, scaled };
      }),
    );
  }
  expect(Math.min(...seen.map((x) => x.n))).toBeLessThanOrEqual(3);
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
