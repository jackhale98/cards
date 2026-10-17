import { expect, test, type Page } from '@playwright/test';

test.setTimeout(240_000);

/**
 * A table whose host's phone goes quiet moves to the director (in one browser, `?net=local`: the
 * relay's escrow stood in for by the browser's storage). Two phones sign up for a one-round Swiss
 * of Gin; a few moves in, the tab hosting their table closes. The director's screen says whose
 * phone is off, takes the table over from the backup its host kept sending, and the game goes on
 * there, with the other player still at it, to the end of the tournament.
 */
const URL = '/?net=local&seed=7&still';

type Hooks = { __round?: () => number | null; __advance: (n: number) => number; __eventStep: (n: number) => number; __snapshot: () => string };
/** Whether this tab hosts a tournament's table. */
const hosts = (p: Page) => p.evaluate(() => !!(window as unknown as Hooks).__round?.());

test('a table whose host’s tab closes goes on, hosted by the director', async ({ context }) => {
  const director = await context.newPage();
  await director.setViewportSize({ width: 1280, height: 800 });
  await director.goto(URL);
  await director.fill('input[aria-label="Your name"]', 'Dee');
  await director.getByRole('button', { name: 'Run a tournament' }).click();
  await director.getByLabel('Game', { exact: true }).selectOption('gin-rummy');
  await expect(director.getByText('Directing · Gin Rummy')).toBeVisible({ timeout: 20_000 });
  const rounds = director.locator('.opt', { hasText: 'Rounds' });
  for (let i = 0; i < 5 && Number(await rounds.locator('b').textContent()) !== 1; i++)
    await rounds.getByRole('button', { name: Number(await rounds.locator('b').textContent()) < 1 ? 'More rounds' : 'Fewer rounds' }).click();
  await expect(rounds.locator('b')).toHaveText('1');
  const code = (await director.locator('.code').getAttribute('aria-label'))!.replace('Code ', '');

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
  await expect.poll(async () => (await Promise.all(phones.map(hosts))).filter(Boolean).length, { timeout: 20_000 }).toBe(1);
  const host = (await hosts(phones[0])) ? phones[0] : phones[1];
  const other = phones.find((p) => p !== host)!;
  const hostName = host === phones[0] ? 'Ann' : 'Bo';

  // a few moves in (the director has the table's backup by now), the host's tab closes
  await host.evaluate(() => (window as unknown as Hooks).__advance(6));
  await director.waitForTimeout(3000);
  await host.close();
  await expect(director.getByText(`${hostName}’s phone is off`)).toBeVisible({ timeout: 20_000 });

  // once the table has been quiet a while, the director hosts it: its game moves on from here
  await expect.poll(() => director.evaluate(() => (window as unknown as Hooks).__eventStep(1)), { timeout: 90_000, intervals: [2000] }).toBeGreaterThan(0);
  // the other player is at the table still, hosted on the director's laptop now (its screen sits out)
  await expect(other.locator('.table')).toBeVisible();
  await expect
    .poll(() => other.evaluate(() => JSON.parse((window as unknown as Hooks).__snapshot()).view?.lobby.seats.some((s: { id: string }) => s.id === 'director')))
    .toBe(true);
  // (stepped on to the game's end, and the event's: it was the only round)
  await expect
    .poll(
      async () => {
        await director.evaluate(() => (window as unknown as Hooks).__eventStep(400));
        return director.getByText('Final standings').isVisible();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(other.getByText("That's the tournament!")).toBeVisible({ timeout: 20_000 });
});
