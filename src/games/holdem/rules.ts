import { parseCard } from '../../engine/cards';
import * as bet from '../../engine/lib/betting';
import { bestHand, type HandValue } from '../../engine/lib/pokerEval';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, resetDeck, zone } from '../../engine/state';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../../engine/types';
import json from './game.json';

const config = json as GameConfig;

export type Stage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface HoldemData {
  b: bet.BettingState;
  stage: Stage;
  button: number;
  sb: number;
  bb: number;
  handNo: number;
  /** End-of-hand summary. */
  result: { lines: string[]; winners: number[] } | null;
}

type S = GameState<HoldemData>;

const chipsOf = (s: S) => s.players.map((p) => p.chips);
const writeChips = (s: S, chips: number[]) => chips.forEach((c, i) => (s.players[i].chips = c));

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
  d.stage = 'preflop';
  d.b = bet.newBetting(s.players.length, out);
  resetDeck(s, config);
  for (const [id, z] of Object.entries(s.zones)) if (id.startsWith('hand:')) z.visibility = 'owner';

  // deal two cards each starting left of the button
  for (let r = 0; r < 2; r++) {
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
  if (d.stage === 'river') return showdown(s);
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
  if (d.stage === 'preflop') {
    moveTop(s, 'deck', 'board', 3, { up: true });
    d.stage = 'flop';
  } else if (d.stage === 'flop') {
    moveTop(s, 'deck', 'board', 1, { up: true });
    d.stage = 'turn';
  } else if (d.stage === 'turn') {
    moveTop(s, 'deck', 'board', 1, { up: true });
    d.stage = 'river';
  }
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
  d.stage = 'showdown';
  const board = ids(zone(s, 'board'));
  const live = bet.live(d.b);
  const values = new Map<number, HandValue>();
  for (const seat of live) {
    values.set(seat, bestHand([...ids(hand(s, seat)), ...board]));
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

const holdem: GameModule<HoldemData> = {
  config,

  setup(players, seed, options) {
    const bb = Number(options.bigBlind ?? config.chips!.bigBlind);
    const s = createState<HoldemData>(config, players, seed, options, {
      b: bet.newBetting(players.length, players.map(() => false)),
      stage: 'preflop',
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
        if (s.data.stage === 'river') {
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
    const stageName = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' }[d.stage];
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
      if (cards.length !== 2 || cards.some((c) => c.startsWith('?')) || board.length < 3) return undefined;
      return bestHand([...cards, ...board]).name;
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
    const [a, b] = cards.map(parseCard);
    const hi = Math.max(a.rank, b.rank);
    const lo = Math.min(a.rank, b.rank);
    let v = (hi + lo) / 28;
    if (a.rank === b.rank) v = 0.6 + a.rank / 35;
    if (a.suit === b.suit) v += 0.05;
    if (hi - lo === 1) v += 0.03;
    return Math.min(1, v);
  }
  const best = bestHand([...cards, ...board]);
  const boardOnly = board.length >= 5 ? bestHand(board).category : 0;
  const cat = best.category > boardOnly ? best.category : Math.min(best.category, 0.5);
  return Math.min(1, 0.2 + cat * 0.17);
}

export default holdem;
