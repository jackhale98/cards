import { parseCard } from '../../cards';
import { hand, ids, zone } from '../../state';
import { currentWinner, legalCards, rankOf, suitOf } from './play';
import { pointsOf, type S, type TrickGame } from './types';

/**
 * Hard Hearts: what good players do that the quick rules don't. Used for the Hard bots' own moves
 * and, inside their search, for everyone's (so the imagined play is the play of good players).
 *
 * - Passing: the queen of spades goes unless enough spades guard her; the ace and king of spades go
 *   when they'd be left unguarded to catch her; a short club or diamond suit goes, to be void of it;
 *   then the high hearts, then whatever is most dangerous.
 * - Leading: with the queen still out and no high spade to catch her, small spades to drive her out;
 *   otherwise the lowest card of the shortest side suit (to void it) or a safe low card.
 * - Following: duck under the card winning the trick with the highest card that won't take it; when
 *   void, throw the queen, then the high spades she could catch, then the highest heart.
 * - The moon: when one player has taken every point so far, and many remain, take a heart trick to
 *   stop them (it costs a point or two, and saves twenty-six).
 */

const QS = 'QS';
const isPenalty = (g: TrickGame) => g.R.scoring.type === 'penalty' && g.R.scoring.cardPoints?.QS === 13;

/** The three (or `count`) cards to pass, or null for games other than Hearts. */
export function heartsPass(g: TrickGame, s: S, seat: number): string[] | null {
  if (!isPenalty(g) || !g.R.passing) return null;
  const count = g.R.passing.count;
  const cards = ids(hand(s, seat));
  const bySuit = (x: string) => cards.filter((c) => parseCard(c).suit === x);
  const rank = (c: string) => parseCard(c).rank;
  const out: string[] = [];
  const add = (c: string) => {
    if (out.length < count && !out.includes(c)) out.push(c);
  };
  const spades = bySuit('S');
  const low = spades.filter((c) => rank(c) < 12).length;
  // the queen, unless at least three low spades guard her
  if (cards.includes(QS) && low < 3) add(QS);
  // the ace and king of spades, when short in spades and not holding the queen
  if (!cards.includes(QS) && low < 3) for (const c of spades.filter((x) => rank(x) > 12).sort((a, b) => rank(b) - rank(a))) add(c);
  // a short side suit, to be void of it (not clubs' two: it leads the first trick anyway)
  const short = ['D', 'C']
    .map((x) => bySuit(x))
    .filter((xs) => xs.length > 0 && xs.length <= count - out.length)
    .sort((a, b) => a.length - b.length)[0];
  if (short) for (const c of short.sort((a, b) => rank(b) - rank(a))) add(c);
  // high hearts, then the highest of the rest
  for (const c of bySuit('H')
    .filter((x) => rank(x) >= 11)
    .sort((a, b) => rank(b) - rank(a)))
    add(c);
  const danger = (c: string) => pointsOf(g.R, c) * 4 + rank(c) + (parseCard(c).suit === 'S' && rank(c) > 12 ? 20 : 0);
  for (const c of [...cards].sort((a, b) => danger(b) - danger(a))) add(c);
  return out;
}

/** The card to play, or null for games other than Hearts (or when there's no choice to make). */
export function heartsCard(g: TrickGame, s: S, seat: number): string | null {
  if (!isPenalty(g)) return null;
  const d = s.data;
  const legal = legalCards(g, s, seat);
  if (legal.length <= 1) return legal[0] ?? null;
  const trick = zone(s, 'trick').cards;
  const rank = (c: string) => rankOf(g, s, c);
  const suit = (c: string) => suitOf(g, s, c);
  const pts = (c: string) => pointsOf(g.R, c);
  const played = new Set((d.played ?? []).flat());
  const mine = ids(hand(s, seat));
  const queenOut = !played.has(QS) && !mine.includes(QS);
  // the moon: someone else has every point taken so far, with plenty still to come
  const taken = d.points.reduce((a, b) => a + b, 0);
  const shooter = d.points.findIndex((p, i) => i !== seat && p > 0 && p === taken);
  const stopMoon = shooter >= 0 && taken >= 8 && taken < g.totalPoints;

  if (!trick.length) {
    // drive the queen out with small spades, when no high spade of ours could catch her
    if (queenOut && !mine.some((c) => c === 'AS' || c === 'KS')) {
      const smallSpades = legal.filter((c) => suit(c) === 'S' && rank(c) < 12).sort((a, b) => rank(a) - rank(b));
      if (smallSpades.length) return smallSpades[0];
    }
    if (stopMoon) {
      // a high heart takes a trick from the shooter (and gives them no more hearts)
      const hearts = legal.filter((c) => suit(c) === 'H').sort((a, b) => rank(b) - rank(a));
      if (hearts.length) return hearts[0];
    }
    // the lowest card of the shortest side suit (to void it); never lead the queen or a high spade into her
    const safe = legal.filter((c) => c !== QS && !(queenOut && suit(c) === 'S' && rank(c) > 12) && !pts(c));
    const pool = safe.length ? safe : legal;
    const len = (x: string) => mine.filter((c) => suit(c) === x).length;
    return [...pool].sort((a, b) => len(suit(a)) - len(suit(b)) || rank(a) - rank(b))[0];
  }

  const led = suit(trick[0].id);
  const following = legal.some((c) => suit(c) === led);
  const win = currentWinner(g, s)!;
  const beats = (c: string) => {
    const before = zone(s, 'trick').cards;
    zone(s, 'trick').cards = [...trick, { id: c, by: seat }];
    const w = currentWinner(g, s);
    zone(s, 'trick').cards = before;
    return w?.id === c;
  };
  const trickPts = trick.reduce((n, c) => n + pts(c.id), 0);
  const last = trick.length === s.players.length - 1;

  if (stopMoon && win.by === shooter && (trickPts > 0 || !last)) {
    // take this trick from the shooter if we can
    const winners = legal.filter(beats).sort((a, b) => rank(a) - rank(b));
    if (winners.length) return winners[0];
  }
  if (!following) {
    // void: the queen first, then the high spades that could catch her, then the highest heart, then the highest card
    if (legal.includes(QS)) return QS;
    const order = (c: string) => (queenOut && suit(c) === 'S' && rank(c) > 12 ? 300 : 0) + (suit(c) === 'H' ? 200 + rank(c) : rank(c));
    return [...legal].sort((a, b) => order(b) - order(a))[0];
  }
  const losers = legal.filter((c) => !beats(c)).sort((a, b) => rank(b) - rank(a));
  // (spades with the queen still out: don't drop the ace or king under her unless forced)
  if (led === 'S' && queenOut) {
    const under = losers.filter((c) => c !== 'AS' && c !== 'KS');
    if (under.length) return under[0];
  }
  if (losers.length) {
    // the queen under someone else's ace or king of spades
    if (losers.includes(QS)) return QS;
    return losers[0];
  }
  // we must win it: last to play with no points in it, win with the highest; else the lowest winner
  const sorted = [...legal].sort((a, b) => rank(a) - rank(b));
  if (last && trickPts === 0) return sorted.filter((c) => c !== QS).pop() ?? sorted[sorted.length - 1];
  return sorted.find((c) => c !== QS) ?? sorted[0];
}
