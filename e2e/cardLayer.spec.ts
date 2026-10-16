import { expect, test, type Page } from '@playwright/test';
import { handCards } from './cards';
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
const EDGE = { position: { x: 10, y: 30 } };

test('you pass, then play a card by dragging it up, and the same card lands in the trick', async ({ page }) => {
  await deal(page, 'hearts');
  await expect(slots(page)).toHaveCount(13);
  await expect(handCards(page)).toHaveCount(13);
  // pick three and pass them
  for (let i = 0; i < 3; i++) {
    await slots(page).nth(i).click(EDGE);
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
  await slot.click(EDGE);
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  const drawn = page.locator('.layer .layer-card', { has: page.locator(`.card[aria-label="${name}"]`) });
  await drawn.evaluate((el) => ((window as unknown as { __played: Element }).__played = el));
  // drag it up
  const box = (await slot.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y - 20, { steps: 5 });
  await page.mouse.move(box.x + 10, box.y - 100, { steps: 5 });
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

/** The audit's findings that are always wrong: something over something else, off the screen, or cut off. */
const FIRM = /^(overlap|off-screen|text cut off|text past its button|page wider|a button outside)/;

/**
 * The screen audit's checks (e2e/screenCheck.ts) through part of a game, for a game of each way of
 * laying out cards: no card over a button, the headline, a seat or your name, or another pile's
 * label, and none off the screen.
 */
const GAMES: [string, string, number][] = [
  ['hearts', 'a fanned hand and a trick', 4],
  ['bridge', 'a dummy face up beside the trick', 4],
  ['canasta', 'melds squared into piles, on the strip', 4],
  ['kings-corners', 'piles in a cross, cascading', 4],
  ['egyptian-rat-screw', 'a pile fanned under its top, and your own pile', 4],
  ['rummy-500', 'a discard pile kept room for, and melds', 4],
  ['palace', 'face-up cards on the strip', 4],
  ['seven-card-stud', 'cards showing on the strip, chips', 4],
];
for (const [game, what, seats] of GAMES)
  for (const [where, size] of [
    ['a small phone', { width: 667, height: 320 }],
    ['a laptop', { width: 1280, height: 800 }],
  ] as const)
    test(`${game} (${what}) on ${where}: the cards clear of the text and buttons`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await deal(page, game, size, seats);
      const found = new Map<string, string[]>();
      let checks = 0;
      for (let i = 0; i < 48; i++) {
        const phase = await page.evaluate(() => (window as unknown as { __phase: () => string | null }).__phase());
        if (i % 4 === 0 || /roundOver|gameOver/.test(phase ?? '')) {
          await cardsLanded(page);
          let issues = await screenProblems(page);
          // (a bot moving meanwhile isn't a layout problem: only what's still there once it settles counts)
          if (issues.length) {
            await page.waitForTimeout(600);
            await cardsLanded(page);
            const again = new Set(await screenProblems(page));
            issues = issues.filter((x) => again.has(x));
          }
          // (what the cards must never do; how small a card or a tap target may get is the audit's to
          // weigh, game by game, and the same with or without the layer)
          issues = issues.filter((x) => FIRM.test(x));
          checks++;
          if (issues.length) found.set(`${i} ${phase}`, issues);
        }
        if (/gameOver/.test(phase ?? '')) break;
        const moved = await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
        await page.waitForTimeout(moved ? 150 : 300);
      }
      expect(checks).toBeGreaterThan(5);
      expect(Object.fromEntries(found)).toEqual({});
      expect(errors).toEqual([]);
    });
