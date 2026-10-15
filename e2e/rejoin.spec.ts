import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

test('a player who closes the tab can have a bot play for them, and sits back down when they reopen the table', async ({ context }) => {
  test.setTimeout(60_000);
  const host = await phone(context, 'Hana');
  const code = host.url().split('/').pop()!;
  const gus = await phone(context, 'Gus', code);
  await expect(host.locator('.lobby li', { hasText: 'Gus' })).toBeVisible();
  await host.locator('[data-game="hearts"]').first().click();
  await host.click('text=+ Add bot');
  await host.click('text=+ Add bot');
  await host.click('button:has-text("Deal Hearts")');
  await expect(gus.getByRole('group', { name: 'Your hand' })).toBeVisible();

  // Gus closes the tab: once the host notices, anyone at the table can let a bot play for him
  await gus.close();
  const dropped = host.locator('.dropped');
  await expect(dropped).toContainText('Gus has dropped out', { timeout: 20_000 });
  await dropped.getByRole('button', { name: 'Let a bot play' }).click();
  await expect(dropped).toBeHidden();

  // he opens the table again in a new tab: the same seat, and his own hand
  const back = await context.newPage();
  await back.setViewportSize({ width: 852, height: 393 });
  await back.goto(`/?net=local#/room/${code}`);
  await expect(back.getByRole('group', { name: 'Your hand' })).toBeVisible({ timeout: 15_000 });
  // and the host's table shows him back (no bot marker on his seat)
  await expect(host.locator('.seat', { hasText: 'Gus' }).locator('.bot')).toHaveCount(0);
});
