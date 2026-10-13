import { errors, type Locator, type Page } from '@playwright/test';

/**
 * Waits on what the page is doing instead of on the clock.
 */

/** Wait until an element's own entrance animations (a sheet or banner popping in) have finished. */
export async function poppedIn(el: Locator) {
  await el.waitFor();
  await el.evaluate((node) =>
    Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/**
 * Wait until no card is in flight: the card motion (deals, plays, rows sliding into place) runs
 * as script animations. CSS ones are left out: they're small pops, or decorative and slow (a
 * speech bubble that fades over seconds, a pulsing seat) and never move what the layout checks.
 */
export async function cardsLanded(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a instanceof CSSAnimation || a instanceof CSSTransition),
  );
}

/**
 * Let the bots play on: wait for `moves` changes at the table, stopping early once the table has
 * sat still for `quietMs` (it's our move, so nothing more will happen). The quiet window is the
 * one fixed span here: the only way to see "nothing else is coming" is to watch for a while,
 * and it is longer than a bot's usual pause before moving (a longer pause just means the table is
 * checked as it stands, which must fit too). Then (unless `land` is off: checking a
 * real-time game mid-flight) wait for the cards to land.
 */
export async function playOn(page: Page, { moves = 2, quietMs = 1000, land = true } = {}) {
  if (land) await cardsLanded(page);
  const snapshot = () => document.querySelector('.table')?.innerHTML ?? '';
  for (let i = 0; i < moves; i++) {
    const before = await page.evaluate(snapshot);
    const moved = await page
      .waitForFunction((b) => (document.querySelector('.table')?.innerHTML ?? '') !== b, before, { timeout: quietMs })
      .then(
        () => true,
        (e) => {
          if (e instanceof errors.TimeoutError) return false;
          throw e;
        },
      );
    if (land) await cardsLanded(page);
    if (!moved) break;
  }
}
