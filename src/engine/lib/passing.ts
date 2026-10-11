/** Simultaneous card passing (hearts, some rummy variants). */

export type PassDirection = 'left' | 'right' | 'across' | 'hold';

export const HEARTS_PASS_CYCLE: PassDirection[] = ['left', 'right', 'across', 'hold'];

/** Seat that receives cards from `seat`. "Left" is the next seat in turn order. */
export function passTarget(seat: number, dir: PassDirection, n: number): number {
  switch (dir) {
    case 'left':
      return (seat + 1) % n;
    case 'right':
      return (seat - 1 + n) % n;
    case 'across':
      return (seat + Math.floor(n / 2)) % n;
    case 'hold':
      return seat;
  }
}
