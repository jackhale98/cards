import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.setTimeout(90_000);

/** A phone: a tab of its own (each tab is its own player; `?net=local` links tabs together). */
async function phone(ctx: BrowserContext, name: string, code?: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto(code ? `/?net=local#/join/${code}` : '/?net=local');
  await page.fill('input[aria-label="Your name"]', name);
  if (code) await page.click('text=Deal me in');
  else await page.click('text=Start a table');
  await page.waitForURL(/#\/room\//);
  return page;
}
const codeOf = (p: Page) => p.url().split('/').pop()!;

test('more people than a game seats: choose who plays, then split the table and come back', async ({ context }) => {
  const host = await phone(context, 'Hana');
  const code = codeOf(host);
  const guests: Page[] = [];
  for (const n of ['Ann', 'Ben', 'Cal', 'Dee']) guests.push(await phone(context, n, code));
  const [ann, ben, cal, dee] = guests;
  await host.locator('[data-game="hearts"]').first().click();
  await expect(host.locator('.players li')).toHaveCount(5);
  // the last to arrive sits out of a four-player game
  await expect(host.locator('.block .eyebrow').first()).toHaveText(/Playing · 4\/4 · 1 sitting out/);
  await expect(dee.locator('.players li', { hasText: 'Dee' })).toContainText('sitting out');
  // the host swaps who sits out
  await host.click('button[aria-label="Sit Ann out"]');
  await host.click('button[aria-label="Deal Dee in"]');
  await expect(ann.locator('.players li', { hasText: 'Ann' })).toContainText('sitting out');
  await host.click('button:has-text("Deal Hearts")');
  await expect(ann.locator('.me-sub')).toContainText('Sitting this one out');
  await expect(dee.locator('.hand .slot')).toHaveCount(13);
  // back to the lobby
  await host.click('button[aria-label="Menu"]');
  await host.click('text=Back to lobby');
  await host.locator('.lobby').waitFor();

  // split: Ben and Cal go off to a table Cal hosts
  await host.click('text=Split the table');
  await host.locator('.pick li', { hasText: 'Ben' }).locator('input[type=checkbox]').check();
  await host.locator('.pick li', { hasText: 'Cal' }).locator('input[type=checkbox]').check();
  await host.locator('.pick li', { hasText: 'Cal' }).locator('input[type=radio]').check();
  await host.click('text=Move 2 to a new table');
  await cal.waitForURL((u) => !u.hash.endsWith(code));
  const side = codeOf(cal);
  await ben.waitForURL(new RegExp(`${side}$`));
  await expect(cal.locator('text=Split off from table')).toBeVisible();
  await expect(cal.locator('.players li')).toHaveCount(2);
  await expect(host.locator('.players li')).toHaveCount(3);
  await expect(host.locator('p.small', { hasText: 'Also playing tonight' })).toContainText(`table ${side} (Ben, Cal)`);

  // and back again
  await cal.click(`text=Everyone back to ${code}`);
  await cal.waitForURL(new RegExp(`${code}$`));
  await ben.waitForURL(new RegExp(`${code}$`));
  await expect(host.locator('.players li')).toHaveCount(5);
  await expect(host.locator('p.small', { hasText: 'Also playing tonight' })).toHaveCount(0);
});
