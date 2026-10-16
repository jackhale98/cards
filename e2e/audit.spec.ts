import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { screenProblems as check } from './screenCheck';
import { cardsLanded } from './wait';

/**
 * The screen audit (not part of the usual run): every game played through its stages at a small
 * phone and a large screen, the player's own seat driven by a bot (window.__botMove, development
 * builds only). At each new stage the layout is checked (anything off-screen, overlapping or with
 * its text cut off) and a screenshot kept for a person to look over.
 *
 *   pnpm audit:screens                           every game (about an hour on 4 cores)
 *   AUDIT_GAMES=holdem,omaha pnpm audit:screens  just these (a few minutes each)
 *   AUDIT_LAYER=1 AUDIT_GAMES=hearts pnpm audit:screens  on the card layer (`?layer=1`)
 *
 * Audit the games a change touches; every game only when it changes the table for all of them
 * (src/ui/screens/Table.svelte, the shared components, the theme).
 *
 * Findings land in AUDIT_OUT/<game>/<run>.json (default audit/), screenshots beside them.
 */
test.skip(!process.env.AUDIT, 'the screen audit runs on request (AUDIT=1)');
test.setTimeout(240_000);

const OUT = process.env.AUDIT_OUT ?? 'audit';
const ONLY = process.env.AUDIT_GAMES?.split(',');
/** AUDIT_LAYER=1: the tables the card layer can draw, drawn on it (see src/ui/cardLayer.ts). */
const LAYER = !!process.env.AUDIT_LAYER;

interface GameJson {
  id: string;
  name: string;
  players: { min: number; max: number; recommended?: number; counts?: number[] };
}
const GAMES: GameJson[] = readdirSync('src/games', { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'freetable')
  .map((d) => JSON.parse(readFileSync(`src/games/${d.name}/game.json`, 'utf8')) as GameJson)
  .filter((g) => !ONLY || ONLY.includes(g.id));

const allowed = (g: GameJson, n: number) => (g.players.counts ? g.players.counts.includes(n) : n >= g.players.min && n <= g.players.max);
const recommended = (g: GameJson) => {
  const want = g.players.recommended ?? Math.max(g.players.min, Math.min(4, g.players.max));
  return allowed(g, want) ? want : (g.players.counts?.at(-1) ?? g.players.min);
};
const most = (g: GameJson) => Math.min(8, g.players.counts ? Math.max(...g.players.counts) : g.players.max);
// (the fewest players: often the biggest hands)
const fewest = (g: GameJson) => (g.players.counts ? Math.min(...g.players.counts) : Math.max(2, g.players.min));

const SIZES = {
  // a phone in landscape with the browser's bars showing
  small: { width: 667, height: 320 },
  // a laptop or tablet
  large: { width: 1280, height: 800 },
};

/** A short name for the stage the table is at: the phase, the headline's words, a banner. */
async function stage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const phase = (window as unknown as { __phase?: () => string | null }).__phase?.() ?? '?';
    const head = (document.querySelector('main .headline')?.textContent ?? '')
      .toLowerCase()
      .replace(/[0-9]+/g, '#')
      .replace(/\b(ada|bix|cleo|dash|eli|fay|gus|hal|tester)\b/g, 'X')
      .split(/[·:—]/)[0]
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(' ');
    const banner = document.querySelector('.banner') ? '+banner' : '';
    return `${phase}|${head}${banner}`;
  });
}

interface Shot {
  stage: string;
  file: string;
  issues: string[];
}

/**
 * `sheets`: also the menu, save and scores sheets (once a game: they hardly change with the
 * screen or the number of players) and `replay`, the table in a replay (once a screen size).
 */
async function audit(page: Page, g: GameJson, size: keyof typeof SIZES, seats: number, tag: string, { sheets = false, replay = false, tv = false } = {}) {
  const shots: Shot[] = [];
  const dir = `${OUT}/${g.id}`;
  mkdirSync(dir, { recursive: true });
  const snap = async (label: string) => {
    await cardsLanded(page).catch(() => {});
    // (a sheet or banner part way through fading in isn't what anyone sees for long)
    await page
      .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), null, {
        timeout: 1500,
      })
      .catch(() => {});
    const file = `${tag}-${String(shots.length).padStart(2, '0')}-${label.replace(/[^a-z0-9#+]+/gi, '_').slice(0, 50)}.png`;
    let issues = await check(page);
    // (the bots play on meanwhile: a card caught in flight isn't a layout problem, so a problem
    // counts only if it's still there once things settle)
    if (issues.length) {
      await page.waitForTimeout(700);
      await cardsLanded(page).catch(() => {});
      const again = new Set(await check(page));
      issues = issues.filter((i) => again.has(i));
    }
    await page.screenshot({ path: `${dir}/${file}` });
    shots.push({ stage: label, file, issues });
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SIZES[size]);
  await page.goto(`/?net=local${LAYER ? '&layer=1' : ''}`);
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${g.id}"]`).first().click();
  for (let i = 1; i < seats; i++) await page.click('text=+ Add bot');
  await snap('lobby');
  await page.click(`button:has-text("Deal ${g.name}")`);
  await page.locator('.table').waitFor();
  // a TV showing the table: the phone shows just your hand and the piles you can use ("hand mode")
  if (tv) {
    const code = page.url().match(/#\/room\/([^/?]+)/)![1];
    const screen = await page.context().newPage();
    await screen.setViewportSize({ width: 1366, height: 768 });
    await screen.goto(`/?net=local#/display/${code}`);
    await page.locator('.table.handmode').waitFor();
  }

  const seen = new Set<string>();
  const start = Date.now();
  for (let i = 0; i < 600 && Date.now() - start < 120_000 && shots.length < 18; i++) {
    const s = await stage(page);
    if (!seen.has(s)) {
      seen.add(s);
      await snap(s);
    }
    if (s.startsWith('gameOver')) break;
    const moved = await page.evaluate(() => (window as unknown as { __botMove: () => unknown }).__botMove());
    await page.waitForTimeout(moved ? 120 : 300);
  }
  // the menu, the scores, the save choices, and a replay
  await cardsLanded(page).catch(() => {});
  const close = () =>
    page
      .locator('.sheet .x')
      .first()
      .click()
      .catch(() => page.keyboard.press('Escape'));
  if (sheets) {
    await page.click('button[aria-label="Menu"]');
    await snap('menu');
    if (await page.locator('.sheet button:has-text("Save this game")').count()) {
      await page.click('.sheet button:has-text("Save this game")');
      await snap('save');
    }
    await close();
    const scores = page.locator('button[aria-label="Scores and log"]');
    if (await scores.count()) {
      await scores.click();
      await snap('scores');
      await close();
    }
  }
  if (replay) {
    await page.click('button[aria-label="Menu"]');
    const again = page.locator('.sheet button:has-text("Replay the last hand")');
    if (await again.count()) {
      await again.click();
      await page.locator('.replay').waitFor();
      await snap('replay');
    } else await close();
  }

  writeFileSync(`${dir}/${tag}.json`, JSON.stringify({ game: g.id, size, seats, errors, shots }, null, 1));
  expect(errors).toEqual([]);
}

for (const g of GAMES) {
  test(`${g.name}: small screen`, async ({ page }) => audit(page, g, 'small', recommended(g), 'small', { sheets: true, replay: true }));
  test(`${g.name}: large screen`, async ({ page }) => audit(page, g, 'large', recommended(g), 'large', { replay: true }));
  test(`${g.name}: small screen, with a TV`, async ({ page }) => audit(page, g, 'small', recommended(g), 'small-tv', { tv: true }));
  if (most(g) > recommended(g)) test(`${g.name}: small screen, ${most(g)} players`, async ({ page }) => audit(page, g, 'small', most(g), `small-${most(g)}p`));
  if (fewest(g) < recommended(g)) {
    test(`${g.name}: small screen, ${fewest(g)} players`, async ({ page }) => audit(page, g, 'small', fewest(g), `small-${fewest(g)}p`));
    test(`${g.name}: large screen, ${fewest(g)} players`, async ({ page }) => audit(page, g, 'large', fewest(g), `large-${fewest(g)}p`));
  }
}
