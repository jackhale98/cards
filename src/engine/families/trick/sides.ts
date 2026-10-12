import { nextSeat } from '../../state';
import { sideName, soloTeams, teamIndex } from '../../lib/teams';
import type { S, TrickGame } from './types';

/** Partnerships, and who takes part in this hand. */

/** The teams at a table of `n` (everyone alone unless the game's partnerships fit the table). */
export const teamsFor = (g: TrickGame, n: number) => (g.R.teams?.filter((t) => t.every((s) => s < n)).length ? g.R.teams! : soloTeams(n));
/** A seat's partners (none when everyone plays for themselves). */
export const partnersOf = (g: TrickGame, s: S, seat: number) => (teamsFor(g, s.players.length).find((t) => t.includes(seat)) ?? [seat]).filter((x) => x !== seat);
export const teamOf = (g: TrickGame, s: S, seat: number) => teamIndex(teamsFor(g, s.players.length), seat);
export const teamName = (g: TrickGame, s: S, team: number) => sideName(s, teamsFor(g, s.players.length)[team]);

/** Seats taking part this hand, in turn order from `seat` (someone going alone leaves their partner out). */
export const active = (g: TrickGame, s: S, seat: number) =>
  // (a game saved before outSeats only has sittingOut)
  s.data.sittingOut !== seat &&
  !s.data.outSeats?.includes(seat) &&
  !(s.data.defAlone != null && partnersOf(g, s, s.data.defAlone).includes(seat));
export const playersThisHand = (g: TrickGame, s: S) => s.players.filter((p) => active(g, s, p.seat)).length;
export const nextActive = (g: TrickGame, s: S, seat: number) => nextSeat(s, seat, (x) => !active(g, s, x));

/** Who acts on the current turn: the declarer plays for the dummy once it's on the table. */
export const controller = (s: S) => (s.turn != null && s.data.dummyUp && s.turn === s.data.dummy ? s.data.maker! : s.turn);
/** Where a seat plays from: its hand, or the table (a bridge dummy / an open misère hand). */
export const sourceZone = (s: S, seat: number) => ((s.data.dummyUp && seat === s.data.dummy) || s.data.exposed === seat ? 'dummy' : `hand:${seat}`);
