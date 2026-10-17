import { setSound, soundOn } from '../sound';
import { fourColourOn, setFourColour } from '../suits';
import { hintsOn, setHints } from '../hints';
import { HAND_SORTS, handSortOn, setHandSort, type HandSort } from '../handOrder';
import { setTurnAlerts, turnAlertsOn } from '../turnAlert';

/** This device's own settings at the table, from the menu (each kept in this device's storage by its module). */
export class TableSettings {
  sound = $state(soundOn());
  fourColour = $state(fourColourOn());
  /** Cards you can't play now shaded. */
  hints = $state(hintsOn());
  /** A notification when it's your turn and you're elsewhere (see turnAlert.ts). */
  turnAlerts = $state(turnAlertsOn());
  /** How your hand is sorted (see arrangeHand). */
  handSort = $state<HandSort>(handSortOn());

  toggleSound() {
    this.sound = !this.sound;
    setSound(this.sound);
  }
  toggleFourColour() {
    this.fourColour = !this.fourColour;
    setFourColour(this.fourColour);
  }
  toggleHints() {
    this.hints = !this.hints;
    setHints(this.hints);
  }
  async toggleTurnAlerts() {
    this.turnAlerts = await setTurnAlerts(!this.turnAlerts);
  }
  nextHandSort() {
    this.handSort = HAND_SORTS[(HAND_SORTS.indexOf(this.handSort) + 1) % HAND_SORTS.length];
    setHandSort(this.handSort);
  }
}
