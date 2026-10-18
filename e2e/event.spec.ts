import { expect, test, type Page } from '@playwright/test';

test.setTimeout(180_000);

/**
 * A tournament from start to finish, in one browser (`?net=local`: tabs linked, no network): a
 * director's tab sets up a Swiss of Gin and shows the board; two phones sign up with its code, are
 * sent to the table one of them hosts, play it out (stepped from a seed: `__advance`), move on to
 * the next round, and see the final standings; a phone reloads on the way and is back at its
 * table; a TV shows the event.
 */
const URL = '/?net=local&seed=7&still';

async function named(page: Page, name: string) {
  await page.goto(URL);
  await page.fill('input[aria-label="Your name"]', name);
}

type Hooks = { __phase?: () => string | null; __round?: () => number | null; __advance: (n: number) => number };
/** What a phone hosts: its table's round and its game's phase (null: it hosts nothing). */
const hosting = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as Hooks;
    return w.__round?.() ? { round: w.__round!(), phase: w.__phase?.() ?? null } : null;
  });

/** The phone hosting round `round`'s table (once it's there: the last round's host may linger a moment), stepped to the game's end. */
async function playOut(phones: Page[], round: number) {
  await expect
    .poll(
      async () => {
        for (const p of phones) {
          const at = await hosting(p);
          if (at?.round === round && at.phase && at.phase !== 'gameOver') await p.evaluate(() => (window as unknown as Hooks).__advance(400));
        }
        const at = await Promise.all(phones.map(hosting));
        return at.some((x) => x?.round === round && x.phase === 'gameOver');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

test('a Swiss of Gin: sign up by code, sent to a table, two rounds, the final standings', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await named(director, 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await expect(director.getByText('Directing')).toBeVisible();
  await director.getByLabel('Game', { exact: true }).selectOption('gin-rummy');
  // (the game's rules load first: a while, the first time on a busy machine)
  await expect(director.getByText('Directing · Gin Rummy')).toBeVisible({ timeout: 20_000 });
  // two rounds
  const rounds = director.locator('.opt', { hasText: 'Rounds' });
  for (let i = 0; i < 5; i++) {
    const n = Number(await rounds.locator('b').textContent());
    if (n === 2) break;
    await rounds.getByRole('button', { name: n < 2 ? 'More rounds' : 'Fewer rounds' }).click();
  }
  await expect(rounds.locator('b')).toHaveText('2');
  const code = (await director.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');

  // a TV showing the event
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1366, height: 768 });
  await tv.goto(`${URL}#/display/${code}`);
  await expect(tv.locator('.board .join-code')).toContainText(code);

  const phones: Page[] = [];
  for (const name of ['Ann', 'Bo']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 852, height: 393 });
    await named(p, name);
    await p.fill('input[aria-label="Table code"]', code);
    await p.getByRole('button', { name: 'Sign me up' }).click();
    await expect(p.getByText("You're in.")).toBeVisible();
    phones.push(p);
  }
  await expect(director.locator('.people li')).toHaveCount(2);
  await expect(tv.locator('.people li')).toHaveCount(2);

  await director.getByRole('button', { name: 'Start the tournament' }).click();
  // both phones are sent to their table, and the game is dealt
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });
  await expect(director.getByText('Round 1 of 2')).toBeVisible();
  // each phone reloads mid-round: back at its table (the host hosting it again, linked up to the
  // director; the other seated again by its key)
  for (const p of phones) {
    await p.reload();
    await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });
  }
  await expect(director.locator('.tile .state')).toHaveText(/Hand/);

  await playOut(phones, 1);
  await expect(director.getByText("Every table's done")).toBeVisible({ timeout: 20_000 });
  await director.getByRole('button', { name: 'Next round now' }).click();
  await expect(director.getByText('Round 2 of 2')).toBeVisible();
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });

  await playOut(phones, 2);
  await director.getByRole('button', { name: 'Finish' }).click();
  await expect(director.getByText('Final standings')).toBeVisible();
  // everyone back at the event, with the standings
  for (const p of phones) await expect(p.getByText("That's the tournament!")).toBeVisible({ timeout: 20_000 });
  await expect(tv.locator('.standings li:not(.head)')).toHaveCount(2);
  // the standings' numbers line up under their headings, row after row
  const rights = await director
    .locator('.standings li:not(.more)')
    .evaluateAll((rows) => rows.map((li) => [...li.querySelectorAll('.num')].map((n) => Math.round(n.getBoundingClientRect().right))));
  expect(rights[0].length).toBeGreaterThanOrEqual(2);
  for (const row of rights.slice(1)) expect(row).toEqual(rights[0]);
});
