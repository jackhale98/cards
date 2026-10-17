import { expect, test } from '@playwright/test';
import { cardsLanded } from './wait';

test.setTimeout(120_000);

/**
 * At a hand's end the table used to jump: bridge's dummy played its last card into the last trick
 * and gave up its room, so that one trick moved up and grew (and a player's own hand, empty after
 * their last card, gave the middle its room too). The last trick now looks like the ones before.
 * (A hand dealt from a fixed seed and played a step at a time: `?seed`, `&still`, `__advance`.)
 */
test('the last trick of a hand is the size the others were', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 461 });
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator('[data-game="bridge"]').first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  // Hana watches: four bots play
  await page.click('button[aria-label="Sit Hana out"]');
  await page.click('text=+ Add bot');
  await page.click('button:has-text("Deal Contract Bridge")');
  await page.locator('.table').waitFor();
  /** The table as the host has it: the trick's size in cards, the dummy's, and whether the hand's over. */
  const now = () =>
    page.evaluate(() => {
      const s = JSON.parse((window as unknown as { __snapshot: () => string }).__snapshot()).snap.state;
      return { trick: s.zones.trick.cards.length as number, dummy: (s.zones.dummy?.cards.length ?? 0) as number, phase: s.phase as string };
    });
  // the trick's card width and place, once the cards have landed; and whether the dummy still has cards
  const read = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.layer .layer-card[data-in="trick"]:not([data-leaving]) .card')] as HTMLElement[];
      return {
        width: Math.max(...cards.map((c) => c.offsetWidth)),
        top: Math.round(document.querySelector('[data-zone="trick"]')!.getBoundingClientRect().top),
      };
    });
  const before = new Set<string>();
  const last = new Set<string>();
  let played = false;
  // (each trick looked at once it's full, through the whole hand)
  for (let i = 0; i < 400; i++) {
    const t = await now();
    if (/roundOver|handOver|gameOver/.test(t.phase)) break;
    if (t.trick === 4) {
      await cardsLanded(page);
      const r = await read();
      (t.dummy ? before : last).add(`${r.width}@${r.top}`);
      played = true;
    }
    if (!(await page.evaluate(() => (window as unknown as { __advance: (n: number) => number }).__advance(1)))) break;
  }
  expect(played).toBe(true);
  expect(before.size).toBeGreaterThan(0);
  expect(last.size).toBeGreaterThan(0);
  // the last trick, once the dummy was empty: where and how big the tricks before it were
  for (const look of last) expect([...before]).toContain(look);
});
