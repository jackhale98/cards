import { buildDeck, cardLabel, cardName, parseCard } from '../cards';
import { nextRandom } from '../rng';
import { describeShow, pegPoints, pipValue, scoreHand } from '../lib/cribbageScore';
import {
  createState,
  cutForDeal,
  deal,
  hand,
  ids,
  log,
  moveCards,
  moveTop,
  name,
  nextSeat,
  placesFromScores,
  resetDeck,
  seatOrderFrom,
  sortHand,
  zone,
} from '../state';
import { botBudget, dealUnseen, easyMove, edge, fork, playOut, type SearchGame, searchMove, shuffled } from '../bots/search';
import { familyRules, assertRule, type Action, type GameConfig, type GameModule, type GameState } from '../types';
import { acrossTeams, sideName, soloTeams, teamIndex } from '../lib/teams';
/** This family's settings in game.json (generated from the schema). */
export type { CribbageRules } from '../schema.gen';

export interface CribData {
  /** Per team (one team per player except in 4-player partnerships). */
  scores: number[];
  /** The back peg: each team's score before its latest points. */
  prev: number[];
  handNo: number;
  /** Cards each seat chose for the crib (redacted to the owner). */
  discards: (string[] | null)[];
  /** The 4 cards each seat kept (redacted to the owner until the show). */
  kept: string[][];
  count: number;
  lastPlayer: number | null;
  /** Seats that have said "go" since the count last reset. */
  goes: boolean[];
  /** Show step: 0… players in order (dealer last), then the crib. */
  showStep: number;
  /**
   * Counting your own hands (muggins option): the hand being counted, the points claimed
   * (null until announced), and which opponents have accepted the count.
   */
  claim?: { seat: number; crib: boolean; points: number | null; accepted: boolean[] } | null;
  result: { lines: string[] } | null;
}

type S = GameState<CribData>;

const LAYOUT: Record<number, { deal: number; discard: number; fromDeck: number }> = {
  2: { deal: 6, discard: 2, fromDeck: 0 },
  3: { deal: 5, discard: 1, fromDeck: 1 },
  4: { deal: 5, discard: 1, fromDeck: 0 },
};

export function cribbageFamily(config: GameConfig): GameModule<CribData> {
  const R = familyRules(config, 'cribbage');
  const target = (s: S) => Number(s.options.target ?? R.target);
  // four play as partners, sitting opposite
  const teamsFor = (n: number) => (n === 4 ? acrossTeams(n) : soloTeams(n));
  const teamOf = (s: S, seat: number) => teamIndex(teamsFor(s.players.length), seat);
  const teamName = (s: S, team: number) => sideName(s, teamsFor(s.players.length)[team]);
  const layout = (s: S) => LAYOUT[s.players.length];
  const pone = (s: S) => nextSeat(s, s.dealer);
  const canPlay = (s: S, seat: number) => ids(hand(s, seat)).some((c) => s.data.count + pipValue(c) <= 31);
  const showOrder = (s: S) => seatOrderFrom(s, s.dealer + 1); // pone first, dealer last
  const selfCount = (s: S) => !!s.options.muggins;
  /** Seats that check a count: everyone not on the counting player's side. */
  const checkers = (s: S, seat: number) => s.players.map((_, i) => i).filter((i) => teamOf(s, i) !== teamOf(s, seat));
  const starterOf = (s: S) => zone(s, 'starter').cards[0].id;
  /** The cards being counted right now and what they're truly worth. */
  function claimTruth(s: S) {
    const c = s.data.claim!;
    const cards = c.crib ? ids(zone(s, 'cribShow')) : s.data.kept[c.seat];
    return scoreHand(cards, starterOf(s), c.crib);
  }

  /** Peg points for a seat's side. Returns true if that won the game. */
  function peg(s: S, seat: number, points: number, why: string, short?: string): boolean {
    const d = s.data;
    if (points <= 0) return false;
    const t = teamOf(s, seat);
    d.prev[t] = d.scores[t];
    d.scores[t] = Math.min(target(s), d.scores[t] + points);
    log(s, `${name(s, seat)}: ${why}`, seat, short ?? `+${points}`);
    if (d.scores[t] >= target(s)) {
      s.winner = teamsFor(s.players.length)[t];
      s.phase = 'gameOver';
      s.turn = null;
      // a loser short of 91 (in a game to 121) is skunked; short of 61, double skunked
      const skunk = (sc: number) => (target(s) === 121 && sc < 61 ? ' — double skunk' : target(s) === 121 && sc < 91 ? ' — skunked' : '');
      d.result = {
        lines: [
          `${teamName(s, t)} ${teamsFor(s.players.length)[t].length > 1 ? 'reach' : 'reaches'} ${target(s)}!`,
          ...d.scores.map((sc, i) => `${teamName(s, i)}: ${sc}${i === t ? '' : skunk(sc)}`),
        ],
      };
      return true;
    }
    return false;
  }

  function startHand(s: S) {
    const d = s.data;
    resetDeck(s, config);
    deal(s, [{ to: 'hand', count: layout(s).deal }]);
    s.players.forEach((_, i) => sortHand(s, i, { aceLow: true }));
    zone(s, 'crib').label = `${name(s, s.dealer)}'s crib`;
    d.discards = s.players.map(() => null);
    d.kept = s.players.map(() => []);
    d.count = 0;
    d.lastPlayer = null;
    d.goes = s.players.map(() => false);
    d.showStep = 0;
    d.result = null;
    d.handNo++;
    zone(s, 'pegging').label = 'Count 0';
    s.phase = 'discard';
    s.turn = null;
  }

  /** Whose turn it is next in the pegging, or the end of a sequence / the pegging. */
  function advance(s: S, from: number) {
    const d = s.data;
    const n = s.players.length;
    for (let i = 1; i <= n; i++) {
      const seat = (from + i) % n;
      if (!hand(s, seat).cards.length) continue;
      if (canPlay(s, seat) || !d.goes[seat]) {
        s.turn = seat; // either plays, or must say "go"
        return;
      }
    }
    endSequence(s);
  }

  /** Nobody can play: last card / go scores 1 (unless it was 31), the count starts again. */
  function endSequence(s: S) {
    const d = s.data;
    const last = d.lastPlayer!;
    if (d.count !== 31) {
      const anyLeft = s.players.some((_, i) => hand(s, i).cards.length);
      if (peg(s, last, 1, anyLeft ? 'go for 1' : 'last card for 1', anyLeft ? 'Go +1' : 'Last card +1')) return;
    }
    for (const c of [...zone(s, 'pegging').cards]) moveCards(s, 'pegging', `played:${c.by}`, [c.id], { up: true, by: c.by });
    d.count = 0;
    d.goes = d.goes.map(() => false);
    zone(s, 'pegging').label = 'Count 0';
    if (s.players.every((_, i) => !hand(s, i).cards.length)) return startShow(s);
    // the player after the last to play leads the next count
    s.turn = null;
    advance(s, last);
  }

  function startShow(s: S) {
    s.phase = 'show';
    s.turn = null;
    s.data.showStep = 0;
  }

  /** Count the next hand in the show (pone first, dealer, then the crib). */
  function showNext(s: S) {
    const d = s.data;
    const order = showOrder(s);
    const starter = zone(s, 'starter').cards[0].id;
    // put the previously shown hand away
    for (const z of Object.values(s.zones)) if ((z.base === 'show' || z.id === 'cribShow') && z.cards.length) moveCards(s, z.id, 'done', ids(z));
    const lines = d.result?.lines ?? [];
    if (d.showStep < order.length) {
      const seat = order[d.showStep];
      const cards = d.kept[seat];
      moveCards(s, `played:${seat}`, `show:${seat}`, cards, { up: true });
      zone(s, `show:${seat}`).label = `${name(s, seat)}'s hand`;
      d.showStep++;
      if (selfCount(s)) return askCount(s, seat, false);
      const sc = scoreHand(cards, starter, false);
      lines.push(`${name(s, seat)}: ${describeShow(sc)}`);
      d.result = { lines };
      if (!sc.total) log(s, `${name(s, seat)}: ${describeShow(sc)}`, seat, '19 (nothing)');
      else peg(s, seat, sc.total, `hand counts ${describeShow(sc)}`, `${sc.total} in hand`);
      return;
    }
    // the crib, for the dealer
    const crib = ids(zone(s, 'crib'));
    moveCards(s, 'crib', 'cribShow', crib, { up: true });
    zone(s, 'cribShow').label = `${name(s, s.dealer)}'s crib`;
    d.showStep++;
    if (selfCount(s)) return askCount(s, s.dealer, true);
    const sc = scoreHand(crib, starter, true);
    lines.push(`${name(s, s.dealer)}'s crib: ${describeShow(sc)}`);
    d.result = { lines };
    if (sc.total && peg(s, s.dealer, sc.total, `crib counts ${describeShow(sc)}`, `Crib ${sc.total}`)) return;
    if (!sc.total) log(s, `${name(s, s.dealer)}'s crib: ${describeShow(sc)}`, s.dealer, 'Crib 19');
    s.phase = 'roundOver';
  }

  // ---- counting your own hands (muggins) ---------------------------------------------------

  function askCount(s: S, seat: number, crib: boolean) {
    s.data.claim = { seat, crib, points: null, accepted: s.players.map(() => false) };
    s.phase = 'count';
    s.turn = seat;
  }

  /**
   * Settle a count: `call` is what an opponent said it's really worth (undefined = everyone
   * accepted). Pegs the counting player first, then the caller.
   */
  function settle(s: S, caller?: number, call?: number) {
    const d = s.data;
    const c = d.claim!;
    const claimed = c.points!;
    const truth = claimTruth(s);
    const T = truth.total;
    const what = c.crib ? `${name(s, c.seat)}'s crib` : `${name(s, c.seat)}'s hand`;
    const lines = d.result?.lines ?? [];
    let own = claimed;
    let theirs = 0;
    let note = '';
    if (caller != null && call != null) {
      const under = call > claimed;
      const right = under ? T > claimed : T < claimed;
      // any call means the cards get checked, so an overcount is always cut back
      own = Math.min(claimed, T);
      if (right) {
        theirs = under ? Math.min(call, T) - claimed : claimed - Math.max(call, T);
        note = `${name(s, caller)}: muggins! ${what} is worth ${T}, not ${claimed} — ${name(s, caller)} takes ${theirs}`;
      } else {
        own += Math.abs(call - claimed);
        note = `${name(s, caller)} called muggins for ${call}, but ${what} ${T === claimed ? `is worth ${claimed}` : `is worth ${T}`} — ${name(s, c.seat)} gets ${Math.abs(call - claimed)} penalty`;
      }
    } else if (claimed !== T) {
      note = `${what} was really worth ${T} (${claimed > T ? 'overcounted' : 'missed points'}, nobody called it)`;
    }
    lines.push(`${what}: ${describeShow(truth)}${claimed !== T ? ` — counted ${claimed}` : ''}`);
    if (note) lines.push(note);
    d.result = { lines };
    d.claim = null;
    s.phase = 'show';
    s.turn = null;
    if (note) log(s, note, caller ?? c.seat, caller != null ? `Muggins ${theirs ? '+' + theirs : '✗'}` : undefined);
    if (own > 0 && peg(s, c.seat, own, `${c.crib ? 'crib' : 'hand'} ${own}`, c.crib ? `Crib ${own}` : `${own} in hand`)) return;
    if (theirs > 0 && peg(s, caller!, theirs, `muggins ${theirs}`, `Muggins +${theirs}`)) return;
    if (c.crib) s.phase = 'roundOver';
  }

  // ---- bots -------------------------------------------------------------------------------

  /**
   * The best cards to throw to the crib: the kept hand's average over every possible starter, plus
   * (or minus, for an opponent's crib) what the throw is worth to the crib. With `samples`, the crib
   * is valued by imagining the other cards that go in and the starter; without, by rule of thumb.
   */
  function botDiscard(s: S, seat: number, samples = 0): string[] {
    const cards = ids(hand(s, seat));
    const k = layout(s).discard;
    const mine = s.dealer === seat || teamOf(s, s.dealer) === teamOf(s, seat);
    const unseen = buildDeck(config.deck).filter((c) => !cards.includes(c));
    // the other crib cards and the starter, drawn once from the cards we can't see and shared by
    // every choice, so choices are compared on the same cribs (not each on its own luck)
    const more = 4 - k;
    const draws = Array.from({ length: samples }, () => shuffled([...unseen]).slice(0, more + 1));
    let best: { keep: string[]; value: number } | null = null;
    for (const drop of combos(cards, k)) {
      const keep = cards.filter((c) => !drop.includes(c));
      // average over possible starters, plus a nudge for what the discards give the crib
      let total = 0;
      for (const st of unseen) total += scoreHand(keep, st).total;
      const avg = total / unseen.length;
      // what the discards are worth to whoever owns the crib: a fifteen or a pair is 2, a five is promising
      const sum = drop.reduce((n, c) => n + pipValue(c), 0);
      const pair = drop.length === 2 && parseCard(drop[0]).rank === parseCard(drop[1]).rank;
      const fives = drop.filter((c) => pipValue(c) === 5).length;
      let cribValue = (sum === 15 ? 2 : 0) + (pair ? 2 : 0) + fives * 1.5;
      if (samples) {
        let t = 0;
        for (const pick of draws) t += scoreHand([...drop, ...pick.slice(0, more)], pick[more], true).total;
        cribValue = t / samples;
      }
      const value = avg + (mine ? 1 : -1) * cribValue;
      if (!best || value > best.value) best = { keep, value };
    }
    return cards.filter((c) => !best!.keep.includes(c));
  }

  function botPeg(s: S, seat: number): string {
    const d = s.data;
    const seq = ids(zone(s, 'pegging'));
    const legal = ids(hand(s, seat)).filter((c) => d.count + pipValue(c) <= 31);
    const rate = (c: string) => {
      const after = d.count + pipValue(c);
      let v = pegPoints([...seq, c]).points * 10;
      if (after === 5 || after === 21) v -= 4; // easy 15 / 31 for the next player
      if (!seq.length && pipValue(c) === 5) v -= 3; // never lead a five
      if (!seq.length) v -= pipValue(c) * 0.2; // lead low
      if (after > 15 && after < 21) v += 0.5;
      return v + Math.random() * 0.5;
    };
    return legal.sort((a, b) => rate(b) - rate(a))[0];
  }

  function quickBot(s: S, seat: number): Action | null {
    if (s.phase === 'discard' && !s.data.discards[seat]) return { type: 'crib', cards: botDiscard(s, seat) };
    const c = s.data.claim;
    if (s.phase === 'count' && c) {
      // bots count their own cards correctly, and check everyone else's
      if (c.points == null) return c.seat === seat ? { type: 'count', amount: claimTruth(s).total } : null;
      if (!checkers(s, c.seat).includes(seat) || c.accepted[seat]) return null;
      const T = claimTruth(s).total;
      return T === c.points ? { type: 'accept' } : { type: 'muggins', amount: T };
    }
    if (s.turn !== seat) return null;
    if (s.phase === 'cut') return { type: 'cut' };
    if (s.phase === 'peg') return canPlay(s, seat) ? { type: 'play', cards: [botPeg(s, seat)] } : { type: 'go' };
    return null;
  }

  // the search bot (pegging): imagine the others' cards, play each card out to the end of the play
  const search: SearchGame<CribData> = {
    determinize(s, viewer) {
      const c = fork(s);
      dealUnseen(c, [
        ...c.players.filter((p) => p.seat !== viewer).map((p) => ({ zone: `hand:${p.seat}` })),
        { zone: 'crib', fixed: c.data.discards[viewer] ?? [] },
        { zone: 'deck' },
      ]);
      return c;
    },
    candidates(s, seat) {
      const legal = ids(hand(s, seat)).filter((c) => s.data.count + pipValue(c) <= 31);
      return legal.length ? legal.map((c) => ({ type: 'play', cards: [c] })) : [{ type: 'go' }];
    },
    apply: (s, seat, a) => module.apply(s, seat, a),
    rollout: (s) => playOut(module, quickBot, s, (x) => x.phase !== 'peg'),
    score: (before, after, seat) => edge(before.data.scores, after.data.scores, teamOf(before, seat)),
  };

  const module: GameModule<CribData> = {
    config,
    botLevels: true,

    setup(players, seed, options) {
      assertRule(LAYOUT[players.length], 'Cribbage is for 2, 3 or 4 players');
      const teams = teamsFor(players.length).length;
      const s = createState<CribData>(config, players, seed, options, {
        scores: Array(teams).fill(0),
        prev: Array(teams).fill(0),
        handNo: 0,
        discards: [],
        kept: [],
        count: 0,
        lastPlayer: null,
        goes: [],
        showStep: 0,
        result: null,
      });
      s.dealer = cutForDeal(s); // low card deals
      startHand(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'discard') {
        if (d.discards[seat]) return [];
        const k = layout(s).discard;
        return [
          {
            type: 'crib',
            label: `To ${s.dealer === seat ? 'your' : name(s, s.dealer) + "'s"} crib`,
            style: 'primary',
            select: { min: k, max: k, cards: ids(hand(s, seat)) },
          },
        ];
      }
      if (s.phase === 'cut' && s.turn === seat) return [{ type: 'cut', label: 'Cut the deck', style: 'primary', zone: 'deck' }];
      if (s.phase === 'peg' && s.turn === seat) {
        const legal = ids(hand(s, seat)).filter((c) => d.count + pipValue(c) <= 31);
        if (!legal.length) return [{ type: 'go', label: 'Go', style: 'primary' }];
        return [{ type: 'play', label: 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legal } }];
      }
      if (s.phase === 'count' && d.claim) {
        const c = d.claim;
        const what = c.crib ? 'crib' : 'hand';
        if (c.points == null && seat === c.seat)
          return [
            {
              type: 'count',
              label: `Count ${c.crib ? 'your crib' : 'your hand'}`,
              style: 'primary',
              amount: { min: 0, max: 29, step: 1, default: 0, label: `points in your ${what}` },
            },
          ];
        if (c.points != null && checkers(s, c.seat).includes(seat) && !c.accepted[seat])
          return [
            { type: 'accept', label: `Accept ${c.points}`, style: 'primary' },
            { type: 'muggins', label: 'Muggins!', amount: { min: 0, max: 29, step: 1, default: c.points, label: `what the ${what} is really worth` } },
          ];
        return [];
      }
      if (s.phase === 'roundOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      return [];
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'crib': {
          assertRule(s.phase === 'discard' && !d.discards[seat], 'Not discarding now');
          const k = layout(s).discard;
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(
            cards.length === k && new Set(cards).size === k && cards.every((c) => own.includes(c)),
            `Choose ${k} card${k > 1 ? 's' : ''} for the crib`,
          );
          d.discards[seat] = cards;
          log(s, `${who} puts ${k} card${k > 1 ? 's' : ''} in the crib`, seat, 'To crib', undefined, { to: 'crib' });
          if (d.discards.every(Boolean)) {
            d.discards.forEach((cards, i) => {
              moveCards(s, `hand:${i}`, 'crib', cards!);
              d.kept[i] = ids(hand(s, i));
            });
            if (layout(s).fromDeck) moveTop(s, 'deck', 'crib', layout(s).fromDeck);
            s.phase = 'cut';
            s.turn = pone(s);
          }
          return;
        }
        case 'cut': {
          assertRule(s.phase === 'cut' && s.turn === seat, 'Not your cut');
          // cut somewhere in the middle of the deck, then turn up the starter
          const deck = zone(s, 'deck').cards;
          const at = Math.floor(deck.length * (0.2 + 0.6 * nextRandom(s)));
          const [cut] = deck.splice(at, 1);
          deck.push(cut);
          moveTop(s, 'deck', 'starter', 1, { up: true });
          const starter = zone(s, 'starter').cards[0].id;
          log(s, `${who} cuts: the ${cardName(starter)}`, seat, cardLabel(starter), undefined, { from: 'deck' });
          s.phase = 'peg';
          s.turn = null;
          if (parseCard(starter).rank === 11 && peg(s, s.dealer, 2, 'his heels for 2 (jack turned up)', 'His heels +2')) return;
          s.turn = pone(s);
          return;
        }
        case 'play': {
          assertRule(s.phase === 'peg' && s.turn === seat, 'Not your turn');
          const card = a.cards?.[0];
          assertRule(card && ids(hand(s, seat)).includes(card), 'Choose a card');
          assertRule(d.count + pipValue(card) <= 31, 'That would go over 31');
          moveCards(s, `hand:${seat}`, 'pegging', [card], { up: true, by: seat });
          d.count += pipValue(card);
          d.lastPlayer = seat;
          zone(s, 'pegging').label = `Count ${d.count}`;
          const { points, reasons } = pegPoints(ids(zone(s, 'pegging')));
          if (points) {
            if (peg(s, seat, points, `${cardLabel(card)} makes ${d.count}: ${reasons.join(', ')}`, `${d.count}: +${points}`)) return;
          } else log(s, `${who} plays ${cardLabel(card)} — ${d.count}`, seat, `${cardLabel(card)} · ${d.count}`);
          if (d.count === 31) return endSequence(s);
          return advance(s, seat);
        }
        case 'go':
          assertRule(s.phase === 'peg' && s.turn === seat && !canPlay(s, seat), 'You can still play');
          d.goes[seat] = true;
          log(s, `${who} says go`, seat, 'Go');
          return advance(s, seat);
        case 'count': {
          const c = d.claim;
          assertRule(s.phase === 'count' && c && c.points == null && c.seat === seat, 'Not your count');
          const pts = Math.floor(a.amount ?? -1);
          assertRule(pts >= 0 && pts <= 29, 'Count between 0 and 29');
          c.points = pts;
          s.turn = null;
          log(s, `${name(s, seat)} counts ${pts === 0 ? '19 (nothing)' : pts} in ${c.crib ? 'the crib' : 'hand'}`, seat, pts ? `${pts}?` : '19?');
          return;
        }
        case 'accept': {
          const c = d.claim;
          assertRule(s.phase === 'count' && c && c.points != null && checkers(s, c.seat).includes(seat), 'Nothing to accept');
          c.accepted[seat] = true;
          if (checkers(s, c.seat).every((i) => c.accepted[i])) settle(s);
          return;
        }
        case 'muggins': {
          const c = d.claim;
          assertRule(s.phase === 'count' && c && c.points != null && checkers(s, c.seat).includes(seat) && !c.accepted[seat], 'You can’t call muggins now');
          const call = Math.floor(a.amount ?? -1);
          assertRule(call >= 0 && call <= 29 && call !== c.points, `Say what it’s really worth (not ${c.points})`);
          return settle(s, seat, call);
        }
        case 'next':
          assertRule(s.phase === 'roundOver', 'Hand in progress');
          for (const z of Object.values(s.zones)) if (z.id !== 'deck') z.cards = [];
          s.dealer = nextSeat(s, s.dealer);
          return startHand(s);
        case 'rematch': {
          assertRule(s.phase === 'gameOver', 'Game not over');
          // the loser deals first in the next game (with partners, the losing side's next player)
          const losers = s.players.map((p) => p.seat).filter((i) => !s.winner?.includes(i));
          const low = Math.min(...losers.map((i) => d.scores[teamOf(s, i)]));
          s.dealer = seatOrderFrom(s, s.dealer + 1).find((i) => losers.includes(i) && d.scores[teamOf(s, i)] === low) ?? s.dealer;
          d.scores = d.scores.map(() => 0);
          d.prev = d.prev.map(() => 0);
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    system(s) {
      if (s.phase === 'show') return { delay: s.data.showStep === 0 ? 900 : 2600, run: showNext };
      return null;
    },

    bot(s, seat) {
      const budget = botBudget(s.options);
      if (budget && s.phase === 'discard' && !s.data.discards[seat]) return { type: 'crib', cards: botDiscard(s, seat, budget.samples) };
      if (s.phase === 'peg' && s.turn === seat)
        return budget
          ? (searchMove(search, s, seat, budget, quickBot(s, seat)) ?? quickBot(s, seat))
          : easyMove(s.options, search.candidates(s, seat), quickBot(s, seat));
      return quickBot(s, seat);
    },

    redactData(s, viewer) {
      const d = s.data;
      const shown = s.phase === 'show' || s.phase === 'roundOver' || s.phase === 'gameOver';
      return {
        ...d,
        discards: d.discards.map((x, i) => (x && i !== viewer ? [] : x)),
        kept: d.kept.map((k, i) => (i === viewer || shown ? k : [])),
      };
    },

    standings(s) {
      return placesFromScores(s.players.map((_, i) => s.data.scores[teamOf(s, i)]));
    },

    status(s, viewer) {
      const d = s.data;
      const k = layout(s).discard;
      let headline = '';
      if (s.phase === 'discard')
        headline = d.discards[viewer]
          ? 'Waiting for the others…'
          : `Choose ${k} card${k > 1 ? 's' : ''} for ${s.dealer === viewer ? 'your' : name(s, s.dealer) + "'s"} crib`;
      else if (s.phase === 'cut') headline = s.turn === viewer ? 'Tap the deck to cut' : `${name(s, s.turn!)} cuts the deck`;
      else if (s.phase === 'peg') {
        if (s.turn === viewer) headline = canPlay(s, viewer) ? `Count ${d.count} — your play` : `Count ${d.count} — you can't play: say Go`;
        else headline = `Count ${d.count} · ${name(s, s.turn!)} to play`;
      } else if (s.phase === 'show') headline = d.result?.lines.at(-1) ?? 'Counting hands…';
      else if (s.phase === 'count' && d.claim) {
        const c = d.claim;
        const what = c.crib ? `${c.seat === viewer ? 'your' : name(s, c.seat) + "'s"} crib` : `${c.seat === viewer ? 'your' : name(s, c.seat) + "'s"} hand`;
        if (c.points == null) headline = c.seat === viewer ? `Count ${what} — miss any and the others can take them` : `${name(s, c.seat)} is counting ${what}`;
        else if (checkers(s, c.seat).includes(viewer) && !c.accepted[viewer]) headline = `${name(s, c.seat)} says ${c.points} — accept, or call muggins?`;
        else
          headline = `${c.seat === viewer ? 'You say' : name(s, c.seat) + ' says'} ${c.points} · waiting for ${checkers(s, c.seat)
            .filter((i) => !c.accepted[i])
            .map((i) => name(s, i))
            .join(', ')}`;
      } else if (s.phase === 'roundOver') headline = 'Hand counted';
      else if (s.phase === 'gameOver') headline = 'Game over';

      const teams = teamsFor(s.players.length);
      let hint: string | undefined;
      if (viewer >= 0 && s.phase === 'peg' && !selfCount(s)) {
        const starter = zone(s, 'starter').cards[0]?.id;
        if (starter && d.kept[viewer]?.length) hint = `Hand worth ${scoreHand(d.kept[viewer], starter).total}`;
      }
      return {
        headline,
        hint,
        seats: s.players.map((_, i) => ({ badge: `${d.scores[teamOf(s, i)]}`, tag: i === s.dealer ? 'D' : undefined })),
        track: {
          target: target(s),
          lanes: teams.map((t, ti) => ({ label: teamName(s, ti), seat: t[0], score: d.scores[ti], prev: d.prev[ti] })),
        },
        scoreboard: {
          columns: ['Score'],
          rows: teams.map((t, ti) => ({ name: teamName(s, ti), values: [d.scores[ti]], highlight: !!s.winner && t.some((i) => s.winner!.includes(i)) })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
            : s.phase === 'roundOver'
              ? { title: 'The show', lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
  return module;
}

function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}
