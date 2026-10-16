import { buildDeck, parseCard, rankLabel } from '../cards';
import { createState, deal, hand, ids, log, moveCards, name, placesFromScores, resetDeck, zone } from '../state';
import { botBudget, botLevel, dealUnseen, easyMove, fork, playOut, type SearchGame, searchMove } from '../bots/search';
import { familyRules, assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';
import { ownOnly } from '../redact';
/** This family's settings in game.json (generated from the schema). */
export type { ClimbingRules } from '../schema.gen';

export interface ClimbingData {
  handNo: number;
  points: number[];
  /** Titles from the last hand (by seat). */
  titles: (string | null)[];
  /** Seats in the order they went out this hand. */
  finished: number[];
  /**
   * Turn order. Players reseat by rank after each hand (President, Vice-President, … Scum, then
   * round to the President again); phones can't move, so the order of play does instead.
   */
  order?: number[];
  /** The play to beat: how many cards and their rank. */
  top: { count: number; rank: number } | null;
  /** Who made the play to beat. */
  last: number | null;
  /** Who has passed since the last play. */
  passed: boolean[];
  /** Cards to give back in the exchange: giver → receiver and how many (cleared once given). */
  owed: { from: number; to: number; count: number }[];
  /** Cards just received (highlighted; redacted to the owner). */
  received: string[][];
  result: { lines: string[] } | null;
}

type S = GameState<ClimbingData>;

/** The pack, to count what's still out. */
const DECK = buildDeck({});

/** 3 lowest … A, 2 highest. */
export const climbRank = (id: string) => {
  const r = parseCard(id).rank;
  return r === 2 ? 15 : r;
};
const rankName = (r: number) => rankLabel(r === 15 ? 2 : r);
const playName = (count: number, rank: number) => (count === 1 ? `a ${rankName(rank)}` : `${['', '', 'two', 'three', 'four'][count]} ${rankName(rank)}s`);

/** Title for a finishing place among `n` players. */
export function titleFor(place: number, n: number): string {
  if (place === 0) return 'President';
  if (place === n - 1) return 'Scum';
  if (n >= 4 && place === 1) return 'Vice-President';
  if (n >= 4 && place === n - 2) return 'Vice-Scum';
  return 'Citizen';
}
const POINTS: Record<string, number> = { President: 2, 'Vice-President': 1 };

export function climbingFamily(config: GameConfig): GameModule<ClimbingData> {
  const R = familyRules(config, 'climbing');
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const inPlay = (s: S, seat: number) => hand(s, seat).cards.length > 0;
  /** The next seat in play order (by rank after the first hand), skipping any `skip` says. */
  const nextInOrder = (s: S, seat: number, skip: (x: number) => boolean = () => false) => {
    const order = s.data.order ?? s.players.map((p) => p.seat);
    const k = order.indexOf(seat);
    for (let i = 1; i <= order.length; i++) {
      const x = order[(k + i) % order.length];
      if (!skip(x)) return x;
    }
    return seat;
  };
  const nextIn = (s: S, seat: number) => nextInOrder(s, seat, (x) => !inPlay(s, x));
  const byRank = (cards: string[]) => {
    const m = new Map<number, string[]>();
    for (const c of cards) m.set(climbRank(c), [...(m.get(climbRank(c)) ?? []), c]);
    return m;
  };

  function sortHand(s: S, seat: number) {
    hand(s, seat).cards.sort((a, b) => climbRank(a.id) - climbRank(b.id) || a.id.localeCompare(b.id));
  }

  /** Cards that could start a legal play now (any card when leading). */
  function playable(s: S, seat: number): string[] {
    const cards = ids(hand(s, seat));
    const top = s.data.top;
    if (!top) return cards;
    return [...byRank(cards)].filter(([r, cs]) => r > top.rank && cs.length >= top.count).flatMap(([, cs]) => cs);
  }

  function startHand(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, config);
    // deal everything, starting left of the dealer (some get one more)
    let seat = nextInOrder(s, s.dealer);
    while (zone(s, 'deck').cards.length) {
      deal(s, [{ to: 'hand', count: 1 }], [seat]);
      seat = nextInOrder(s, seat);
    }
    s.players.forEach((_, i) => sortHand(s, i));
    d.handNo++;
    d.finished = [];
    d.top = null;
    d.last = null;
    d.passed = s.players.map(() => false);
    d.received = s.players.map(() => []);
    d.owed = [];
    d.result = null;
    zone(s, 'pile').label = 'Lead anything';
    if (d.handNo === 1 || !d.titles.some(Boolean)) {
      s.phase = 'play';
      s.turn = s.players.findIndex((_, i) => ids(hand(s, i)).includes('3C'));
      log(s, `Hand ${d.handNo}: ${name(s, s.turn)} has the 3♣ and leads`);
      return;
    }
    // the exchange: the bottom hand over their best cards, the top give back any they like
    const at = (t: string) => d.titles.indexOf(t);
    const swaps: [string, string, number][] = [['Scum', 'President', 2]];
    if (n >= 4) swaps.push(['Vice-Scum', 'Vice-President', 1]);
    for (const [low, high, count] of swaps) {
      const from = at(low);
      const to = at(high);
      if (from < 0 || to < 0) continue;
      const best = ids(hand(s, from)).slice(-count);
      moveCards(s, `hand:${from}`, `hand:${to}`, best);
      d.received[to] = best;
      log(s, `${name(s, from)} (${low}) hands ${count === 1 ? 'their best card' : `their ${count} best cards`} to ${name(s, to)}`, from, `Gave ${count}`, to);
      d.owed.push({ from: to, to: from, count });
    }
    s.players.forEach((_, i) => sortHand(s, i));
    s.phase = 'swap';
    s.turn = null;
  }

  function startPlay(s: S) {
    s.phase = 'play';
    const pres = s.data.titles.indexOf('President');
    s.turn = pres >= 0 ? pres : nextInOrder(s, s.dealer);
    log(s, `${name(s, s.turn)} leads`);
  }

  function clearTrick(s: S) {
    const d = s.data;
    moveCards(s, 'pile', 'cleared', ids(zone(s, 'pile')));
    const leader = inPlay(s, d.last!) ? d.last! : nextIn(s, d.last!);
    d.top = null;
    d.last = null;
    d.passed = s.players.map(() => false);
    zone(s, 'pile').label = 'Lead anything';
    s.turn = leader;
  }

  function endHand(s: S) {
    const d = s.data;
    const n = s.players.length;
    // the last one holding cards is the Scum
    for (let i = 0; i < n; i++) if (!d.finished.includes(i)) d.finished.push(i);
    d.titles = s.players.map((_, i) => titleFor(d.finished.indexOf(i), n));
    const lines = d.finished.map((seat, place) => {
      const t = titleFor(place, n);
      d.points[seat] += POINTS[t] ?? 0;
      return `${place + 1}. ${name(s, seat)} — ${t}${POINTS[t] ? ` +${POINTS[t]}` : ''}`;
    });
    lines.push(s.players.map((_, i) => `${name(s, i)} ${d.points[i]}`).join(' · '));
    d.result = { lines };
    s.turn = null;
    const best = Math.max(...d.points);
    if (best >= target(s) && d.points.filter((p) => p === best).length === 1) {
      s.winner = [d.points.indexOf(best)];
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
    // reseat by rank (the President on the Scum's left), and the Scum deals the next hand
    d.order = [...d.finished];
    lines.push(`Next hand plays in order of rank: ${d.order.map((i) => name(s, i)).join(' → ')}`);
    s.dealer = d.finished[n - 1];
  }

  // ---- bots -------------------------------------------------------------------------------

  function botPlay(s: S, seat: number): Action {
    const d = s.data;
    const cards = ids(hand(s, seat));
    const groups = [...byRank(cards)].sort((a, b) => a[0] - b[0]);
    const nearlyOut = cards.length <= 4;
    if (!d.top) {
      // lead the lowest set (keep 2s for later unless that's all that's left)
      const lead = groups.find(([r]) => r < 15) ?? groups[0];
      return { type: 'play', cards: lead[1] };
    }
    const top = d.top;
    // beat it as cheaply as possible, without breaking up a bigger set or spending 2s too early
    const options = groups.filter(([r, cs]) => r > top.rank && cs.length >= top.count);
    const exact = options.find(([r, cs]) => cs.length === top.count && (r < 15 || nearlyOut));
    const any = options.find(([r]) => r < 14 || nearlyOut);
    const pick = exact ?? (nearlyOut || top.rank >= 10 ? any : undefined);
    if (!pick) return { type: 'pass' };
    return { type: 'play', cards: pick[1].slice(0, top.count) };
  }

  /**
   * Hard's play: the usual rules, plus a good player's endgame. It counts which of its sets nobody
   * can beat now (no one else can hold that many of a higher rank, from its own cards and those
   * already played). When all but one are unbeatable, it plays those first and goes out on the
   * last, taking the lead with an unbeatable set to do it.
   */
  function hardPlay(s: S, seat: number): Action {
    const d = s.data;
    const cards = ids(hand(s, seat));
    const groups = [...byRank(cards)].sort((a, b) => a[0] - b[0]);
    const gone = new Set([...cards, ...ids(zone(s, 'cleared')), ...ids(zone(s, 'pile'))]);
    const out = new Map<number, number>();
    for (const c of DECK) if (!gone.has(c)) out.set(climbRank(c), (out.get(climbRank(c)) ?? 0) + 1);
    const boss = (rank: number, k: number) => [...out].every(([r, n]) => r <= rank || n < k);
    const plan = (gs: [number, string[]][]) => gs.filter(([r, cs]) => !boss(r, cs.length)).length <= 1;
    // the endgame: all but one set unbeatable, so play those and go out on the last
    if (!d.top) {
      if (groups.length > 1 && plan(groups)) {
        const sure = groups.find(([r, cs]) => boss(r, cs.length));
        if (sure) return { type: 'play', cards: sure[1] };
      }
      return botPlay(s, seat);
    }
    const top = d.top;
    // going out, or taking the lead with a set nobody can beat when the rest then plays out
    for (const [r, cs] of groups.filter(([x, xs]) => x > top.rank && xs.length >= top.count)) {
      const rest = groups.filter(([x]) => x !== r).concat(cs.length > top.count ? [[r, cs.slice(top.count)]] : []);
      if (!rest.length || (cs.length === top.count && boss(r, top.count) && plan(rest))) return { type: 'play', cards: cs.slice(0, top.count) };
    }
    // otherwise the usual rules
    return botPlay(s, seat);
  }

  /** Hard's give-back in the exchange: its lowest odd cards, never splitting a pair if it can help it. */
  function hardGive(s: S, seat: number, count: number): string[] {
    const groups = [...byRank(ids(hand(s, seat)))].sort((a, b) => a[1].length - b[1].length || a[0] - b[0]);
    return groups.flatMap(([, cs]) => cs).slice(0, count);
  }

  function quickBot(s: S, seat: number): Action | null {
    const d = s.data;
    if (s.phase === 'swap') {
      const owe = d.owed.find((o) => o.from === seat);
      // give back the lowest cards
      return owe ? { type: 'giveBack', cards: ids(hand(s, seat)).slice(0, owe.count) } : null;
    }
    if (s.phase === 'play' && s.turn === seat) return botPlay(s, seat);
    return null;
  }

  // the search bot: imagine the other hands, play each option out, and keep the best finishing place
  const search: SearchGame<ClimbingData> = {
    determinize(s, viewer) {
      const c = fork(s);
      dealUnseen(
        c,
        c.players.filter((p) => p.seat !== viewer).map((p) => ({ zone: `hand:${p.seat}` })),
      );
      return c;
    },
    candidates(s, seat) {
      const top = s.data.top;
      const groups = [...byRank(ids(hand(s, seat)))];
      // leading: any rank, as one card up to the whole set; following: each rank that beats the play
      const moves: Action[] = top
        ? groups.filter(([r, cs]) => r > top.rank && cs.length >= top.count).map(([, cs]) => ({ type: 'play', cards: cs.slice(0, top.count) }))
        : groups.flatMap(([, cs]) => cs.map((_, k) => ({ type: 'play', cards: cs.slice(0, k + 1) })));
      if (top) moves.push({ type: 'pass' });
      return moves;
    },
    apply: (s, seat, a) => module.apply(s, seat, a),
    rollout: (s) => playOut(module, quickBot, s, (x) => x.phase !== 'play'),
    // finishing earlier is better: President 0 … Scum −(n−1)
    score: (_, after, seat) => {
      const place = after.data.finished.indexOf(seat);
      return -(place < 0 ? after.players.length : place);
    },
  };

  // (Hard: everyone in its imagined playouts plays as it does)
  const hardSearch: SearchGame<ClimbingData> = {
    ...search,
    rollout: (s) =>
      playOut(
        module,
        (x, seat) => (x.phase === 'play' && x.turn === seat ? hardPlay(x, seat) : quickBot(x, seat)),
        s,
        (x) => x.phase !== 'play',
      ),
  };

  const module: GameModule<ClimbingData> = {
    config,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<ClimbingData>(config, players, seed, options, {
        handNo: 0,
        points: players.map(() => 0),
        titles: players.map(() => null),
        finished: [],
        top: null,
        last: null,
        passed: [],
        owed: [],
        received: [],
        result: null,
      });
      s.dealer = players.length - 1;
      startHand(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase === 'swap') {
        const owe = d.owed.find((o) => o.from === seat);
        if (!owe) return [];
        return [
          {
            type: 'giveBack',
            label: `Give ${owe.count} to ${name(s, owe.to)}`,
            style: 'primary',
            select: { min: owe.count, max: owe.count, cards: ids(hand(s, seat)) },
          },
        ];
      }
      if (s.phase !== 'play' || s.turn !== seat) return [];
      const out: ActionSpec[] = [
        { type: 'play', label: 'Play', style: 'primary', quick: 'swipe', select: { min: d.top?.count ?? 1, max: d.top?.count ?? 4, cards: playable(s, seat) } },
      ];
      if (d.top) out.push({ type: 'pass', label: 'Pass', style: 'quiet' });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'handOver', 'Hand in progress');
          return startHand(s);
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.points = d.points.map(() => 0);
          d.titles = d.titles.map(() => null);
          d.order = undefined;
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
        case 'giveBack': {
          const i = d.owed.findIndex((o) => o.from === seat);
          assertRule(s.phase === 'swap' && i >= 0, 'Nothing to give back');
          const owe = d.owed[i];
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(
            cards.length === owe.count && new Set(cards).size === cards.length && cards.every((c) => own.includes(c)),
            `Choose ${owe.count} card${owe.count > 1 ? 's' : ''} to give back`,
          );
          moveCards(s, `hand:${seat}`, `hand:${owe.to}`, cards);
          d.received[owe.to] = cards;
          d.received[seat] = [];
          sortHand(s, owe.to);
          d.owed.splice(i, 1);
          log(s, `${who} gives ${owe.count === 1 ? 'a card' : `${owe.count} cards`} back to ${name(s, owe.to)}`, seat, `Gave ${owe.count}`, owe.to);
          if (!d.owed.length) startPlay(s);
          return;
        }
      }
      assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'play': {
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(
            cards.length >= 1 && cards.length <= 4 && new Set(cards).size === cards.length && cards.every((c) => own.includes(c)),
            'Choose cards from your hand',
          );
          const rank = climbRank(cards[0]);
          assertRule(
            cards.every((c) => climbRank(c) === rank),
            'Play cards of one rank',
          );
          if (d.top) {
            assertRule(cards.length === d.top.count, `Play ${d.top.count === 1 ? 'one card' : `${d.top.count} cards`}`);
            assertRule(rank > d.top.rank, `Play higher than ${playName(d.top.count, d.top.rank)}`);
          }
          moveCards(s, 'pile', 'cleared', ids(zone(s, 'pile')));
          moveCards(s, `hand:${seat}`, 'pile', cards, { up: true, by: seat });
          d.top = { count: cards.length, rank };
          d.last = seat;
          d.passed = s.players.map(() => false);
          d.received[seat] = [];
          zone(s, 'pile').label = 'To beat';
          log(s, `${who} plays ${playName(cards.length, rank)}`, seat, cards.length === 1 ? rankName(rank) : `${cards.length}× ${rankName(rank)}`);
          if (!inPlay(s, seat)) {
            d.finished.push(seat);
            log(s, `${who} is out — ${titleFor(d.finished.length - 1, s.players.length)}!`, seat, 'Out!');
            if (s.players.filter((_, i) => inPlay(s, i)).length <= 1) return endHand(s);
          }
          // nobody left to answer: the pile is cleared
          const others = s.players.map((_, i) => i).filter((i) => i !== seat && inPlay(s, i));
          if (!others.length) return clearTrick(s);
          s.turn = nextIn(s, seat);
          return;
        }
        case 'pass': {
          assertRule(d.top, 'You’re leading — play something');
          d.passed[seat] = true;
          log(s, `${who} passes`, seat, 'Pass');
          const waiting = s.players.map((_, i) => i).filter((i) => i !== d.last && inPlay(s, i) && !d.passed[i]);
          if (!waiting.length) {
            log(s, `Everyone passed — ${name(s, d.last!)} leads again`, d.last!, 'Leads');
            return clearTrick(s);
          }
          s.turn = nextIn(s, seat);
          return;
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    redactData(s, viewer) {
      return { ...s.data, received: ownOnly(s.data.received, viewer) };
    },

    bot(s, seat) {
      const budget = botBudget(s.options);
      if (botLevel(s.options) === 2) {
        const owe = s.data.owed.find((o) => o.from === seat);
        if (s.phase === 'swap' && owe) return { type: 'giveBack', cards: hardGive(s, seat, owe.count) };
        if (s.phase === 'play' && s.turn === seat) return searchMove(hardSearch, s, seat, budget!, hardPlay(s, seat)) ?? hardPlay(s, seat);
      }
      if (s.phase === 'play' && s.turn === seat)
        return budget
          ? (searchMove(search, s, seat, budget, quickBot(s, seat)) ?? quickBot(s, seat))
          : easyMove(s.options, search.candidates(s, seat), quickBot(s, seat));
      return quickBot(s, seat);
    },

    standings(s) {
      return placesFromScores(s.data.points);
    },

    status(s, viewer) {
      const d = s.data;
      const turnName = s.turn != null ? name(s, s.turn) : '';
      let headline = '';
      if (s.phase === 'swap') {
        const owe = d.owed.find((o) => o.from === viewer);
        headline = owe ? `Give ${owe.count} card${owe.count > 1 ? 's' : ''} back to ${name(s, owe.to)}` : 'Swapping cards…';
      } else if (s.phase === 'play') {
        if (s.turn === viewer) headline = d.top ? `Beat ${playName(d.top.count, d.top.rank)}, or pass` : 'Your lead — play a card or a set';
        else headline = `${turnName} to play`;
      } else if (s.phase === 'handOver') headline = 'Hand over';
      else if (s.phase === 'gameOver') headline = 'Game over';
      const place = (i: number) => d.finished.indexOf(i);
      return {
        headline,
        seats: s.players.map((_, i) => ({
          badge: [
            place(i) >= 0 && s.phase === 'play' ? `Out · ${titleFor(place(i), s.players.length)}` : (d.titles[i] ?? ''),
            s.phase === 'play' && d.passed[i] ? 'Passed' : '',
            `${d.points[i]} pts`,
          ]
            .filter(Boolean)
            .join(' · '),
          tag: d.titles[i] === 'President' ? '★' : undefined,
        })),
        scoreboard: {
          columns: ['Title', 'Points'],
          rows: s.players.map((p, i) => ({ name: p.name, values: [d.titles[i] ?? '–', d.points[i]], highlight: s.winner?.includes(i) })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${name(s, s.winner![0])} wins!`, lines: d.result?.lines ?? [] }
            : s.phase === 'handOver'
              ? { title: 'Hand over', lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
  return module;
}
