import { expect, test } from '@playwright/test';

test.setTimeout(150_000);

/**
 * Rummy 500 on a table screen: a TV can't be scrolled, so everyone's melds wrap into rows that
 * all show, and the piles hold still as cards are discarded and melds go down.
 */
test('on a table screen every meld shows and the piles hold still', async ({ context }) => {
  const host = await context.newPage();
  await host.setViewportSize({ width: 852, height: 393 });
  await host.goto('/?net=local');
  await host.fill('input[aria-label="Your name"]', 'Ada');
  await host.click('text=Start a table');
  await host.waitForURL(/#\/room\//);
  const code = host.url().split('/').pop()!;
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(`/?net=local#/display/${code}`);
  await host.locator('[data-game="rummy-500"]').first().click();
  await host.click('text=+ Add bot');
  await host.click('text=+ Add bot');
  await host.click('button:has-text("Deal Rummy 500")');
  await tv.locator('.table.display').waitFor();
  const stock = tv.locator('[data-zone="deck"]');
  await expect(stock).toBeVisible();
  const at = async () => {
    const b = (await stock.boundingBox())!;
    return [Math.round(b.x), Math.round(b.y)];
  };
  let start = await at();
  let melds = 0;
  for (let i = 0; i < 1200 && melds < 2; i++) {
    const phase = await host.evaluate(() => (window as unknown as { __phase: () => string }).__phase());
    if (phase === 'gameOver') break;
    await host.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    // (a hand can end with only one player's melds down: deal the next, and measure from there)
    if (phase === 'handOver') {
      await expect.poll(() => host.evaluate(() => (window as unknown as { __phase: () => string }).__phase())).not.toBe('handOver');
      await tv.waitForTimeout(800);
      start = await at();
      continue;
    }
    // the stock never slides more than a couple of pixels
    const now = await at();
    expect(Math.abs(now[0] - start[0]) + Math.abs(now[1] - start[1]), `move ${i}`).toBeLessThanOrEqual(3);
    melds = await tv.locator('.strip > .zone').count();
  }
  expect(melds).toBeGreaterThanOrEqual(2);
  // every player's melds are on screen, none scrolled out of sight
  const off = await tv.evaluate(
    () =>
      [...document.querySelectorAll('.strip > .zone')].filter((z) => {
        const r = z.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight;
      }).length,
  );
  expect(off).toBe(0);
});
