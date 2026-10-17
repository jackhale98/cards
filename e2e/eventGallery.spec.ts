import { expect, test, type Page } from '@playwright/test';
import { screenProblems } from './screenCheck';
import { settled } from './wait';

/**
 * A tournament's screens, checked at every size they're shown on: the director's desk (a laptop),
 * and the board (on a TV, a laptop, or a phone someone opened it on), from signing up through the
 * rounds to the final standings, in each of the views the director can put on the screens. A field
 * of bots, so the director's own device hosts every table, and stepped on from a seed
 * (`?seed=7&still`, `__eventStep`: development builds) so each moment is the same every run.
 * Nothing may overlap, run off the screen or be cut off (the screen audit's firm findings).
 */
test.setTimeout(180_000);
test.use({ reducedMotion: 'reduce' });

const URL = '/?net=local&seed=7&still';
const FIRM = /^(overlap|off-screen|text cut off|text past its button|page wider|a button outside)/;
const BOARD_SIZES = [
  { name: 'TV', width: 1920, height: 1080 },
  { name: 'small TV', width: 1366, height: 768 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'phone', width: 852, height: 393 },
  { name: 'phone upright', width: 393, height: 852 },
];
const DESK_SIZES = [
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'small laptop', width: 1024, height: 640 },
  { name: 'tablet upright', width: 768, height: 1024 },
];

async function problems(page: Page, sizes: typeof BOARD_SIZES, what: string) {
  const out: string[] = [];
  for (const s of sizes) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await settled(page);
    for (const p of (await screenProblems(page)).filter((x) => FIRM.test(x))) out.push(`${what}, ${s.name}: ${p}`);
  }
  return out;
}

/** A tournament of Gin directed in this tab, with `bots` bots signed up. Returns its code. */
async function direct(page: Page, bots: number, format?: string): Promise<string> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(URL);
  await page.fill('input[aria-label="Your name"]', 'Dee');
  await page.getByRole('button', { name: 'Run a tournament' }).click();
  await page.getByLabel('Game', { exact: true }).selectOption('gin-rummy');
  await expect(page.getByText('Directing · Gin Rummy')).toBeVisible({ timeout: 20_000 });
  if (format) await page.locator('.seg button', { hasText: format }).click();
  for (let i = 0; i < bots; i++) await page.getByRole('button', { name: 'Add a bot' }).click();
  await expect(page.locator('.people li')).toHaveCount(bots);
  return (await page.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');
}

const step = (page: Page, n: number) => page.evaluate((k) => (window as unknown as { __eventStep: (n: number) => number }).__eventStep(k), n);
/** The director picks what the screens show. */
const show = (page: Page, label: string) => page.locator('.shows button', { hasText: new RegExp(`^${label}$`) }).click();

test('a Swiss: the desk and the board fit every screen, from signing up to the final standings', async ({ context }) => {
  const errors: string[] = [];
  const desk = await context.newPage();
  desk.on('pageerror', (e) => errors.push(e.message));
  const code = await direct(desk, 17);
  const tv = await context.newPage();
  tv.on('pageerror', (e) => errors.push(e.message));
  await tv.goto(`${URL}#/display/${code}`);
  await expect(tv.locator('.board .join-code')).toContainText(code);
  await expect(tv.locator('.people li')).toHaveCount(17);

  const found: string[] = [];
  found.push(...(await problems(desk, DESK_SIZES, 'the desk, signing up')));
  found.push(...(await problems(tv, BOARD_SIZES, 'the board, signing up')));

  await desk.setViewportSize({ width: 1280, height: 800 });
  await desk.getByRole('button', { name: 'Start the tournament' }).click();
  await expect(desk.getByText('Round 1 of')).toBeVisible();
  // part of the way through the round: some tables done, some playing
  await step(desk, 900);
  await expect(desk.locator('.tile.done').first()).toBeVisible();
  found.push(...(await problems(desk, DESK_SIZES, 'the desk, playing')));

  for (const [label, sel] of [
    ['Tables', '.tiles'],
    ['Standings', '.standings'],
  ] as const) {
    await show(desk, label);
    await expect(tv.locator(sel)).toBeVisible();
    found.push(...(await problems(tv, BOARD_SIZES, `the board, ${label.toLowerCase()}`)));
  }
  // the tables live: one still playing, on the table screen's own layout
  await show(desk, 'Tables live');
  await expect(tv.locator('.live .table')).toBeVisible();
  await expect(tv.locator('.live-head')).toContainText('Table');
  // (on the table screen's own layout, made for a TV or a laptop: the gallery checks it at those)
  found.push(...(await problems(tv, BOARD_SIZES.slice(0, 3), 'the board, a table live')));
  // the director's own board
  await desk.getByRole('button', { name: 'Show the board' }).click();
  await expect(desk.locator('.live .table')).toBeVisible();
  found.push(...(await problems(desk, DESK_SIZES.slice(0, 1), 'the director’s board, a table live')));
  await desk.getByRole('button', { name: 'Back to the desk' }).click();
  await expect(desk.locator('.desk')).toBeVisible();

  // on to the end
  await show(desk, 'Turn about');
  for (let i = 0; i < 40 && !(await desk.getByText('Final standings').isVisible()); i++) await step(desk, 2000);
  await expect(desk.getByText('Final standings')).toBeVisible();
  await expect(tv.locator('.standings')).toBeVisible();
  found.push(...(await problems(desk, DESK_SIZES, 'the desk, done')));
  found.push(...(await problems(tv, BOARD_SIZES, 'the board, done')));
  expect(found).toEqual([]);
  expect(errors).toEqual([]);
});

test('a knockout: the bracket fits the board', async ({ context }) => {
  const desk = await context.newPage();
  const code = await direct(desk, 11, 'Knockout');
  const tv = await context.newPage();
  await tv.goto(`${URL}#/display/${code}`);
  await expect(tv.locator('.people li')).toHaveCount(11);
  await desk.getByRole('button', { name: 'Start the tournament' }).click();
  await step(desk, 1500);
  await show(desk, 'Bracket');
  await expect(tv.locator('.bracket')).toBeVisible();
  const found = [...(await problems(tv, BOARD_SIZES, 'the bracket')), ...(await problems(desk, DESK_SIZES, 'the desk, a knockout'))];
  expect(found).toEqual([]);
});
