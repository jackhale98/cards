import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { zoneCards } from './cards';
import { layoutProblems } from './screenCheck';
import { cardsLanded, playOn } from './wait';

/**
 * The real-time games, played live (their bots react on their own clocks): with a TV connected,
 * the phone keeps the piles you react to; on a short screen, the pile in the middle stays clear of
 * your own. Every game at every size, stepped from a seed, is e2e/gallery.spec.ts.
 */

interface GameJson {
  id: string;
  name: string;
  players: { min: number; max: number; recommended?: number; counts?: number[] };
  bots?: boolean;
}
const GAMES: GameJson[] = readdirSync('src/games', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => JSON.parse(readFileSync(`src/games/${d.name}/game.json`, 'utf8')) as GameJson)
  .filter((g) => g.id !== 'freetable');

/** Collect page errors and console errors (a broken image or a failed fetch counts too). */
function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Start a table, pick the game, fill the seats with bots and deal. Returns the table code. */
async function deal(page: Page, g: GameJson): Promise<string> {
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${g.id}"]`).first().click();
  for (let i = 1; i < (g.players.recommended ?? g.players.min); i++) await page.click('text=+ Add bot');
  await page.click(`button:has-text("Deal ${g.name}")`);
  await page.locator('.table').waitFor();
  return (await page.evaluate(() => location.hash)).split('/').pop()!;
}

async function checkLayout(page: Page, opts: { seatsMayScroll: boolean }) {
  expect(await layoutProblems(page, opts)).toEqual([]);
}

/** Real-time games with a TV connected: the phone keeps the piles you react to (and still fits). */
const SPEED: [string, string[]][] = [
  ['slapjack', ['pile']],
  ['egyptian-rat-screw', ['pile']],
  ['spit', ['left', 'right']],
  ['spoons', ['deck']],
];
for (const [id, piles] of SPEED) {
  const g = GAMES.find((x) => x.id === id)!;
  test(`${g.name} on a phone with a TV`, async ({ page, context }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    const errors = watch(page);
    const code = await deal(page, g);
    const tv = await context.newPage();
    await tv.setViewportSize({ width: 1366, height: 768 });
    errors.push(...watch(tv));
    await tv.goto(`/?net=local#/display/${code}`);
    await tv.locator('.table.display').waitFor();
    await page.locator('.table.handmode').waitFor();
    // through a few moves (bots turning cards, slapping), the piles never leave the phone
    for (let i = 0; i < 4; i++) {
      for (const z of piles) await expect(page.locator(`main [data-zone="${z}"]`)).toBeVisible();
      await playOn(page, { moves: 1, quietMs: 700, land: false });
    }
    await cardsLanded(page);
    await checkLayout(page, { seatsMayScroll: true });
    expect(errors).toEqual([]);
  });
}

/** Slap games on a short screen: the pile in the middle, once cards are on it, stays clear of your own. */
for (const id of ['egyptian-rat-screw', 'slapjack']) {
  const g = GAMES.find((x) => x.id === id)!;
  test(`${g.name} with cards on the pile, on a phone with browser bars`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 300 });
    const errors = watch(page);
    await deal(page, g);
    const turn = page.locator('aside button:has-text("Turn over")');
    // turn cards over until a few are on the pile (the bots turn theirs between)
    await expect
      .poll(
        async () => {
          if (await turn.isEnabled().catch(() => false)) await turn.click().catch(() => {});
          return zoneCards(page, 'pile').count();
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(2);
    await cardsLanded(page);
    await checkLayout(page, { seatsMayScroll: true });
    expect(errors).toEqual([]);
  });
}
