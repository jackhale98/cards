import { expect, test } from '@playwright/test';
import { handCards } from './cards';
import { cardsLanded } from './wait';

/**
 * Development builds: a debug snapshot of the host's table (the menu's "Copy debug snapshot") put
 * back on screen on another device (the home screen's "Load debug snapshot"): the same table, held
 * still, in the seat of whoever hosted it.
 */
test('a debug snapshot puts the same table back on screen, held still', async ({ browser }) => {
  const first = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await first.goto('/?net=local&seed=7');
  await first.fill('input[aria-label="Your name"]', 'Hana');
  await first.click('text=Start a table');
  await first.waitForURL(/#\/room\//);
  await first.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await first.click('text=+ Add bot');
  await first.click('.dealbar button.primary');
  await first.locator('.table').waitFor();
  await cardsLanded(first);
  // (pass three cards: a moment past the deal)
  await first.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
  await expect(first.locator('[aria-live]')).not.toContainText('Your turn');
  const snapshot = await first.evaluate(() => (window as unknown as { __snapshot: () => string }).__snapshot());
  const names = (page: typeof first) => page.locator('.hand .slot').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  const hand = await names(first);
  const headline = await first.locator('.headline').textContent();

  // another device, with its own storage: load it from the home screen
  const second = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  await second.goto('/?net=local');
  await second.click('text=Load debug snapshot');
  await second.fill('textarea[aria-label="Snapshot"]', snapshot);
  await second.click('text=Load it');
  await second.locator('.table').waitFor();
  await cardsLanded(second);
  await expect(handCards(second)).toHaveCount(hand.length);
  expect(await names(second)).toEqual(hand);
  await expect(second.locator('.headline')).toHaveText(headline!);
  // (held still: the bots don't play on, and nobody shows as having dropped out)
  const v = await second.evaluate(() => (window as unknown as { __phase: () => string }).__phase());
  await second.waitForTimeout(2500);
  expect(await second.evaluate(() => (window as unknown as { __phase: () => string }).__phase())).toBe(v);
  await expect(second.locator('.dropped')).toHaveCount(0);
});

test('a snapshot that isn’t one, or comes from a player’s phone, says so', async ({ page }) => {
  await page.goto('/?net=local');
  const load = (text: string) => page.evaluate((t) => (window as unknown as { __loadSnapshot: (t: string) => string | null }).__loadSnapshot(t), text);
  expect(await load('hello')).toBe('That isn’t a snapshot');
  expect(await load(JSON.stringify({ kind: 'lamplight-snapshot', view: {} }))).toContain('player’s phone');
});
