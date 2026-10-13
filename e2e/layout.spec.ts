import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { cardsLanded, playOn } from './wait';

/**
 * Deal every game at the sizes people really use — phones in landscape, a laptop, and a TV as the
 * table display — and check nothing is cut off or pushed off-screen, and nothing throws.
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

/** How many seats to fill: the recommended number, kept to what the game allows. */
function seatsFor(g: GameJson): number {
  const want = g.players.recommended ?? Math.max(g.players.min, Math.min(4, g.players.max));
  if (g.players.counts) return g.players.counts.includes(want) ? want : Math.max(...g.players.counts);
  return Math.max(g.players.min, Math.min(g.players.max, want));
}

const PHONES = [
  { name: 'phone', width: 852, height: 393 },
  { name: 'small phone', width: 667, height: 375 },
  // (a phone in landscape with the browser's bars showing, not full screen)
  { name: 'phone with browser bars', width: 800, height: 300 },
  { name: 'laptop', width: 1280, height: 720 },
];

/** Collect page errors and console errors (a broken image or a failed fetch counts too). */
function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Start a table, pick the game, fill the seats with bots and deal. Returns the table code. */
async function deal(page: Page, g: GameJson, seats = seatsFor(g)): Promise<string> {
  await page.goto('/?net=local');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${g.id}"]`).first().click();
  for (let i = 1; i < seats; i++) await page.click('text=+ Add bot');
  await page.click(`button:has-text("Deal ${g.name}")`);
  await page.locator('.table').waitFor();
  return (await page.evaluate(() => location.hash)).split('/').pop()!;
}

/** Everything that matters is inside the window; nothing scrolled the page or the table sideways. */
async function checkLayout(page: Page, opts: { seatsMayScroll: boolean }) {
  const problems = await page.evaluate(({ seatsMayScroll }) => {
    const out: string[] = [];
    const W = innerWidth;
    const H = innerHeight;
    const inside = (sel: string, el: Element) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return; // not shown
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)
        out.push(`${sel} off-screen: ${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)} in ${W}×${H}`);
    };
    if (document.documentElement.scrollWidth > W + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${W}px window`);
    const table = document.querySelector('.table');
    if (table && table.scrollLeft) out.push(`table scrolled sideways by ${table.scrollLeft}px`);
    // (what's inside the table may not be wider than it: it would be cut off, or shift it sideways)
    if (table && table.scrollWidth > table.clientWidth + 1) out.push(`table content is ${table.scrollWidth}px wide in ${table.clientWidth}px`);
    // the piles in the middle (deck, discard, pot…); a long row of melds may scroll in its strip
    document.querySelectorAll('.zones > .zone-slot, .zones > .pot').forEach((el) => inside('pile', el));
    for (const sel of ['.headline', '.zones', '.table:not(.display) .me', '.hand-wrap', 'aside', '.seats'])
      document.querySelectorAll(sel).forEach((el) => inside(sel, el));
    document.querySelectorAll('aside button').forEach((el) => inside('action button', el));
    // the cards in the middle stay in the middle: clear of your hand below and the headline above
    const footer = document.querySelector('.table:not(.display) footer')?.getBoundingClientRect();
    const head = document.querySelector('.table:not(.display) main .headline')?.getBoundingClientRect();
    document.querySelectorAll('.table:not(.display) main .zones .card').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (footer && footer.height && r.bottom > footer.top + 2 && r.top < footer.bottom)
        out.push(`a card in the middle reaches into the hand: its bottom ${Math.round(r.bottom)}, the hand's top ${Math.round(footer.top)}`);
      if (head && head.height && r.top < head.bottom - 2 && r.bottom > head.top)
        out.push(`a card in the middle reaches up over the headline: its top ${Math.round(r.top)}, the headline's bottom ${Math.round(head.bottom)}`);
    });
    // seats on a row that scrolls may sit out of view; on a table display every seat must show
    if (!seatsMayScroll) document.querySelectorAll('.seat-slot').forEach((el) => inside('seat', el));
    return out;
  }, opts);
  expect(problems).toEqual([]);
}

for (const g of GAMES) {
  for (const size of PHONES) {
    test(`${g.name} on a ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size);
      const errors = watch(page);
      await deal(page, g);
      await playOn(page);
      await checkLayout(page, { seatsMayScroll: true });
      // and again once the bots have played on a little
      await playOn(page, { moves: 4 });
      await checkLayout(page, { seatsMayScroll: true });
      expect(errors).toEqual([]);
    });
  }

  test(`${g.name} on a TV`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = watch(page);
    const code = await deal(page, g);
    const tv = await context.newPage();
    await tv.setViewportSize({ width: 1366, height: 768 });
    errors.push(...watch(tv));
    await tv.goto(`/?net=local#/display/${code}`);
    await tv.locator('.table.display').waitFor();
    await playOn(tv);
    await checkLayout(tv, { seatsMayScroll: false });
    expect(errors).toEqual([]);
  });
}

/** Other table sizes where the game changes (more or fewer cards each, more seats): phone and TV. */
const SIZES: [string, number][] = [
  ['hearts', 3],
  ['hearts', 5],
  ['hand-and-foot', 6],
  ['spades', 3],
  ['five-hundred', 3],
  ['euchre', 6],
  ['canasta', 3],
  ['canasta', 6],
  ['spades', 6],
  ['five-hundred', 5],
  ['five-hundred', 6],
];
for (const [id, seats] of SIZES) {
  const g = GAMES.find((x) => x.id === id)!;
  test(`${g.name} with ${seats} on a phone`, async ({ page }) => {
    await page.setViewportSize(PHONES[0]);
    const errors = watch(page);
    await deal(page, g, seats);
    await playOn(page);
    await checkLayout(page, { seatsMayScroll: true });
    expect(errors).toEqual([]);
  });
  test(`${g.name} with ${seats} on a TV`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = watch(page);
    const code = await deal(page, g, seats);
    const tv = await context.newPage();
    await tv.setViewportSize({ width: 1366, height: 768 });
    errors.push(...watch(tv));
    await tv.goto(`/?net=local#/display/${code}`);
    await tv.locator('.table.display').waitFor();
    await playOn(tv);
    await checkLayout(tv, { seatsMayScroll: false });
    expect(errors).toEqual([]);
  });
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
          return page.locator('main [data-zone="pile"] .card').count();
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(2);
    await cardsLanded(page);
    await checkLayout(page, { seatsMayScroll: true });
    expect(errors).toEqual([]);
  });
}
