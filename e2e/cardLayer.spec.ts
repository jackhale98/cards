import { expect, test, type Locator, type Page } from '@playwright/test';
import { handCards, showing } from './cards';
import { screenProblems } from './screenCheck';
import { cardsLanded } from './wait';

test.setTimeout(150_000);

/**
 * The card layer (src/ui/components/CardLayer.svelte): every card on the table is one element for
 * as long as it's on the table, so a card you play is the very element that lands in the trick,
 * and gets there by easing, not by being swapped for another.
 */
async function deal(page: Page, game: string, size = { width: 844, height: 390 }, seats = 4) {
  await page.setViewportSize(size);
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${game}"]`).first().click();
  for (let i = 1; i < seats; i++) await page.click('text=+ Add bot');
  await page.locator('button:has-text("Deal")').first().click();
  await page.locator('.table').waitFor();
}
const slots = (page: Page) => page.locator('.hand .slot');
/** (the cards overlap, each over the one before: tap the strip of it that shows) */
const tap = async (slot: Locator) => slot.click({ position: await showing(slot) });

test('you pass, then play a card by dragging it up, and the same card lands in the trick', async ({ page }) => {
  await deal(page, 'hearts');
  await expect(slots(page)).toHaveCount(13);
  await expect(handCards(page)).toHaveCount(13);
  // pick three and pass them
  for (let i = 0; i < 3; i++) {
    await tap(slots(page).nth(i));
    await expect(slots(page).nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: /^Pass/ }).click();
  await expect(page.locator('.hand .slot[aria-pressed="true"]')).toHaveCount(0);
  // your turn: pick a card you may play
  // (it's your turn: the screen reader hears so, whatever the headline asks of you, "Lead the 2♣" say)
  // (and not still from the pass: that's "your turn" too)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __phase: () => string }).__phase()), { timeout: 30_000 }).toBe('play');
  await expect(page.locator('[aria-live]')).toContainText('Your turn', { timeout: 60_000 });
  const slot = page.locator('.hand .slot:not([aria-disabled="true"])').first();
  const name = (await slot.getAttribute('aria-label'))!;
  await tap(slot);
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  const drawn = page.locator('.layer .layer-card', { has: page.locator(`.card[aria-label="${name}"]`) });
  await drawn.evaluate((el) => ((window as unknown as { __played: Element }).__played = el));
  // drag it up
  const box = (await slot.boundingBox())!;
  const at = await showing(slot);
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x, box.y + at.y - 50, { steps: 5 });
  await page.mouse.move(box.x + at.x, box.y + at.y - 130, { steps: 5 });
  await page.mouse.up();
  // it's no longer in your hand, and the element that left it is the one now in the trick
  await expect(drawn).toHaveAttribute('data-in', 'trick');
  expect(await drawn.evaluate((el) => el === (window as unknown as { __played: Element }).__played)).toBe(true);
  await cardsLanded(page);
  const r = (await drawn.boundingBox())!;
  const t = (await page.locator('.zone[data-zone="trick"] .frame').boundingBox())!;
  expect(r.y + r.height / 2).toBeGreaterThan(t.y);
  expect(r.y + r.height / 2).toBeLessThan(t.y + t.height + 20);
});

test('the layout check sees the cards on the layer: one put over a button is caught', async ({ page }) => {
  await deal(page, 'hearts');
  await expect(handCards(page)).toHaveCount(13);
  await cardsLanded(page);
  expect((await screenProblems(page)).filter((x) => x.startsWith('overlap'))).toEqual([]);
  await page.evaluate(() => {
    const btn = document.querySelector('aside button')!.getBoundingClientRect();
    const card = document.querySelector<HTMLElement>('.layer .layer-card[data-frame="hand"]')!;
    const layer = card.parentElement!.getBoundingClientRect();
    card.style.transition = 'none';
    card.style.transform = `translate(${btn.left - layer.left}px, ${btn.top - layer.top}px)`;
  });
  expect(await screenProblems(page)).toContainEqual(expect.stringMatching(/^overlap, your hand and a button/));
});

test('a card pressed stays in its place in the fan: only one being dragged comes to the front', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="hearts"]').first().click();
  for (let i = 1; i < 4; i++) await page.click('text=+ Add bot');
  await page.locator('button:has-text("Deal")').first().click();
  await expect(handCards(page)).toHaveCount(13);
  await cardsLanded(page);
  const slot = slots(page).nth(5);
  const name = (await slot.getAttribute('aria-label'))!;
  const drawn = page.locator('.layer .layer-card', { has: page.locator(`.card[aria-label="${name}"]`) });
  const look = () => drawn.evaluate((el) => ({ held: el.classList.contains('held'), z: Number(getComputedStyle(el).zIndex) }));
  const before = await look();
  const box = (await slot.boundingBox())!;
  const at = await showing(slot);
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  // (pressed, not yet moved: a tap in the making)
  expect(await look()).toEqual(before);
  await page.mouse.move(box.x + at.x, box.y + at.y - 40, { steps: 4 });
  expect((await look()).held).toBe(true);
  await page.mouse.up();
});
