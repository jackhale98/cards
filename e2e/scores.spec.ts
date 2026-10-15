import { expect, test } from '@playwright/test';

test('after a hand, the scores show a chart and a hand-by-hand table, and chips games a recap', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  for (let i = 0; i < 2; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Texas Hold")');
  await page.locator('.table').waitFor();
  // play the hand out (this seat's moves as a bot would make them)
  for (let i = 0; i < 400 && (await page.evaluate(() => (window as unknown as { __phase: () => string }).__phase())) !== 'handOver'; i++) {
    await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(100);
  }
  await expect(page.locator('.recap')).toContainText('This hand:');
  await page.click('button[aria-label="Scores and log"]');
  await expect(page.locator('.score-chart svg')).toBeVisible();
  await expect(page.locator('.score-chart table tbody tr')).toHaveCount(2);
});

test('your record: games you finished, on this device, from the home screen', async ({ page }) => {
  await page.goto('/?net=local');
  await page.evaluate(() =>
    localStorage.setItem(
      'cards.record',
      JSON.stringify([
        { at: 1, game: 'hearts', name: 'Hearts', place: 0, players: 4, others: ['Ann', 'Ben'], beat: ['Ann', 'Ben'], lostTo: [] },
        { at: 2, game: 'spades', name: 'Spades', place: 1, players: 4, others: ['Ann'], beat: [], lostTo: ['Ann'] },
      ]),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Your record' }).click();
  const sheet = page.getByRole('dialog', { name: 'Your record' });
  await expect(sheet).toContainText('50%');
  await expect(sheet.locator('tr', { hasText: 'Ann' })).toContainText('2');
  await sheet.getByRole('button', { name: 'Clear my record' }).click();
  await sheet.getByRole('button', { name: 'Clear it' }).click();
  await expect(sheet).toContainText('Finish a game');
});
