import { cardLabel, cardName, parseCard } from '../cards';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, sortHand, zone } from '../state';
import { familyRules, assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';
/** This family's settings in game.json (generated from the schema). */
export type { CornersRules } from '../schema.gen';

export interface CornersData {
  handNo: number;
  /** Penalty points per player (lowest wins). */
  scores: number[];
  /** With the stock gone: players who passed in a row (everyone passing ends the hand). */
  passes: number;
  /** Plays made this turn (for the headline). */
  moved: number;
  result: { lines: string[] } | null;
}

type S = GameState<CornersData>;

/** The eight piles: four sides (any card may fill an empty one) and four corners (kings only). */
export const SIDES = ['north', 'east', 'south', 'west'] as const;
export const CORNERS = ['northEast', 'southEast', 'southWest', 'northWest'] as const;
const PILES = [...SIDES, ...CORNERS];
type Pile = (typeof PILES)[number];
const PILE_NAME: Record<Pile, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
  northEast: 'NE',
  southEast: 'SE',
  southWest: 'SW',
  northWest: 'NW',
};

const red = (id: string) => 'HD'.includes(parseCard(id).suit);
const rank = (id: string) => (parseCard(id).rank === 14 ? 1 : parseCard(id).rank); // ace low
/** Does `card` go on `top`: one lower and the other colour. */
export const fits = (card: string, top: string) => rank(card) === rank(top) - 1 && red(card) !== red(top);
export const penalty = (id: string) => (parseCard(id).rank === 13 ? 10 : 1);

export function cornersFamily(config: GameConfig): GameModule<CornersData> {
  const R = familyRules(config, 'corners');
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const cards = (s: S, p: Pile) => ids(zone(s, p));
  const top = (s: S, p: Pile) => cards(s, p).at(-1);
  const isCorner = (p: Pile) => (CORNERS as readonly string[]).includes(p);
  const pileOf = (s: S, card: string) => PILES.find((p) => top(s, p) === card);

  /** Can `card` (from `seat`'s hand, or the top of a pile, meaning that whole pile) go onto `to`? */
  function canPlace(s: S, seat: number, card: string, to: Pile): boolean {
    const from = pileOf(s, card);
    const inHand = ids(hand(s, seat)).includes(card);
    if (!from && !inHand) return false;
    if (from === to) return false;
    // a moving pile is judged by its bottom card
    const lead = from ? cards(s, from)[0] : card;
    const t = top(s, to);
    if (t) return fits(lead, t);
    // (a corner pile has nowhere better to go: no shuffling kings between corners)
    if (isCorner(to)) return rank(lead) === 13 && !(from && isCorner(from));
    // an empty side takes any card from hand (moving a whole pile there gains nothing)
    return inHand;
  }

  /** Every card `seat` could place on `to` right now (hand cards, and tops of movable piles). */
  const placeable = (s: S, seat: number, to: Pile) =>
    [...ids(hand(s, seat)), ...PILES.map((p) => top(s, p)).filter((c): c is string => !!c)].filter((c) => canPlace(s, seat, c, to));

  function labelPiles(s: S) {
    for (const p of PILES) {
      const cs = cards(s, p);
      // (short labels: nine piles have to fit in two rows)
      zone(s, p).label = cs.length > 1 ? `${PILE_NAME[p]} · ${cardLabel(cs[0])}↓` : isCorner(p) && !cs.length ? `${PILE_NAME[p]} · K` : PILE_NAME[p];
    }
  }

  function startHand(s: S) {
    const d = s.data;
    resetDeck(s, config);
    for (const z of Object.values(s.zones)) if (z.id !== 'deck') z.cards = [];
    const n = s.players.length;
    for (let k = 0; k < 7; k++) for (let i = 1; i <= n; i++) moveTop(s, 'deck', `hand:${(s.dealer + i) % n}`, 1);
    for (const p of SIDES) moveTop(s, 'deck', p, 1, { up: true });
    s.players.forEach((_, i) => sortHand(s, i));
    d.handNo++;
    d.passes = 0;
    d.moved = 0;
    d.result = null;
    s.phase = 'play';
    s.turn = nextSeat(s, s.dealer);
    labelPiles(s);
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals seven each and turns up four`, undefined, undefined, undefined, { from: 'deck' });
  }

  function endHand(s: S, winner: number | null) {
    const d = s.data;
    const lines = [winner != null ? `${name(s, winner)} is out of cards!` : 'Nobody can play on — the hand is over'];
    s.players.forEach((_, i) => {
      const pts = ids(hand(s, i)).reduce((k, c) => k + penalty(c), 0);
      d.scores[i] += pts;
      if (i !== winner) lines.push(`${name(s, i)}: +${pts} → ${d.scores[i]}`);
      for (const c of hand(s, i).cards) c.up = true;
    });
    d.result = { lines };
    s.turn = null;
    log(s, lines[0], winner ?? undefined, winner != null ? 'Out!' : undefined);
    if (Math.max(...d.scores) >= target(s)) {
      const best = Math.min(...d.scores);
      s.winner = s.players.map((p) => p.seat).filter((i) => d.scores[i] === best);
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
  }

  function nextTurn(s: S, seat: number) {
    s.data.moved = 0;
    s.turn = nextSeat(s, seat);
  }

  // ---- bots ---------------------------------------------------------------------------------

  /**
   * One good move, or null: kings into corners, piles moved together (freeing a side for a hand
   * card), hand cards onto piles (high ones first: they cost most if stuck), then an empty side
   * filled with the highest card left.
   */
  function botMove(s: S, seat: number): Action | null {
    const own = ids(hand(s, seat));
    const byValue = [...own].sort((a, b) => penalty(b) * 20 + rank(b) - (penalty(a) * 20 + rank(a)));
    for (const c of CORNERS) {
      const k = byValue.find((x) => canPlace(s, seat, x, c));
      if (k) return { type: `to:${c}`, cards: [k] };
    }
    // moving a pile (onto another, or a king pile into a corner) frees a space
    for (const from of PILES)
      for (const to of PILES) {
        const t = top(s, from);
        if (t && canPlace(s, seat, t, to)) return { type: `to:${to}`, cards: [t] };
      }
    for (const c of byValue) for (const p of PILES) if (top(s, p) && canPlace(s, seat, c, p)) return { type: `to:${p}`, cards: [c] };
    const empty = SIDES.find((p) => !top(s, p));
    if (empty && byValue.length) return { type: `to:${empty}`, cards: [byValue[0]] };
    return null;
  }

  const module: GameModule<CornersData> = {
    config,

    setup(players, seed, options) {
      const s = createState<CornersData>(config, players, seed, options, { handNo: 0, scores: players.map(() => 0), passes: 0, moved: 0, result: null });
      s.dealer = players.length - 1;
      startHand(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'handOver') return [{ type: 'next', label: 'Next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase !== 'play' || s.turn !== seat) return [];
      // select a card (from hand, or a pile's top card to move the pile), then tap where it goes
      const out: ActionSpec[] = PILES.map((p) => ({
        type: `to:${p}`,
        label: `Onto ${isCorner(p) ? `the ${PILE_NAME[p]} corner` : PILE_NAME[p]}`,
        select: { min: 1, max: 1, cards: placeable(s, seat, p) },
        zone: p,
        menu: true,
      }));
      if (zone(s, 'deck').cards.length) out.unshift({ type: 'draw', label: 'Draw & end turn', style: 'primary', zone: 'deck' });
      else out.unshift({ type: 'pass', label: 'End turn', style: 'primary' });
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
      assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
      if (a.type === 'draw') {
        assertRule(zone(s, 'deck').cards.length > 0, 'The stock is empty');
        moveTop(s, 'deck', `hand:${seat}`, 1);
        sortHand(s, seat);
        d.passes = 0;
        log(s, `${who} draws`, seat, 'Draws', undefined, { from: 'deck' });
        return nextTurn(s, seat);
      }
      if (a.type === 'pass') {
        assertRule(zone(s, 'deck').cards.length === 0, 'Draw a card to end your turn');
        d.passes = d.moved ? 0 : d.passes + 1;
        log(s, `${who} ends their turn`, seat, d.moved ? 'Done' : 'Pass');
        if (d.passes >= s.players.length) return endHand(s, null);
        return nextTurn(s, seat);
      }
      const to = a.type.startsWith('to:') ? (a.type.slice(3) as Pile) : null;
      assertRule(to && PILES.includes(to), `Unknown action ${a.type}`);
      const card = a.cards?.[0];
      assertRule(
        card && canPlace(s, seat, card, to),
        `That can’t go there: one lower and the other colour${isCorner(to) ? ', or a king into an empty corner' : ''}`,
      );
      const from = pileOf(s, card);
      if (from) {
        const moving = cards(s, from);
        moveCards(s, from, to, moving, { up: true });
        log(s, `${who} moves the ${cardLabel(moving[0])} pile${isCorner(to) ? ' into a corner' : ` onto ${PILE_NAME[to]}`}`, seat, `${cardLabel(moving[0])} →`);
      } else {
        moveCards(s, `hand:${seat}`, to, [card], { up: true, by: seat });
        log(
          s,
          `${who} plays the ${cardName(card)}${isCorner(to) && cards(s, to).length === 1 ? ' into a corner' : ` on ${isCorner(to) ? `the ${PILE_NAME[to]} corner` : PILE_NAME[to]}`}`,
          seat,
          cardLabel(card),
          undefined,
          { to },
        );
      }
      d.moved++;
      labelPiles(s);
      if (!hand(s, seat).cards.length) return endHand(s, seat);
    },

    bot(s, seat) {
      if (s.phase !== 'play' || s.turn !== seat) return null;
      return botMove(s, seat) ?? (zone(s, 'deck').cards.length ? { type: 'draw' } : { type: 'pass' });
    },

    standings(s) {
      return placesFromScores(s.data.scores, true);
    },

    status(s, viewer) {
      const d = s.data;
      let headline: string;
      if (s.phase === 'play') {
        const stock = zone(s, 'deck').cards.length;
        headline =
          s.turn === viewer
            ? `Your turn: select a card, tap a pile to play it — then ${stock ? 'draw to end your turn' : 'end your turn'}`
            : `${name(s, s.turn!)} is playing`;
      } else headline = d.result?.lines[0] ?? '';
      return {
        headline,
        seats: s.players.map((_, i) => ({
          badge: `${hand(s, i).cards.length} card${hand(s, i).cards.length === 1 ? '' : 's'} · ${d.scores[i]} pts`,
          tag: i === s.dealer ? 'D' : undefined,
        })),
        scoreboard: { columns: ['Points'], rows: s.players.map((p, i) => ({ name: p.name, values: [d.scores[i]], highlight: s.winner?.includes(i) })) },
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
            : s.phase === 'handOver'
              ? { title: 'Hand over', lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
  return module;
}
