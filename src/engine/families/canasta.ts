import { parseCard, rankLabel } from '../cards';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Classic Canasta. Four players in partnerships (or two head to head). Configured from
 * `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "canasta", "end": { "target": 5000 } }
 * ```
 * Two decks and four jokers; jokers and 2s are wild. Melds are sets of one rank (3+ cards, at
 * least 2 natural, at most 3 wild); seven make a canasta (500 natural, 300 mixed). Each turn: draw
 * from the stock (two cards head to head) or take the whole discard pile by melding its top card,
 * meld, then discard. Red threes are bonuses laid out at once; black threes block the pile. A side's
 * first meld must reach a minimum that rises with its score, and you need a canasta (two head to
 * head) to go out. Simplified: no "may I go out?" question, and the hand ends when the stock runs out.
 */
export interface CanastaRules {
  family: 'canasta';
  end: { target: number };
}

export interface CanastaMeld {
  team: number;
  /** Natural rank (4–14) the meld is of; 3 for black threes laid down when going out. */
  rank: number;
  cards: string[];
}

export interface CanastaData {
  handNo: number;
  /** Per side. */
  scores: number[];
  melds: CanastaMeld[];
  /** Red threes laid out, per side. */
  red3: string[][];
  /** Frozen: a wild card (or a starting red three) is in the discard pile. */
  frozen: boolean;
  /** Seats that melded on an earlier turn this hand (going out without is "concealed"). */
  melded: boolean[];
  /** The player to move has melded this turn. */
  turnMelded: boolean;
  /** Cards just drawn or taken (highlighted; redacted to the owner). */
  received: string[][];
  result: { lines: string[] } | null;
}

type S = GameState<CanastaData>;

export const isWild = (id: string) => {
  const c = parseCard(id);
  return c.suit === 'X' || c.rank === 2;
};
export const isRedThree = (id: string) => {
  const c = parseCard(id);
  return c.rank === 3 && (c.suit === 'H' || c.suit === 'D');
};
export const isBlackThree = (id: string) => {
  const c = parseCard(id);
  return c.rank === 3 && (c.suit === 'S' || c.suit === 'C');
};

/** Card values: joker 50, 2 and A 20, K–8 10, 7–4 and black 3 5. */
export function cardPoints(id: string): number {
  const c = parseCard(id);
  if (c.suit === 'X') return 50;
  if (c.rank === 2 || c.rank === 14) return 20;
  if (c.rank >= 8) return 10;
  return 5;
}

/** A side's first meld must be worth at least this, depending on its score. */
export function minimumMeld(score: number): number {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

const label = (id: string) => (parseCard(id).suit === 'X' ? 'Joker' : rankLabel(parseCard(id).rank) + '');
const rankName = (r: number) => (r === 3 ? 'black 3' : rankLabel(r));
const isCanasta = (m: CanastaMeld) => m.cards.length >= 7;
const isNatural = (m: CanastaMeld) => !m.cards.some(isWild);

/**
 * Split selected cards into melds: naturals grouped by rank, wild cards spread over the groups
 * (first topping each group up to three cards, then the rest on the largest group). Returns null if
 * something can't be melded (a red three, a lone wild, mixed black threes and wilds…).
 */
export function groupMeld(cards: string[], existing: number[] = []): Map<number, string[]> | null {
  const groups = new Map<number, string[]>();
  const wilds = cards.filter(isWild);
  for (const c of cards.filter((x) => !isWild(x))) {
    if (isRedThree(c)) return null;
    const r = parseCard(c).rank;
    groups.set(r, [...(groups.get(r) ?? []), c]);
  }
  if (wilds.length && !groups.size) return null;
  const order = [...groups.keys()].filter((r) => r !== 3);
  if (wilds.length && !order.length) return null; // black threes take no wild cards
  for (const w of wilds) {
    // a new group needs topping up to three first; existing melds can take any
    const needy = order.find((r) => !existing.includes(r) && groups.get(r)!.length < 3);
    const target = needy ?? [...order].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length)[0];
    groups.get(target)!.push(w);
  }
  return groups;
}

export function canastaFamily(config: GameConfig): GameModule<CanastaData> {
  const R = config.rules as unknown as CanastaRules;
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const twoHanded = (s: S) => s.players.length === 2;
  const teamOf = (s: S, seat: number) => (twoHanded(s) ? seat : seat % 2);
  const teamSeats = (s: S, team: number) => (twoHanded(s) ? [team] : [team, team + 2]);
  const teamName = (s: S, team: number) => teamSeats(s, team).map((i) => name(s, i)).join(' & ');
  const meldZone = (team: number) => `melds:${team}`;
  const teamMelds = (s: S, team: number) => s.data.melds.filter((m) => m.team === team);
  const hasMelded = (s: S, team: number) => teamMelds(s, team).length > 0;
  const canastasNeeded = (s: S) => (twoHanded(s) ? 2 : 1);
  const canastas = (s: S, team: number) => teamMelds(s, team).filter(isCanasta).length;
  const topCard = (s: S) => zone(s, 'discard').cards.at(-1)?.id ?? null;
  const pileFrozenFor = (s: S, team: number) => s.data.frozen || !hasMelded(s, team);

  function sortHand(s: S, seat: number) {
    const key = (id: string) => (isWild(id) ? 100 + cardPoints(id) : parseCard(id).rank);
    hand(s, seat).cards.sort((a, b) => key(a.id) - key(b.id) || a.id.localeCompare(b.id));
  }

  /** Lay each side's melds out in front of it: red threes, then melds by rank, canastas first. */
  function relayout(s: S) {
    const sides = twoHanded(s) ? [0, 1] : [0, 1];
    for (const t of sides) {
      const z = zone(s, meldZone(t));
      const melds = teamMelds(s, t).sort((a, b) => Number(isCanasta(b)) - Number(isCanasta(a)) || b.rank - a.rank);
      z.cards = [
        ...s.data.red3[t].map((id) => ({ id, up: true, group: 0 })),
        ...melds.flatMap((m) => [...m.cards.filter((c) => !isWild(c)), ...m.cards.filter(isWild)].map((id) => ({ id, up: true, group: m.rank }))),
      ];
      const n = canastas(s, t);
      z.label = `${teamName(s, t)}${n ? ` · ${n} canasta${n > 1 ? 's' : ''}` : ''}`;
    }
  }

  /** Lay out any red threes in a seat's hand, drawing replacements from the stock. */
  function layRedThrees(s: S, seat: number) {
    for (;;) {
      const reds = ids(hand(s, seat)).filter(isRedThree);
      if (!reds.length) return;
      moveCards(s, `hand:${seat}`, meldZone(teamOf(s, seat)), reds, { up: true });
      s.data.red3[teamOf(s, seat)].push(...reds);
      log(s, `${name(s, seat)} lays out ${reds.length === 1 ? 'a red 3' : `${reds.length} red 3s`}`, seat, 'Red 3!');
      for (let i = 0; i < reds.length && zone(s, 'deck').cards.length; i++) moveTop(s, 'deck', `hand:${seat}`, 1);
    }
  }

  function startHand(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, config);
    const size = twoHanded(s) ? 15 : 11;
    const first = nextSeat(s, s.dealer);
    for (let k = 0; k < size; k++) for (let i = 0; i < n; i++) moveTop(s, 'deck', `hand:${(first + i) % n}`, 1);
    d.handNo++;
    d.melds = [];
    d.red3 = [[], []];
    d.frozen = false;
    d.melded = s.players.map(() => false);
    d.turnMelded = false;
    d.received = s.players.map(() => []);
    d.result = null;
    // turn up the first discard; a wild or red three freezes the pile and another is turned
    for (;;) {
      moveTop(s, 'deck', 'discard', 1, { up: true });
      const top = topCard(s)!;
      if (!isWild(top) && !isRedThree(top)) break;
      d.frozen = true;
    }
    s.players.forEach((_, i) => layRedThrees(s, i));
    s.players.forEach((_, i) => sortHand(s, i));
    relayout(s);
    updatePile(s);
    s.phase = 'draw';
    s.turn = first;
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals ${size} each`);
  }

  function updatePile(s: S) {
    const z = zone(s, 'discard');
    // (the pile shows its own count)
    z.label = s.data.frozen ? 'Discard — frozen' : 'Discard';
  }

  /**
   * Check a meld action: `cards` from `seat`'s hand (plus `top` when taking the pile) grouped into
   * melds, new or added to the side's melds. Returns the groups, or throws a RuleError.
   */
  function planMeld(s: S, seat: number, cards: string[], top: string | null): Map<number, string[]> {
    const team = teamOf(s, seat);
    const mine = teamMelds(s, team);
    const existing = mine.map((m) => m.rank);
    const groups = groupMeld(top ? [top, ...cards] : cards, existing);
    assertRule(groups && groups.size, 'Those cards don’t make a meld: sets of one rank, with 2s and jokers wild');
    let newValue = 0;
    for (const [rank, gs] of groups) {
      const old = mine.find((m) => m.rank === rank);
      const all = [...(old?.cards ?? []), ...gs];
      const naturals = all.filter((c) => !isWild(c)).length;
      const wilds = all.length - naturals;
      assertRule(all.length >= 3, `A ${rankName(rank)} meld needs at least 3 cards`);
      assertRule(naturals >= 2, `A meld needs at least 2 natural ${rankName(rank)}s`);
      assertRule(wilds <= 3, 'A meld can’t have more than 3 wild cards');
      if (rank === 3) assertRule(wilds === 0, 'Black 3s can’t be melded with wild cards');
      if (!old) newValue += gs.reduce((n, c) => n + cardPoints(c), 0);
    }
    if (top) {
      const r = parseCard(top).rank;
      const fromHand = cards.filter((c) => !isWild(c) && parseCard(c).rank === r).length;
      if (pileFrozenFor(s, team)) assertRule(fromHand >= 2, `The pile is frozen: you need two natural ${rankName(r)}s to take it`);
    }
    // black threes only on the turn you go out
    const left = ids(hand(s, seat)).length - cards.length;
    if (groups.has(3)) assertRule(left <= 1 && canGoOutAfter(s, seat, cards, groups), 'Black 3s can only be melded when you go out');
    if (!hasMelded(s, team)) {
      const min = minimumMeld(s.data.scores[team]);
      assertRule(newValue >= min, `Your side's first meld must be worth ${min} — that's ${newValue}`);
    }
    // keep a card to discard unless the side will have its canastas
    if (left < 2) assertRule(canGoOutAfter(s, seat, cards, groups), `You need ${canastasNeeded(s) === 1 ? 'a canasta' : 'two canastas'} to go out`);
    return groups;
  }

  /** Would the side have enough canastas to go out after these melds? */
  function canGoOutAfter(s: S, seat: number, _cards: string[], groups: Map<number, string[]>) {
    const team = teamOf(s, seat);
    const sizes = new Map(teamMelds(s, team).map((m) => [m.rank, m.cards.length]));
    for (const [r, gs] of groups) sizes.set(r, (sizes.get(r) ?? 0) + gs.length);
    return [...sizes.values()].filter((n) => n >= 7).length >= canastasNeeded(s);
  }

  function applyMelds(s: S, seat: number, groups: Map<number, string[]>, fromPile: string | null) {
    const team = teamOf(s, seat);
    for (const [rank, gs] of groups) {
      let m = s.data.melds.find((x) => x.team === team && x.rank === rank);
      if (!m) {
        m = { team, rank, cards: [] };
        s.data.melds.push(m);
      }
      const wasCanasta = isCanasta(m);
      for (const c of gs) {
        moveCards(s, c === fromPile ? 'discard' : `hand:${seat}`, meldZone(team), [c], { up: true });
        m.cards.push(c);
      }
      if (!wasCanasta && isCanasta(m)) log(s, `${teamName(s, team)} complete a ${isNatural(m) ? 'natural' : 'mixed'} canasta of ${rankName(rank)}s!`, seat, 'Canasta!');
    }
    s.data.turnMelded = true;
    relayout(s);
  }

  function endHand(s: S, outSeat: number | null, concealed: boolean) {
    const d = s.data;
    const lines: string[] = [];
    if (outSeat != null) lines.push(`${name(s, outSeat)} goes out${concealed ? ' concealed' : ''}!`);
    else lines.push('The stock has run out');
    for (const t of [0, 1]) {
      const melds = teamMelds(s, t);
      const meldPts = melds.flatMap((m) => m.cards).reduce((n, c) => n + cardPoints(c), 0);
      const bonus = melds.filter(isCanasta).reduce((n, m) => n + (isNatural(m) ? 500 : 300), 0);
      const reds = d.red3[t].length;
      const redPts = (reds === 4 ? 800 : reds * 100) * (melds.length ? 1 : -1);
      const outPts = outSeat != null && teamOf(s, outSeat) === t ? (concealed ? 200 : 100) : 0;
      const held = teamSeats(s, t).flatMap((i) => ids(hand(s, i))).reduce((n, c) => n + cardPoints(c), 0);
      const total = meldPts + bonus + redPts + outPts - held;
      d.scores[t] += total;
      const parts = [`melds ${meldPts}`, bonus && `canastas ${bonus}`, redPts && `red 3s ${redPts}`, outPts && `out ${outPts}`, held && `held −${held}`].filter(Boolean);
      lines.push(`${teamName(s, t)}: ${parts.join(', ')} = ${total >= 0 ? '+' : ''}${total} → ${d.scores[t]}`);
    }
    for (const z of Object.values(s.zones)) if (z.id.startsWith('hand:')) for (const c of z.cards) c.up = true;
    d.result = { lines };
    s.turn = null;
    log(s, lines[0]);
    const best = Math.max(...d.scores);
    if (best >= target(s) && d.scores[0] !== d.scores[1]) {
      const t = d.scores.indexOf(best);
      s.winner = teamSeats(s, t);
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
  }

  // ---- bots -------------------------------------------------------------------------------

  /** The melds a bot would make from its hand now (natural groups of 3+, plus additions). */
  function botMeldCards(s: S, seat: number): string[] {
    const team = teamOf(s, seat);
    const cards = ids(hand(s, seat));
    const naturals = cards.filter((c) => !isWild(c) && !isBlackThree(c));
    const byRank = new Map<number, string[]>();
    for (const c of naturals) byRank.set(parseCard(c).rank, [...(byRank.get(parseCard(c).rank) ?? []), c]);
    const existing = new Set(teamMelds(s, team).map((m) => m.rank));
    let pick: string[] = [];
    for (const [r, cs] of byRank) if (existing.has(r) || cs.length >= 3) pick.push(...cs);
    // use wild cards to finish canastas (or start a meld from a natural pair)
    const wilds = cards.filter(isWild);
    for (const m of teamMelds(s, team)) {
      const room = 3 - m.cards.filter(isWild).length;
      const short = 7 - m.cards.length - pick.filter((c) => parseCard(c).rank === m.rank).length;
      if (short > 0 && short <= Math.min(room, wilds.length) && short <= 2) pick.push(...wilds.splice(0, short));
    }
    if (!pick.length) return [];
    // keep cards in hand to discard unless we're able to go out
    while (pick.length && cards.length - pick.length < 2) {
      try {
        planMeld(s, seat, pick, null);
        return pick;
      } catch {
        pick = pick.slice(0, -1);
      }
    }
    try {
      planMeld(s, seat, pick, null);
      return pick;
    } catch {
      return [];
    }
  }

  function botTake(s: S, seat: number): Action | null {
    const top = topCard(s);
    if (!top || isWild(top) || isBlackThree(top)) return null;
    const cards = ids(hand(s, seat));
    const r = parseCard(top).rank;
    const pairs = cards.filter((c) => !isWild(c) && parseCard(c).rank === r);
    const wilds = cards.filter(isWild);
    const tries: string[][] = [[], pairs.slice(0, 2), [...pairs.slice(0, 1), ...wilds.slice(0, 1)]];
    // with the side yet to meld, add whatever else it holds to reach the minimum
    const extra = botMeldCards(s, seat).filter((c) => !pairs.includes(c));
    for (const t of [...tries, ...tries.map((x) => [...x, ...extra])]) {
      if (!t.length && pileFrozenFor(s, teamOf(s, seat))) continue;
      try {
        planMeld(s, seat, t, top);
        return { type: 'takePile', cards: t };
      } catch {
        /* try the next */
      }
    }
    return null;
  }

  function botDiscard(s: S, seat: number): Action {
    const team = teamOf(s, seat);
    const cards = ids(hand(s, seat));
    const theirs = new Set(teamMelds(s, 1 - team).map((m) => m.rank));
    const ours = new Set(teamMelds(s, team).map((m) => m.rank));
    const count = (r: number) => cards.filter((c) => parseCard(c).rank === r && !isWild(c)).length;
    const score = (c: string) => {
      if (isBlackThree(c)) return -100; // blocks the pile
      if (isWild(c)) return 1000; // never feed a wild into the pile if avoidable
      const r = parseCard(c).rank;
      return (ours.has(r) ? 200 : 0) + (theirs.has(r) ? 150 : 0) + count(r) * 40 + cardPoints(c);
    };
    return { type: 'discard', cards: [[...cards].sort((a, b) => score(a) - score(b))[0]] };
  }

  return {
    config,

    setup(players, seed, options) {
      const s = createState<CanastaData>(config, players, seed, options, {
        handNo: 0,
        scores: [0, 0],
        melds: [],
        red3: [[], []],
        frozen: false,
        melded: [],
        turnMelded: false,
        received: [],
        result: null,
      });
      s.dealer = players.length - 1;
      startHand(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.turn !== seat) return [];
      const own = ids(hand(s, seat));
      const top = topCard(s);
      if (s.phase === 'draw') {
        const out: ActionSpec[] = [{ type: 'draw', label: twoHanded(s) ? 'Draw 2' : 'Draw', style: 'primary', zone: 'deck' }];
        if (top && !isWild(top) && !isBlackThree(top))
          out.push({ type: 'takePile', label: `Take the pile`, select: { min: 0, max: own.length, cards: own } });
        return out;
      }
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [{ type: 'meld', label: 'Meld', style: 'primary', select: { min: 1, max: own.length, cards: own } }];
      out.push({ type: 'discard', label: 'Discard', quick: 'swipe', select: { min: 1, max: 1, cards: own } });
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
          d.scores = [0, 0];
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'draw': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          const n = twoHanded(s) ? 2 : 1;
          if (zone(s, 'deck').cards.length < n) return endHand(s, null, false);
          const before = ids(hand(s, seat));
          for (let i = 0; i < n; i++) moveTop(s, 'deck', `hand:${seat}`, 1);
          log(s, `${who} draws ${n === 1 ? 'a card' : `${n} cards`}`, seat, 'Drew', undefined, { from: 'deck' });
          layRedThrees(s, seat);
          d.received[seat] = ids(hand(s, seat)).filter((c) => !before.includes(c));
          sortHand(s, seat);
          relayout(s);
          s.phase = 'play';
          return;
        }
        case 'takePile': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          const top = topCard(s);
          assertRule(top && !isWild(top) && !isBlackThree(top), 'You can’t take the pile when a wild card or black 3 is on top');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.every((c) => own.includes(c)) && new Set(cards).size === cards.length, 'Meld cards from your hand');
          const groups = planMeld(s, seat, cards, top);
          applyMelds(s, seat, groups, top);
          const rest = ids(zone(s, 'discard'));
          // a red three turned up at the start comes with the pile and is laid out (no replacement)
          const reds = rest.filter(isRedThree);
          if (reds.length) {
            moveCards(s, 'discard', meldZone(teamOf(s, seat)), reds, { up: true });
            d.red3[teamOf(s, seat)].push(...reds);
          }
          const taken = ids(zone(s, 'discard'));
          moveCards(s, 'discard', `hand:${seat}`, taken);
          d.received[seat] = taken;
          d.frozen = false;
          sortHand(s, seat);
          relayout(s);
          updatePile(s);
          log(s, `${who} takes the pile (${taken.length + 1} cards) with the ${label(top)}`, seat, `Took ${taken.length + 1}`, undefined, { from: 'discard' });
          s.phase = 'play';
          if (!hand(s, seat).cards.length) return endHand(s, seat, !d.melded[seat]);
          return;
        }
        case 'meld': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length && cards.every((c) => own.includes(c)) && new Set(cards).size === cards.length, 'Meld cards from your hand');
          const groups = planMeld(s, seat, cards, null);
          applyMelds(s, seat, groups, null);
          d.received[seat] = d.received[seat].filter((c) => !cards.includes(c));
          log(s, `${who} melds ${[...groups].map(([r, gs]) => `${gs.length}× ${rankName(r)}`).join(', ')}`, seat, 'Meld!');
          if (!hand(s, seat).cards.length) return endHand(s, seat, !d.melded[seat]);
          return;
        }
        case 'discard': {
          assertRule(s.phase === 'play', 'Draw first');
          const card = a.cards?.[0];
          const own = ids(hand(s, seat));
          assertRule(card && own.includes(card), 'Choose a card to discard');
          if (own.length === 1) {
            const team = teamOf(s, seat);
            assertRule(canastas(s, team) >= canastasNeeded(s), `You need ${canastasNeeded(s) === 1 ? 'a canasta' : 'two canastas'} to go out`);
          }
          moveCards(s, `hand:${seat}`, 'discard', [card], { up: true });
          if (isWild(card)) d.frozen = true;
          d.received[seat] = [];
          updatePile(s);
          log(s, `${who} discards ${isWild(card) ? `a ${label(card)} — the pile is frozen` : `a ${label(card)}`}`, seat, label(card), undefined, { to: 'discard' });
          if (!hand(s, seat).cards.length) return endHand(s, seat, !d.melded[seat]);
          if (d.turnMelded) d.melded[seat] = true;
          d.turnMelded = false;
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
      if (s.phase === 'draw') {
        const take = botTake(s, seat);
        return take ?? { type: 'draw' };
      }
      if (s.phase === 'play') {
        const meld = botMeldCards(s, seat);
        if (meld.length) return { type: 'meld', cards: meld };
        return botDiscard(s, seat);
      }
      return null;
    },

    standings(s) {
      return placesFromScores(s.players.map((_, i) => s.data.scores[teamOf(s, i)]));
    },

    status(s, viewer) {
      const d = s.data;
      const turnName = s.turn != null ? name(s, s.turn) : '';
      let headline = '';
      if (s.phase === 'draw') headline = s.turn === viewer ? (twoHanded(s) ? 'Draw 2 — or take the pile' : 'Draw — or take the pile') : `${turnName} to draw`;
      else if (s.phase === 'play') headline = s.turn === viewer ? 'Meld, then discard' : `${turnName} is playing`;
      else headline = d.result?.lines[0] ?? '';
      let hint: string | undefined;
      if (viewer >= 0 && (s.phase === 'draw' || s.phase === 'play')) {
        const team = teamOf(s, viewer);
        hint = hasMelded(s, team)
          ? `${canastas(s, team)}/${canastasNeeded(s)} canasta${canastasNeeded(s) > 1 ? 's' : ''} to go out`
          : `First meld needs ${minimumMeld(d.scores[team])}`;
      }
      return {
        headline,
        hint,
        seats: s.players.map((_, i) => ({ badge: `${d.scores[teamOf(s, i)]} pts`, tag: i === s.dealer ? 'D' : undefined })),
        scoreboard: {
          columns: ['Canastas', 'Score'],
          rows: [0, 1].map((t) => ({ name: teamName(s, t), values: [canastas(s, t), d.scores[t]], highlight: !!s.winner && teamSeats(s, t).some((i) => s.winner!.includes(i)) })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${teamName(s, teamOf(s, s.winner![0]))} win${twoHanded(s) ? 's' : ''}!`, lines: d.result?.lines ?? [] }
            : s.phase === 'handOver'
              ? { title: 'Hand over', lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
}
