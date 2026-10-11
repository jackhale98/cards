import { buildDeck, parseCard } from '../cards';
import { botBudget, botLevel, now, shuffled } from '../bots/search';
import * as bet from '../lib/betting';
import { bestHand, bestWithHole, eval5, type HandValue } from '../lib/pokerEval';
import { shuffle } from '../rng';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, placesFromScores, resetDeck, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Poker family: no-limit betting, side pots and showdown, for community-card games (blinds, a
 * board dealt street by street) and draw poker (antes, one draw).
 *
 * ```jsonc
 * "rules": {
 *   "family": "poker",
 *   "holeCards": 2,          // cards dealt to each player (Omaha: 4; five card draw: 5)
 *   "useHole": 0,            // 0 = best five of any cards; 2 = exactly two hole cards (Omaha)
 *   "board": [3, 1, 1],      // community cards per street (flop, turn, river); [] for draw
 *   "draw": { "max": 3 }     // draw poker: everyone antes, bets, swaps up to `max` cards, bets again
 * }
 * ```
 */
export interface PokerRules {
  family: 'poker';
  holeCards: number;
  useHole?: number;
  board: number[];
  draw?: { max: number };
}

export interface PokerData {
  b: bet.BettingState;
  /** 0 = before any board cards, then one per street in `rules.board`. */
  street: number;
  showdown: boolean;
  button: number;
  sb: number;
  bb: number;
  handNo: number;
  /** Each seat's latest action this street ("Check", "Call 20", "Raise to 60"…). */
  acted: (string | null)[];
  /** End-of-hand summary. */
  result: { lines: string[]; winners: number[] } | null;
  /** The hand each seat was knocked out in (null while still playing), for final placings. */
  bustedAt?: (number | null)[];
  /** Draw poker: the ante, chips left in the pot from a deal everyone checked, who opened the betting, who has drawn. */
  ante?: number;
  carry?: number;
  opener?: number | null;
  drawn?: (number | null)[];
  /** Cards discarded in the draw (shuffled into a new stock if it runs short). */
  discards?: string[];
}

type S = GameState<PokerData>;

const chipsOf = (s: S) => s.players.map((p) => p.chips);
const writeChips = (s: S, chips: number[]) => chips.forEach((c, i) => (s.players[i].chips = c));

export function pokerFamily(config: GameConfig): GameModule<PokerData> {
  const R = config.rules as unknown as PokerRules;
  const draw = R.draw;
  /** Streets: one per board deal; draw poker has the betting before the draw and after it. */
  const lastStreet = draw ? 1 : R.board.length;
  const evaluate = (hole: string[], board: string[]) => bestWithHole(hole, board, R.useHole ?? 0);
  const streetName = (st: number, showdown: boolean) => {
    if (showdown) return 'Showdown';
    if (draw) return st === 0 ? 'Before the draw' : 'After the draw';
    if (R.board.join() === '3,1,1') return ['Pre-flop', 'Flop', 'Turn', 'River'][st];
    return st === 0 ? 'Opening' : `Street ${st}`;
  };

  function startHand(s: S) {
    const d = s.data;
    const alive = s.players.filter((p) => p.chips > 0);
    if (alive.length < 2) {
      s.phase = 'gameOver';
      s.turn = null;
      s.winner = alive.map((p) => p.seat);
      return;
    }
    const out = s.players.map((p) => p.chips === 0);
    const skip = (i: number) => out[i];
    d.handNo++;
    d.button = d.handNo === 1 ? (out[d.button] ? nextSeat(s, d.button, skip) : d.button) : nextSeat(s, d.button, skip);
    s.dealer = d.button;
    d.result = null;
    d.street = 0;
    d.showdown = false;
    d.b = bet.newBetting(s.players.length, out);
    resetDeck(s, config);
    for (const [id, z] of Object.entries(s.zones)) if (id.startsWith('hand:')) z.visibility = 'owner';

    // deal two cards each starting left of the button
    for (let r = 0; r < R.holeCards; r++) {
      let seat = d.button;
      for (let i = 0; i < alive.length; i++) {
        seat = nextSeat(s, seat, skip);
        moveTop(s, 'deck', `hand:${seat}`, 1);
      }
    }

    if (draw) return startDrawHand(s);
    const headsUp = alive.length === 2;
    const sbSeat = headsUp ? d.button : nextSeat(s, d.button, skip);
    const bbSeat = nextSeat(s, sbSeat, skip);
    const chips = chipsOf(s);
    bet.post(d.b, chips, sbSeat, d.sb);
    bet.post(d.b, chips, bbSeat, d.bb);
    d.b.currentBet = Math.max(d.b.currentBet, d.bb);
    d.b.minRaise = d.bb;
    writeChips(s, chips);
    d.acted = s.players.map(() => null);
    d.acted[sbSeat] = `Small blind ${d.b.bets[sbSeat]}`;
    d.acted[bbSeat] = `Big blind ${d.b.bets[bbSeat]}`;
    log(s, `Hand #${d.handNo}: ${name(s, sbSeat)} and ${name(s, bbSeat)} post blinds ${d.sb}/${d.bb}`);

    s.phase = 'betting';
    s.turn = nextActor(s, bbSeat);
    if (s.turn == null || bet.streetComplete(d.b)) advance(s);
  }

  /** Draw poker: everyone antes, then the player left of the dealer opens the betting. */
  function startDrawHand(s: S) {
    const d = s.data;
    const chips = chipsOf(s);
    for (const p of s.players) if (!d.b.out[p.seat]) bet.post(d.b, chips, p.seat, d.ante!);
    // antes go in the pot without being a bet in the first round
    d.b.bets.fill(0);
    d.b.currentBet = 0;
    d.b.minRaise = d.ante!;
    writeChips(s, chips);
    d.acted = s.players.map(() => null);
    d.opener = null;
    d.drawn = s.players.map(() => null);
    d.discards = [];
    const carried = d.carry ? ` (the pot carries ${d.carry})` : '';
    log(s, `Hand #${d.handNo}: everyone antes ${d.ante}${carried}`);
    s.phase = 'betting';
    s.turn = nextActor(s, d.button);
    if (s.turn == null || bet.streetComplete(d.b)) advance(s);
  }

  /** Draw poker: may this seat bet first? (With "jacks or better", only a pair of jacks or better opens.) */
  const mayOpen = (s: S, seat: number) => !s.options.jacks || eval5(ids(hand(s, seat))).score >= eval5(['JS', 'JH', '4C', '3D', '2C']).score;
  const opening = (s: S) => !!draw && s.data.street === 0 && s.data.b.currentBet === 0;

  /** Draw poker: cards a seat may swap (up to three; four if keeping an ace, with that option). */
  const drawLimit = (s: S, seat: number) => {
    const max = draw?.max ?? 3;
    return s.options.aceFour && ids(hand(s, seat)).some((c) => parseCard(c).rank === 14) ? max + 1 : max;
  };
  const toDraw = (s: S) => bet.live(s.data.b).filter((i) => s.data.drawn![i] == null);

  /** The first player still to draw, from the dealer's left. */
  function nextDrawer(s: S, from: number): number | null {
    const left = toDraw(s);
    for (let i = 1; i <= s.players.length; i++) {
      const seat = (from + i) % s.players.length;
      if (left.includes(seat)) return seat;
    }
    return null;
  }

  function afterDraw(s: S) {
    const d = s.data;
    d.street = 1;
    s.phase = 'betting';
    if (bet.bettingClosed(d.b)) return showdown(s);
    bet.newStreet(d.b, d.ante!);
    d.acted = d.acted.map(() => null);
    // the player who opened bets first (or the next one still in)
    const start = d.opener ?? d.button;
    s.turn = bet.canAct(d.b, start) ? start : nextActor(s, start);
  }

  function nextActor(s: S, from: number): number | null {
    const b = s.data.b;
    for (let i = 1; i <= s.players.length; i++) {
      const seat = (from + i) % s.players.length;
      if (bet.canAct(b, seat)) return seat;
    }
    return null;
  }

  /** Called after every betting action. */
  function advance(s: S) {
    const d = s.data;
    const live = bet.live(d.b);
    if (live.length === 1) return awardUncontested(s, live[0]);
    if (!bet.streetComplete(d.b)) {
      s.turn = nextActor(s, s.turn!);
      return;
    }
    if (d.street === lastStreet) return showdown(s);
    if (draw) {
      // nobody bet: the deal is thrown in and the pot stays for the next one
      if (d.b.currentBet === 0 && !bet.bettingClosed(d.b)) return throwIn(s);
      s.phase = 'draw';
      s.turn = nextDrawer(s, d.button);
      return;
    }
    if (bet.bettingClosed(d.b)) {
      // everyone is all in: run the board out with a little drama
      s.phase = 'runout';
      s.turn = null;
      return;
    }
    dealStreet(s);
    bet.newStreet(d.b, d.bb);
    d.acted = d.acted.map(() => null);
    s.turn = nextActor(s, d.button);
  }

  function dealStreet(s: S) {
    const d = s.data;
    moveTop(s, 'deck', 'muck', 1); // burn
    moveTop(s, 'deck', 'board', R.board[d.street], { up: true });
    d.street++;
  }

  function throwIn(s: S) {
    const d = s.data;
    d.carry = (d.carry ?? 0) + bet.potTotal(d.b);
    d.b.committed.fill(0);
    d.b.bets.fill(0);
    for (const seat of s.players.map((p) => p.seat)) moveCards(s, `hand:${seat}`, 'muck', ids(hand(s, seat)));
    d.result = { lines: [`Nobody opened — the pot (${d.carry}) stays for the next deal`], winners: [] };
    log(s, d.result.lines[0]);
    s.turn = null;
    s.phase = 'handOver';
  }

  function collect(s: S, winner: number, amount: number) {
    s.players[winner].chips += amount;
  }

  function awardUncontested(s: S, winner: number) {
    const d = s.data;
    const total = bet.potTotal(d.b) + (d.carry ?? 0);
    d.carry = 0;
    collect(s, winner, total);
    d.b.committed.fill(0);
    d.b.bets.fill(0);
    d.result = { lines: [`${name(s, winner)} wins ${total}`], winners: [winner] };
    log(s, d.result.lines[0]);
    endHand(s);
  }

  function showdown(s: S) {
    const d = s.data;
    d.showdown = true;
    const board = ids(zone(s, 'board'));
    const live = bet.live(d.b);
    const values = new Map<number, HandValue>();
    for (const seat of live) {
      values.set(seat, evaluate(ids(hand(s, seat)), board));
      for (const c of hand(s, seat).cards) c.up = true; // reveal
    }
    const lines: string[] = [];
    const winners = new Set<number>();
    const pots = bet.pots(d.b);
    // chips carried from a thrown-in deal belong to the main pot
    if (d.carry && pots.length) pots[0].amount += d.carry;
    d.carry = 0;
    pots.forEach((pot, pi) => {
      const top = Math.max(...pot.eligible.map((i) => values.get(i)!.score));
      const potWinners = pot.eligible.filter((i) => values.get(i)!.score === top);
      const share = Math.floor(pot.amount / potWinners.length);
      let odd = pot.amount - share * potWinners.length;
      // odd chips go to the winner nearest the dealer's left (the button itself is last)
      const n = s.players.length;
      const ordered = [...potWinners].sort((a, b) => ((a - d.button - 1 + n) % n) - ((b - d.button - 1 + n) % n));
      for (const w of ordered) {
        collect(s, w, share + (odd-- > 0 ? 1 : 0));
        winners.add(w);
      }
      const label = pots.length > 1 ? (pi === 0 ? 'main pot' : `side pot ${pi}`) : 'the pot';
      lines.push(`${ordered.map((w) => name(s, w)).join(' & ')} ${ordered.length > 1 ? 'split' : 'wins'} ${label} (${pot.amount}) with ${values.get(ordered[0])!.name.toLowerCase()}`);
    });
    d.b.committed.fill(0);
    d.b.bets.fill(0);
    d.result = { lines, winners: [...winners] };
    lines.forEach((l) => log(s, l));
    endHand(s);
  }

  function endHand(s: S) {
    s.turn = null;
    // note who was knocked out this hand: later knockouts finish higher on game night
    const d = s.data;
    d.bustedAt ??= s.players.map(() => null);
    s.players.forEach((p, i) => p.chips === 0 && d.bustedAt![i] == null && (d.bustedAt![i] = d.handNo));
    const alive = s.players.filter((p) => p.chips > 0);
    if (alive.length < 2) {
      s.phase = 'gameOver';
      s.winner = alive.map((p) => p.seat);
    } else {
      s.phase = 'handOver';
    }
  }

  const module: GameModule<PokerData> = {
    botLevels: true,
    config,

    setup(players, seed, options) {
      const bb = Number(draw ? (options.ante ?? config.chips!.ante ?? 10) : (options.bigBlind ?? config.chips!.bigBlind));
      const s = createState<PokerData>(config, players, seed, options, {
        b: bet.newBetting(players.length, players.map(() => false)),
        street: 0,
        showdown: false,
        button: 0,
        sb: Math.max(1, Math.floor(bb / 2)),
        bb,
        handNo: 0,
        acted: [],
        result: null,
        ...(draw ? { ante: bb, carry: 0, opener: null, drawn: [], discards: [] } : {}),
      });
      const stack = Number(options.stack ?? config.chips!.start);
      s.players.forEach((p) => (p.chips = stack));
      startHand(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'handOver' && s.players[seat].chips > 0) return [{ type: 'next', label: 'Deal next hand', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase === 'draw' && s.turn === seat) {
        const max = drawLimit(s, seat);
        return [
          { type: 'draw', label: 'Draw', style: 'primary', select: { min: 1, max, cards: ids(hand(s, seat)) } },
          { type: 'standPat', label: 'Stand pat' },
        ];
      }
      if (s.phase !== 'betting' || s.turn !== seat) return [];
      const o = bet.options(d.b, chipsOf(s), seat);
      // jacks or better: without them you can only check (or fold) until someone opens
      if (opening(s) && !mayOpen(s, seat)) o.canRaise = false;
      const chips = s.players[seat].chips;
      const out: ActionSpec[] = [{ type: 'fold', label: 'Fold', style: o.canCheck ? 'quiet' : 'danger' }];
      out.push(o.canCheck ? { type: 'check', label: 'Check' } : { type: 'call', label: `Call ${o.toCall}`, style: 'primary' });
      if (o.canRaise && o.maxRaiseTo > o.minRaiseTo) {
        out.push({
          type: 'raise',
          label: d.b.currentBet === 0 ? 'Bet' : 'Raise to',
          amount: { min: o.minRaiseTo, max: o.maxRaiseTo, step: Math.max(1, d.sb), default: o.minRaiseTo, label: 'chips' },
        });
      }
      if (chips > 0 && o.canRaise) out.push({ type: 'allin', label: `All in · ${chips + d.b.bets[seat]}`, style: 'quiet' });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      if (a.type === 'next') {
        assertRule(s.phase === 'handOver', 'Hand still in progress');
        return startHand(s);
      }
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        const stack = Number(s.options.stack ?? config.chips!.start);
        s.players.forEach((p) => (p.chips = stack));
        s.winner = undefined;
        d.handNo = 0;
        d.bustedAt = s.players.map(() => null);
        d.carry = 0;
        return startHand(s);
      }
      if (a.type === 'draw' || a.type === 'standPat') {
        assertRule(s.phase === 'draw' && s.turn === seat, 'Not your turn to draw');
        const cards = a.type === 'standPat' ? [] : (a.cards ?? []);
        const own = ids(hand(s, seat));
        const max = drawLimit(s, seat);
        assertRule(cards.length <= max && new Set(cards).size === cards.length && cards.every((c) => own.includes(c)), `Discard up to ${max} cards`);
        if (max > (draw?.max ?? 3) && cards.length === max) assertRule(own.some((c) => parseCard(c).rank === 14 && !cards.includes(c)), 'Drawing four means keeping an ace');
        moveCards(s, `hand:${seat}`, 'muck', cards);
        d.discards!.push(...cards);
        // short of cards: the discards so far become a new stock
        if (zone(s, 'deck').cards.length < cards.length) {
          const back = d.discards!.filter((c) => !cards.includes(c));
          moveCards(s, 'muck', 'deck', back);
          zone(s, 'deck').cards = shuffle(zone(s, 'deck').cards, s);
          d.discards = [...cards];
          log(s, 'The stock is short — earlier discards are shuffled in');
        }
        moveTop(s, 'deck', `hand:${seat}`, cards.length);
        d.drawn![seat] = cards.length;
        const said = cards.length ? `Drew ${cards.length}` : 'Stands pat';
        d.acted[seat] = said;
        log(s, `${name(s, seat)} ${cards.length ? `draws ${cards.length}` : 'stands pat'}`, seat, said);
        const next = nextDrawer(s, seat);
        if (next == null) afterDraw(s);
        else s.turn = next;
        return;
      }
      assertRule(s.phase === 'betting' && s.turn === seat, 'Not your turn');
      if (opening(s) && !mayOpen(s, seat)) assertRule(a.type !== 'raise' && a.type !== 'allin', 'You need jacks or better to open');
      const chips = chipsOf(s);
      const betBefore = d.b.currentBet;
      try {
        if (a.type === 'raise') bet.act(d.b, chips, seat, { type: 'raise', to: Math.floor(a.amount ?? 0) });
        else if (a.type === 'fold' || a.type === 'check' || a.type === 'call' || a.type === 'allin') bet.act(d.b, chips, seat, { type: a.type });
        else assertRule(false, `Unknown action ${a.type}`);
      } catch (e) {
        assertRule(false, (e as Error).message);
      }
      writeChips(s, chips);
      const put = d.b.bets[seat];
      const raised = put > betBefore;
      const [verb, short] = {
        fold: ['folds', 'Fold'],
        check: ['checks', 'Check'],
        call: [`calls ${put}`, `Call ${put}`],
        raise: betBefore === 0 ? [`bets ${put}`, `Bet ${put}`] : [`raises to ${put}`, `Raise to ${put}`],
        allin: raised ? [`goes all in for ${put}`, `All in ${put}`] : [`calls all in for ${put}`, `All in ${put}`],
      }[a.type as 'fold' | 'check' | 'call' | 'raise' | 'allin'];
      d.acted[seat] = short;
      if (draw && d.street === 0 && raised && d.opener == null) d.opener = seat;
      log(s, `${name(s, seat)} ${verb}`, seat, short);
      if (a.type === 'fold') moveCards(s, `hand:${seat}`, 'muck', ids(hand(s, seat)));
      advance(s);
    },

    system(s) {
      // only bots left with chips: nobody can press "Deal next hand", so keep dealing
      if (s.phase === 'handOver' && !s.players.some((p) => !p.bot && p.chips > 0)) return { delay: 2500, run: (s) => startHand(s) };
      if (s.phase !== 'runout') return null;
      return {
        delay: 1100,
        run: (s) => {
          if (s.data.street === lastStreet) {
            s.phase = 'betting';
            showdown(s);
          } else dealStreet(s);
        },
      };
    },

    bot(s, seat) {
      if (s.phase === 'draw' && s.turn === seat) {
        const cards = botDiscards(s, seat);
        return cards.length ? { type: 'draw', cards } : { type: 'standPat' };
      }
      if (s.phase !== 'betting' || s.turn !== seat) return null;
      const d = s.data;
      const o = bet.options(d.b, chipsOf(s), seat);
      if (opening(s) && !mayOpen(s, seat)) return o.canCheck ? { type: 'check' } : { type: 'fold' };
      const r = Math.random();
      const pot = bet.potTotal(d.b);
      // with too few chips for a full raise, the only way up is all in (as the action bar offers)
      const raise = (to: number): Action => (o.maxRaiseTo > o.minRaiseTo ? { type: 'raise', amount: to } : { type: 'allin' });
      const level = botLevel(s.options);
      if (level > 0) return oddsBot(s, seat, o, level, raise);
      const strength = handStrength(s, seat);
      if (strength > 0.85 && o.canRaise && r < 0.7) {
        return raise(Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, d.b.currentBet + Math.round(pot * 0.75))));
      }
      if (o.canCheck) {
        if (strength > 0.6 && o.canRaise && r < 0.35) return raise(o.minRaiseTo);
        return { type: 'check' };
      }
      const priceRatio = o.toCall / Math.max(1, pot + o.toCall);
      if (strength > priceRatio + 0.15 || (strength > 0.3 && o.toCall <= d.bb)) return { type: 'call' };
      // a short stack facing an all-in can only call with what it has
      if (o.toCall >= s.players[seat].chips && strength > 0.5) return { type: 'call' };
      return { type: 'fold' };
    },

    standings(s) {
      // players still in by chips, then the knocked-out by how long they lasted
      const out = s.data.bustedAt ?? [];
      return placesFromScores(s.players.map((p, i) => (p.chips > 0 ? 1e9 + p.chips : (out[i] ?? 0))));
    },

    status(s, viewer) {
      const d = s.data;
      const stageName = streetName(d.street, d.showdown);
      let headline = stageName;
      if (s.phase === 'draw' && s.turn != null) {
        headline = s.turn === viewer ? `The draw · discard up to ${drawLimit(s, viewer)} (none to stand pat)` : `The draw · ${name(s, s.turn)} to draw`;
      } else if (s.phase === 'betting' && s.turn != null) {
        if (s.turn === viewer) {
          const o = bet.options(d.b, chipsOf(s), viewer);
          headline = o.canCheck ? `${stageName} · your move` : `${stageName} · ${o.toCall} to call`;
          if (opening(s) && !mayOpen(s, viewer)) headline = `${stageName} · you need jacks or better to open`;
        } else headline = `${stageName} · ${name(s, s.turn)} to act`;
      } else if (s.phase === 'handOver') headline = d.result?.lines.join(' · ') ?? 'Hand over';
      else if (s.phase === 'gameOver') headline = 'Game over';

      const handName = (seat: number) => {
        const cards = ids(hand(s, seat));
        const board = ids(zone(s, 'board'));
        if (cards.length !== R.holeCards || cards.some((c) => c.startsWith('?')) || cards.length + board.length < 5) return undefined;
        if (R.useHole && board.length < 5 - R.useHole) return undefined;
        return evaluate(cards, board).name;
      };

      return {
        headline,
        pot: bet.potTotal(d.b) + (d.carry ?? 0),
        seats: s.players.map((p, i) => ({
          out: d.b.out[i] || d.b.folded[i],
          badge: d.b.out[i] ? 'Out' : d.b.folded[i] ? 'Folded' : (d.acted?.[i] ?? (d.b.allIn[i] ? 'All in' : d.b.bets[i] ? `Bet ${d.b.bets[i]}` : undefined)),
          tag: i === d.button ? 'D' : undefined,
        })),
        hint: viewer >= 0 ? handName(viewer) : undefined,
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} wins it all!`, lines: d.result?.lines ?? [] }
            : undefined,
      };
    },
  };

  /**
   * How often `seat` wins from here, by dealing the cards it can't see many times over: the other
   * players' hands, the rest of the board, and (before the draw) the cards it would draw.
   */
  function equity(s: S, seat: number, level: number): number {
    const d = s.data;
    const budget = botBudget({ botLevel: level })!;
    const rivals = s.players.map((p) => p.seat).filter((i) => i !== seat && !d.b.folded[i] && !d.b.out[i]);
    if (!rivals.length) return 1;
    const mine = ids(hand(s, seat));
    const board = ids(zone(s, 'board'));
    const seen = new Set([...mine, ...board]); // (others' draw discards are face down: still unseen)
    const unseen = buildDeck(config.deck).filter((c) => !seen.has(c));
    const boardLeft = draw ? 0 : R.board.reduce((a, b) => a + b, 0) - board.length;
    const tossed = draw && d.street === 0 && d.drawn?.[seat] == null ? botDiscards(s, seat) : [];
    const kept = mine.filter((c) => !tossed.includes(c));
    const score = (hole: string[], b: string[]) => (draw ? eval5(hole).score : evaluate(hole, b).score);
    // whoever has bet or raised this street likely holds something: a pair, two big cards or an ace
    // before the flop, at least a pair after it (draw poker: a pair)
    const aggressive = rivals.map((i) => d.b.currentBet > 0 && d.b.bets[i] === d.b.currentBet && (d.street > 0 || draw || d.b.currentBet > d.bb));
    const plausible = (hole: string[]) => {
      if (draw) return eval5(hole).category >= 1;
      if (!board.length) {
        const r = hole.map((c) => parseCard(c).rank);
        return new Set(r).size < r.length || r.filter((x) => x >= 10).length >= 2 || r.includes(14);
      }
      return evaluate(hole, board).category >= 1;
    };
    let won = 0;
    let runs = 0;
    const stop = now() + budget.ms;
    // hand values are cheap next to the search's playouts: many more deals in the same time
    while (runs < budget.samples * 8 && (runs < 20 || now() < stop)) {
      const deck = shuffled([...unseen]);
      let k = 0;
      const take = (n: number) => deck.slice(k, (k += n));
      const me = [...kept, ...take(tossed.length)];
      const theirs = rivals.map((_, j) => {
        let h = take(R.holeCards);
        // re-deal a bettor's hand (a few tries) until it fits their betting
        // (keeping enough cards back for everyone else and the board)
        const spare = () => deck.length - k >= R.holeCards * (rivals.length + 1) + boardLeft;
        for (let t = 0; t < 6 && aggressive[j] && !plausible(h) && spare(); t++) h = take(R.holeCards);
        return h;
      });
      const full = [...board, ...take(boardLeft)];
      const v = score(me, full);
      const best = Math.max(...theirs.map((h) => score(h, full)));
      if (v > best) won += 1;
      else if (v === best) won += 1 / (1 + theirs.filter((h) => score(h, full) === best).length);
      runs++;
    }
    return won / runs;
  }

  /**
   * Normal and Hard bots bet on their real chances: they call when the pot (counting some of what's
   * still to come) pays for the risk, and bet or raise when well ahead. Hard plays the same way
   * with a more exact estimate of its chances (more imagined deals).
   */
  function oddsBot(s: S, seat: number, o: bet.BetOptions, level: number, raise: (to: number) => Action): Action {
    const d = s.data;
    const eq = equity(s, seat, level);
    const rivals = s.players.filter((p) => p.seat !== seat && !d.b.folded[p.seat] && !d.b.out[p.seat]).length;
    const pot = bet.potTotal(d.b);
    const r = Math.random();
    // against several players a hand needs to be better than its fair share to be "strong"
    // (aces win about 85% heads-up but only about 64% against three others)
    const fair = 1 / (rivals + 1);
    const strong = eq > Math.min(0.75, fair * 1.8);
    const good = eq > Math.min(0.6, fair * 1.3);
    const sized = (frac: number) => Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, d.b.currentBet + Math.round(pot * frac)));
    if (o.canCheck) {
      if (o.canRaise && strong) return raise(sized(0.66));
      if (o.canRaise && good && r < 0.5) return raise(sized(0.5));
      return { type: 'check' };
    }
    if (o.canRaise && strong && r < 0.6) return raise(sized(1));
    // the price of calling, counting some of what the others will put in on later streets
    const later = d.street < lastStreet ? o.toCall * rivals * 0.5 : 0;
    const price = o.toCall / Math.max(1, pot + o.toCall + later);
    if (eq > price + 0.02) return { type: 'call' };
    return { type: 'fold' };
  }

  /** Draw poker: what a bot throws away — keep made hands, pairs, four to a flush or an open straight. */
  function botDiscards(s: S, seat: number): string[] {
    const cards = ids(hand(s, seat));
    const v = eval5(cards);
    if (v.category >= 4) return []; // straight or better: stand pat
    const max = drawLimit(s, seat);
    const rank = (c: string) => parseCard(c).rank;
    const count = (r: number) => cards.filter((c) => rank(c) === r).length;
    if (v.category >= 1) {
      // keep the pairs, trips or quads; draw to the rest
      const junk = cards.filter((c) => count(rank(c)) === 1);
      return v.category === 2 ? junk : junk.slice(0, max);
    }
    for (const suit of ['S', 'H', 'D', 'C']) {
      const inSuit = cards.filter((c) => parseCard(c).suit === suit);
      if (inSuit.length === 4) return cards.filter((c) => !inSuit.includes(c));
    }
    const sorted = [...cards].sort((a, b) => rank(a) - rank(b));
    for (const four of [sorted.slice(0, 4), sorted.slice(1)]) {
      const r = four.map(rank);
      if (new Set(r).size === 4 && r[3] - r[0] === 3) return cards.filter((c) => !four.includes(c));
    }
    // nothing: keep the highest card (or two) and draw the rest
    const high = [...cards].sort((a, b) => rank(b) - rank(a));
    return high.slice(cards.length - max);
  }

  /** Crude 0–1 hand strength used by bots. */
  function handStrength(s: S, seat: number): number {
    const cards = ids(hand(s, seat));
    const board = ids(zone(s, 'board'));
    if (draw) {
      const v = eval5(cards);
      const hi = Math.max(...cards.map((c) => parseCard(c).rank));
      return Math.min(1, v.category === 0 ? hi / 40 : v.category === 1 ? 0.35 + v.score / eval5(['AS', 'AH', 'KC', 'QD', 'JC']).score * 0.2 : 0.55 + v.category * 0.07);
    }
    if (board.length === 0) {
      const [a, b] = cards.map(parseCard).sort((x, y) => y.rank - x.rank);
      const hi = Math.max(a.rank, b.rank);
      const lo = Math.min(a.rank, b.rank);
      let v = (hi + lo) / 28;
      if (a.rank === b.rank) v = 0.6 + a.rank / 35;
      if (a.suit === b.suit) v += 0.05;
      if (hi - lo === 1) v += 0.03;
      return Math.min(1, v);
    }
    const best = evaluate(cards, board);
    const boardOnly = board.length >= 5 ? bestHand(board).category : 0;
    const cat = best.category > boardOnly ? best.category : Math.min(best.category, 0.5);
    return Math.min(1, 0.2 + cat * 0.17);
  }

  return module;
}
