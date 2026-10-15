import { cardLabel, parseCard, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../../cards';
import { hand, ids, log, name, nextSeat, sortHand, zone } from '../../state';
import { assertRule, type Action } from '../../types';
import { startPlay } from './deal';
import { teamName, teamOf, teamsFor } from './sides';
import { type S, type TrickGame } from './types';

/**
 * Pitch / Setback (pagat: Pitch): one round of bidding for the right to pitch, trumps named by
 * the pitcher's first lead, and four points a hand: High, Low, Jack and Game.
 */

export const PITCH_BIDS = [2, 3, 4, 5];
export const SMUDGE = 5;
export const pitchLabel = (bid: number) => (bid === SMUDGE ? 'Smudge' : String(bid));

/** Card points for Game: ace 4, king 3, queen 2, jack 1, ten 10. */
export const GAME_POINTS: Record<number, number> = { 14: 4, 13: 3, 12: 2, 11: 1, 10: 10 };
export const gamePoints = (id: string) => GAME_POINTS[parseCard(id).rank] ?? 0;

export function startPitch(s: S) {
  s.data.pitch = { bid: 0, by: null, high: null, highBy: null, low: null, lowTo: null, jack: null, jackTo: null };
}

/**
 * The bids `seat` may make now: higher than the bid to beat, but the dealer (last to speak) may
 * take it by matching it; if nobody has bid, the dealer must bid at least two.
 */
export function pitchBids(s: S, seat: number): number[] {
  const p = s.data.pitch!;
  const min = p.by == null ? 2 : seat === s.dealer ? p.bid : p.bid + 1;
  return PITCH_BIDS.filter((b) => b >= min);
}

/** Everyone else passed: the dealer has to bid. */
export const forcedDealer = (s: S, seat: number) => seat === s.dealer && s.data.pitch!.by == null;

/** A bid (`pitchBid`, the amount), or a pass (`decline`). After the dealer, the high bidder pitches. */
export function applyPitchBid(g: TrickGame, s: S, seat: number, a: Action) {
  const p = s.data.pitch!;
  assertRule(s.phase === 'pitch' && s.turn === seat, 'Not your turn to bid');
  if (a.type === 'decline') {
    assertRule(!forcedDealer(s, seat), 'Everyone else passed: the dealer has to bid');
    log(s, `${name(s, seat)} passes`, seat, 'Pass');
  } else {
    const bid = Math.floor(a.amount ?? -1);
    assertRule(pitchBids(s, seat).includes(bid), p.by == null ? 'Bid 2, 3, 4 or smudge' : `Bid more than ${pitchLabel(p.bid)}`);
    const steal = seat === s.dealer && p.by != null && bid === p.bid;
    p.bid = bid;
    p.by = seat;
    log(s, steal ? `${name(s, seat)} takes the bid at ${pitchLabel(bid)}` : `${name(s, seat)} bids ${pitchLabel(bid)}`, seat, pitchLabel(bid));
  }
  if (seat !== s.dealer) {
    s.turn = nextSeat(s, seat);
    return;
  }
  s.data.maker = p.by;
  log(s, `${name(s, p.by!)} will pitch (${pitchLabel(p.bid)})`, p.by!);
  startPlay(g, s);
}

/**
 * The pitcher's first card names trumps. From then on it's known which cards score: the top and
 * bottom trumps in play (every card is dealt out and played) and the jack, if it was dealt.
 */
export function pitchTrumps(s: S, card: string) {
  const d = s.data;
  const p = d.pitch!;
  const trump = parseCard(card).suit as Suit;
  d.trump = trump;
  log(s, `${SUIT_NAME[trump]} are trumps`, undefined, SUIT_SYMBOL[trump]);
  const inPlay = [...s.players.flatMap((x) => ids(hand(s, x.seat))), ...ids(zone(s, 'trick'))].filter((c) => parseCard(c).suit === trump);
  const byRank = [...inPlay].sort((a, b) => parseCard(a).rank - parseCard(b).rank);
  p.low = byRank[0] ?? null;
  p.high = byRank[byRank.length - 1] ?? null;
  p.jack = inPlay.find((c) => parseCard(c).rank === 11) ?? null;
  s.players.forEach((_, i) => sortHand(s, i, { trump }));
}

/** A trick is won: its card points count for Game, and it may hold the low trump or the jack. */
export function pitchTrick(s: S, winner: number) {
  const d = s.data;
  const p = d.pitch!;
  for (const c of zone(s, 'trick').cards) {
    d.points[winner] += gamePoints(c.id);
    if (c.id === p.high) p.highBy = c.by ?? null;
    if (c.id === p.low) p.lowTo = winner;
    if (c.id === p.jack) p.jackTo = winner;
  }
}

/**
 * The hand's points: High, Low, Jack and Game. The bidders score what they make if it's at least
 * their bid (smudge: all six tricks, which takes all four points: five); otherwise they're set
 * back by the bid. The others always score what they make.
 */
export function pitchScores(g: TrickGame, s: S): { deltas: number[]; lines: string[]; made: boolean } {
  const d = s.data;
  const p = d.pitch!;
  const teams = teamsFor(g, s.players.length);
  const pts = teams.map(() => 0);
  const lines: string[] = [];
  const team = (seat: number) => teamOf(g, s, seat);
  if (p.high && p.highBy != null) {
    pts[team(p.highBy)]++;
    lines.push(`High ${cardLabel(p.high)}: ${name(s, p.highBy)}`);
  }
  if (p.low && p.lowTo != null) {
    pts[team(p.lowTo)]++;
    lines.push(`Low ${cardLabel(p.low)}: ${name(s, p.lowTo)}`);
  }
  if (p.jack && p.jackTo != null) {
    pts[team(p.jackTo)]++;
    lines.push(`Jack ${cardLabel(p.jack)}: ${name(s, p.jackTo)}`);
  }
  const game = teams.map((t) => t.reduce((n, i) => n + d.points[i], 0));
  const most = Math.max(...game);
  if (game.filter((x) => x === most).length === 1) {
    const ti = game.indexOf(most);
    pts[ti]++;
    lines.push(`Game: ${teamName(g, s, ti)}, ${most} to ${Math.max(...game.filter((_, k) => k !== ti))}`);
  } else lines.push(`Game: tied at ${most}, nobody`);
  const bidders = team(p.by!);
  const tricks = teams[bidders].reduce((n, i) => n + d.tricks[i], 0);
  const made = p.bid === SMUDGE ? tricks === d.handSize && !!p.jack : pts[bidders] >= p.bid;
  const deltas = pts.map((x, ti) => (ti !== bidders ? x : p.bid === SMUDGE ? (made ? SMUDGE : -SMUDGE) : made ? x : -p.bid));
  lines.push(
    made
      ? `${teamName(g, s, bidders)} ${p.bid === SMUDGE ? 'made smudge' : `bid ${p.bid}, made ${pts[bidders]}`}`
      : `${teamName(g, s, bidders)} bid ${pitchLabel(p.bid)}, made ${pts[bidders]}: set back ${p.bid}`,
  );
  return { deltas, lines, made };
}

/** Rough worth of a hand bid on its best suit: High, Low, Jack, and a share of Game. */
export function pitchStrength(cards: string[]): { suit: Suit; worth: number } {
  let best = { suit: 'S' as Suit, worth: -1 };
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    const mine = cards.map(parseCard).filter((c) => c.suit === suit);
    if (!mine.length) continue;
    const ranks = mine.map((c) => c.rank);
    let worth = 0;
    const top = Math.max(...ranks);
    worth += top === 14 ? 1 : top === 13 ? 0.7 : top === 12 ? 0.4 : 0;
    const bottom = Math.min(...ranks);
    worth += bottom === 2 ? 0.9 : bottom === 3 ? 0.6 : bottom <= 5 ? 0.3 : 0;
    if (ranks.includes(11)) worth += mine.length >= 3 || ranks.some((r) => r > 11) ? 0.8 : 0.4;
    worth += Math.min(1, mine.length * 0.15 + (ranks.includes(10) ? 0.3 : 0));
    if (worth > best.worth) best = { suit, worth };
  }
  return best;
}

/** The bot's bid: what its best suit should make, a bit more with a partner; pass under two. */
export function botPitchBid(g: TrickGame, s: S, seat: number): Action {
  const est = pitchStrength(ids(hand(s, seat))).worth + (teamsFor(g, s.players.length)[teamOf(g, s, seat)].length > 1 ? 0.5 : 0);
  const options = pitchBids(s, seat);
  const want = Math.min(4, Math.floor(est + 0.35));
  const bid = options.filter((b) => b <= want).pop();
  if (bid != null) return { type: 'pitchBid', amount: bid };
  return forcedDealer(s, seat) ? { type: 'pitchBid', amount: 2 } : { type: 'decline' };
}

/** The pitcher's first lead: the top card of their best suit (it names trumps). */
export function botPitchLead(s: S, seat: number): string {
  const cards = ids(hand(s, seat));
  const { suit } = pitchStrength(cards);
  return cards.filter((c) => parseCard(c).suit === suit).sort((a, b) => parseCard(b).rank - parseCard(a).rank)[0];
}
