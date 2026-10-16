import { expect, test, type Page } from '@playwright/test';
import { screenProblems } from './screenCheck';
import { cardsLanded } from './wait';

test.setTimeout(120_000);

/**
 * The card layer (a prototype, `?layer=1`): every card on the table is one element for as long as
 * it's on the table, so a card you play is the very element that lands in the trick, and gets
 * there by easing, not by being swapped for another.
 */
async function hearts(page: Page, size = { width: 844, height: 390 }) {
  await page.setViewportSize(size);
  await page.goto('/?net=local&layer=1');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('.layer .lc.mine')).toHaveCount(13);
}
const mine = (page: Page) => page.locator('.layer .lc.mine');
/** (the cards overlap, each over the one before: tap the strip of it that shows) */
const EDGE = { position: { x: 10, y: 30 } };

test('you pass, then play a card by dragging it up, and the same card lands in the trick', async ({ page }) => {
  await hearts(page);
  // pick three and pass them
  for (let i = 0; i < 3; i++) {
    await mine(page).nth(i).click(EDGE);
    await expect(mine(page).nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: /^Pass/ }).click();
  await expect(page.locator('.layer .lc.mine[aria-pressed="true"]')).toHaveCount(0);
  // your turn: pick a card you may play
  await expect(page.getByText('Your turn', { exact: true })).toBeVisible({ timeout: 60_000 });
  const card = page.locator('.layer .lc.mine:not([aria-disabled="true"])').first();
  await card.click(EDGE);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const id = (await card.getAttribute('data-card'))!;
  await card.evaluate((el) => ((window as unknown as { __played: Element }).__played = el));
  // drag it up
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 5 });
  await page.mouse.up();
  // it's no longer in your hand, and the element that left it is the one now in the trick
  const played = page.locator(`.layer .lc[data-card="${id}"]`);
  await expect(played).not.toHaveClass(/mine/);
  expect(await played.evaluate((el) => el === (window as unknown as { __played: Element }).__played)).toBe(true);
  await expect
    .poll(async () => {
      const r = await played.boundingBox();
      const t = await page.locator('[data-layer="trick"]').boundingBox();
      return !!r && !!t && r.y + r.height / 2 > t.y && r.y + r.height / 2 < t.y + t.height + 20;
    })
    .toBe(true);
});

test('the arrow keys go along your hand in its order, whatever order the cards came in', async ({ page }) => {
  await hearts(page);
  const order = async () =>
    mine(page).evaluateAll((els) =>
      els
        .map((el) => ({ id: el.getAttribute('data-card'), x: el.getBoundingClientRect().left }))
        .sort((a, b) => a.x - b.x)
        .map((c) => c.id),
    );
  const ids = await order();
  await page.locator(`.layer .lc[data-card="${ids[0]}"]`).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-card'))).toBe(ids[2]);
  // only one card of the hand is a tab stop
  await expect(page.locator('.layer .lc.mine[tabindex="0"]')).toHaveCount(1);
});

/**
 * The screen audit's checks (e2e/screenCheck.ts) at every stage of a hand: no card on the layer
 * over a button, the headline, a seat or your name, none off the screen, every card in your hand
 * showing enough to tap.
 */
for (const [name, size] of [
  ['a small phone', { width: 667, height: 320 }],
  ['a laptop', { width: 1280, height: 800 }],
] as const) {
  test(`a hand on ${name}: the cards clear of the text and buttons`, async ({ page }) => {
    await hearts(page, size);
    const found = new Map<string, string[]>();
    let checks = 0;
    for (let i = 0; i < 120; i++) {
      const phase = await page.evaluate(() => (window as unknown as { __phase: () => string | null }).__phase());
      // a few moments of each hand: dealt, passing, a trick part played, a trick whole
      if (i % 3 === 0 || /roundOver|gameOver/.test(phase ?? '')) {
        await cardsLanded(page);
        let issues = await screenProblems(page);
        // (a bot moving meanwhile isn't a layout problem: only what's still there once it settles counts)
        if (issues.length) {
          await page.waitForTimeout(600);
          await cardsLanded(page);
          const again = new Set(await screenProblems(page));
          issues = issues.filter((x) => again.has(x));
        }
        // (the audit's "small …" notes are for a person to weigh, and are the same with or without the layer)
        issues = issues.filter((x) => !x.startsWith('small '));
        checks++;
        if (issues.length) found.set(`${i} ${phase}`, issues);
      }
      if (/roundOver|gameOver/.test(phase ?? '')) break;
      const moved = await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
      await page.waitForTimeout(moved ? 150 : 300);
    }
    expect(checks).toBeGreaterThan(10);
    expect(Object.fromEntries(found)).toEqual({});
  });
}

test('the layout check sees the cards on the layer: one put over a button is caught', async ({ page }) => {
  await hearts(page);
  await cardsLanded(page);
  expect((await screenProblems(page)).filter((x) => x.startsWith('overlap'))).toEqual([]);
  await page.evaluate(() => {
    const btn = document.querySelector('aside button')!.getBoundingClientRect();
    const card = document.querySelector<HTMLElement>('.layer .lc.mine')!;
    const layer = card.parentElement!.getBoundingClientRect();
    card.style.transition = 'none';
    card.style.transform = `translate(${btn.left - layer.left}px, ${btn.top - layer.top}px)`;
  });
  expect(await screenProblems(page)).toContainEqual(expect.stringMatching(/^overlap, your hand and a button/));
});

test('it turns on from the end of the address at the table, and on and off from the menu', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Hearts")');
  await expect(page.locator('footer .hand .slot')).toHaveCount(13);
  await expect(page.locator('.layer')).toHaveCount(0);
  // added at the very end, after the room's code: the same table, now on the layer
  const url = page.url();
  await page.goto(`${url}?layer=1`);
  await expect(mine(page)).toHaveCount(13);
  await expect(page.locator('footer .hand .slot')).toHaveCount(0);
  expect(page.url()).toContain(url.split('#')[1]);
  // and from the menu
  await page.click('button[aria-label="Menu"]');
  await page.click('text=New card table (test): on');
  await expect(page.locator('.layer')).toHaveCount(0);
  await expect(page.locator('footer .hand .slot')).toHaveCount(13);
  await page.click('text=New card table (test): off');
  await expect(mine(page)).toHaveCount(13);
});
