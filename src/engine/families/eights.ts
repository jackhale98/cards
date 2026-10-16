import { cardLabel, cardName, parseCard, rankLabel, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../cards';
import { shuffle } from '../rng';
import { createState, hand, ids, log, moveCards, moveTop, name, placesFromScores, resetDeck, sortHand, zone } from '../state';
import { botBudget, botLevel, dealUnseen, easyMove, edge, fork, playOut, type SearchGame, searchMove } from '../bots/search';
import { familyRules, assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';
/** This family's settings in game.json (generated from the schema). */
export type { EightsRules } from '../schema.gen';

export interface EightsData {
  handNo: number;
  /** Penalty points, per player (lowest wins). */
  scores: number[];
  /** The suit to follow: the top card's, or the one named with an eight. */
  suit: Suit;
  /** 1 = clockwise, −1 after an ace reverses it. */
  dir: 1 | -1;
  /** Cards the next player must draw (twos stack) unless they play a two. */
  pendingDraw: number;
  /** Players who have said "last card" (for their next time down to one). */
  announced: boolean[];
  /** A player down to one card who hasn't said so yet: they draw two if the next player moves first. */
  unannounced: number | null;
  result: { lines: string[] } | null;
}

type S = GameState<EightsData>;

const PILE = 'table';
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

/** Penalty value of a card left in hand: eight 50, picture 10, others face value (ace 1). */
export function eightsPoints(id: string): number {
  const { rank } = parseCard(id);
  if (rank === 8) return 50;
  if (rank === 14) return 1;
  return rank >= 11 ? 10 : rank;
}

export function eightsFamily(config: GameConfig): GameModule<EightsData> {
  const R = familyRules(config, 'eights');
  const target = (s: S) => Number(s.options.target ?? R.end.target);
  const specials = (s: S) => s.options.specials !== false;
  const lastCardRule = (s: S) => s.options.lastCard !== false;
  const top = (s: S) => zone(s, PILE).cards.at(-1)!.id;
  const rankOf = (id: string) => parseCard(id).rank;
  const step = (s: S, seat: number, k = 1) => {
    const n = s.players.length;
    return (((seat + s.data.dir * k) % n) + n) % n;
  };

  /** Cards `seat` may play now (an eight only when no two is pending). */
  function legal(s: S, seat: number): string[] {
    const d = s.data;
    const own = ids(hand(s, seat));
    if (d.pendingDraw) return own.filter((c) => rankOf(c) === 2);
    const t = top(s);
    return own.filter((c) => rankOf(c) === 8 || parseCard(c).suit === d.suit || (rankOf(t) !== 8 && rankOf(c) === rankOf(t)));
  }

  /** Draw `k` cards, turning the pile (but its top card) into a new stock whenever the stock runs out. */
  function drawCards(s: S, seat: number, k: number): number {
    let got = 0;
    for (let i = 0; i < k; i++) {
      if (!zone(s, 'deck').cards.length) {
        const pile = zone(s, PILE).cards;
        if (pile.length <= 1) break;
        const rest = pile.slice(0, -1).map((c) => c.id);
        zone(s, PILE).cards = pile.slice(-1);
        zone(s, 'deck').cards = shuffle(rest, s).map((id) => ({ id }));
        log(s, 'The stock is empty — the pile is shuffled into a new stock');
      }
      moveTop(s, 'deck', `hand:${seat}`, 1);
      got++;
    }
    s.data.announced[seat] = false;
    sortHand(s, seat);
    return got;
  }

  /** Anyone still able to draw? (Stock, or a pile with more than its top card.) */
  const canDraw = (s: S) => zone(s, 'deck').cards.length > 0 || zone(s, PILE).cards.length > 1;

  function updatePile(s: S) {
    const z = zone(s, PILE);
    const t = top(s);
    z.label = rankOf(t) === 8 ? `Pile · ${SUIT_SYMBOL[s.data.suit]} called` : s.data.pendingDraw ? `Pile · draw ${s.data.pendingDraw}` : 'Pile';
  }

  /** Before the next player's move: a player who didn't say "last card" in time draws two. */
  function checkLastCard(s: S, seat: number) {
    const d = s.data;
    if (d.unannounced == null || d.unannounced === seat) return;
    const late = d.unannounced;
    d.unannounced = null;
    if (hand(s, late).cards.length !== 1) return;
    const got = drawCards(s, late, 2);
    log(s, `${name(s, late)} didn't say “last card” — draws ${got}`, late, `+${got}`);
  }

  function startHand(s: S) {
    const d = s.data;
    const n = s.players.length;
    resetDeck(s, { ...config, deck: { ...config.deck, decks: n >= 6 ? 2 : 1 } });
    const size = n === 2 ? 7 : 5;
    for (let k = 0; k < size; k++) for (let i = 1; i <= n; i++) moveTop(s, 'deck', `hand:${(s.dealer + i) % n}`, 1);
    s.players.forEach((_, i) => sortHand(s, i));
    moveTop(s, 'deck', PILE, 1, { up: true });
    d.handNo++;
    d.dir = 1;
    d.pendingDraw = 0;
    d.announced = s.players.map(() => false);
    d.unannounced = null;
    d.result = null;
    const t = top(s);
    d.suit = parseCard(t).suit as Suit;
    s.phase = 'play';
    s.turn = step(s, s.dealer);
    log(s, `Hand ${d.handNo}: ${name(s, s.dealer)} deals ${size} each and turns up the ${cardName(t)}`, undefined, undefined, undefined, { from: 'deck' });
    // a turned-up special card counts as played by the dealer
    if (rankOf(t) === 8) {
      s.phase = 'nominate';
      s.turn = s.dealer;
    } else if (specials(s)) {
      if (rankOf(t) === 14 && n > 2) {
        d.dir = -1;
        s.turn = step(s, s.dealer);
      } else if (rankOf(t) === 2) d.pendingDraw = 2;
      else if (rankOf(t) === 12) s.turn = step(s, s.dealer, 2);
    }
    updatePile(s);
  }

  /** The hand is over: `winner` went out (or null when play is blocked and everyone scores their cards). */
  function endHand(s: S, winner: number | null) {
    const d = s.data;
    const lines = [winner != null ? `${name(s, winner)} is out!` : 'Nobody can play or draw — the hand is blocked'];
    s.players.forEach((_, i) => {
      if (i === winner) return;
      const pts = ids(hand(s, i)).reduce((n, c) => n + eightsPoints(c), 0);
      d.scores[i] += pts;
      lines.push(`${name(s, i)}: +${pts} → ${d.scores[i]}`);
      for (const c of hand(s, i).cards) c.up = true;
    });
    d.result = { lines };
    d.unannounced = null;
    s.turn = null;
    log(s, lines[0], winner ?? undefined, winner != null ? 'Out!' : undefined);
    if (Math.max(...d.scores) >= target(s)) {
      const best = Math.min(...d.scores);
      s.winner = s.players.map((p) => p.seat).filter((i) => d.scores[i] === best);
      s.phase = 'gameOver';
    } else s.phase = 'handOver';
  }

  /** Play a card (an eight with the suit it names). */
  function play(s: S, seat: number, card: string, named?: Suit) {
    const d = s.data;
    const n = s.players.length;
    moveCards(s, `hand:${seat}`, PILE, [card], { up: true, by: seat });
    const r = rankOf(card);
    d.suit = r === 8 ? named! : (parseCard(card).suit as Suit);
    log(
      s,
      `${name(s, seat)} plays the ${cardName(card)}${r === 8 ? ` and calls ${SUIT_NAME[named!].toLowerCase()}` : ''}`,
      seat,
      r === 8 ? `8 → ${SUIT_SYMBOL[named!]}` : cardLabel(card),
      undefined,
      { to: PILE },
    );
    const left = hand(s, seat).cards.length;
    // going out ends the hand at once, whatever the card
    if (!left) return endHand(s, seat);
    if (left === 1 && lastCardRule(s)) {
      if (d.announced[seat] || s.players[seat].bot) {
        if (!d.announced[seat]) log(s, `${name(s, seat)}: “Last card!”`, seat, 'Last card!');
        d.announced[seat] = true;
      } else d.unannounced = seat;
    }
    let next = step(s, seat);
    if (specials(s)) {
      if (r === 12) {
        log(s, `${name(s, next)} is skipped`, next, 'Skipped');
        next = step(s, seat, 2);
      } else if (r === 14 && n > 2) {
        d.dir = d.dir === 1 ? -1 : 1;
        next = step(s, seat);
        log(s, 'Play reverses direction');
      } else if (r === 2) d.pendingDraw += 2;
    }
    s.turn = next;
    updatePile(s);
  }

  // ---- bots ---------------------------------------------------------------------------------

  function bestSuit(s: S, seat: number): Suit {
    const own = ids(hand(s, seat)).filter((c) => rankOf(c) !== 8);
    const count = (x: Suit) => own.filter((c) => parseCard(c).suit === x).reduce((n, c) => n + 1 + eightsPoints(c) / 100, 0);
    return [...SUITS].sort((a, b) => count(b) - count(a))[0];
  }

  function botMove(s: S, seat: number): Action {
    const options = legal(s, seat);
    const plain = options.filter((c) => rankOf(c) !== 8);
    if (plain.length) {
      // shed the costliest card, keeping eights for when nothing else goes
      const pick = [...plain].sort((a, b) => eightsPoints(b) - eightsPoints(a))[0];
      return { type: 'play', cards: [pick] };
    }
    const eight = options.find((c) => rankOf(c) === 8);
    if (eight) return { type: 'eight', cards: [eight], amount: SUITS.indexOf(bestSuit(s, seat)) };
    return canDraw(s) ? { type: 'draw' } : { type: 'pass' };
  }

  function quickBot(s: S, seat: number): Action | null {
    if (s.phase === 'nominate' && s.turn === seat) return { type: 'nominate', amount: SUITS.indexOf(bestSuit(s, seat)) };
    if (s.phase !== 'play' || s.turn !== seat) return null;
    return botMove(s, seat);
  }

  // the search bot: imagine the other hands and the stock, play each option out to the end of the hand
  const search: SearchGame<EightsData> = {
    determinize(s, viewer) {
      const c = fork(s);
      dealUnseen(c, [...c.players.filter((p) => p.seat !== viewer).map((p) => ({ zone: `hand:${p.seat}` })), { zone: 'deck' }]);
      return c;
    },
    candidates(s, seat) {
      const options = legal(s, seat);
      const moves: Action[] = options.filter((c) => rankOf(c) !== 8).map((c) => ({ type: 'play', cards: [c] }));
      // one eight is as good as another: try it with each suit
      const eight = options.find((c) => rankOf(c) === 8);
      if (eight) moves.push(...SUITS.map((_, i) => ({ type: 'eight', cards: [eight], amount: i })));
      if (canDraw(s)) moves.push({ type: 'draw' });
      else if (!moves.length) moves.push({ type: 'pass' });
      return moves;
    },
    apply: (s, seat, a) => module.apply(s, seat, a),
    rollout: (s) => playOut(module, quickBot, s, (x) => x.phase !== 'play' && x.phase !== 'nominate'),
    score: (before, after, seat) => edge(before.data.scores, after.data.scores, seat, true),
  };

  const suitChoices = () => SUITS.map((x, i) => ({ value: i, label: `${SUIT_SYMBOL[x]} ${SUIT_NAME[x]}` }));

  const module: GameModule<EightsData> = {
    config,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<EightsData>(config, players, seed, options, {
        handNo: 0,
        scores: players.map(() => 0),
        suit: 'S',
        dir: 1,
        pendingDraw: 0,
        announced: [],
        unannounced: null,
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
      const out: ActionSpec[] = [];
      // say it before (or right after) going down to one card
      const size = hand(s, seat).cards.length;
      if (lastCardRule(s) && !d.announced[seat] && (d.unannounced === seat || (s.turn === seat && s.phase === 'play' && size === 2)))
        out.push({ type: 'lastCard', label: 'Last card!', style: d.unannounced === seat ? 'danger' : 'quiet' });
      if (s.turn !== seat) return out;
      if (s.phase === 'nominate')
        return [{ type: 'nominate', label: 'Call a suit', style: 'primary', choose: { label: 'The eight calls', options: suitChoices() } }];
      if (s.phase !== 'play') return out;
      const options = legal(s, seat);
      const plain = options.filter((c) => rankOf(c) !== 8);
      const eights = options.filter((c) => rankOf(c) === 8);
      if (plain.length) out.unshift({ type: 'play', label: 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: plain } });
      if (eights.length)
        out.push({ type: 'eight', label: 'Play an 8', select: { min: 1, max: 1, cards: eights }, choose: { label: 'Call a suit', options: suitChoices() } });
      if (canDraw(s))
        out.push({ type: 'draw', label: d.pendingDraw ? `Draw ${d.pendingDraw}` : 'Draw', style: options.length ? 'quiet' : 'primary', zone: 'deck' });
      else if (!options.length) out.push({ type: 'pass', label: 'Pass (no cards to draw)', style: 'primary' });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'handOver', 'Hand in progress');
          s.dealer = (s.dealer + 1) % s.players.length;
          return startHand(s);
        case 'rematch':
          assertRule(s.phase === 'gameOver', 'Game not over');
          d.scores = d.scores.map(() => 0);
          d.handNo = 0;
          s.winner = undefined;
          return startHand(s);
        case 'lastCard':
          assertRule(lastCardRule(s) && (d.unannounced === seat || hand(s, seat).cards.length <= 2), 'You have more than one card to go');
          d.announced[seat] = true;
          if (d.unannounced === seat) d.unannounced = null;
          log(s, `${who}: “Last card!”`, seat, 'Last card!');
          return;
      }
      assertRule(s.turn === seat, 'Not your turn');
      switch (a.type) {
        case 'nominate': {
          assertRule(s.phase === 'nominate', 'Not now');
          const suit = SUITS[a.amount ?? -1];
          assertRule(suit, 'Choose a suit');
          d.suit = suit;
          log(s, `${who} calls ${SUIT_NAME[suit].toLowerCase()} for the turned-up eight`, seat, `8 → ${SUIT_SYMBOL[suit]}`);
          s.phase = 'play';
          s.turn = step(s, s.dealer);
          updatePile(s);
          return;
        }
        case 'play':
        case 'eight': {
          assertRule(s.phase === 'play', 'Not now');
          const card = a.cards?.[0];
          assertRule(
            card && legal(s, seat).includes(card),
            d.pendingDraw ? `Play a 2, or draw ${d.pendingDraw}` : `Match the ${SUIT_NAME[d.suit].toLowerCase()} or the rank — or play an 8`,
          );
          const isEight = rankOf(card) === 8;
          const named = SUITS[a.amount ?? -1];
          assertRule(!isEight || named, 'Call a suit for your eight');
          checkLastCard(s, seat);
          return play(s, seat, card, isEight ? named : undefined);
        }
        case 'draw': {
          assertRule(s.phase === 'play', 'Not now');
          assertRule(canDraw(s), 'There’s nothing left to draw');
          checkLastCard(s, seat);
          const k = d.pendingDraw || 1;
          const got = drawCards(s, seat, k);
          log(s, `${who} draws ${got === 1 ? 'a card' : `${got} cards`}`, seat, `+${got}`, undefined, { from: 'deck' });
          d.pendingDraw = 0;
          s.turn = step(s, seat);
          updatePile(s);
          return;
        }
        case 'pass':
          assertRule(s.phase === 'play' && !canDraw(s) && !legal(s, seat).length, 'You can play or draw');
          checkLastCard(s, seat);
          log(s, `${who} can't play or draw — passes`, seat, 'Pass');
          d.pendingDraw = 0;
          s.turn = step(s, seat);
          // nobody can move at all: the hand is blocked and everyone scores what they hold
          if (s.players.every((p) => !legal(s, p.seat).length)) return endHand(s, null);
          return;
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    /**
     * Easy: the rules of thumb, with a slip now and then. Normal: the rules of thumb, as an average
     * player plays (lookahead measured no better than the rules against them; luck rules this game).
     * Hard: plays each move out on imagined deals.
     */
    bot(s, seat) {
      if (s.phase === 'play' && s.turn === seat) {
        if (botLevel(s.options) === 2) return searchMove(search, s, seat, botBudget(s.options)!, quickBot(s, seat)) ?? quickBot(s, seat);
        return easyMove(s.options, search.candidates(s, seat), quickBot(s, seat));
      }
      return quickBot(s, seat);
    },

    standings(s) {
      return placesFromScores(s.data.scores, true);
    },

    status(s, viewer) {
      const d = s.data;
      const turnName = s.turn != null ? name(s, s.turn) : '';
      let headline: string;
      if (s.phase === 'nominate') headline = s.turn === viewer ? 'An eight was turned up: call a suit' : `${turnName} is calling a suit for the eight`;
      else if (s.phase === 'play') {
        const need = d.pendingDraw
          ? `play a 2 or draw ${d.pendingDraw}`
          : `${SUIT_SYMBOL[d.suit]}${rankOf(top(s)) !== 8 ? ` or ${rankLabel(rankOf(top(s)))}` : ''} — or an 8`;
        headline = s.turn === viewer ? `Your turn: ${need}` : `${turnName} to play · ${need}`;
        if (d.unannounced === viewer) headline = 'Say “last card!” before the next player moves';
      } else headline = d.result?.lines[0] ?? '';
      return {
        headline,
        seats: s.players.map((_, i) => ({
          badge: [`${hand(s, i).cards.length} card${hand(s, i).cards.length === 1 ? '' : 's'}`, `${d.scores[i]} pts`].join(' · '),
          tag: i === s.dealer ? 'D' : undefined,
        })),
        scoreboard: {
          columns: ['Cards', 'Points'],
          rows: s.players.map((p, i) => ({ name: p.name, values: [hand(s, i).cards.length, d.scores[i]], highlight: s.winner?.includes(i) })),
        },
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
