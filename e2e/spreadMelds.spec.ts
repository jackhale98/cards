import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

/**
 * On a phone the melds are a sliver under the piles: a button opens everyone's melds full screen,
 * as big as fits, with your hand and your moves below them, so you can play from there.
 */
test('on a phone the melds open full screen and you can play from there', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Ada');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="rummy-500"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Rummy 500")');
  await page.locator('.table').waitFor();
  const yourTurn = () => page.locator('aside .bar .btn').count();
  // bots play (for you too) until there's a meld down and it's your turn again
  for (let i = 0; i < 300; i++) {
    if ((await page.locator('.strip > .zone').count()) && (await yourTurn())) break;
    await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(50);
  }
  test.skip(!(await page.locator('.strip > .zone').count()), 'no meld went down on this deal');
  await expect.poll(yourTurn).toBeGreaterThan(0);

  await page.click('.spread-open');
  const sheet = page.locator('.sheet.full');
  await expect(sheet).toBeVisible();
  // every set of melds, on a panel inside the screen
  await expect(sheet.locator('.spread-all > .zone')).toHaveCount(await page.locator('.strip > .zone').count());
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeGreaterThan(800);
  // the cards are as big as the room allows: the melds only scroll once they're at their smallest
  const fit = await sheet.evaluate((el) => {
    const all = el.querySelector('.spread-all')!;
    return { over: all.scrollHeight - all.clientHeight, cw: el.querySelector('.spread-all .card')!.getBoundingClientRect().width };
  });
  if (fit.over > 1) expect(fit.cw).toBeLessThanOrEqual(41);
  else expect(fit.cw).toBeGreaterThan(41);
  // your hand and your moves are there too
  const hand = sheet.locator('.hand .slot');
  const held = await hand.count();
  expect(held).toBeGreaterThan(0);
  await expect(sheet.locator('.bar .btn').first()).toBeVisible();
  // and a move made there plays: drawing adds a card to the hand in the sheet
  const draw = sheet.locator('.bar .btn', { hasText: /draw/i }).first();
  if (await draw.count()) {
    await draw.click();
    await expect(hand).toHaveCount(held + 1);
  }
  await sheet.locator('button.x').click();
  await expect(sheet).toHaveCount(0);
});
