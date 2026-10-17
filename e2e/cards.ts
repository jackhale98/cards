import type { Locator, Page } from '@playwright/test';

/**
 * Where the tests find cards. Every card on the table is drawn by the card layer
 * (src/ui/components/CardLayer.svelte), each where its frame (your hand, or a zone) puts it; what
 * you tap is the frame's place for it underneath (`.hand .slot` in your hand, `.scard` in a zone,
 * the `.stack` itself for a pile), in order, named for the card.
 */

/** The cards in your hand as drawn (not in your hand's order: use `.hand .slot` for that). */
export const handCards = (page: Page | Locator) => page.locator('.layer .layer-card[data-frame="hand"]:not([data-leaving]) .card');

/** A zone's cards as drawn. */
export const zoneCards = (page: Page | Locator, zone: string) => page.locator(`.layer .layer-card[data-in="${zone}"]:not([data-leaving]) .card`);

/** The drawn card a hand's place (`.hand .slot`, named for its card) shows. */
export const drawnFor = (page: Page, name: string) => page.locator(`.layer .layer-card[data-frame="hand"]:not([data-leaving]) .card[aria-label="${name}"]`);

/**
 * A point on a card in your hand (`.hand .slot`) that taps that card, relative to its box: the
 * strip of it that shows. (A fanned card is turned, so a fixed point near its box's corner can
 * fall on the card before it.)
 */
export async function showing(slot: Locator): Promise<{ x: number; y: number }> {
  const at = await slot.evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (let y = r.top + r.height * 0.25; y < r.bottom - 4; y += 4)
      for (let x = r.left + 2; x < r.right; x += 3) if (document.elementFromPoint(x, y)?.closest('.slot') === el) return { x: x + 4 - r.left, y: y - r.top };
    return null;
  });
  if (!at) throw new Error('no part of the card shows');
  return at;
}
