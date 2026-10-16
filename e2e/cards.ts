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
