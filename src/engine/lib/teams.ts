import { name } from '../state';
import type { GameState } from '../types';

/** Partnerships. A table's teams are lists of seats: `[[0, 2], [1, 3]]` is two pairs sitting opposite. */

/** Everyone for themselves: a team of one per seat. */
export const soloTeams = (n: number): number[][] => Array.from({ length: n }, (_, i) => [i]);

/** Partners sitting opposite each other: four as two pairs, six as three pairs. */
export const acrossTeams = (n: number): number[][] => Array.from({ length: n / 2 }, (_, i) => [i, i + n / 2]);

/** Which team (its index in `teams`) a seat plays for; -1 if none. */
export const teamIndex = (teams: number[][], seat: number) => teams.findIndex((t) => t.includes(seat));

/** A side's name from its players: "Ann & Bob". */
export const sideName = (s: GameState<any>, seats: number[]) => seats.map((i) => name(s, i)).join(' & ');
