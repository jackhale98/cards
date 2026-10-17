import { expect, test } from '@playwright/test';

/**
 * A phone on its side: the column on the left (the tip, the last move, you) keeps one width as the
 * tip changes. The tip is one line that glides when it's long; a column as wide as its words would
 * push the middle, and every card in it, sideways with each move.
 */
test('the side column keeps its width as the tip changes', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="gin-rummy"]').first().click();
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Gin")');
  await expect(page.locator('.me.side')).toBeVisible();
  const tips = new Set<string>();
  const widths = new Set<number>();
  // play on (taking the bot's moves for us), a short tip and a long one
  for (let i = 0; i < 30 && tips.size < 3; i++) {
    const { tip, width } = await page.evaluate(() => ({
      tip: document.querySelector('.me.side .headline')?.textContent ?? '',
      width: Math.round(document.querySelector('.me.side')!.getBoundingClientRect().width),
    }));
    tips.add(tip);
    widths.add(width);
    await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(150);
  }
  expect(tips.size).toBeGreaterThan(1);
  expect([...widths]).toHaveLength(1);
});

test('your turn’s glow shows whole in the side column: nothing cuts it into a box', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="five-hundred"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  const mine = page.locator('.me.side .headline.mine');
  await expect(page.locator('.me.side')).toBeVisible();
  for (let i = 0; i < 60 && !(await mine.isVisible()); i++) await page.evaluate(() => (window as unknown as { __advance: (n: number) => number }).__advance(1));
  await expect(mine).toBeVisible();
  // the glow (the box shadow's blur) is inside whatever clips the column's top part
  const cut = await mine.evaluate((el) => {
    const blur = Number(/(\d+(?:\.\d+)?)px 0px$/.exec(getComputedStyle(el).boxShadow.replace(/ inset$/, ''))?.[1] ?? 0);
    const r = el.getBoundingClientRect();
    const out: string[] = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue;
      const c = p.getBoundingClientRect();
      if (r.left - blur < c.left - 0.5 || r.top - blur < c.top - 0.5 || r.right + blur > c.right + 0.5 || r.bottom + blur > c.bottom + 0.5)
        out.push(
          `${p.className}: glow ${Math.round(r.left - blur)},${Math.round(r.top - blur)} → ${Math.round(r.right + blur)},${Math.round(r.bottom + blur)} in ${Math.round(c.left)},${Math.round(c.top)} → ${Math.round(c.right)},${Math.round(c.bottom)}`,
        );
      break;
    }
    return out;
  });
  expect(cut).toEqual([]);
});
