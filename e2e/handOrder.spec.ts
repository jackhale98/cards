import { expect, test, type Page } from '@playwright/test';
import { cardsLanded } from './wait';

async function hearts(page: Page) {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.hand .slot')).toHaveCount(13);
}
const order = (page: Page) => page.locator('.hand .slot .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

test('drag a card sideways to move it in your hand; sort your hand by rank from the menu', async ({ page }) => {
  await hearts(page);
  await cardsLanded(page);
  // and the hand has settled where it will stay (the line above it fills in after the deal)
  const box = () =>
    page
      .locator('.hand .slot')
      .first()
      .evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
  await expect.poll(async () => (await box()) === (await new Promise((r) => setTimeout(r, 300)).then(box)), { timeout: 10_000 }).toBe(true);
  const before = await order(page);
  // drag the first card along the hand, from a point that's really on it (the cards are turned, and overlap)
  const at = await page.evaluate(() => {
    const first = document.querySelector('.hand .slot')!;
    const r = first.getBoundingClientRect();
    for (let y = r.top + r.height * 0.6; y > r.top; y -= 4)
      for (let x = r.left + 2; x < r.right; x += 3) if (document.elementFromPoint(x, y)?.closest('.slot') === first) return { x: x + 4, y };
    return null;
  });
  expect(at).not.toBeNull();
  const last = (await page.locator('.hand .slot').last().boundingBox())!;
  await page.mouse.move(at!.x, at!.y);
  await page.mouse.down();
  await page.mouse.move(at!.x + 30, at!.y + 2, { steps: 4 });
  // (past the last card: it lands in the last place)
  await page.mouse.move(last.x + last.width + 20, at!.y + 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => order(page)).not.toEqual(before);
  const after = await order(page);
  expect(after.at(-1)).toBe(before[0]);
  expect([...after].sort()).toEqual([...before].sort());
  // nothing was played or passed: still 13 cards, none selected
  await expect(page.locator('.hand .slot')).toHaveCount(13);

  // by rank, from the menu: the twos come first
  await page.click('button[aria-label="Menu"]');
  for (let i = 0; i < 2 && !(await page.getByRole('button', { name: 'Hand: by rank' }).isVisible()); i++)
    await page.getByRole('button', { name: /^Hand:/ }).click();
  await page.keyboard.press('Escape');
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
  const ranks = (await order(page)).map((l) => RANKS.indexOf(l!.split(' ')[0]));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});

test('reactions: pick one and it shows above your name', async ({ page }) => {
  await hearts(page);
  await page.click('button[aria-label="React"]');
  await page.getByRole('button', { name: 'Applause' }).click();
  await expect(page.locator('.my-react')).toHaveText('👏');
  await expect(page.getByRole('group', { name: 'Reactions' })).toBeHidden();
});
