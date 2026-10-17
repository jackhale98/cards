import { expect, test, type Page } from '@playwright/test';
import { cardsLanded } from './wait';

/**
 * Pictures of the table, to show a change to the page changed nothing: a dozen games, one for each way cards are laid out, each dealt from a fixed seed with
 * nothing moving by itself (`?seed=7&still`: development builds only), on a phone on its side, a
 * tablet, and a phone in hand mode with the TV beside it; then the menu, scores and save sheets.
 *
 *   pnpm pictures --update-snapshots    the "before" pictures (kept out of git)
 *   pnpm pictures                       after the change: any picture that differs fails, with a diff
 *
 * Not in CI (PICTURES=1 runs it): the pictures are only comparable on the same machine.
 */
test.skip(!process.env.PICTURES, 'PICTURES=1 runs it (pnpm pictures)');
test.setTimeout(120_000);

/** A game and how many sit down (with the bots). */
const GAMES: [string, number][] = [
  ['hearts', 4],
  ['bridge', 4],
  ['holdem', 4],
  ['seven-card-stud', 4],
  ['rummy-500', 3],
  ['canasta', 4],
  ['kings-corners', 3],
  ['cribbage', 2],
  ['gin-rummy', 2],
  ['palace', 3],
  ['slapjack', 3],
  ['spit', 2],
];
const PHONE = { width: 844, height: 390 };
const TABLET = { width: 1280, height: 800 };
const TV = { width: 1366, height: 768 };

async function deal(page: Page, game: string, seats: number) {
  // (the same face for you every time: a new one is picked at random)
  await page.addInitScript(() => localStorage.setItem('cards.avatar', JSON.stringify({ emoji: '🦊', color: '#d9822b' })));
  await page.goto('/?net=local&seed=7&still');
  await page.fill('input[aria-label="Your name"]', 'Tester');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${game}"]`).first().click();
  for (let i = 1; i < seats; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
}
const picture = async (page: Page, name: string) => {
  await cardsLanded(page);
  // (the table's code is new each time: the menu's title shows it)
  await page.evaluate(() => document.querySelectorAll('.sheet h3').forEach((h) => (h.textContent = h.textContent!.replace(/^Table \w+/, 'Table CODE'))));
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 });
};

for (const [game, seats] of GAMES) {
  test(`${game}: phone and its sheets`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await deal(page, game, seats);
    await picture(page, `${game}-phone`);
    for (const [open, sheet] of [
      ['Menu', 'menu'],
      ['Scores and log', 'scores'],
    ] as const) {
      await page.click(`button[aria-label="${open}"]`);
      await page.locator('.sheet').waitFor();
      await picture(page, `${game}-${sheet}`);
      await page.keyboard.press('Escape');
      await expect(page.locator('.sheet')).toHaveCount(0);
    }
  });

  test(`${game}: tablet`, async ({ page }) => {
    await page.setViewportSize(TABLET);
    await deal(page, game, seats);
    await picture(page, `${game}-tablet`);
  });

  test(`${game}: hand mode and the TV`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await deal(page, game, seats);
    const code = page.url().match(/#\/room\/([^/?]+)/)![1];
    const screen = await page.context().newPage();
    await screen.setViewportSize(TV);
    await screen.goto(`/?net=local#/display/${code}`);
    await page.locator('.table.handmode').waitFor();
    await screen.locator('.table.display').waitFor();
    await picture(page, `${game}-handmode`);
    await picture(screen, `${game}-tv`);
  });
}
