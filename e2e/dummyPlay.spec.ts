import { expect, test, type Page } from '@playwright/test';
import { cardsLanded } from './wait';

test.setTimeout(150_000);

/**
 * A whole hand face up on the table that you play from (bridge's dummy, 500's open misère) comes
 * down into your hand's place on your turn. Dealt from a fixed seed (development builds) so you're
 * the declarer, and played on a step at a time (`still`, `__advance`), the same way every run.
 */
async function deal(page: Page, game: string, seed: number) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`/?net=local&seed=${seed}&still`);
  await page.fill('input[aria-label="Your name"]', 'Hana');
  await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  await page.locator(`[data-game="${game}"]`).first().click();
  for (let i = 0; i < 3; i++) await page.click('text=+ Add bot');
  await page.click('.dealbar button.primary');
  await page.locator('.table').waitFor();
}

/** Step the game on (your moves as a bot would make them, or `pick` one), until `until` holds. */
async function playUntil(page: Page, until: () => Promise<boolean>, pick?: string) {
  const ask = page.getByRole('dialog', { name: 'Confirm your call' });
  for (let i = 0; i < 400 && !(await until()); i++) {
    const chosen = pick ? page.locator('aside button', { hasText: pick }) : null;
    if (chosen && (await chosen.isVisible())) {
      await chosen.click();
      // (a call is asked about before it goes)
      await ask.getByRole('button', { name: 'Confirm' }).click();
      await expect(chosen).toBeHidden();
    } else await page.evaluate(() => (window as unknown as { __advance: (n: number) => number }).__advance(1));
  }
}

/** Play the first card you may from your hand's place, and watch the card that goes: its opacity and where it is, each frame. */
async function playAndWatch(page: Page) {
  await cardsLanded(page);
  const slot = page.locator('.hand .slot:not([aria-disabled="true"])').first();
  const name = (await slot.getAttribute('aria-label'))!;
  await slot.click({ position: { x: 10, y: 30 } });
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  const watch = page.evaluate((card) => {
    const el = [...document.querySelectorAll<HTMLElement>('.layer .layer-card')].find((x) => x.querySelector(`.card[aria-label="${card}"]`))!;
    const seen: { o: number; y: number }[] = [];
    return new Promise<{ o: number; y: number }[]>((done) => {
      const t0 = performance.now();
      const look = () => {
        seen.push({ o: Number(getComputedStyle(el).opacity), y: Math.round(el.getBoundingClientRect().top) });
        if (performance.now() - t0 < 700) requestAnimationFrame(look);
        else done(seen);
      };
      requestAnimationFrame(look);
    });
  }, name);
  await slot.click({ position: { x: 10, y: 30 } });
  return { name, seen: await watch };
}

test('a card played from the dummy travels from your hand to the trick, not fading out and in', async ({ page }) => {
  await deal(page, 'bridge', 5);
  // (until it's the dummy's turn: you're declarer, so the dummy comes down into your hand's place)
  await playUntil(page, () => page.locator('.fan-label').isVisible());
  const { name, seen } = await playAndWatch(page);
  await expect(page.locator('.layer .layer-card[data-in="trick"]', { has: page.locator(`.card[aria-label="${name}"]`) })).toBeVisible();
  // never faded (a quiet trade of places), and on its way up through the frames between
  expect(Math.min(...seen.map((s) => s.o))).toBeGreaterThan(0.9);
  expect(new Set(seen.map((s) => s.y)).size).toBeGreaterThan(3);
});

test('an open misère hand stays in your hand’s place between your turns', async ({ page }) => {
  await deal(page, 'five-hundred', 1);
  // (you bid open misère; after the first trick your hand goes face up, and you play from it)
  await playUntil(page, () => page.locator('.fan-label').isVisible(), 'Open misère');
  const { seen } = await playAndWatch(page);
  expect(Math.min(...seen.map((s) => s.o))).toBeGreaterThan(0.9);
  // others play now: it stays in your hand's place, not back in the middle
  await page.waitForFunction(() => !document.querySelector('[aria-live]')?.textContent?.includes('Your turn'), undefined, { timeout: 20_000 });
  await page.evaluate(() => (window as unknown as { __advance: (n: number) => number }).__advance(2));
  await expect(page.locator('.fan-label')).toBeVisible();
  await expect(page.locator('.hand .slot')).not.toHaveCount(0);
  await expect(page.locator('main [data-zone="dummy"] .scard')).toHaveCount(0);
});
