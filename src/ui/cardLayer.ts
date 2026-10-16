/**
 * The new card layer (a prototype): every card on the table drawn in one layer, each always the
 * same element, placed by ui/layout/cardLayout.ts and eased from place to place. Off unless asked
 * for: `?layer=1` in the address turns it on for this device (remembered), `?layer=0` off.
 */
const KEY = 'cards.layer';

export function cardLayerOn(): boolean {
  try {
    const asked = new URLSearchParams(location.search).get('layer');
    if (asked === '1' || asked === '0') localStorage.setItem(KEY, asked);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
