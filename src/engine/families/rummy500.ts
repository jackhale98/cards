import { cardName, parseCard, rankLabel, SUIT_SYMBOL } from '../cards';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Rummy 500 (500 Rum), 2–6 players. Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "rummy", "style": "500", "end": { "target": 500 } }
 * ```
 * Deal 13 each with two players, 7 with more (two decks for five or six). Each turn: draw the top
 * of the stock, or take any card from the spread-out discard pile together with everything above
 * it (the deepest card taken must be melded this turn), then meld sets and runs, lay off on anyone's
 * melds, and discard. Every card you meld or lay off scores for you; cards left in hand count
 * against you when someone goes out. Aces are high or low (15 points, 1 in an A-2-3 run).
 * Played without jokers and without "Rummy!" calls.
 */
export interface Rummy500Rules {
  family: 'rummy';
  style: '500';
  end: { target: number };
}

/** A meld on the table. Laid-off cards join it but score for whoever laid them off. */
export interface TableMeld {
  id: number;
  /** Who laid it down (it sits in front of them). */
  owner: number;
  kind: 'set' | 'run';
  /** In display order (runs low to high). */
  cards: string[];
}

export interface Rummy500Data {
  handNo: number;
  scores: number[];
  melds: TableMeld[];
  nextMeld: number;
  /** Who scores each card on the table. */
  scoredBy: Record<string, number>;
  /** The deepest card taken from the discard pile, which must be melded before discarding. */
  mustMeld: string | null;
  /** The single top discard just taken (it can't go straight back). */
  justTook: string | null;
  /** Cards each seat just drew (highlighted; redacted to the owner). */
  received: string[][];
  result: { headline: string; lines: string[] } | null;
}

type S = GameState<Rummy500Data>;

const label = (id: string) => `${rankLabel(parseCard(id).rank)}${SUIT_SYMBOL[parseCard(id).suit]}`;
const list = (cards: string[]) => cards.map(label).join(' ');

/** Card value in hand: ace 15, faces 10, others their number. */
export function handValue(id: string): number {
  const { rank } = parseCard(id);
  return rank === 14 ? 15 : Math.min(rank, 10);
}

/** Card value in a meld: an ace in a low run (A-2-3…) counts 1. */
export function meldValue(id: string, meld: { kind: string; cards: string[] }): number {
  const { rank } = parseCard(id);
  if (rank === 14 && meld.kind === 'run' && meld.cards.some((c) => parseCard(c).rank === 2)) return 1;
  return handValue(id);
}

/**
 * Is this a valid meld? Sets: 3–4 of a rank, all different suits. Runs: 3+ consecutive in one
 * suit, ace low (A-2-3) or high (Q-K-A) but not both. Returns the cards in display order.
 */
export function asMeld(cards: string[]): { kind: 'set' | 'run'; cards: string[] } | null {
  if (cards.length < 3) return null;
  const cs = cards.map(parseCard);
  if (cs.some((c) => c.suit === 'X')) return null;
  if (cs.every((c) => c.rank === cs[0].rank)) {
    const suits = new Set(cs.map((c) => c.suit));
    return suits.size === cs.length && cs.length <= 4 ? { kind: 'set', cards } : null;
  }
  if (cs.some((c) => c.suit !== cs[0].suit)) return null;
  for (const aceLow of [false, true]) {
    const v = (r: number) => (r === 14 && aceLow ? 1 : r);
    const sorted = [...cs].sort((a, b) => v(a.rank) - v(b.rank));
    if (sorted.every((c, i) => i === 0 || v(c.rank) === v(sorted[i - 1].rank) + 1)) return { kind: 'run', cards: sorted.map((c) => c.id) };
  }
  return null;
}

/** Can `card` be melded from `pool` (which includes it), or laid off on one of `melds`? */
export function canUse(card: string, pool: string[], melds: { cards: string[] }[]): boolean {
  if (melds.some((m) => asMeld([...m.cards, card]))) return true;
  const c = parseCard(card);
  const others = pool.filter((x) => x !== card).map(parseCard);
  // a set: two more of the rank in other suits
  if (new Set(others.filter((o) => o.rank === c.rank && o.suit !== c.suit).map((o) => o.suit)).size >= 2) return true;
  // a run: a stretch of 3+ through it in its suit (an ace can sit at either end)
  const have = new Set<number>();
  for (const o of [c, ...others.filter((o) => o.suit === c.suit)]) {
    have.add(o.rank);
    if (o.rank === 14) have.add(1);
  }
  for (const start of c.rank === 14 ? [1, 14] : [c.rank]) {
    let lo = start;
    let hi = start;
    while (have.has(lo - 1)) lo--;
    while (have.has(hi + 1)) hi++;
    if (hi - lo + 1 >= 3) return true;
  }
  return false;
}

/** Melds a hand could lay down (greedy, most points first) — used by bots and hints. */
export function findMelds(cards: string[]): string[][] {
  const left = [...cards];
  const out: string[][] = [];
  for (;;) {
    const options: string[][] = [];
    const cs = left.map(parseCard);
    // sets: one card per suit
    const byRank = new Map<number, Map<string, string>>();
    for (const c of cs) {
      const m = byRank.get(c.rank) ?? new Map<string, string>();
      if (!m.has(c.suit)) m.set(c.suit, c.id);
      byRank.set(c.rank, m);
    }
    for (const m of byRank.values()) if (m.size >= 3) options.push([...m.values()]);
    // runs: maximal stretches per suit, ace low or high
    for (const suit of ['S', 'H', 'D', 'C']) {
      const inSuit = cs.filter((c) => c.suit === suit);
      for (const aceLow of [false, true]) {
        const v = (r: number) => (r === 14 && aceLow ? 1 : r);
        const byVal = new Map<number, string>();
        for (const c of inSuit) if (!byVal.has(v(c.rank))) byVal.set(v(c.rank), c.id);
        const vals = [...byVal.keys()].sort((a, b) => a - b);
        let run: number[] = [];
        for (const x of [...vals, Infinity]) {
          if (run.length && x === run[run.length - 1] + 1) run.push(x);
          else {
            if (run.length >= 3) options.push(run.map((r) => byVal.get(r)!));
            run = [x];
          }
        }
      }
    }
    if (!options.length) return out;
    const worth = (m: string[]) => m.reduce((n, c) => n + handValue(c), 0);
    const best = options.sort((a, b) => worth(b) - worth(a))[0];
    out.push(best);
    for (const c of best) left.splice(left.indexOf(c), 1);
  }
}

export function rummy500Family(config: GameConfig): GameModule<Rummy500Data> {
  const R = config.rules as unknown as Rummy500Rules;
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const pile = (s: S) => ids(zone(s, 'discard'));
  const meldOf = (s: S, card: string) => s.data.melds.find((m) => m.cards.includes(card));

  /** Discard pile cards this seat may take: the top always; a deeper one only if it can be melded. */
  function takeable(s: S, seat: number): string[] {
    const p = pile(s);
    if (!p.length) return [];
    const own = ids(hand(s, seat));
    return p.filter((c, i) => i === p.length - 1 || canUse(c, [...own, ...p.slice(i)], s.data.melds));
  }

  /** Lay each player's melds out in front of them, meld by meld. */
  function relayout(s: S) {
    s.players.forEach((_, i) => {
      const z = zone(s, `melds:${i}`);
      const mine = s.data.melds.filter((m) => m.owner === i);
      z.cards = mine.flatMap((m) => m.cards.map((id) => ({ id, up: true, group: m.id })));
    });
  }

  function startHand(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, { ...config, deck: { ...config.deck, decks: n >= 5 ? 2 : 1 } });
    const size = n === 2 ? 13 : 7;
    const first = nextSeat(s, s.dealer);
    for (let k = 0; k < size; k++) for (let i = 0; i < n; i++) moveTop(s, 'deck', `hand:${(first + i) % n}`, 1);
    moveTop(s, 'deck', 'discard', 1, { up: true });
    s.players.forEach((_, i) => sortHand(s, i));
    d.handNo++;
    d.melds = [];
    d.scoredBy = {};
    d.mustMeld = null;
    d.justTook = null;
    d.received = s.players.map(() => []);
    d.result = null;
    relayout(s);
    s.phase = 'draw';
    s.turn = first;
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals ${size} each, ${label(pile(s)[0])} turned up`, undefined, undefined, undefined, { from: 'deck' });
  }

  function sortHand(s: S, seat: number) {
    const order = (id: string) => {
      const c = parseCard(id);
      return 'SHCD'.indexOf(c.suit) * 20 + c.rank;
    };
    hand(s, seat).cards.sort((a, b) => order(a.id) - order(b.id));
  }

  function endHand(s: S, why: string) {
    const d = s.data;
    const lines: string[] = [why];
    const deltas = s.players.map((_, i) => {
      const melded = d.melds.flatMap((m) => m.cards.filter((c) => d.scoredBy[c] === i).map((c) => meldValue(c, m))).reduce((a, b) => a + b, 0);
      const left = ids(hand(s, i)).reduce((a, c) => a + handValue(c), 0);
      return { melded, left };
    });
    deltas.forEach(({ melded, left }, i) => {
      d.scores[i] += melded - left;
      const delta = melded - left;
      lines.push(`${name(s, i)}: ${melded}${left ? ` − ${left} held` : ''} = ${delta >= 0 ? '+' : ''}${delta} → ${d.scores[i]}`);
    });
    // show what everyone was left holding
    for (const z of Object.values(s.zones)) if (z.id.startsWith('hand:')) for (const c of z.cards) c.up = true;
    s.turn = null;
    d.mustMeld = null;
    const best = Math.max(...d.scores);
    const leaders = d.scores.filter((x) => x === best).length;
    if (best >= target(s) && leaders === 1) {
      s.winner = [d.scores.indexOf(best)];
      s.phase = 'gameOver';
      lines.push(`${name(s, s.winner[0])} reaches ${target(s)}!`);
    } else s.phase = 'handOver';
    d.result = { headline: why, lines };
    log(s, why);
  }

  /** After melding or discarding: out of cards ends the hand. */
  function checkOut(s: S, seat: number) {
    if (hand(s, seat).cards.length) return false;
    endHand(s, `${name(s, seat)} goes out!`);
    return true;
  }

  // ---- bots -------------------------------------------------------------------------------

  function botDraw(s: S, seat: number): Action {
    const own = ids(hand(s, seat));
    const p = pile(s);
    let best: { card: string; gain: number } | null = null;
    for (const card of takeable(s, seat)) {
      const i = p.indexOf(card);
      const taken = p.slice(i);
      const melds = findMelds([...own, ...taken]);
      const used = new Set(melds.flat());
      // points we could meld, minus the junk we'd be stuck holding
      const gain =
        melds.flat().filter((c) => taken.includes(c)).reduce((n, c) => n + handValue(c), 0) -
        taken.filter((c) => !used.has(c) && !s.data.melds.some((m) => asMeld([...m.cards, c]))).reduce((n, c) => n + handValue(c), 0) * 0.6;
      if (canUse(card, [...own, ...taken], s.data.melds) && (!best || gain > best.gain)) best = { card, gain };
    }
    if (best && best.gain > 0) return { type: 'take', cards: [best.card] };
    if (zone(s, 'deck').cards.length) return { type: 'draw' };
    return { type: 'endHand' };
  }

  function botPlay(s: S, seat: number): Action {
    const d = s.data;
    const own = ids(hand(s, seat));
    // the card taken from deep in the pile has to be used first
    if (d.mustMeld) {
      const meld = findMelds(own).find((m) => m.includes(d.mustMeld!));
      if (meld) return { type: 'meld', cards: meld };
      const onto = d.melds.find((m) => asMeld([...m.cards, d.mustMeld!]));
      if (onto) return { type: 'layoff', cards: [d.mustMeld, onto.cards[0]] };
    }
    const melds = findMelds(own);
    if (melds.length) return { type: 'meld', cards: melds[0] };
    for (const c of own) {
      const onto = d.melds.find((m) => asMeld([...m.cards, c]));
      if (onto) return { type: 'layoff', cards: [c, onto.cards[0]] };
    }
    // discard the most expensive card that isn't close to a meld
    const near = (c: string) => {
      const x = parseCard(c);
      return own.some((o) => o !== c && (parseCard(o).rank === x.rank || (parseCard(o).suit === x.suit && Math.abs(parseCard(o).rank - x.rank) <= 2)));
    };
    const options = own.filter((c) => c !== d.justTook);
    const pick = [...options].sort((a, b) => Number(near(a)) - Number(near(b)) || handValue(b) - handValue(a))[0];
    return { type: 'discard', cards: [pick] };
  }

  return {
    config,

    setup(players, seed, options) {
      const s = createState<Rummy500Data>(config, players, seed, options, {
        handNo: 0,
        scores: players.map(() => 0),
        melds: [],
        nextMeld: 1,
        scoredBy: {},
        mustMeld: null,
        justTook: null,
        received: [],
        result: null,
      });
      s.players.forEach((p, i) => (zone(s, `melds:${i}`).label = `${p.name}'s melds`));
      s.dealer = players.length - 1;
      startHand(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.turn !== seat) return [];
      const own = ids(hand(s, seat));
      if (s.phase === 'draw') {
        const out: ActionSpec[] = [];
        if (zone(s, 'deck').cards.length) out.push({ type: 'draw', label: 'Draw', style: 'primary', zone: 'deck' });
        const can = takeable(s, seat);
        if (can.length) out.push({ type: 'take', label: 'Take from the pile', select: { min: 1, max: 1, cards: can } });
        if (!zone(s, 'deck').cards.length) out.push({ type: 'endHand', label: 'End the hand', style: 'quiet' });
        return out;
      }
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [
        { type: 'meld', label: 'Meld', style: 'primary', select: { min: 3, max: own.length, cards: own } },
      ];
      const tableCards = d.melds.flatMap((m) => m.cards);
      if (tableCards.length) out.push({ type: 'layoff', label: 'Lay off', select: { min: 2, max: own.length + 1, cards: [...own, ...tableCards] } });
      if (!d.mustMeld) out.push({ type: 'discard', label: 'Discard', quick: 'swipe', select: { min: 1, max: 1, cards: own.filter((c) => c !== d.justTook) } });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'handOver', 'Hand in progress');
          s.dealer = nextSeat(s, s.dealer);
          return startHand(s);
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.scores = d.scores.map(() => 0);
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'draw': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          assertRule(zone(s, 'deck').cards.length, 'The stock is empty');
          moveTop(s, 'deck', `hand:${seat}`, 1);
          d.received[seat] = [hand(s, seat).cards.at(-1)!.id];
          d.justTook = null;
          sortHand(s, seat);
          log(s, `${who} draws from the stock`, seat, 'Drew', undefined, { from: 'deck' });
          s.phase = 'play';
          return;
        }
        case 'take': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          const card = a.cards?.[0];
          assertRule(card && takeable(s, seat).includes(card), 'You can only take a deeper card if you can meld it this turn');
          const p = pile(s);
          const taken = p.slice(p.indexOf(card));
          moveCards(s, 'discard', `hand:${seat}`, taken);
          d.received[seat] = taken;
          const deep = taken.length > 1;
          d.mustMeld = deep ? card : null;
          d.justTook = deep ? null : card;
          sortHand(s, seat);
          log(s, `${who} takes ${deep ? `${list(taken)} from the pile` : `the ${cardName(card)}`}`, seat, `Took ${taken.length > 1 ? `${taken.length} cards` : label(card)}`, undefined, { from: 'discard' });
          s.phase = 'play';
          return;
        }
        case 'endHand':
          assertRule(s.phase === 'draw' && !zone(s, 'deck').cards.length, 'There are still cards in the stock');
          return endHand(s, 'The stock is empty — the hand is over');
        case 'meld': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.every((c) => own.includes(c)) && new Set(cards).size === cards.length, 'Meld cards from your hand');
          const m = asMeld(cards);
          assertRule(m, 'That isn’t a meld: 3–4 of a rank in different suits, or 3+ in a row in one suit');
          const meld: TableMeld = { id: d.nextMeld++, owner: seat, kind: m.kind, cards: m.cards };
          d.melds.push(meld);
          moveCards(s, `hand:${seat}`, `melds:${seat}`, m.cards, { up: true, group: meld.id });
          for (const c of m.cards) d.scoredBy[c] = seat;
          if (d.mustMeld && m.cards.includes(d.mustMeld)) d.mustMeld = null;
          d.received[seat] = d.received[seat].filter((c) => !m.cards.includes(c));
          relayout(s);
          log(s, `${who} melds ${list(m.cards)}`, seat, 'Meld!');
          checkOut(s, seat);
          return;
        }
        case 'layoff': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          const onTable = cards.filter((c) => meldOf(s, c));
          const fromHand = cards.filter((c) => own.includes(c));
          assertRule(onTable.length === 1 && fromHand.length >= 1 && fromHand.length + 1 === cards.length, 'Pick cards from your hand and one card of the meld to add to');
          const meld = meldOf(s, onTable[0])!;
          const m = asMeld([...meld.cards, ...fromHand]);
          assertRule(m && m.kind === meld.kind, `Those don’t fit that meld`);
          moveCards(s, `hand:${seat}`, `melds:${meld.owner}`, fromHand, { up: true, group: meld.id });
          meld.cards = m.cards;
          for (const c of fromHand) d.scoredBy[c] = seat;
          if (d.mustMeld && fromHand.includes(d.mustMeld)) d.mustMeld = null;
          d.received[seat] = d.received[seat].filter((c) => !fromHand.includes(c));
          relayout(s);
          log(s, `${who} lays off ${list(fromHand)}${meld.owner !== seat ? ` on ${name(s, meld.owner)}'s meld` : ''}`, seat, `Laid off ${list(fromHand)}`);
          checkOut(s, seat);
          return;
        }
        case 'discard': {
          assertRule(s.phase === 'play', 'Draw first');
          assertRule(!d.mustMeld, `Meld the ${d.mustMeld ? cardName(d.mustMeld) : ''} you took first`);
          const card = a.cards?.[0];
          assertRule(card && ids(hand(s, seat)).includes(card), 'Choose a card to discard');
          assertRule(card !== d.justTook, 'You can’t throw back the card you just took');
          moveCards(s, `hand:${seat}`, 'discard', [card], { up: true });
          d.justTook = null;
          d.received[seat] = [];
          log(s, `${who} discards the ${cardName(card)}`, seat, label(card), undefined, { to: 'discard' });
          if (checkOut(s, seat)) return;
          s.phase = 'draw';
          s.turn = nextSeat(s, seat);
          return;
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    redactData(s, viewer) {
      return { ...s.data, received: s.data.received.map((r, i) => (i === viewer ? r : [])) };
    },

    bot(s, seat) {
      if (s.turn !== seat) return null;
      if (s.phase === 'draw') return botDraw(s, seat);
      if (s.phase === 'play') return botPlay(s, seat);
      return null;
    },

    standings(s) {
      return placesFromScores(s.data.scores);
    },

    status(s, viewer) {
      const d = s.data;
      const turnName = s.turn != null ? name(s, s.turn) : '';
      let headline = '';
      if (s.phase === 'draw') headline = s.turn === viewer ? 'Draw — or take from the discard pile' : `${turnName} to draw`;
      else if (s.phase === 'play')
        headline =
          s.turn === viewer
            ? d.mustMeld
              ? `Meld the ${label(d.mustMeld)} you took, then discard`
              : 'Meld or lay off, then discard'
            : `${turnName} is playing`;
      else headline = d.result?.headline ?? '';
      const meldedBy = (i: number) =>
        d.melds.flatMap((m) => m.cards.filter((c) => d.scoredBy[c] === i).map((c) => meldValue(c, m))).reduce((a, b) => a + b, 0);
      let hint: string | undefined;
      if (viewer >= 0 && (s.phase === 'draw' || s.phase === 'play')) {
        const left = ids(hand(s, viewer)).reduce((a, c) => a + handValue(c), 0);
        hint = `Melded ${meldedBy(viewer)} · holding ${left}`;
      }
      return {
        headline,
        hint,
        seats: s.players.map((_, i) => ({ badge: `${d.scores[i]} pts${meldedBy(i) && s.phase !== 'handOver' ? ` · ${meldedBy(i)} down` : ''}`, tag: i === s.dealer ? 'D' : undefined })),
        scoreboard: {
          columns: ['Melded', 'Score'],
          rows: s.players.map((p, i) => ({ name: p.name, values: [meldedBy(i), d.scores[i]], highlight: s.winner?.includes(i) })),
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
}
