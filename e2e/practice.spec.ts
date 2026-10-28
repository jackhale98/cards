import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

/**
 * Practising bridge bidding (`?net=local&seed=7&still`, the bots stepped with `__advance`): the deal
 * is dealt for the topic, partner opens, and your first call gets a note under the middle, which
 * you can take back and try again while the auction lasts.
 */
const URL = '/?net=local&seed=7&still';
type Hooks = { __advance: (n: number) => number };

async function practiceTable(page: Page, topic: string) {
  await page.goto(URL);
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="bridge"]').first().click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: topic, exact: true }).click();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  // partner opens, the next player passes: your call
  await page.evaluate(() => (window as unknown as Hooks).__advance(2));
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeVisible();
}

/** Two boxes overlap. */
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// (bridge on a phone held upright asks to be turned on its side: a phone on its side, and a tablet)
for (const [w, h] of [
  [852, 393],
  [1024, 768],
]) {
  test(`your first call is graded in a note you can try again from, at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await practiceTable(page, 'Answering 1♥ or 1♠');
    const coach = page.locator('.coach');
    await expect(coach).toBeHidden();
    // 7NT straight over partner's one of a major: no rule gives it
    await page.getByRole('button', { name: 'Bid', exact: true }).click();
    await page.getByRole('button', { name: /^7\s+NT$/ }).click();
    await page.getByRole('dialog', { name: 'Confirm your call' }).getByRole('button', { name: 'Confirm' }).click();
    await expect(coach).toBeVisible();
    await expect(coach).toContainText(/7\s+NT/);
    await expect(coach).toContainText('The book');
    // on screen, and clear of your hand and the buttons
    const box = (await coach.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(h);
    for (const other of ['.fan', 'aside']) {
      const b = await page.locator(other).first().boundingBox();
      if (b) expect(overlap(box, b), `the note over ${other}`).toBe(false);
    }
    // try again: the call taken back, your turn once more
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(coach).toBeHidden();
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirm your call' }).getByRole('button', { name: 'Confirm' }).click();
    await expect(coach).toBeVisible();
  });
}

test('a new practice deal from the action bar’s menu, any time', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await practiceTable(page, 'Answering 1NT or 2NT');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'New practice deal' }).click();
  // (a fresh deal: partner deals and opens first, so it isn't your call)
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeHidden();
  await page.evaluate(() => (window as unknown as Hooks).__advance(2));
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeVisible();
});
