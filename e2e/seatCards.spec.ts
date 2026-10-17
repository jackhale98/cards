import { expect, test, type Page } from '@playwright/test';
import { cardsLanded } from './wait';

/**
 * The seats' small cards are on the card layer like every other card: a card an opponent plays
 * starts from their seat's cards and is eased to the trick, and what they just said still shows
 * over their cards.
 */
async function deal(page: Page) {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="spades"]').first().click();
  for (let i = 1; i < 4; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  await cardsLanded(page);
}
const advance = (page: Page, n: number) => page.evaluate((k) => (window as unknown as { __advance: (n: number) => number }).__advance(k), n);

test('each seat’s cards are drawn on the card layer, on its pill, under what the player just said', async ({ page }) => {
  await deal(page);
  for (const seat of [1, 2, 3]) {
    const pill = (await page.locator(`.seat[data-seat="${seat}"]`).boundingBox())!;
    const cards = page.locator(`.layer-card[data-frame="seat:${seat}"]`);
    // (thirteen cards nobody else can see, in a crowded row: one back and a count)
    await expect(cards).toHaveCount(1);
    for (const box of await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      expect(x > pill.x && x < pill.x + pill.width && y > pill.y && y < pill.y + pill.height, `seat ${seat}`).toBe(true);
    }
  }
  // (the bidding: each bot's bid pops up over the right end of their seat, where their cards are)
  await advance(page, 4);
  const bubble = page.locator('.seat .said').first();
  await expect(bubble).toBeVisible();
  // (neither takes touches, so hit-testing would pass through both: let it find them for a moment)
  await page.addStyleTag({ content: '.said, .layer-card { pointer-events: auto !important }' });
  const onTop = await bubble.evaluate((el) => {
    // (the part of it in view: a seat at the end of a row that scrolls may be partly out of it)
    const r = el.getBoundingClientRect();
    const row = el.closest('.seats')!.getBoundingClientRect();
    const right = Math.min(r.right, row.right) - 6;
    return el.contains(document.elementFromPoint(right, r.y + r.height / 2));
  });
  expect(onTop).toBe(true);
});

test('a card an opponent plays starts from their seat’s cards', async ({ page }) => {
  await deal(page);
  // (on through the bids, a move at a time, until an opponent leads or follows to the trick)
  let played: { seat: number; card: string } | null = null;
  for (let i = 0; i < 12 && !played; i++) {
    await advance(page, 1);
    played = await page.evaluate(() => {
      const s = JSON.parse((window as unknown as { __snapshot: () => string }).__snapshot()).snap.state;
      const last = s.log.at(-1);
      const card = s.zones.trick.cards.at(-1)?.id as string | undefined;
      return card && last?.seat > 0 && / plays /.test(last.text) ? { seat: last.seat as number, card } : null;
    });
  }
  expect(played).not.toBeNull();
  // where its move began: the first keyframe of its transition (its top left corner), on the seat's pill
  const start = await page.evaluate((id) => {
    const card = document.querySelector<HTMLElement>(`.layer-card[data-frame="trick"][data-card="${id}"]`)!;
    const move = card.getAnimations().find((a) => a instanceof CSSTransition && a.transitionProperty === 'transform')!;
    const from = new DOMMatrixReadOnly((move.effect as KeyframeEffect).getKeyframes()[0].transform as string);
    const layer = card.parentElement!.getBoundingClientRect();
    return { x: layer.x + from.e + 2, y: layer.y + from.f + 2 };
  }, played!.card);
  const pill = (await page.locator(`.seat[data-seat="${played!.seat}"]`).boundingBox())!;
  expect(start.x).toBeGreaterThan(pill.x);
  expect(start.x).toBeLessThan(pill.x + pill.width);
  expect(start.y).toBeGreaterThan(pill.y);
  expect(start.y).toBeLessThan(pill.y + pill.height);
});

test('in a game with a trick, each seat shows the card they put in it, and a back until they have', async ({ page }) => {
  await deal(page);
  const played = async () => {
    const s = JSON.parse(await page.evaluate(() => (window as unknown as { __snapshot: () => string }).__snapshot())).snap.state;
    return (s.zones.trick.cards as { id: string; by: number }[]).filter((c) => c.by > 0);
  };
  // (on through the bids to a trick with an opponent's card in it)
  for (let i = 0; i < 12 && !(await played()).length; i++) await advance(page, 1);
  const inTrick = await played();
  expect(inTrick.length).toBeGreaterThan(0);
  await cardsLanded(page);
  for (const seat of [1, 2, 3]) {
    const card = inTrick.find((c) => c.by === seat);
    const front = page.locator(`.layer-card[data-frame="seat:${seat}"]`).last();
    if (card) await expect(front).toHaveAttribute('data-card', card.id);
    else await expect(front).toHaveAttribute('data-key', `seat:${seat}:front`);
  }
});

test('you can slide the row of players along to look, and once you let go it eases back', async ({ page }) => {
  // (six at the table on a small phone: more players than fit)
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="spades"]').first().click();
  for (let i = 1; i < 6; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await cardsLanded(page);
  const row = page.getByRole('group', { name: 'The other players' });
  const scrolled = () => row.evaluate((el) => Math.round(el.scrollLeft));
  const wide = await row.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(wide).toBe(true);
  const was = await scrolled();
  // (from a seat in view, slide toward the side with more to see)
  const seat = (await page.locator('.seat-slot').nth(1).boundingBox())!;
  const toward = was > 0 ? 1 : -1;
  await page.mouse.move(seat.x + seat.width / 2, seat.y + seat.height / 2);
  await page.mouse.down();
  await page.mouse.move(seat.x + seat.width / 2 + toward * 160, seat.y + seat.height / 2, { steps: 8 });
  const held = await scrolled();
  expect(Math.abs(held - was)).toBeGreaterThan(60);
  await page.mouse.up();
  await expect.poll(scrolled, { timeout: 3000 }).toBe(was);
});
