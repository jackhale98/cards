import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { screenProblems } from './screenCheck';
import { cardsLanded } from './wait';

/**
 * The layout gallery: every game, dealt from a fixed seed and played on a step at a time with
 * nothing moving by itself (`?seed=7&still`, `__advance`: development builds; see Host.step), so
 * each moment is the same every run. At the deal, a few moves in and at the hand's end, on a
 * small phone and a large screen, the screen check finds nothing overlapping, off screen or cut
 * off. Quick and repeatable, unlike the screen audit (pnpm audit:screens), which plays whole games
 * with live bots for an hour and keeps screenshots for a person to look over.
 */
test.setTimeout(90_000);

interface GameJson {
  id: string;
  players: { min: number; max: number; recommended?: number; counts?: number[] };
}
const GAMES: GameJson[] = readdirSync('src/games', { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'freetable')
  .map((d) => JSON.parse(readFileSync(`src/games/${d.name}/game.json`, 'utf8')) as GameJson);
const allowed = (g: GameJson, n: number) => (g.players.counts ? g.players.counts.includes(n) : n >= g.players.min && n <= g.players.max);
const seats = (g: GameJson) => {
  const want = g.players.recommended ?? Math.max(g.players.min, Math.min(4, g.players.max));
  return allowed(g, want) ? want : (g.players.counts?.at(-1) ?? g.players.min);
};
const SIZES = { small: { width: 667, height: 320 }, large: { width: 1280, height: 800 } };
/** What's wrong for anyone, whatever they look for (the softer findings are the audit's: docs/audit-baseline.md). */
const FIRM = /^(overlap|off-screen|text cut off|text past its button|page wider|a button outside)/;
const END = ['handOver', 'roundOver', 'gameOver'];

async function look(page: Page, at: string) {
  await cardsLanded(page);
  expect(
    (await screenProblems(page)).filter((x) => FIRM.test(x)),
    at,
  ).toEqual([]);
}

for (const g of GAMES)
  for (const [size, viewport] of Object.entries(SIZES))
    test(`${g.id}, ${size} screen: nothing overlaps, runs off or is cut off, from the deal to the hand's end`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?net=local&seed=7&still');
      await page.fill('input[aria-label="Your name"]', 'Tester');
      await page.click('text=Start a table');
      await page.waitForURL(/#\/room\//);
      await page.locator(`[data-game="${g.id}"]`).first().click();
      for (let i = 1; i < seats(g); i++) await page.click('text=+ Add bot');
      await page.click('.dealbar button.primary');
      await page.locator('.table').waitFor();
      await look(page, 'dealt');
      const advance = (n: number) => page.evaluate((k) => (window as unknown as { __advance: (n: number) => number }).__advance(k), n);
      await advance(6);
      await look(page, 'a few moves in');
      // (on to the hand's end, a step at a time)
      await page.evaluate((end) => {
        const w = window as unknown as { __advance: (n: number) => number; __phase: () => string };
        for (let i = 0; i < 600 && !end.includes(w.__phase()); i++) if (!w.__advance(1)) break;
      }, END);
      await look(page, `the hand's end (${await page.evaluate(() => (window as unknown as { __phase: () => string }).__phase())})`);
    });
