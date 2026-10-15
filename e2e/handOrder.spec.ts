import { expect, test, type Page } from '@playwright/test';

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
  const before = await order(page);
  // drag the first card most of the way along the hand
  const first = (await page.locator('.hand .slot').first().boundingBox())!;
  const last = (await page.locator('.hand .slot').last().boundingBox())!;
  await page.mouse.move(first.x + 12, first.y + 40);
  await page.mouse.down();
  await page.mouse.move(first.x + 40, first.y + 42, { steps: 4 });
  // (past the last card: it lands in the last place)
  await page.mouse.move(last.x + last.width + 20, first.y + 42, { steps: 8 });
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
  const ranks = (await order(page)).map((l) => '23456789TJQKA'.indexOf(l!.replace('10', 'T')[0]));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});

test('reactions: pick one and it shows above your name', async ({ page }) => {
  await hearts(page);
  await page.click('button[aria-label="React"]');
  await page.getByRole('button', { name: 'Applause' }).click();
  await expect(page.locator('.my-react')).toHaveText('👏');
  await expect(page.getByRole('group', { name: 'Reactions' })).toBeHidden();
});
