import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240_000);

/**
 * A standby director takes over (in one browser, `?net=local`: the relay's escrow stood in for by
 * the browser's storage): the director's tab hands a second tab its standby link, starts a Swiss
 * of Gin with two phones, and closes after the first round; the standby, once the director has
 * gone quiet, takes over, and the tournament goes on to the second round and the final standings.
 */
const URL = '/?net=local&seed=7&still';

type Hooks = { __phase?: () => string | null; __round?: () => number | null; __advance: (n: number) => number };
const hosting = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as Hooks;
    return w.__round?.() ? { round: w.__round!(), phase: w.__phase?.() ?? null } : null;
  });
/** The phone hosting round `round`'s table, stepped to the game's end. */
async function playOut(phones: Page[], round: number) {
  await expect
    .poll(
      async () => {
        for (const p of phones) {
          const at = await hosting(p);
          if (at?.round === round && at.phase && at.phase !== 'gameOver') await p.evaluate(() => (window as unknown as Hooks).__advance(400));
        }
        return (await Promise.all(phones.map(hosting))).some((x) => x?.round === round && x.phase === 'gameOver');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

test('a standby director takes over when the director’s tab closes, and the tournament goes on', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await director.goto(URL);
  await director.fill('input[aria-label="Your name"]', 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await director.getByLabel('Game', { exact: true }).selectOption('gin-rummy');
  await expect(director.getByText('Directing · Gin Rummy')).toBeVisible({ timeout: 20_000 });
  const rounds = director.locator('.opt', { hasText: 'Rounds' });
  for (let i = 0; i < 5 && Number(await rounds.locator('b').textContent()) !== 2; i++)
    await rounds.getByRole('button', { name: Number(await rounds.locator('b').textContent()) < 2 ? 'More rounds' : 'Fewer rounds' }).click();
  const code = (await director.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');

  // the standby: a second tab opens the link from the director's sheet
  await director.getByRole('button', { name: 'Standby director' }).click();
  const link = await director.getByLabel('Standby link').inputValue();
  expect(link).toContain(`#/standby/${code}/`);
  const standby = await context.newPage();
  await standby.setViewportSize({ width: 1280, height: 800 });
  await standby.goto(link);
  await expect(standby.getByText('Copy of the tournament from')).toBeVisible({ timeout: 20_000 });
  await expect(director.getByText('A device is standing by, with a copy.')).toBeVisible();
  await director.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  const phones: Page[] = [];
  for (const name of ['Ann', 'Bo']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 852, height: 393 });
    await p.goto(URL);
    await p.fill('input[aria-label="Your name"]', name);
    await p.fill('input[aria-label="Table code"]', code);
    await p.getByRole('button', { name: 'Sign me up' }).click();
    await expect(p.getByText("You're in.")).toBeVisible();
    phones.push(p);
  }
  await expect(director.locator('.people li')).toHaveCount(2);
  await director.getByRole('button', { name: 'Start the tournament' }).click();
  for (const p of phones) await expect(p.locator('.table')).toBeVisible({ timeout: 20_000 });
  await playOut(phones, 1);
  await expect(director.getByText("Every table's done")).toBeVisible({ timeout: 20_000 });

  // the director's tab closes; once it's been quiet a while, the standby takes over (its copy may be
  // from before the round's results: the tables send them again when they link up)
  await director.close();
  await standby.getByRole('button', { name: 'Take over directing' }).click({ timeout: 60_000 });
  await expect(standby.getByText('Directing · Gin Rummy')).toBeVisible({ timeout: 20_000 });
  await expect(standby.getByText("Every table's done")).toBeVisible({ timeout: 20_000 });
  await standby.getByRole('button', { name: 'Next round now' }).click();
  await expect(standby.getByText('Round 2 of 2')).toBeVisible();
  await playOut(phones, 2);
  await standby.getByRole('button', { name: 'Finish' }).click({ timeout: 30_000 });
  await expect(standby.getByText('Final standings')).toBeVisible();
  for (const p of phones) await expect(p.getByText("That's the tournament!")).toBeVisible({ timeout: 20_000 });
});
