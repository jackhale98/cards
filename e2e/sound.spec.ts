import { expect, test } from '@playwright/test';

/** The table plays a chime on your turn, card and chip sounds for moves, and can be muted. */
test('sounds follow the game, and the menu mutes them', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __sounds: string[] }).__sounds = [];
  });
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table'); // (this tap also unlocks audio)
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="holdem"]').first().click();
  for (let i = 0; i < 2; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Texas")');
  await page.locator('.table').waitFor();
  const heard = () => page.evaluate(() => (window as unknown as { __sounds: string[] }).__sounds);
  // a chime when it's our turn; chips when we (and the bots) bet
  await expect.poll(heard, { timeout: 15_000 }).toContain('turn');
  await page
    .locator('aside button', { hasText: /Call|Check/ })
    .first()
    .click();
  await expect.poll(heard, { timeout: 15_000 }).toContain('chips');
  // mute from the menu: nothing more plays
  await page.click('button[aria-label="Menu"]');
  await page.click('button:has-text("Sound: on")');
  await page.keyboard.press('Escape');
  await page.evaluate(() => ((window as unknown as { __sounds: string[] }).__sounds = []));
  // bots play on (each move would click or chip) until it comes round to us again (a chime)
  await page.evaluate(() => {
    // (each move shows afresh in the "last move" line)
    const w = window as unknown as { __moves: number };
    w.__moves = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && n.matches('.last')) w.__moves++;
    }).observe(document.querySelector('.table main')!, { childList: true });
  });
  const moves = () => page.evaluate(() => (window as unknown as { __moves: number }).__moves);
  const ourTurn = page.locator('.headline.mine');
  await expect.poll(async () => (await moves()) >= 2 || (await ourTurn.count()) > 0, { timeout: 15_000 }).toBe(true);
  expect(await heard()).toEqual([]);
});
