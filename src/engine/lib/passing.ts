/** Simultaneous card passing (hearts, some rummy variants). */

/** `left2` / `right2`: to the second player that way (five-handed Hearts). */
export type PassDirection = 'left' | 'right' | 'across' | 'hold' | 'left2' | 'right2';

/** How a direction reads in a sentence ("Pass 3 cards two to the left"). */
export const PASS_WORDS: Record<PassDirection, string> = { left: 'left', right: 'right', across: 'across', hold: 'nowhere', left2: 'two to the left', right2: 'two to the right' };


/** Seat that receives cards from `seat`. "Left" is the next seat in turn order. */
export function passTarget(seat: number, dir: PassDirection, n: number): number {
  switch (dir) {
    case 'left':
      return (seat + 1) % n;
    case 'right':
      return (seat - 1 + n) % n;
    case 'across':
      return (seat + Math.floor(n / 2)) % n;
    case 'left2':
      return (seat + 2) % n;
    case 'right2':
      return (seat - 2 + n) % n;
    case 'hold':
      return seat;
  }
}
