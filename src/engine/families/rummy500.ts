import { cardName, cardOrJokerLabel, parseCard, rankLabel, SUIT_SYMBOL } from '../cards';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, showHands, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';
import { ownOnly } from '../redact';

/**
 * Rummy 500 (500 Rum), 2–8 players. Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "rummy", "style": "500", "end": { "target": 500 } }
 * ```
 * Deal 13 each with two players, 7 with more (two decks for five or six). Each turn: draw the top
 * of the stock, or take any card from the spread-out discard pile together with everything above
 * it (the deepest card taken must be melded this turn), then meld sets and runs, lay off on anyone's
 * melds, and discard. Every card you meld or lay off scores for you; cards left in hand count
 * against you when someone goes out. Aces are high or low (15 points, 1 in an A-2-3 run). Jokers
 * are wild (15 points) and stand for a card the player declares; it can't change afterwards. If a
 * discard leaves a card in the pile that could be melded without anyone's hand, any other player may
 * call "Rummy!" before the next draw, take it and play on from there.
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
  /** What each joker stands for: a rank (1 = a low ace in a run). */
  as?: Record<string, number>;
  /** A run with the ace low (A-2-3…). */
  low?: boolean;
}

/** A way to read some cards as a meld (jokers given the ranks they stand for). */
export interface MeldPlan {
  kind: 'set' | 'run';
  cards: string[];
  as: Record<string, number>;
  low?: boolean;
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
  /** A meld or lay-off with jokers that could mean more than one thing: the player says which. */
  pending?: { kind: 'meld' | 'layoff'; meld?: number; cards: string[]; options: MeldPlan[] } | null;
  /** After a discard: "Rummy!" may be called on the pile (by anyone but the discarder) until the next draw. */
  rummyBy?: number | null;
}

type S = GameState<Rummy500Data>;

export const isJoker = (id: string) => parseCard(id).suit === 'X';
const list = (cards: string[]) => cards.map(cardOrJokerLabel).join(' ');
const rankText = (v: number) => rankLabel(v === 1 ? 14 : v);

/** Card value in hand: joker and ace 15, faces 10, others their number. */
export function handValue(id: string): number {
  const { rank, suit } = parseCard(id);
  if (suit === 'X') return 15;
  return rank === 14 ? 15 : Math.min(rank, 10);
}

/** Card value in a meld: an ace in a low run (A-2-3…) counts 1; a joker is always 15. */
export function meldValue(id: string, meld: { kind: string; cards: string[]; low?: boolean }): number {
  const { rank } = parseCard(id);
  if (rank === 14 && meld.kind === 'run' && (meld.low ?? meld.cards.some((c) => parseCard(c).rank === 2))) return 1;
  return handValue(id);
}

/**
 * Every way to read `cards` as a meld. Sets: 3–4 of a rank in different suits (jokers fill missing
 * suits, so never more than four). Runs: 3+ in a row in one suit, ace low (A-2-3) or high (Q-K-A)
 * but not both, jokers filling gaps or extending an end. `fixed` jokers (already on the table) keep
 * the rank they were declared as; `kind` and `low` restrict the reading (when adding to a meld).
 */
export function meldOptions(cards: string[], fixed: Record<string, number> = {}, kind?: 'set' | 'run', low?: boolean): MeldPlan[] {
  if (cards.length < 3) return [];
  const jokers = cards.filter(isJoker);
  const nat = cards.filter((c) => !isJoker(c)).map(parseCard);
  if (!nat.length) return [];
  const out: MeldPlan[] = [];
  if ((!kind || kind === 'set') && nat.every((c) => c.rank === nat[0].rank) && new Set(nat.map((c) => c.suit)).size === nat.length && cards.length <= 4) {
    out.push({ kind: 'set', cards: [...nat.map((c) => c.id), ...jokers], as: Object.fromEntries(jokers.map((j) => [j, nat[0].rank])) });
  }
  if ((!kind || kind === 'run') && nat.every((c) => c.suit === nat[0].suit)) {
    const fixedJ = jokers.filter((j) => fixed[j] != null);
    const freeJ = jokers.filter((j) => fixed[j] == null);
    for (const aceLow of low == null ? [false, true] : [low]) {
      const v = (r: number) => (r === 14 && aceLow ? 1 : r);
      const lo = aceLow ? 1 : 2;
      const hi = aceLow ? 13 : 14;
      const vals = [...nat.map((c) => v(c.rank)), ...fixedJ.map((j) => fixed[j])];
      if (vals.some((x) => x < lo || x > hi) || new Set(vals).size !== vals.length) continue;
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      const extra = freeJ.length - (mx - mn + 1 - vals.length);
      for (let below = 0; below <= extra; below++) {
        const start = mn - below;
        const end = mx + extra - below;
        if (start < lo || end > hi) continue;
        const at = new Map<number, string>([...nat.map((c) => [v(c.rank), c.id] as [number, string]), ...fixedJ.map((j) => [fixed[j], j] as [number, string])]);
        const free = [...freeJ];
        const as: Record<string, number> = Object.fromEntries(fixedJ.map((j) => [j, fixed[j]]));
        const shown: string[] = [];
        for (let x = start; x <= end; x++) {
          if (at.has(x)) shown.push(at.get(x)!);
          else {
            const j = free.shift()!;
            as[j] = x;
            shown.push(j);
          }
        }
        out.push({ kind: 'run', cards: shown, as, low: start === 1 });
      }
    }
  }
  // the same reading can come from both ace modes
  const key = (m: MeldPlan) => `${m.kind}:${m.cards.map((c) => `${c}=${m.as[c] ?? ''}`).join(',')}`;
  return out.filter((m, i) => out.findIndex((x) => key(x) === key(m)) === i);
}

/** The single reading of a meld, or null (none, or several that a player would have to choose between). */
export function asMeld(cards: string[]): MeldPlan | null {
  const opts = meldOptions(cards);
  return opts.length ? opts[0] : null;
}

/** Ways to add `add` to a meld on the table (it stays the same kind; its jokers keep their ranks). */
export function layoffOptions(meld: { kind: 'set' | 'run'; cards: string[]; as?: Record<string, number>; low?: boolean }, add: string[]): MeldPlan[] {
  if (meld.kind === 'set') return meldOptions([...meld.cards, ...add], {}, 'set');
  const vals = meld.cards.map((c) => (isJoker(c) ? meld.as?.[c] : parseCard(c).rank));
  // a run with its ace (or a joker) at 1 stays low; one reaching 14 stays high
  const low = meld.low || vals.includes(1) ? true : vals.includes(14) ? false : undefined;
  return meldOptions([...meld.cards, ...add], meld.as ?? {}, 'run', low);
}

/** Could `card` be melded from `pool` (which includes it), or laid off on one of `melds`? */
export function canUse(card: string, pool: string[], melds: { kind?: 'set' | 'run'; cards: string[]; as?: Record<string, number>; low?: boolean }[]): boolean {
  if (melds.some((m) => (m.kind ? layoffOptions(m as TableMeld, [card]).length : meldOptions([...m.cards, card]).length))) return true;
  // any meld through the card contains a three-card one: try pairs of likely partners
  const c = parseCard(card);
  const near = pool.filter((x) => {
    if (x === card) return false;
    if (isJoker(x) || isJoker(card)) return true;
    const o = parseCard(x);
    if (o.rank === c.rank) return true;
    if (o.suit !== c.suit) return false;
    const d = Math.abs(o.rank - c.rank);
    return d <= 2 || (o.rank === 14 && c.rank <= 3) || (c.rank === 14 && o.rank <= 3);
  });
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) if (meldOptions([card, near[i], near[j]]).length) return true;
  return false;
}

/** How a reading reads: "set of 9s", "run 7♦–9♦". */
export function planLabel(m: MeldPlan): string {
  const valueOf = (c: string) => (isJoker(c) ? m.as[c] : m.low && parseCard(c).rank === 14 ? 1 : parseCard(c).rank);
  if (m.kind === 'set') return `Set of ${rankLabel(valueOf(m.cards[0]))}s`;
  const suit = SUIT_SYMBOL[parseCard(m.cards.find((c) => !isJoker(c))!).suit];
  return `Run ${rankText(valueOf(m.cards[0]))}${suit}–${rankText(valueOf(m.cards.at(-1)!))}${suit}`;
}

/** Melds a hand could lay down (greedy, most points first) — used by bots and hints. */
export function findMelds(cards: string[]): string[][] {
  const left = cards.filter((c) => !isJoker(c));
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
  const rummyOn = (s: S) => s.options.rummy !== false;

  /** Pile cards that could be melded with no one's hand: laid off on the table, or with cards above them. */
  function rummyCards(s: S): string[] {
    const p = pile(s);
    return p.filter((c, i) => canUse(c, p.slice(i), s.data.melds));
  }

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
    resetDeck(s, { ...config, deck: { ...config.deck, decks: n >= 5 ? 2 : 1, jokers: s.options.jokers === false ? 0 : (config.deck.jokers ?? 0) } });
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
    d.pending = null;
    d.rummyBy = null;
    relayout(s);
    s.phase = 'draw';
    s.turn = first;
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals ${size} each, ${cardOrJokerLabel(pile(s)[0])} turned up`, undefined, undefined, undefined, {
      from: 'deck',
    });
  }

  function sortHand(s: S, seat: number) {
    const order = (id: string) => {
      const c = parseCard(id);
      return 'SHCDX'.indexOf(c.suit) * 20 + c.rank;
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
    showHands(s);
    s.turn = null;
    d.mustMeld = null;
    d.pending = null;
    d.rummyBy = null;
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

  /** Meld or lay off with a single reading at once; with several, take the one given or ask. */
  function chooseOrAsk(s: S, seat: number, p: NonNullable<Rummy500Data['pending']>, pick?: number) {
    if (p.options.length === 1 || (pick != null && p.options[pick])) return commit(s, seat, p.kind, p.cards, p.options[pick ?? 0], p.meld);
    s.data.pending = p;
    s.phase = 'declare';
  }

  function commit(s: S, seat: number, kind: 'meld' | 'layoff', cards: string[], plan: MeldPlan, meldId?: number) {
    const d = s.data;
    const who = name(s, seat);
    const jokers = cards.filter(isJoker).map((j) => `joker as ${plan.kind === 'set' ? rankLabel(plan.as[j]) : `${rankText(plan.as[j])}`}`);
    let meld: TableMeld;
    if (kind === 'meld') {
      meld = { id: d.nextMeld++, owner: seat, kind: plan.kind, cards: plan.cards, as: plan.as, low: plan.low };
      d.melds.push(meld);
      moveCards(s, `hand:${seat}`, `melds:${seat}`, cards, { up: true, group: meld.id });
      log(s, `${who} melds ${list(plan.cards)}${jokers.length ? ` (${jokers.join(', ')})` : ''}`, seat, 'Meld!');
    } else {
      meld = d.melds.find((m) => m.id === meldId)!;
      moveCards(s, `hand:${seat}`, `melds:${meld.owner}`, cards, { up: true, group: meld.id });
      meld.cards = plan.cards;
      meld.as = plan.as;
      meld.low = plan.low;
      log(
        s,
        `${who} lays off ${list(cards)}${jokers.length ? ` (${jokers.join(', ')})` : ''}${meld.owner !== seat ? ` on ${name(s, meld.owner)}'s meld` : ''}`,
        seat,
        `Laid off ${list(cards)}`,
      );
    }
    for (const c of cards) d.scoredBy[c] = seat;
    if (d.mustMeld && cards.includes(d.mustMeld)) d.mustMeld = null;
    d.received[seat] = d.received[seat].filter((c) => !cards.includes(c));
    relayout(s);
    checkOut(s, seat);
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
        melds
          .flat()
          .filter((c) => taken.includes(c))
          .reduce((n, c) => n + handValue(c), 0) +
        taken.filter(isJoker).length * 15 -
        taken.filter((c) => !used.has(c) && !isJoker(c) && !s.data.melds.some((m) => layoffOptions(m, [c]).length)).reduce((n, c) => n + handValue(c), 0) * 0.6;
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
      const must = d.mustMeld;
      const meld = findMelds(own).find((m) => m.includes(must));
      if (meld) return { type: 'meld', cards: meld };
      const onto = d.melds.find((m) => layoffOptions(m, [must]).length);
      if (onto) return { type: 'layoff', cards: [must, onto.cards[0]], amount: 0 };
      // with a joker or two (or as a joker itself)
      const rest = own.filter((c) => c !== must);
      for (let i = 0; i < rest.length; i++)
        for (let j = i + 1; j < rest.length; j++)
          if (meldOptions([must, rest[i], rest[j]]).length) return { type: 'meld', cards: [must, rest[i], rest[j]], amount: 0 };
    }
    const melds = findMelds(own);
    if (melds.length) return { type: 'meld', cards: melds[0] };
    for (const c of own) {
      const onto = d.melds.find((m) => layoffOptions(m, [c]).length);
      if (onto) return { type: 'layoff', cards: [c, onto.cards[0]], amount: 0 };
    }
    // a joker with a pair or a near-run
    const joker = own.find(isJoker);
    if (joker) {
      const rest = own.filter((c) => c !== joker);
      for (let i = 0; i < rest.length; i++)
        for (let j = i + 1; j < rest.length; j++)
          if (meldOptions([joker, rest[i], rest[j]]).length) return { type: 'meld', cards: [joker, rest[i], rest[j]], amount: 0 };
    }
    // discard the most expensive card that isn't close to a meld
    const near = (c: string) => {
      const x = parseCard(c);
      return own.some((o) => o !== c && (parseCard(o).rank === x.rank || (parseCard(o).suit === x.suit && Math.abs(parseCard(o).rank - x.rank) <= 2)));
    };
    // (never a joker if anything else will do)
    const options = own.filter((c) => c !== d.justTook);
    const pick = [...options].sort((a, b) => Number(isJoker(a)) - Number(isJoker(b)) || Number(near(a)) - Number(near(b)) || handValue(b) - handValue(a))[0];
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
      // anyone but the discarder (and the player about to draw, who can simply take it) may call Rummy!
      if (s.phase === 'draw' && d.rummyBy != null && seat !== d.rummyBy && seat !== s.turn) {
        const can = rummyCards(s);
        return can.length ? [{ type: 'rummy', label: 'Rummy!', style: 'danger', select: { min: 1, max: 1, cards: can } }] : [];
      }
      if (s.turn !== seat) return [];
      const own = ids(hand(s, seat));
      if (s.phase === 'declare' && d.pending) {
        return [
          {
            type: 'declare',
            label: 'Say what the joker is',
            style: 'primary',
            choose: { label: 'The joker stands for…', options: d.pending.options.map((m, i) => ({ value: i, label: planLabel(m) })) },
          },
          { type: 'cancel', label: 'Cancel', style: 'quiet' },
        ];
      }
      if (s.phase === 'draw') {
        const out: ActionSpec[] = [];
        if (zone(s, 'deck').cards.length) out.push({ type: 'draw', label: 'Draw', style: 'primary', zone: 'deck' });
        const can = takeable(s, seat);
        if (can.length) out.push({ type: 'take', label: 'Take from the pile', select: { min: 1, max: 1, cards: can } });
        if (!zone(s, 'deck').cards.length) out.push({ type: 'endHand', label: 'End the hand', style: 'quiet' });
        return out;
      }
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [{ type: 'meld', label: 'Meld', style: 'primary', select: { min: 3, max: own.length, cards: own } }];
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
        case 'rummy': {
          assertRule(s.phase === 'draw' && d.rummyBy != null && seat !== d.rummyBy && seat !== s.turn, 'Too late to call Rummy!');
          const card = a.cards?.[0];
          assertRule(card && rummyCards(s).includes(card), 'That card can’t be melded without a hand');
          // the caller takes the pile down to that card, must use it, and play continues from them
          const p = pile(s);
          const taken = p.slice(p.indexOf(card));
          moveCards(s, 'discard', `hand:${seat}`, taken);
          d.received[seat] = taken;
          d.mustMeld = card;
          d.justTook = null;
          d.rummyBy = null;
          sortHand(s, seat);
          log(s, `${who} calls Rummy! and takes ${list(taken)}`, seat, 'Rummy!', undefined, { from: 'discard' });
          s.turn = seat;
          s.phase = 'play';
          return;
        }
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'draw': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          assertRule(zone(s, 'deck').cards.length, 'The stock is empty');
          d.rummyBy = null;
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
          d.rummyBy = null;
          moveCards(s, 'discard', `hand:${seat}`, taken);
          d.received[seat] = taken;
          const deep = taken.length > 1;
          d.mustMeld = deep ? card : null;
          d.justTook = deep ? null : card;
          sortHand(s, seat);
          log(
            s,
            `${who} takes ${deep ? `${list(taken)} from the pile` : `the ${cardName(card)}`}`,
            seat,
            `Took ${taken.length > 1 ? `${taken.length} cards` : cardOrJokerLabel(card)}`,
            undefined,
            { from: 'discard' },
          );
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
          const options = meldOptions(cards);
          assertRule(options.length, 'That isn’t a meld: 3–4 of a rank in different suits, or 3+ in a row in one suit');
          return chooseOrAsk(s, seat, { kind: 'meld', cards, options }, a.amount);
        }
        case 'layoff': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          const onTable = cards.filter((c) => meldOf(s, c));
          const fromHand = cards.filter((c) => own.includes(c));
          assertRule(
            onTable.length === 1 && fromHand.length >= 1 && fromHand.length + 1 === cards.length,
            'Pick cards from your hand and one card of the meld to add to',
          );
          const meld = meldOf(s, onTable[0])!;
          const options = layoffOptions(meld, fromHand);
          assertRule(options.length, `Those don’t fit that meld`);
          return chooseOrAsk(s, seat, { kind: 'layoff', meld: meld.id, cards: fromHand, options }, a.amount);
        }
        case 'declare': {
          assertRule(s.phase === 'declare' && d.pending, 'Nothing to declare');
          const plan = d.pending!.options[a.amount ?? -1];
          assertRule(plan, 'Choose what the joker stands for');
          const p = d.pending!;
          d.pending = null;
          s.phase = 'play';
          return commit(s, seat, p.kind, p.cards, plan, p.meld);
        }
        case 'cancel':
          assertRule(s.phase === 'declare', 'Nothing to cancel');
          d.pending = null;
          s.phase = 'play';
          return;
        case 'rummy':
          return assertRule(false, 'Not your turn');
        case 'discard': {
          assertRule(s.phase === 'play', 'Draw first');
          assertRule(!d.mustMeld, `Meld the ${d.mustMeld ? cardName(d.mustMeld) : ''} you took first`);
          const card = a.cards?.[0];
          assertRule(card && ids(hand(s, seat)).includes(card), 'Choose a card to discard');
          assertRule(card !== d.justTook, 'You can’t throw back the card you just took');
          moveCards(s, `hand:${seat}`, 'discard', [card], { up: true });
          d.justTook = null;
          d.received[seat] = [];
          log(s, `${who} discards the ${isJoker(card) ? 'joker' : cardName(card)}`, seat, cardOrJokerLabel(card), undefined, { to: 'discard' });
          if (checkOut(s, seat)) return;
          s.phase = 'draw';
          s.turn = nextSeat(s, seat);
          // the pile now holds a card that needs nobody's hand: others may call Rummy! until the next draw
          d.rummyBy = rummyOn(s) && rummyCards(s).length ? seat : null;
          return;
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    redactData(s, viewer) {
      return {
        ...s.data,
        received: ownOnly(s.data.received, viewer),
        // a meld waiting on its joker's declaration is still in the player's hand
        pending: s.turn === viewer ? s.data.pending : null,
      };
    },

    bot(s, seat) {
      const d = s.data;
      if (s.phase === 'draw' && d.rummyBy != null && seat !== d.rummyBy && seat !== s.turn) {
        // call it on the shallowest card that can be used
        const can = rummyCards(s);
        return can.length ? { type: 'rummy', cards: [can[can.length - 1]] } : null;
      }
      if (s.turn !== seat) return null;
      if (s.phase === 'declare') return { type: 'declare', amount: 0 };
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
      let headline: string;
      if (s.phase === 'draw') {
        const canCall = d.rummyBy != null && viewer >= 0 && viewer !== d.rummyBy && viewer !== s.turn && rummyCards(s).length > 0;
        headline =
          s.turn === viewer ? 'Draw — or take from the discard pile' : canCall ? `Rummy! is on — call it before ${turnName} draws` : `${turnName} to draw`;
      } else if (s.phase === 'declare') headline = s.turn === viewer ? 'Say what the joker stands for' : `${turnName} is declaring a joker`;
      else if (s.phase === 'play')
        headline =
          s.turn === viewer
            ? d.mustMeld
              ? `Meld the ${cardOrJokerLabel(d.mustMeld)} you took, then discard`
              : 'Meld or lay off, then discard'
            : `${turnName} is playing`;
      else headline = d.result?.headline ?? '';
      const meldedBy = (i: number) => d.melds.flatMap((m) => m.cards.filter((c) => d.scoredBy[c] === i).map((c) => meldValue(c, m))).reduce((a, b) => a + b, 0);
      let hint: string | undefined;
      if (viewer >= 0 && (s.phase === 'draw' || s.phase === 'play')) {
        const left = ids(hand(s, viewer)).reduce((a, c) => a + handValue(c), 0);
        hint = `Melded ${meldedBy(viewer)} · holding ${left}`;
      }
      return {
        headline,
        hint,
        seats: s.players.map((_, i) => ({
          badge: `${d.scores[i]} pts${meldedBy(i) && s.phase !== 'handOver' ? ` · ${meldedBy(i)} down` : ''}`,
          tag: i === s.dealer ? 'D' : undefined,
        })),
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
