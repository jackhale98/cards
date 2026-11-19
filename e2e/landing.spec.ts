import { expect, test, type Page } from '@playwright/test';
import { cardsLanded, settled } from './wait';

/**
 * The pictures on the landing page (about/img/*.jpg), taken from the app itself, dealt from a
 * fixed seed so they come out the same each time. Not a test (LANDING=1 runs it): run it again after
 * a change to how the app looks, and commit the new pictures.
 *
 *   LANDING=1 pnpm exec playwright test e2e/landing.spec.ts --project=dev
 */
test.skip(!process.env.LANDING, 'LANDING=1 takes the landing page’s pictures');
test.setTimeout(300_000);
test.use({ deviceScaleFactor: 2, reducedMotion: 'reduce' });

const URL = '/?net=local&seed=7&still';
const OUT = 'about/img';
type Hooks = { __advance: (n: number) => number; __eventStep: (n: number) => number };

async function table(page: Page, game: string, bots: number, setup?: (p: Page) => Promise<void>) {
  await page.addInitScript(() => localStorage.setItem('cards.avatar', JSON.stringify({ emoji: '🦊', color: '#d9822b' })));
  await page.goto(URL);
  await page.fill('input[aria-label="Your name"]', 'Sam');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${game}"]`).first().click();
  await setup?.(page);
  for (let i = 0; i < bots; i++) await page.click('text=+ Add bot');
  await expect(page.locator('.players li')).toHaveCount(bots + 1);
}
const deal = async (page: Page) => {
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
};
const advance = (page: Page, n: number) => page.evaluate((k) => (window as unknown as Hooks).__advance(k), n);
const shot = async (page: Page, name: string) => {
  await cardsLanded(page);
  await settled(page);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 80 });
};

test('the lobby: a code to join by, the players, the game', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await table(page, 'hearts', 3);
  // (from the top; the network line is left out: here, with no network, it never connects)
  await page.evaluate(() => {
    document.querySelector('.lobby')!.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>('.net').forEach((e) => (e.style.visibility = 'hidden'));
  });
  await shot(page, 'lobby');
});

// (a table on a phone is played with the phone on its side)
const SIDEWAYS = { width: 844, height: 390 };

test('a hand of Hearts on a phone', async ({ page }) => {
  await page.setViewportSize(SIDEWAYS);
  await table(page, 'hearts', 3);
  await deal(page);
  await advance(page, 14);
  await shot(page, 'hearts');
});

test('Hold’em on the TV, your hand on your phone', async ({ page, context }) => {
  await page.setViewportSize(SIDEWAYS);
  await table(page, 'holdem', 4);
  await deal(page);
  const code = page.url().match(/#\/room\/([^/?]+)/)![1];
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1280, height: 720 });
  await tv.goto(`/?net=local#/display/${code}`);
  await tv.locator('.table.display').waitFor();
  await advance(page, 9);
  await shot(tv, 'tv');
  await shot(page, 'tv-hand');
});

test('bridge practice: your call, graded', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await table(page, 'bridge', 3, async (p) => {
    await p.getByRole('button', { name: 'Settings' }).click();
    await p.getByRole('combobox', { name: /Practice bidding/ }).selectOption({ label: 'Answering 1♥ or 1♠' });
    await p.keyboard.press('Escape');
  });
  await deal(page);
  await advance(page, 2);
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm your call' }).getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.coach')).toBeVisible();
  await shot(page, 'practice');
});

test('a tournament on the big screen', async ({ context }) => {
  const desk = await context.newPage();
  await desk.setViewportSize({ width: 1280, height: 800 });
  await desk.goto(URL);
  await desk.fill('input[aria-label="Your name"]', 'Dee');
  await desk.getByRole('button', { name: 'Run a tournament' }).click();
  await desk.getByLabel('Game', { exact: true }).selectOption('hearts');
  await expect(desk.getByText('Directing · Hearts')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 31; i++) await desk.getByRole('button', { name: 'Add a bot' }).click();
  const code = (await desk.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1280, height: 720 });
  await tv.goto(`${URL}#/display/${code}`);
  await desk.getByRole('button', { name: 'Start the tournament' }).click();
  await desk.evaluate(() => (window as unknown as Hooks).__eventStep(1500));
  await desk.locator('.shows button', { hasText: /^Tables$/ }).click();
  await expect(tv.locator('.tiles')).toBeVisible();
  await settled(tv);
  // (the tiles, not the empty felt below them)
  const tiles = (await tv.locator('.tiles').boundingBox())!;
  await tv.screenshot({
    path: `${OUT}/tournament.jpg`,
    type: 'jpeg',
    quality: 80,
    clip: { x: 0, y: 0, width: 1280, height: Math.min(720, tiles.y + tiles.height + 32) },
  });
});
