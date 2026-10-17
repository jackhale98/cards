import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { layoutProblems, screenProblems } from './screenCheck';
import { settled } from './wait';

/**
 * The layout gallery: every game, dealt from a fixed seed and played on a step at a time with
 * nothing moving by itself (`?seed=7&still`, `__advance`: development builds; see Host.step), so
 * each moment is the same every run and there's no waiting on bots. From the deal through part of
 * the hand to its end, at each phone size and a laptop (the window resized at each moment, as a
 * phone turned or a window dragged would), and on a TV with your phone in hand mode beside it:
 *  - nothing overlaps, runs off the screen or is cut off (the screen audit's firm findings);
 *  - nothing that matters leaves the window, and the middle's cards stay clear of your hand and
 *    the headline;
 *  - the middle stands as tall as the table's sizes reckoned (layout/table.ts: `data-middle-h`),
 *    unless it couldn't fit even at the smallest cards and was scaled to fit;
 *  - nothing throws.
 * Quick and repeatable, unlike the screen audit (pnpm audit:screens), which plays whole games
 * with live bots for an hour and keeps screenshots for a person to look over.
 */
test.setTimeout(120_000);
// (cards snap into place rather than easing there: what's checked is where they end up)
test.use({ reducedMotion: 'reduce' });

interface GameJson {
  id: string;
  name: string;
  players: { min: number; max: number; recommended?: number; counts?: number[] };
}
const GAMES: GameJson[] = readdirSync('src/games', { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'freetable')
  .map((d) => JSON.parse(readFileSync(`src/games/${d.name}/game.json`, 'utf8')) as GameJson);
const allowed = (g: GameJson, n: number) => (g.players.counts ? g.players.counts.includes(n) : n >= g.players.min && n <= g.players.max);
const seatsFor = (g: GameJson) => {
  const want = g.players.recommended ?? Math.max(g.players.min, Math.min(4, g.players.max));
  return allowed(g, want) ? want : (g.players.counts?.at(-1) ?? g.players.min);
};
/** Other table sizes where the game changes (more or fewer cards each, more seats). */
const OTHER_SIZES: [string, number][] = [
  ['hearts', 3],
  ['hearts', 5],
  ['hand-and-foot', 6],
  ['spades', 3],
  ['spades', 6],
  ['five-hundred', 3],
  ['five-hundred', 5],
  ['five-hundred', 6],
  ['euchre', 6],
  ['canasta', 3],
  ['canasta', 6],
];
const TABLES: [GameJson, number][] = [
  ...GAMES.map((g): [GameJson, number] => [g, seatsFor(g)]),
  ...OTHER_SIZES.map(([id, n]): [GameJson, number] => [GAMES.find((g) => g.id === id)!, n]),
];

const SCREENS = [
  { name: 'phone', width: 852, height: 393 },
  { name: 'small phone', width: 667, height: 375 },
  { name: 'short phone', width: 667, height: 320 },
  // (a phone in landscape with the browser's bars showing, not full screen)
  { name: 'phone with browser bars', width: 800, height: 300 },
  { name: 'laptop', width: 1280, height: 800 },
];
/** What's wrong for anyone, whatever they look for (the softer findings are the audit's: docs/audit-baseline.md). */
const FIRM = /^(overlap|off-screen|text cut off|text past its button|page wider|a button outside)/;
const END = ['handOver', 'roundOver', 'gameOver'];
/** The moments looked at: the deal, then after this many steps, and the hand's end. */
const STEPS = [4, 12, 24, 40];

/** Collect page errors and console errors (a broken image or a failed fetch counts too). */
function watch(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
}

/** Start a table from the seed, pick the game, fill the seats with bots and deal. Returns the table code. */
async function deal(page: Page, g: GameJson, seats: number): Promise<string> {
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${g.id}"]`).first().click();
  for (let i = 1; i < seats; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
  return (await page.evaluate(() => location.hash)).split('/').pop()!;
}

const phase = (page: Page) => page.evaluate(() => (window as unknown as { __phase: () => string }).__phase());
/** Step on to `n` steps from the deal (or the hand's end, if that comes first). */
const stepTo = (page: Page, n: number) =>
  page.evaluate(
    ({ n, end }) => {
      const w = window as unknown as { __advance: (n: number) => number; __phase: () => string; __steps?: number };
      w.__steps ??= 0;
      while (w.__steps < n && !end.includes(w.__phase())) {
        if (!w.__advance(1)) return;
        w.__steps++;
      }
    },
    { n, end: END },
  );
/** On to the hand's end, a step at a time. */
const stepToEnd = (page: Page) => stepTo(page, 600);

/** Everything wrong with the table as it stands. */
async function problems(page: Page, o: { display: boolean }): Promise<string[]> {
  await settled(page);
  // (after the window shrinks, Chrome can go on counting the room your hand's places took before
  // they eased to their new ones, though nothing is there: laid out afresh, the hand measures true)
  await page.evaluate(() => {
    const hand = document.querySelector<HTMLElement>('.hand');
    if (!hand) return;
    hand.style.display = 'none';
    void hand.offsetWidth;
    hand.style.display = '';
  });
  const out = [...(await screenProblems(page)).filter((x) => FIRM.test(x)), ...(await layoutProblems(page, { seatsMayScroll: !o.display }))];
  if (!o.display) {
    const r = await page.evaluate(() => {
      const z = document.querySelector<HTMLElement>('.zones');
      return z && { said: Number(z.dataset.middleH), is: z.offsetHeight, squeezed: /scale\(/.test(z.style.transform) };
    });
    if (r && r.said && !r.squeezed && Math.abs(r.said - r.is) > 2) out.push(`the middle stands ${r.is}px, reckoned ${r.said}px`);
  }
  return out;
}

for (const [g, seats] of TABLES) {
  const what = seats === seatsFor(g) ? g.id : `${g.id} with ${seats}`;

  test(`${what}: from the deal to the hand's end, at every phone size and a laptop`, async ({ page }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(SCREENS[0]);
    await deal(page, g, seats);
    const found: Record<string, string[]> = {};
    const look = async (at: string) => {
      for (const screen of SCREENS) {
        await page.setViewportSize(screen);
        const p = await problems(page, { display: false });
        if (p.length) found[`${at} (${await phase(page)}), ${screen.name}`] = p;
      }
    };
    await look('dealt');
    for (const n of STEPS) {
      if (END.includes(await phase(page))) break;
      await stepTo(page, n);
      await look(`${n} steps in`);
    }
    if (!END.includes(await phase(page))) {
      await stepToEnd(page);
      await look("the hand's end");
    }
    expect(found).toEqual({});
    expect(errors).toEqual([]);
  });

  test(`${what}: on a TV, with your phone in hand mode beside it`, async ({ page, context }) => {
    const errors: string[] = [];
    watch(page, errors);
    await page.setViewportSize(SCREENS[0]);
    const code = await deal(page, g, seats);
    const tv = await context.newPage();
    watch(tv, errors);
    await tv.setViewportSize({ width: 1366, height: 768 });
    await tv.goto(`/?net=local#/display/${code}`);
    await tv.locator('.table.display').waitFor();
    await page.locator('.table.handmode').waitFor();
    const found: Record<string, string[]> = {};
    const look = async (at: string) => {
      const p = await phase(page);
      for (const [where, screen, display] of [
        ['the TV', tv, true],
        ['your phone', page, false],
      ] as const) {
        const q = await problems(screen, { display });
        if (q.length) found[`${at} (${p}), ${where}`] = q;
      }
    };
    await look('dealt');
    await stepTo(page, STEPS[1]);
    await look(`${STEPS[1]} steps in`);
    if (!END.includes(await phase(page))) {
      await stepToEnd(page);
      await look("the hand's end");
    }
    expect(found).toEqual({});
    expect(errors).toEqual([]);
  });
}
