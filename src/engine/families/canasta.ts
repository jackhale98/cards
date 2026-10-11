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
 * head) to go out. With partners you may ask "may I go out?" (the answer binds). Once the stock is
 * empty play goes on while players take the discard (they must when it matches their side's meld).
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
  /** …from their hand (asking "may I go out?" is only allowed before that). */
  turnMeldedFromHand?: boolean;
  /** …onto melds that were on the table before this turn (rules out going out concealed). */
  turnAddedToOld?: boolean;
  /** Ranks of the side's melds at the start of this turn. */
  turnStartRanks?: number[];
  /** "May I go out?" this turn, and the partner's binding answer. */
  ask?: { seat: number; answer: 'yes' | 'no' | null } | null;
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
export function groupMeld(cards: string[], existing: number[] = [], existingWilds: Map<number, number> = new Map()): Map<number, string[]> | null {
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
    // otherwise the largest group that still has room for a wild card (at most 3 per meld)
    const wildsIn = (r: number) => (existingWilds.get(r) ?? 0) + groups.get(r)!.filter(isWild).length;
    const bySize = [...order].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);
    const target = needy ?? bySize.find((r) => wildsIn(r) < 3) ?? bySize[0];
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
    beginTurn(s, first);
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
  function planMeld(s: S, seat: number, cards: string[], top: string | null, forced?: Map<number, string[]>): Map<number, string[]> {
    const team = teamOf(s, seat);
    const mine = teamMelds(s, team);
    const existing = mine.map((m) => m.rank);
    const groups = forced ?? groupMeld(top ? [top, ...cards] : cards, existing, new Map(mine.map((m) => [m.rank, m.cards.filter(isWild).length])));
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
      // going out concealed straight from the stock, with a canasta, needs no minimum
      const ownCanasta = [...groups.values()].some((g) => g.length >= 7);
      const concealedOut = !top && left <= 1 && ownCanasta && !s.data.turnMelded && canGoOutAfter(s, seat, cards, groups);
      if (!concealedOut) assertRule(newValue >= min, `Your side's first meld must be worth ${min} — that's ${newValue}`);
    }
    if (left < 2 && s.data.ask?.seat === seat && s.data.ask.answer === 'no') assertRule(false, 'Your partner said not to go out: keep a card after you discard');
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
      if (m && s.data.turnStartRanks?.includes(rank)) s.data.turnAddedToOld = true;
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

  /**
   * Going out concealed: nothing melded before this turn, nothing added to partner's melds, and a
   * canasta of the player's own put down.
   */
  function concealedOut(s: S, seat: number) {
    const d = s.data;
    const team = teamOf(s, seat);
    const own = teamMelds(s, team).filter((m) => !d.turnStartRanks?.includes(m.rank));
    return !d.melded[seat] && !d.turnAddedToOld && own.some(isCanasta);
  }

  /** A new turn: forget this-turn flags. */
  function beginTurn(s: S, seat: number) {
    const d = s.data;
    d.turnMelded = false;
    d.turnMeldedFromHand = false;
    d.turnAddedToOld = false;
    d.turnStartRanks = teamMelds(s, teamOf(s, seat)).map((m) => m.rank);
    d.ask = null;
  }

  /** Can the player go out this turn (meld everything, or all but one card and discard it)? */
  function canGoOutNow(s: S, seat: number): boolean {
    const own = ids(hand(s, seat));
    const tries = [own, ...own.map((c) => own.filter((x) => x !== c))];
    return tries.some((cards) => {
      if (!cards.length) return canastas(s, teamOf(s, seat)) >= canastasNeeded(s);
      try {
        planMeld(s, seat, cards, null);
        return true;
      } catch {
        return false;
      }
    });
  }

  /** With the stock gone, a player must take an unfrozen pile whose top card matches one of their side's melds. */
  function mustTakePile(s: S, seat: number) {
    const top = topCard(s);
    const team = teamOf(s, seat);
    return (
      zone(s, 'deck').cards.length === 0 && !!top && !isWild(top) && !isBlackThree(top) && !pileFrozenFor(s, team) && teamMelds(s, team).some((m) => m.rank === parseCard(top).rank)
    );
  }

  function endHand(s: S, outSeat: number | null, concealed: boolean) {
    const d = s.data;
    const lines: string[] = [];
    if (outSeat != null) lines.push(`${name(s, outSeat)} goes out${concealed ? ' concealed' : ''}!`);
    else lines.push('The stock has run out — play ends');
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
      const d = s.data;
      const own = ids(hand(s, seat));
      const top = topCard(s);
      if (s.phase === 'ask') {
        return [
          { type: 'allowOut', label: 'Yes, go out', style: 'primary' },
          { type: 'denyOut', label: 'No, keep playing' },
        ];
      }
      if (s.phase === 'draw') {
        const empty = zone(s, 'deck').cards.length === 0;
        const out: ActionSpec[] = [];
        if (!mustTakePile(s, seat)) out.push({ type: 'draw', label: empty ? 'No stock — end the hand' : twoHanded(s) ? 'Draw 2' : 'Draw', style: empty ? 'quiet' : 'primary', zone: 'deck' });
        if (top && !isWild(top) && !isBlackThree(top))
          out.push({ type: 'takePile', label: `Take the pile`, style: empty ? 'primary' : undefined, select: { min: 0, max: own.length, cards: own } });
        return out;
      }
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [{ type: 'meld', label: 'Meld', style: 'primary', select: { min: 1, max: own.length, cards: own } }];
      // wild cards on their own go onto one of the side's melds that has room
      const wilds = own.filter(isWild);
      const room = teamMelds(s, teamOf(s, seat)).filter((m) => m.rank !== 3 && m.cards.filter(isWild).length < 3);
      if (wilds.length && room.length)
        out.push({
          type: 'addWild',
          label: 'Add wilds to…',
          select: { min: 1, max: Math.min(3, wilds.length), cards: wilds },
          choose: { label: 'Add to which meld?', options: room.map((m) => ({ value: m.rank, label: `${rankName(m.rank)}s · ${m.cards.length} cards` })) },
        });
      out.push({ type: 'discard', label: 'Discard', quick: 'swipe', select: { min: 1, max: 1, cards: own } });
      if (!twoHanded(s) && !d.turnMeldedFromHand && !d.ask) out.push({ type: 'ask', label: 'May I go out?', style: 'quiet' });
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
        case 'ask': {
          assertRule(s.phase === 'play' && !twoHanded(s), 'Not now');
          assertRule(!d.turnMeldedFromHand && !d.ask, 'Ask before melding from your hand (once a turn)');
          d.ask = { seat, answer: null };
          log(s, `${who}: “Partner, may I go out?”`, seat, 'May I go out?');
          s.phase = 'ask';
          s.turn = (seat + 2) % s.players.length;
          return;
        }
        case 'allowOut':
        case 'denyOut': {
          assertRule(s.phase === 'ask' && d.ask, 'Nobody asked');
          d.ask!.answer = a.type === 'allowOut' ? 'yes' : 'no';
          log(s, `${who}: “${d.ask!.answer === 'yes' ? 'Yes' : 'No'}.”`, seat, d.ask!.answer === 'yes' ? 'Yes' : 'No');
          s.phase = 'play';
          s.turn = d.ask!.seat;
          return;
        }
        case 'draw': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          assertRule(!mustTakePile(s, seat), 'The stock is gone and the discard matches your meld: you must take the pile');
          const stock = zone(s, 'deck').cards.length;
          // no stock left: the play ends (two-handed, a last single card counts as a full draw)
          if (stock === 0) return endHand(s, null, false);
          const n = Math.min(twoHanded(s) ? 2 : 1, stock);
          const before = ids(hand(s, seat));
          for (let i = 0; i < n; i++) moveTop(s, 'deck', `hand:${seat}`, 1);
          log(s, `${who} draws ${n === 1 ? 'a card' : `${n} cards`}`, seat, 'Drew', undefined, { from: 'deck' });
          layRedThrees(s, seat);
          d.received[seat] = ids(hand(s, seat)).filter((c) => !before.includes(c));
          sortHand(s, seat);
          relayout(s);
          // a red three as the last card of the stock: no replacement, so play ends there
          if (!d.received[seat].length && zone(s, 'deck').cards.length === 0) {
            log(s, 'A red 3 was the last card of the stock — play ends');
            return endHand(s, null, false);
          }
          s.phase = 'play';
          return;
        }
        case 'addWild': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length && cards.every((c) => own.includes(c) && isWild(c)) && new Set(cards).size === cards.length, 'Choose wild cards from your hand');
          const m = teamMelds(s, teamOf(s, seat)).find((x) => x.rank === a.amount);
          assertRule(m && m.rank !== 3, 'Choose one of your side’s melds');
          const groups = planMeld(s, seat, cards, null, new Map([[m.rank, cards]]));
          applyMelds(s, seat, groups, null);
          d.turnMeldedFromHand = true;
          d.received[seat] = d.received[seat].filter((c) => !cards.includes(c));
          log(s, `${who} adds ${cards.length === 1 ? 'a wild card' : `${cards.length} wild cards`} to the ${rankName(m.rank)}s`, seat, 'Meld!');
          if (!hand(s, seat).cards.length) return endHand(s, seat, concealedOut(s, seat));
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
          if (!hand(s, seat).cards.length) return endHand(s, seat, concealedOut(s, seat));
          return;
        }
        case 'meld': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length && cards.every((c) => own.includes(c)) && new Set(cards).size === cards.length, 'Meld cards from your hand');
          const groups = planMeld(s, seat, cards, null);
          applyMelds(s, seat, groups, null);
          d.turnMeldedFromHand = true;
          d.received[seat] = d.received[seat].filter((c) => !cards.includes(c));
          log(s, `${who} melds ${[...groups].map(([r, gs]) => `${gs.length}× ${rankName(r)}`).join(', ')}`, seat, 'Meld!');
          if (!hand(s, seat).cards.length) return endHand(s, seat, concealedOut(s, seat));
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
            assertRule(d.ask?.seat !== seat || d.ask.answer !== 'no', 'Your partner said not to go out: keep a card');
          } else if (d.ask?.seat === seat && d.ask.answer === 'yes') {
            // the answer binds: having been told yes, you must go out if you can
            assertRule(!canGoOutNow(s, seat), 'Your partner said yes — you must go out: meld the rest of your cards');
          }
          moveCards(s, `hand:${seat}`, 'discard', [card], { up: true });
          if (isWild(card)) d.frozen = true;
          d.received[seat] = [];
          updatePile(s);
          log(s, `${who} discards ${isWild(card) ? `a ${label(card)} — the pile is frozen` : `a ${label(card)}`}`, seat, label(card), undefined, { to: 'discard' });
          if (!hand(s, seat).cards.length) return endHand(s, seat, concealedOut(s, seat));
          if (d.turnMelded) d.melded[seat] = true;
          s.phase = 'draw';
          s.turn = nextSeat(s, seat);
          beginTurn(s, s.turn);
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
      if (s.phase === 'ask') {
        // let partner go out unless we're holding a lot that would count against us
        const held = ids(hand(s, seat)).reduce((n, c) => n + cardPoints(c), 0);
        return { type: held <= 60 ? 'allowOut' : 'denyOut' };
      }
      if (s.phase === 'draw') {
        const take = botTake(s, seat);
        if (!take && mustTakePile(s, seat)) return { type: 'takePile', cards: [] };
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
      if (s.phase === 'draw') {
        if (s.turn === viewer && mustTakePile(s, viewer)) headline = 'The stock is gone: you must take the pile';
        else if (s.turn === viewer && zone(s, 'deck').cards.length === 0) headline = 'The stock is gone: take the pile, or the hand ends';
        else headline = s.turn === viewer ? (twoHanded(s) ? 'Draw 2 — or take the pile' : 'Draw — or take the pile') : `${turnName} to draw`;
      } else if (s.phase === 'ask') headline = s.turn === viewer ? `${name(s, d.ask!.seat)} asks: may I go out?` : `${name(s, d.ask!.seat)} asks ${turnName}: may I go out?`;
      else if (s.phase === 'play') {
        const told = d.ask?.seat === s.turn && d.ask.answer ? (d.ask.answer === 'yes' ? ' — told to go out' : ' — told not to go out') : '';
        headline = (s.turn === viewer ? 'Meld, then discard' : `${turnName} is playing`) + told;
      }
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
