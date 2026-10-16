/**
 * The new card layer (a prototype): every card on the table drawn in one layer, each always the
 * same element, placed by ui/layout/cardLayout.ts and eased from place to place. Off unless asked
 * for, on this device (remembered): from the table's menu, or `layer=1` in the address (`layer=0`
 * turns it off). The address may have it before the `#` or after it, at the end, where people add
 * things (`…#/room/ABCD?layer=1`).
 */
const KEY = 'cards.layer';

/** `layer=…` in the address, before or after the `#`. */
function asked(): string | null {
  const inHash = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
  return new URLSearchParams(location.search).get('layer') ?? new URLSearchParams(inHash).get('layer');
}

export function cardLayerOn(): boolean {
  try {
    const a = asked();
    if (a === '1' || a === '0') localStorage.setItem(KEY, a);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return asked() === '1';
  }
}

export function setCardLayer(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: for this visit only */
  }
}
