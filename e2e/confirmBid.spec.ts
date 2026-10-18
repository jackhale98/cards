import { expect, test, type Page } from '@playwright/test';

/**
 * A bid is asked about before it goes (ActionSpec.confirm): a stray tap on the wrong bid, or on
 * Pass, can't be taken back once the next player has called. The question floats over the
 * middle; Change goes back to the bids, Confirm sends it.
 */
async function toYourCall(page: Page) {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="five-hundred"]').first().click();
  for (let i = 1; i < 4; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  // (the bots call, a move at a time, until it's your turn in the auction)
  await page.evaluate(() => {
    const w = window as unknown as { __advance: (n: number) => number; __snapshot: () => string };
    const yours = () => {
      const s = JSON.parse(w.__snapshot()).snap.state;
      return s.phase === 'auction' && s.turn === 0;
    };
    for (let i = 0; i < 8 && !yours(); i++) w.__advance(1);
  });
}
const said = (page: Page) =>
  page.evaluate(
    () => JSON.parse((window as unknown as { __snapshot: () => string }).__snapshot()).snap.state.log.filter((l: { seat?: number }) => l.seat === 0).length,
  );

test('a bid is asked about before it goes, and Change takes you back to the bids', async ({ page }) => {
  await toYourCall(page);
  const before = await said(page);
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  const bids = page.getByRole('dialog', { name: /bid/i });
  await bids.locator('.choice:not(:disabled)').first().click();
  const ask = page.getByRole('dialog', { name: 'Confirm your call' });
  await expect(ask).toBeVisible();
  // (it floats over the middle of the screen)
  const box = (await ask.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 426)).toBeLessThan(20);
  expect(await said(page)).toBe(before);
  await ask.getByRole('button', { name: 'Change' }).click();
  await expect(ask).toBeHidden();
  await expect(bids).toBeVisible();
  await bids.locator('.choice:not(:disabled)').first().click();
  await ask.getByRole('button', { name: 'Confirm' }).click();
  await expect(ask).toBeHidden();
  await expect.poll(() => said(page)).toBe(before + 1);
});

test('passing is asked about too', async ({ page }) => {
  await toYourCall(page);
  const before = await said(page);
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Confirm your call' });
  await expect(ask).toContainText('Pass');
  // (the keyboard is in the question once it's up: Confirm, ready for Enter, and Escape to go back)
  await expect(ask.getByRole('button', { name: 'Confirm' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  expect(await said(page)).toBe(before);
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await ask.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => said(page)).toBe(before + 1);
});
