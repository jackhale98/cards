import { parseCard, rankLabel } from '../cards';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, showHands, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';
import { cardPoints, groupByRank, isBlackThree, isRedThree, isWild } from '../lib/canastaCards';
import { ownOnly } from '../redact';
import { nextRandom } from '../rng';
import { sideName } from '../lib/teams';

/**
 * Hand and Foot (pagat.com/rummy/handfoot.html, the basic partnership game). Two to six players:
 * four in two partnerships (partners opposite), six in two teams of three (alternate seats), and
 * two, three or five each for themselves. Configured from
 * `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "handfoot" }
 * ```
 * One more 54-card deck than players. Everyone gets a 13-card hand and a 13-card foot (face down,
 * picked up once the hand is played out). Each turn: draw two from the stock, or take the top seven
 * of the discard pile by melding its top card with two of the same rank from hand; meld; discard.
 * Melds are 3–7 cards of one rank (4s to aces) and belong to the partnership; 2s and jokers are wild,
 * at most one wild in a meld of up to five and two in six or seven, and an all-wild meld is allowed.
 * Seven cards make a pile: clean (no wilds) 500, dirty 300, wild 1500. Red 3s are laid out at once
 * (+100, or −100 if still in hand or foot); black 3s can't be melded and block the pile. The first
 * meld must reach 50, 90, 120 then 150 in the four rounds. To go out a side needs two clean, two
 * dirty and one wild pile, and (with partners) both feet picked up; going out scores 100.
 *
 * Simplified from pagat: taking the pile needs the top card and two from hand to start a new meld
 * (not to finish an unfinished one of that rank); nobody asks "may I go out?"; a hand emptied by a
 * discard picks up its foot at once (ready for the next turn).
 */
export interface HandFootMeld {
  team: number;
  /** Natural rank (4–14), or 0 for an all-wild meld. */
  rank: number;
  cards: string[];
}

export interface HandFootData {
  /** Round 1–4 (the first meld's minimum rises each round). */
  round: number;
  scores: number[];
  melds: HandFootMeld[];
  red3: string[][];
  /** Who has picked up their foot. */
  footTaken: boolean[];
  received: string[][];
  result: { lines: string[] } | null;
}

type S = GameState<HandFootData>;

const ROUNDS = 4;
const MINIMUM = [50, 90, 120, 150];
const PILE = 7;
const BONUS = { clean: 500, dirty: 300, wild: 1500 };
const NEED = { clean: 2, dirty: 2, wild: 1 };

const rankName = (r: number) => (r === 0 ? 'wild' : `${rankLabel(r)}`);
const isPile = (m: HandFootMeld) => m.cards.length >= PILE;
export const kindOf = (m: HandFootMeld): 'clean' | 'dirty' | 'wild' => (m.rank === 0 ? 'wild' : m.cards.some(isWild) ? 'dirty' : 'clean');
/** Most wild cards a meld of `size` may hold (naturals must outnumber them two to one). */
export const maxWilds = (size: number) => (size >= 6 ? 2 : 1);

/**
 * Split cards into melds: naturals by rank, wilds spread over them (topping new melds up to three
 * first), or, if every card is wild, one wild meld. Returns rank → cards, or null.
 */
export function groupHF(cards: string[], incomplete: Map<number, string[]>): Map<number, string[]> | null {
  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));
  if (!naturals.length) return wilds.length ? new Map([[0, wilds]]) : null;
  if (naturals.some((c) => isRedThree(c) || isBlackThree(c))) return null;
  const groups = groupByRank(naturals);
  const size = (r: number) => (incomplete.get(r)?.length ?? 0) + groups.get(r)!.length;
  const wildsIn = (r: number) => (incomplete.get(r) ?? []).concat(groups.get(r)!).filter(isWild).length;
  for (const w of wilds) {
    const order = [...groups.keys()];
    const target =
      order.find((r) => size(r) < 3 && wildsIn(r) < maxWilds(size(r) + 1)) ?? order.find((r) => size(r) < PILE && wildsIn(r) < maxWilds(size(r) + 1));
    if (target == null) return null;
    groups.get(target)!.push(w);
  }
  return groups;
}

export function handFootFamily(config: GameConfig): GameModule<HandFootData> {
  /** Four or six play in two teams, alternate seats; otherwise everyone plays for themselves. */
  const partners = (n: number) => n === 4 || n === 6;
  const teamCount = (n: number) => (partners(n) ? 2 : n);
  const teams = (s: S) => [...Array(teamCount(s.players.length)).keys()];
  const teamOf = (s: S, seat: number) => (partners(s.players.length) ? seat % 2 : seat);
  const teamSeats = (s: S, team: number) => s.players.map((p) => p.seat).filter((i) => teamOf(s, i) === team);
  const teamName = (s: S, team: number) => sideName(s, teamSeats(s, team));
  const teamMelds = (s: S, team: number) => s.data.melds.filter((m) => m.team === team);
  const incompleteOf = (s: S, team: number) => new Map(teamMelds(s, team).filter((m) => !isPile(m)).map((m) => [m.rank, m.cards]));
  const piles = (s: S, team: number) => {
    const done = teamMelds(s, team).filter(isPile);
    return { clean: done.filter((m) => kindOf(m) === 'clean').length, dirty: done.filter((m) => kindOf(m) === 'dirty').length, wild: done.filter((m) => kindOf(m) === 'wild').length };
  };
  const topCard = (s: S) => zone(s, 'discard').cards.at(-1)?.id ?? null;
  const footZ = (seat: number) => `foot:${seat}`;
  const meldZ = (team: number) => `melds:${team}`;

  function sortHand(s: S, seat: number) {
    const key = (id: string) => (isWild(id) ? 100 + cardPoints(id) : isRedThree(id) || isBlackThree(id) ? 0 : parseCard(id).rank);
    hand(s, seat).cards.sort((a, b) => key(a.id) - key(b.id) || a.id.localeCompare(b.id));
  }

  /** The side's piles and requirements met? (and, with partners, both feet picked up) */
  function sideCanGoOut(s: S, team: number, extra?: Map<number, string[]>): boolean {
    const p = piles(s, team);
    if (extra) {
      const inc = incompleteOf(s, team);
      for (const [r, gs] of extra) {
        const all = [...(inc.get(r) ?? []), ...gs];
        if (all.length >= PILE) p[kindOf({ team, rank: r, cards: all })]++;
      }
    }
    return p.clean >= NEED.clean && p.dirty >= NEED.dirty && p.wild >= NEED.wild && teamSeats(s, team).every((i) => s.data.footTaken[i]);
  }

  /** Lay out a side: red 3s, unfinished melds in full, finished piles as their top card (the rest squared up beneath). */
  function relayout(s: S) {
    for (const t of teams(s)) {
      const z = zone(s, meldZ(t));
      const under = zone(s, `stacked:${t}`);
      const melds = teamMelds(s, t).sort((a, b) => Number(isPile(b)) - Number(isPile(a)) || b.rank - a.rank);
      z.cards = [...s.data.red3[t].map((id) => ({ id, up: true, group: -1 }))];
      under.cards = [];
      melds.forEach((m, i) => {
        if (isPile(m)) {
          // a clean pile is topped with a red card, a dirty one with a black card, a wild one with a joker
          const k = kindOf(m);
          const topId =
            (k === 'wild' ? m.cards.find((c) => parseCard(c).suit === 'X') : m.cards.find((c) => !isWild(c) && 'HD'.includes(parseCard(c).suit) === (k === 'clean'))) ??
            m.cards[0];
          z.cards.push({ id: topId, up: true, group: i });
          under.cards.push(...m.cards.filter((c) => c !== topId).map((id) => ({ id, up: true })));
        } else z.cards.push(...[...m.cards.filter((c) => !isWild(c)), ...m.cards.filter(isWild)].map((id) => ({ id, up: true, group: i })));
      });
      const p = piles(s, t);
      z.label = `${teamName(s, t)} · ${p.clean}/${NEED.clean} clean, ${p.dirty}/${NEED.dirty} dirty, ${p.wild}/${NEED.wild} wild`;
    }
  }

  /** Lay out red 3s from a seat's hand, drawing replacements. */
  function layRedThrees(s: S, seat: number) {
    for (;;) {
      const reds = ids(hand(s, seat)).filter(isRedThree);
      if (!reds.length) return;
      for (const r of reds) {
        moveCards(s, `hand:${seat}`, meldZ(teamOf(s, seat)), [r], { up: true });
        s.data.red3[teamOf(s, seat)].push(r);
      }
      log(s, `${name(s, seat)} lays out ${reds.length === 1 ? 'a red 3' : `${reds.length} red 3s`}`, seat, 'Red 3!');
      for (let i = 0; i < reds.length && zone(s, 'deck').cards.length; i++) moveTop(s, 'deck', `hand:${seat}`, 1);
    }
  }

  /** The hand is played out: pick up the foot (red 3s in it are laid out). */
  function pickUpFoot(s: S, seat: number) {
    if (s.data.footTaken[seat]) return;
    s.data.footTaken[seat] = true;
    moveCards(s, footZ(seat), `hand:${seat}`, ids(zone(s, footZ(seat))));
    log(s, `${name(s, seat)} picks up their foot`, seat, 'Foot!');
    layRedThrees(s, seat);
    sortHand(s, seat);
  }

  function startRound(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, { ...config, deck: { ...config.deck, decks: n + 1, jokers: 2 } });
    for (const z of Object.values(s.zones)) if (z.id !== 'deck') z.cards = [];
    const first = nextSeat(s, s.dealer);
    for (let k = 0; k < 13; k++)
      for (let i = 0; i < n; i++) {
        moveTop(s, 'deck', `hand:${(first + i) % n}`, 1);
        moveTop(s, 'deck', footZ((first + i) % n), 1);
      }
    d.round++;
    d.melds = [];
    d.red3 = teams(s).map(() => []);
    d.footTaken = s.players.map(() => false);
    d.received = s.players.map(() => []);
    d.result = null;
    // the first discard: a red 3 or a wild card goes back into the stock and another is turned
    for (;;) {
      moveTop(s, 'deck', 'discard', 1, { up: true });
      const top = topCard(s)!;
      if (!isWild(top) && !isRedThree(top)) break;
      const deck = zone(s, 'deck').cards;
      moveCards(s, 'discard', 'deck', [top]);
      // (buried at random in the stock: not at a spot everyone could count to)
      deck.splice(Math.floor(nextRandom(s) * (deck.length - 1)), 0, deck.pop()!);
    }
    s.players.forEach((_, i) => {
      layRedThrees(s, i);
      sortHand(s, i);
    });
    relayout(s);
    s.phase = 'draw';
    s.turn = first;
    log(s, `Round ${d.round}: ${name(s, s.dealer)} deals a hand and a foot each — first melds need ${MINIMUM[d.round - 1]}`);
  }

  /**
   * Check a meld: `cards` from hand (plus the pile's `top` when taking it). Returns the groups, or
   * throws a RuleError explaining what's wrong.
   */
  function planMeld(s: S, seat: number, cards: string[], top: string | null, forced?: Map<number, string[]>): Map<number, string[]> {
    const d = s.data;
    const team = teamOf(s, seat);
    const inc = incompleteOf(s, team);
    const groups = forced ?? groupHF(top ? [top, ...cards] : cards, inc);
    assertRule(groups && groups.size, 'Those don’t make a meld: 3–7 cards of one rank (4s to aces), with 2s and jokers wild');
    let value = 0;
    for (const [rank, gs] of groups) {
      const old = inc.get(rank) ?? [];
      const all = [...old, ...gs];
      const w = all.filter(isWild).length;
      assertRule(all.length >= 3, `A meld needs at least 3 cards`);
      assertRule(all.length <= PILE, 'A meld stops at seven cards (a pile)');
      if (rank !== 0) assertRule(w <= maxWilds(all.length), `Too many wild cards: ${maxWilds(all.length)} at most in a meld of ${all.length}`);
      if (!old.length) value += gs.reduce((n, c) => n + cardPoints(c), 0);
    }
    if (top) {
      const fromHand = cards.filter((c) => (isWild(top) ? isWild(c) : !isWild(c) && parseCard(c).rank === parseCard(top).rank)).length;
      assertRule(fromHand >= 2, isWild(top) ? 'To take a wild card you need two wild cards' : `You need two ${rankName(parseCard(top).rank)}s from your hand to take the pile`);
      const r = isWild(top) ? 0 : parseCard(top).rank;
      assertRule(!inc.has(r), `You already have an unfinished ${rankName(r)} meld: take the pile to start a new one only once it's a pile`);
    }
    if (!teamMelds(s, team).length) {
      const min = MINIMUM[d.round - 1];
      assertRule(value >= min, `Your side's first meld must be worth ${min} this round — that's ${value}`);
    }
    // in the foot, keep a card to discard unless the side can go out
    const left = ids(hand(s, seat)).length - cards.length;
    if (left < 2 && d.footTaken[seat]) assertRule(sideCanGoOut(s, team, groups), `You can’t go out yet: you need 2 clean, 2 dirty and 1 wild pile${partners(s.players.length) ? ' (and your partners in their feet)' : ''}`);
    return groups;
  }

  function applyMelds(s: S, seat: number, groups: Map<number, string[]>, fromPile: string | null) {
    const team = teamOf(s, seat);
    for (const [rank, gs] of groups) {
      let m = s.data.melds.find((x) => x.team === team && x.rank === rank && !isPile(x));
      if (!m) {
        m = { team, rank, cards: [] };
        s.data.melds.push(m);
      }
      for (const c of gs) {
        moveCards(s, c === fromPile ? 'discard' : `hand:${seat}`, meldZ(team), [c], { up: true });
        m.cards.push(c);
      }
      if (isPile(m)) log(s, `${teamName(s, team)} complete a ${kindOf(m)} pile of ${rankName(rank)}s!`, seat, `${kindOf(m)} pile!`);
    }
    relayout(s);
  }

  /** Cards out of the hand: pick up the foot, or go out. */
  function afterCardsLeft(s: S, seat: number) {
    if (hand(s, seat).cards.length) return false;
    if (!s.data.footTaken[seat]) {
      pickUpFoot(s, seat);
      return false;
    }
    endRound(s, seat);
    return true;
  }

  function endRound(s: S, outSeat: number | null) {
    const d = s.data;
    const lines = [outSeat != null ? `${name(s, outSeat)} goes out!` : 'The stock has run out'];
    for (const t of teams(s)) {
      const melds = teamMelds(s, t);
      const meldPts = melds.flatMap((m) => m.cards).reduce((n, c) => n + cardPoints(c), 0);
      const p = piles(s, t);
      const bonus = p.clean * BONUS.clean + p.dirty * BONUS.dirty + p.wild * BONUS.wild;
      const seats = teamSeats(s, t);
      const held = seats.flatMap((i) => [...ids(hand(s, i)), ...ids(zone(s, footZ(i)))]);
      const heldReds = held.filter(isRedThree).length;
      const heldPts = held.filter((c) => !isRedThree(c)).reduce((n, c) => n + cardPoints(c), 0);
      const reds = d.red3[t].length * 100 - heldReds * 100;
      const out = outSeat != null && teamOf(s, outSeat) === t ? 100 : 0;
      const total = meldPts + bonus + reds + out - heldPts;
      d.scores[t] += total;
      const parts = [`melds ${meldPts}`, bonus && `piles ${bonus}`, reds && `red 3s ${reds}`, out && `out ${out}`, heldPts && `held −${heldPts}`].filter(Boolean);
      lines.push(`${teamName(s, t)}: ${parts.join(', ')} = ${total >= 0 ? '+' : ''}${total} → ${d.scores[t]}`);
    }
    showHands(s);
    d.result = { lines };
    s.turn = null;
    log(s, lines[0], outSeat ?? undefined, outSeat != null ? 'Out!' : undefined);
    if (d.round >= ROUNDS) {
      const best = Math.max(...d.scores);
      s.winner = teams(s).filter((t) => d.scores[t] === best).flatMap((t) => teamSeats(s, t));
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
  }

  // ---- bots -----------------------------------------------------------------------------

  /**
   * A meld the bot can make now: natural groups of 3+ (and additions), a wild card to finish a pile
   * that's a card or two short, wilds onto the wild meld, or a new wild meld. `target` sends wild
   * cards to one particular meld.
   */
  function botMeld(s: S, seat: number): { cards: string[]; target?: number } | null {
    const team = teamOf(s, seat);
    const own = ids(hand(s, seat));
    const inc = incompleteOf(s, team);
    const naturals = own.filter((c) => !isWild(c) && !isRedThree(c) && !isBlackThree(c));
    const byRank = groupByRank(naturals);
    const tries: { cards: string[]; target?: number }[] = [];
    const all: string[] = [];
    for (const [r, cs] of byRank) {
      const room = PILE - (inc.get(r)?.length ?? 0);
      if (inc.has(r) || cs.length >= 3) all.push(...cs.slice(0, room));
    }
    if (all.length) tries.push({ cards: all });
    const wilds = own.filter(isWild);
    const p = piles(s, team);
    for (const [r, cs] of inc) {
      if (r === 0) tries.push({ cards: wilds.slice(0, PILE - cs.length), target: 0 });
      else if (p.dirty < NEED.dirty && PILE - cs.length <= 2) tries.push({ cards: wilds.slice(0, 1), target: r });
    }
    if (wilds.length >= 3 && !inc.has(0) && p.wild < NEED.wild) tries.push({ cards: wilds.slice(0, PILE) });
    for (const t of tries) {
      // trim until it's allowed (e.g. keeping a card to discard when not allowed out)
      for (let cards = t.cards; cards.length; cards = cards.slice(0, -1)) {
        try {
          planMeld(s, seat, cards, null, t.target != null ? new Map([[t.target, cards]]) : undefined);
          return { cards, target: t.target };
        } catch {
          /* fewer */
        }
      }
    }
    return null;
  }

  function botTake(s: S, seat: number): Action | null {
    const top = topCard(s);
    if (!top || isBlackThree(top)) return null;
    const own = ids(hand(s, seat));
    const match = own.filter((c) => (isWild(top) ? isWild(c) : !isWild(c) && parseCard(c).rank === parseCard(top).rank));
    if (match.length < 2) return null;
    for (const cards of [match.slice(0, 2), match.slice(0, 6)]) {
      try {
        planMeld(s, seat, cards, top);
        return { type: 'takePile', cards };
      } catch {
        /* next */
      }
    }
    return null;
  }

  function botDiscard(s: S, seat: number): Action {
    const own = ids(hand(s, seat));
    const team = teamOf(s, seat);
    const theirs = new Set(teamMelds(s, 1 - team).map((m) => m.rank));
    const count = (r: number) => own.filter((c) => !isWild(c) && parseCard(c).rank === r).length;
    const score = (c: string) => {
      if (isBlackThree(c)) return -100;
      if (isWild(c)) return 1000;
      const r = parseCard(c).rank;
      return count(r) * 40 + (theirs.has(r) ? 60 : 0) + cardPoints(c);
    };
    return { type: 'discard', cards: [[...own].sort((a, b) => score(a) - score(b))[0]] };
  }

  const module: GameModule<HandFootData> = {
    config,

    setup(players, seed, options) {
      assertRule(players.length >= 2 && players.length <= 6, 'Hand and Foot is for 2 to 6 players');
      const s = createState<HandFootData>(config, players, seed, options, {
        round: 0,
        scores: Array(teamCount(players.length)).fill(0),
        melds: [],
        red3: [],
        footTaken: [],
        received: [],
        result: null,
      });
      s.dealer = players.length - 1;
      startRound(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next round', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.turn !== seat) return [];
      const own = ids(hand(s, seat));
      const top = topCard(s);
      if (s.phase === 'draw') {
        const out: ActionSpec[] = [{ type: 'draw', label: zone(s, 'deck').cards.length ? 'Draw 2' : 'No stock — end the round', style: 'primary', zone: 'deck' }];
        if (top && !isBlackThree(top)) out.push({ type: 'takePile', label: 'Take the pile', select: { min: 2, max: own.length, cards: own } });
        return out;
      }
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [{ type: 'meld', label: 'Meld', style: 'primary', select: { min: 1, max: own.length, cards: own } }];
      const wilds = own.filter(isWild);
      const room = teamMelds(s, teamOf(s, seat)).filter((m) => !isPile(m) && (m.rank === 0 || m.cards.filter(isWild).length < maxWilds(m.cards.length + 1)));
      if (wilds.length && room.length)
        out.push({
          type: 'addWild',
          label: 'Add wilds to…',
          select: { min: 1, max: Math.min(PILE, wilds.length), cards: wilds },
          choose: { label: 'Add to which meld?', options: room.map((m) => ({ value: m.rank, label: `${rankName(m.rank)} · ${m.cards.length} cards` })) },
        });
      out.push({ type: 'discard', label: 'Discard', quick: 'swipe', select: { min: 1, max: 1, cards: own } });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'handOver', 'Round in progress');
          s.dealer = nextSeat(s, s.dealer);
          return startRound(s);
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.scores = teams(s).map(() => 0);
          d.round = 0;
          s.winner = undefined;
          return startRound(s);
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'draw': {
          assertRule(s.phase === 'draw', 'You’ve already drawn');
          const stock = zone(s, 'deck').cards.length;
          if (!stock) return endRound(s, null);
          const before = ids(hand(s, seat));
          moveTop(s, 'deck', `hand:${seat}`, Math.min(2, stock));
          log(s, `${who} draws ${Math.min(2, stock) === 1 ? 'a card' : '2 cards'}`, seat, 'Drew', undefined, { from: 'deck' });
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
          assertRule(top && !isBlackThree(top), 'A black 3 on top blocks the pile');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.every((c) => own.includes(c)) && new Set(cards).size === cards.length, 'Meld cards from your hand');
          const groups = planMeld(s, seat, cards, top);
          applyMelds(s, seat, groups, top);
          // then the next six cards of the pile (seven in all) come into the hand
          const pile = ids(zone(s, 'discard'));
          const taken = pile.slice(-6);
          moveCards(s, 'discard', `hand:${seat}`, taken);
          d.received[seat] = taken;
          sortHand(s, seat);
          log(s, `${who} takes the pile (${taken.length + 1} cards) with the ${rankName(isWild(top) ? 0 : parseCard(top).rank)}`, seat, `Took ${taken.length + 1}`, undefined, { from: 'discard' });
          s.phase = 'play';
          afterCardsLeft(s, seat);
          return;
        }
        case 'meld':
        case 'addWild': {
          assertRule(s.phase === 'play', 'Draw first');
          const cards = a.cards ?? [];
          const own = ids(hand(s, seat));
          assertRule(cards.length && cards.every((c) => own.includes(c)) && new Set(cards).size === cards.length, 'Meld cards from your hand');
          let forced: Map<number, string[]> | undefined;
          if (a.type === 'addWild') {
            assertRule(cards.every(isWild), 'Choose wild cards');
            assertRule(incompleteOf(s, teamOf(s, seat)).has(a.amount ?? -1), 'Choose one of your side’s unfinished melds');
            forced = new Map([[a.amount!, cards]]);
          }
          const groups = planMeld(s, seat, cards, null, forced);
          applyMelds(s, seat, groups, null);
          d.received[seat] = d.received[seat].filter((c) => !cards.includes(c));
          log(s, `${who} melds ${[...groups].map(([r, gs]) => `${gs.length}× ${rankName(r)}`).join(', ')}`, seat, 'Meld!');
          afterCardsLeft(s, seat);
          return;
        }
        case 'discard': {
          assertRule(s.phase === 'play', 'Draw first');
          const card = a.cards?.[0];
          const own = ids(hand(s, seat));
          assertRule(card && own.includes(card), 'Choose a card to discard');
          // a last card can only go if the side may go out — or the stock is gone (a red 3 drawn as the
          // last card can leave a single card), when the round is over anyway
          const stuck = own.length === 1 && d.footTaken[seat] && !sideCanGoOut(s, teamOf(s, seat));
          if (stuck) assertRule(zone(s, 'deck').cards.length === 0, `You can’t go out yet: you need 2 clean, 2 dirty and 1 wild pile${partners(s.players.length) ? ' (and your partners in their feet)' : ''}`);
          moveCards(s, `hand:${seat}`, 'discard', [card], { up: true });
          if (stuck) return endRound(s, null);
          d.received[seat] = [];
          log(s, `${who} discards a ${isWild(card) ? 'wild card' : rankName(parseCard(card).rank)}`, seat, isWild(card) ? 'Wild' : rankName(parseCard(card).rank), undefined, { to: 'discard' });
          if (afterCardsLeft(s, seat)) return;
          s.phase = 'draw';
          s.turn = nextSeat(s, seat);
          return;
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    redactData(s, viewer) {
      return { ...s.data, received: ownOnly(s.data.received, viewer) };
    },

    bot(s, seat) {
      if (s.turn !== seat) return null;
      if (s.phase === 'draw') return botTake(s, seat) ?? { type: 'draw' };
      if (s.phase === 'play') {
        const meld = botMeld(s, seat);
        // (wilds for one particular meld go through "add wilds")
        if (meld) return meld.target != null ? { type: 'addWild', cards: meld.cards, amount: meld.target } : { type: 'meld', cards: meld.cards };
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
      if (s.phase === 'draw') headline = s.turn === viewer ? 'Draw 2 — or take the pile' : `${turnName} to draw`;
      else if (s.phase === 'play') headline = s.turn === viewer ? 'Meld, then discard' : `${turnName} is playing`;
      else headline = d.result?.lines[0] ?? '';
      let hint: string | undefined;
      if (viewer >= 0 && (s.phase === 'draw' || s.phase === 'play')) {
        const team = teamOf(s, viewer);
        hint = teamMelds(s, team).length
          ? d.footTaken[viewer]
            ? 'In your foot'
            : `${zone(s, footZ(viewer)).cards.length}-card foot waiting`
          : `Round ${d.round}: first meld needs ${MINIMUM[d.round - 1]}`;
      }
      return {
        headline,
        hint,
        seats: s.players.map((_, i) => ({ badge: `${d.scores[teamOf(s, i)]} pts${d.footTaken[i] ? ' · in foot' : ''}`, tag: i === s.dealer ? 'D' : undefined })),
        scoreboard: {
          columns: ['Clean', 'Dirty', 'Wild', 'Score'],
          rows: teams(s).map((t) => {
            const p = piles(s, t);
            return { name: teamName(s, t), values: [p.clean, p.dirty, p.wild, d.scores[t]], highlight: !!s.winner && teamSeats(s, t).some((i) => s.winner!.includes(i)) };
          }),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win!`, lines: d.result?.lines ?? [] }
            : s.phase === 'handOver'
              ? { title: `Round ${d.round} of ${ROUNDS}`, lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
  return module;
}
