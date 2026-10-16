import { deadline, now, playOut, settled, TESTING, type SearchGame } from '../../bots/search';
import { hand, ids, zone } from '../../state';
import type { Action, GameModule } from '../../types';
import { parseCard } from '../../cards';
import { quickBot } from './bots';
import { startPlay } from './deal';
import { forcedDealer, pitchBids } from './pitch';
import { solveSetback, type SetbackDeal } from './setbackSolve';
import { teamOf, teamsFor } from './sides';
import type { S, TrickData, TrickGame } from './types';

/**
 * Hard Setback's card play. For each imagined deal of the unseen cards, each card it could play is
 * followed by the quick rules until everyone is down to four cards, and the rest of the hand is
 * then solved exactly (setbackSolve.ts: everyone's best play, every card known). Four cards a
 * player solve in a few milliseconds; six don't, and the first tricks matter less to the points.
 * Once the hands are down to four, there are no quick rules at all: each deal is solved outright.
 *
 * The pitcher's first lead, which names trumps, is chosen the same way.
 */

/** Solve from here when nobody holds more than this. */
const SOLVE_AT = 4;

/** The hand as the solver takes it: every card placed, as in an imagined deal. */
export function setbackDeal(g: TrickGame, s: S, seat: number): SetbackDeal {
  const d = s.data;
  const p = d.pitch!;
  const n = s.players.length;
  const side = s.players.map((x) => teamOf(g, s, x.seat));
  const teams = teamsFor(g, n);
  const sum = (xs: number[]) => teams.map((t) => t.reduce((a, i) => a + (xs[i] ?? 0), 0));
  return {
    hands: s.players.map((x) => ids(hand(s, x.seat))),
    trump: d.trump!,
    trick: zone(s, 'trick').cards.map((c) => ({ seat: c.by!, card: c.id })),
    turn: s.turn!,
    side,
    me: side[seat],
    bidders: side[p.by!],
    bid: p.bid,
    game: sum(d.points),
    lowTo: p.lowTo == null ? -1 : side[p.lowTo],
    jackTo: p.jackTo == null ? -1 : side[p.jackTo],
    tricks: sum(d.tricks),
    highSide: p.high == null ? null : side[holder(s, p.high)],
    low: p.low,
    jack: p.jack,
    handSize: d.handSize,
  };
}

/** Who played or holds `card`. */
const holder = (s: S, card: string) => {
  const by = (s.data.played ?? []).findIndex((xs) => xs.includes(card));
  return by >= 0 ? by : s.players.findIndex((x) => ids(hand(s, x.seat)).includes(card));
};

/** The hand's points for `seat`'s side against the others', once it's over (the same measure the solver uses). */
function handEdge(g: TrickGame, before: S, after: S, seat: number): number {
  const me = teamOf(g, before, seat);
  const delta = after.data.scores.map((x, i) => x - before.data.scores[i]);
  const others = delta.filter((_, i) => i !== me);
  return delta[me] - others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
}

const small = (s: S) => s.phase === 'play' && !!s.data.trump && s.players.every((x) => hand(s, x.seat).cards.length <= SOLVE_AT);

/** The value of an imagined deal for `seat`'s side: played on by the quick rules until it's small, then solved. */
function value(g: TrickGame, module: GameModule<TrickData>, search: SearchGame<TrickData>, before: S, sim: S, seat: number): number {
  playOut(
    module,
    (x: S, k: number) => quickBot(g, x, k),
    sim,
    (x) => x.phase === 'roundOver' || x.phase === 'gameOver' || small(x),
  );
  if (small(sim)) {
    const deal = setbackDeal(g, sim, seat);
    const solved = solveSetback(deal);
    if (solved) {
      const vs = solved.map((x) => x.value);
      return deal.side[deal.turn] === deal.me ? Math.max(...vs) : Math.min(...vs);
    }
    search.rollout(sim);
  }
  return handEdge(g, before, sim, seat);
}

/** Hard Setback's card, or null to leave it to the other bots (nothing to choose). */
export function setbackCard(
  g: TrickGame,
  module: GameModule<TrickData>,
  search: SearchGame<TrickData>,
  s: S,
  seat: number,
  ms: number,
  samples = 120,
): string | null {
  const moves = search.candidates(s, seat).filter((a) => a.type === 'play');
  if (moves.length <= 1) return moves[0]?.cards?.[0] ?? null;
  const cards = moves.map((m) => m.cards![0]);
  const total = cards.map(() => 0);
  // each card's score on each deal, to tell when the answer is settled
  const scores: number[][] = cards.map(() => []);
  const stop = deadline(ms);
  // (in tests a set number of deals, so a busy machine can't change the answer)
  const max = TESTING ? Math.min(samples, 16) : samples;
  for (let runs = 0; runs < max && (TESTING || runs === 0 || now() < stop) && !(runs % 4 === 0 && settled(scores)); runs++) {
    const deal = search.determinize(s, seat);
    const solved = small(deal) ? solveSetback(setbackDeal(g, deal, seat)) : null;
    cards.forEach((c, i) => {
      let v: number;
      if (solved) {
        // down to four cards: this deal solved outright, every card at once
        v = solved.find((x) => x.card === c)!.value;
      } else {
        const sim = structuredClone(deal);
        search.apply(sim, seat, { type: 'play', cards: [c] } as Action);
        v = value(g, module, search, s, sim, seat);
      }
      total[i] += v;
      scores[i].push(v);
    });
  }
  // (ties go to the quick rules' choice: it plays like a person would)
  const usual = quickBot(g, s, seat)?.cards?.[0];
  let best = Math.max(0, cards.indexOf(usual ?? ''));
  for (let i = 0; i < cards.length; i++) if (total[i] > total[best] + 1e-9) best = i;
  return cards[best];
}

/**
 * How sure Hard must be of making a bid. Set back costs the whole bid, and the imagined deals are
 * kinder than real play (the end of each is solved with every card known), so it bids only what it
 * makes on three deals in four.
 */
const MAKE_RATE = 0.75;

/**
 * Hard Setback's bid. On imagined deals of the unseen cards, it pitches each suit it holds (its
 * top card leads), the quick rules play the first tricks and the rest is solved, once for each
 * bid it could make (the solver plays to make that bid). It bids the most it makes often enough
 * in its best suit for that bid; a dealer who must bid takes the cheapest.
 */
export function setbackBid(g: TrickGame, module: GameModule<TrickData>, search: SearchGame<TrickData>, s: S, seat: number, ms: number, samples = 40): Action {
  const options = pitchBids(s, seat);
  const cards = ids(hand(s, seat));
  const suits = [...new Set(cards.map((c) => parseCard(c).suit))];
  // made[suit][bid]: on how many deals the bid is made (a side set back scores minus the bid)
  const made = suits.map(() => options.map(() => 0));
  const count = (k: number, b: number, value: number) => {
    if (value > 0.5 - options[b]) made[k][b]++;
  };
  const stop = deadline(ms);
  const max = TESTING ? Math.min(samples, 8) : samples;
  let runs = 0;
  for (; runs < max && (TESTING || runs === 0 || now() < stop); runs++) {
    const deal = search.determinize(s, seat);
    suits.forEach((suit, k) => {
      const sim = structuredClone(deal);
      sim.data.pitch = { ...sim.data.pitch!, bid: options[0], by: seat };
      sim.data.maker = seat;
      startPlay(g, sim);
      const lead = cards.filter((c) => parseCard(c).suit === suit).sort((a, b) => parseCard(b).rank - parseCard(a).rank)[0];
      module.apply(sim, seat, { type: 'play', cards: [lead] });
      playOut(
        module,
        (x: S, i: number) => quickBot(g, x, i),
        sim,
        (x) => x.phase === 'roundOver' || x.phase === 'gameOver' || small(x),
      );
      options.forEach((bid, b) => {
        if (small(sim)) {
          const solved = solveSetback({ ...setbackDeal(g, sim, seat), bid });
          if (solved) {
            const deal2 = setbackDeal(g, sim, seat);
            const vs = solved.map((x) => x.value);
            count(k, b, deal2.side[deal2.turn] === deal2.me ? Math.max(...vs) : Math.min(...vs));
            return;
          }
        }
        // (played out by the quick rules, or nothing left to solve: score the bid as it stands)
        const end = structuredClone(sim);
        end.data.pitch!.bid = bid;
        search.rollout(end);
        count(k, b, handEdge(g, s, end, seat));
      });
    });
  }
  let best = forcedDealer(s, seat) ? options[0] : -1;
  options.forEach((bid, b) => {
    if (Math.max(...suits.map((_, k) => made[k][b])) >= MAKE_RATE * runs) best = bid;
  });
  return best < 0 ? { type: 'decline' } : { type: 'pitchBid', amount: best };
}
