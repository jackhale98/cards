import { parseCard } from '../cards';
import * as bet from '../lib/betting';
import { bestHand, bestWithHole, type HandValue } from '../lib/pokerEval';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, resetDeck, zone } from '../state';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Poker family: community-card games with no-limit betting, side pots and showdown.
 *
 * ```jsonc
 * "rules": {
 *   "family": "poker",
 *   "holeCards": 2,          // cards dealt to each player (Omaha: 4)
 *   "useHole": 0,            // 0 = best five of any cards; 2 = exactly two hole cards (Omaha)
 *   "board": [3, 1, 1]       // community cards per street (flop, turn, river)
 * }
 * ```
 */
export interface PokerRules {
  family: 'poker';
  holeCards: number;
  useHole?: number;
  board: number[];
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
  /** End-of-hand summary. */
  result: { lines: string[]; winners: number[] } | null;
}

type S = GameState<PokerData>;

const chipsOf = (s: S) => s.players.map((p) => p.chips);
const writeChips = (s: S, chips: number[]) => chips.forEach((c, i) => (s.players[i].chips = c));

export function pokerFamily(config: GameConfig): GameModule<PokerData> {
  const R = config.rules as unknown as PokerRules;
  const lastStreet = R.board.length;
  const evaluate = (hole: string[], board: string[]) => bestWithHole(hole, board, R.useHole ?? 0);
  const streetName = (st: number, showdown: boolean) => {
    if (showdown) return 'Showdown';
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

    const headsUp = alive.length === 2;
    const sbSeat = headsUp ? d.button : nextSeat(s, d.button, skip);
    const bbSeat = nextSeat(s, sbSeat, skip);
    const chips = chipsOf(s);
    bet.post(d.b, chips, sbSeat, d.sb);
    bet.post(d.b, chips, bbSeat, d.bb);
    d.b.currentBet = Math.max(d.b.currentBet, d.bb);
    d.b.minRaise = d.bb;
    writeChips(s, chips);
    log(s, `Hand #${d.handNo}: blinds ${d.sb}/${d.bb}`);

    s.phase = 'betting';
    s.turn = nextActor(s, bbSeat);
    if (s.turn == null || bet.streetComplete(d.b)) advance(s);
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
    if (bet.bettingClosed(d.b)) {
      // everyone is all in: run the board out with a little drama
      s.phase = 'runout';
      s.turn = null;
      return;
    }
    dealStreet(s);
    bet.newStreet(d.b, d.bb);
    s.turn = nextActor(s, d.button);
  }

  function dealStreet(s: S) {
    const d = s.data;
    moveTop(s, 'deck', 'muck', 1); // burn
    moveTop(s, 'deck', 'board', R.board[d.street], { up: true });
    d.street++;
  }

  function collect(s: S, winner: number, amount: number) {
    s.players[winner].chips += amount;
  }

  function awardUncontested(s: S, winner: number) {
    const d = s.data;
    const total = bet.potTotal(d.b);
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
    pots.forEach((pot, pi) => {
      const top = Math.max(...pot.eligible.map((i) => values.get(i)!.score));
      const potWinners = pot.eligible.filter((i) => values.get(i)!.score === top);
      const share = Math.floor(pot.amount / potWinners.length);
      let odd = pot.amount - share * potWinners.length;
      // odd chips go to the first winner left of the button
      const ordered = [...potWinners].sort((a, b) => ((a - d.button + 99) % s.players.length) - ((b - d.button + 99) % s.players.length));
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
    const alive = s.players.filter((p) => p.chips > 0);
    if (alive.length < 2) {
      s.phase = 'gameOver';
      s.winner = alive.map((p) => p.seat);
    } else {
      s.phase = 'handOver';
    }
  }

  const module: GameModule<PokerData> = {
    config,

    setup(players, seed, options) {
      const bb = Number(options.bigBlind ?? config.chips!.bigBlind);
      const s = createState<PokerData>(config, players, seed, options, {
        b: bet.newBetting(players.length, players.map(() => false)),
        street: 0,
        showdown: false,
        button: 0,
        sb: Math.max(1, Math.floor(bb / 2)),
        bb,
        handNo: 0,
        result: null,
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
      if (s.phase !== 'betting' || s.turn !== seat) return [];
      const o = bet.options(d.b, chipsOf(s), seat);
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
        return startHand(s);
      }
      assertRule(s.phase === 'betting' && s.turn === seat, 'Not your turn');
      const chips = chipsOf(s);
      try {
        if (a.type === 'raise') bet.act(d.b, chips, seat, { type: 'raise', to: Math.floor(a.amount ?? 0) });
        else if (a.type === 'fold' || a.type === 'check' || a.type === 'call' || a.type === 'allin') bet.act(d.b, chips, seat, { type: a.type });
        else assertRule(false, `Unknown action ${a.type}`);
      } catch (e) {
        assertRule(false, (e as Error).message);
      }
      writeChips(s, chips);
      const verb = { fold: 'folds', check: 'checks', call: 'calls', raise: `raises to ${d.b.bets[seat]}`, allin: 'is all in' }[a.type];
      log(s, `${name(s, seat)} ${verb}`);
      if (a.type === 'fold') moveCards(s, `hand:${seat}`, 'muck', ids(hand(s, seat)));
      advance(s);
    },

    system(s) {
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
      if (s.phase !== 'betting' || s.turn !== seat) return null;
      const d = s.data;
      const o = bet.options(d.b, chipsOf(s), seat);
      const strength = handStrength(s, seat);
      const r = Math.random();
      const pot = bet.potTotal(d.b);
      if (strength > 0.85 && o.canRaise && r < 0.7) {
        const to = Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, d.b.currentBet + Math.round(pot * 0.75)));
        return { type: 'raise', amount: to };
      }
      if (o.canCheck) {
        if (strength > 0.6 && o.canRaise && r < 0.35) return { type: 'raise', amount: o.minRaiseTo };
        return { type: 'check' };
      }
      const priceRatio = o.toCall / Math.max(1, pot + o.toCall);
      if (strength > priceRatio + 0.15 || (strength > 0.3 && o.toCall <= d.bb)) return { type: 'call' };
      return { type: 'fold' };
    },

    status(s, viewer) {
      const d = s.data;
      const stageName = streetName(d.street, d.showdown);
      let headline = stageName;
      if (s.phase === 'betting' && s.turn != null) {
        if (s.turn === viewer) {
          const o = bet.options(d.b, chipsOf(s), viewer);
          headline = o.canCheck ? `${stageName} · your move` : `${stageName} · ${o.toCall} to call`;
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
        pot: bet.potTotal(d.b),
        seats: s.players.map((p, i) => ({
          out: d.b.out[i] || d.b.folded[i],
          badge: d.b.out[i] ? 'Out' : d.b.folded[i] ? 'Folded' : d.b.allIn[i] ? `All in` : d.b.bets[i] ? `Bet ${d.b.bets[i]}` : undefined,
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

  /** Crude 0–1 hand strength used by bots. */
  function handStrength(s: S, seat: number): number {
    const cards = ids(hand(s, seat));
    const board = ids(zone(s, 'board'));
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
