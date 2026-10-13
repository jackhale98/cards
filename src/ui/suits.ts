/**
 * Four-colour suits, as many poker apps offer: ♦ blue and ♣ green beside ♥ red and ♠ black, so no
 * two suits share a colour. A choice for this device (it's how you see cards, not the table's look),
 * remembered; a class on the page switches every card and suit symbol over.
 */
const KEY = 'cards.fourColour';

export function fourColourOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setFourColour(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: on for this visit only */
  }
  document.documentElement.classList.toggle('four-colour', on);
}

/** At start-up: the choice this device made last time. */
export function applyFourColour() {
  document.documentElement.classList.toggle('four-colour', fourColourOn());
}
