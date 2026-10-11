import { parseCard, SUIT_SYMBOL, type Suit } from '../../engine/cards';
import { HEARTS_PASS_CYCLE, passTarget, type PassDirection } from '../../engine/lib/passing';
import { followSuit, trickWinner } from '../../engine/lib/trickTaking';
import { createState, deal, hand, ids, log, moveCards, name, nextSeat, resetDeck, sortHand, zone } from '../../engine/state';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../../engine/types';
import json from './game.json';

const config = json as GameConfig;

export interface HeartsData {
  round: number;
  passDir: PassDirection;
  /** Cards each seat has chosen to pass (null = not yet). Redacted to the owner. */
  passes: (string[] | null)[];
  /** Cards each seat just received. Redacted to the owner. */
  received: string[][];
  heartsBroken: boolean;
  trickNo: number;
  points: number[];
  scores: number[];
  lastTrick: { cards: string[]; winner: number } | null;
  result: { lines: string[] } | null;
}

type S = GameState<HeartsData>;

const isPoint = (id: string) => parseCard(id).suit === 'H' || id === 'QS';
const pointsOf = (id: string) => (id === 'QS' ? 13 : parseCard(id).suit === 'H' ? 1 : 0);
const target = (s: S) => Number(s.options.target ?? 100);

function startRound(s: S) {
  const d = s.data;
  resetDeck(s, config);
  deal(s, config.deal!);
  s.players.forEach((_, i) => sortHand(s, i));
  d.passDir = HEARTS_PASS_CYCLE[d.round % HEARTS_PASS_CYCLE.length];
  d.passes = s.players.map(() => null);
  d.received = s.players.map(() => []);
  d.points = s.players.map(() => 0);
  d.heartsBroken = false;
  d.trickNo = 0;
  d.lastTrick = null;
  d.result = null;
  if (d.passDir === 'hold') startPlay(s);
  else {
    s.phase = 'pass';
    s.turn = null;
  }
}

function startPlay(s: S) {
  s.phase = 'play';
  s.turn = s.players.findIndex((_, i) => ids(hand(s, i)).includes('2C'));
}

export function legalCards(s: S, seat: number): string[] {
  const cards = ids(hand(s, seat));
  const trick = zone(s, 'trick').cards;
  const d = s.data;
  if (trick.length === 0) {
    if (d.trickNo === 0) return cards.filter((c) => c === '2C');
    if (!d.heartsBroken) {
      const safe = cards.filter((c) => parseCard(c).suit !== 'H');
      if (safe.length) return safe;
    }
    return cards;
  }
  const legal = followSuit(cards, parseCard(trick[0].id).suit as Suit);
  if (d.trickNo === 0) {
    const clean = legal.filter((c) => !isPoint(c));
    if (clean.length) return clean;
  }
  return legal;
}

function collectTrick(s: S) {
  const d = s.data;
  const trick = zone(s, 'trick');
  const winner = trick.cards[trickWinner(trick.cards)].by!;
  const cards = ids(trick);
  const pts = cards.reduce((n, c) => n + pointsOf(c), 0);
  d.points[winner] += pts;
  d.lastTrick = { cards, winner };
  moveCards(s, 'trick', `taken:${winner}`, cards);
  log(s, `${name(s, winner)} takes the trick${pts ? ` (+${pts})` : ''}`);
  d.trickNo++;
  if (d.trickNo === 13) return endRound(s);
  s.phase = 'play';
  s.turn = winner;
}

function endRound(s: S) {
  const d = s.data;
  const lines: string[] = [];
  const shooter = d.points.findIndex((p) => p === 26);
  if (shooter >= 0) {
    s.players.forEach((_, i) => (d.scores[i] += i === shooter ? 0 : 26));
    lines.push(`🌙 ${name(s, shooter)} shot the moon!`);
  } else {
    s.players.forEach((_, i) => (d.scores[i] += d.points[i]));
  }
  s.players.forEach((_, i) => lines.push(`${name(s, i)}: +${shooter >= 0 ? (i === shooter ? 0 : 26) : d.points[i]} → ${d.scores[i]}`));
  d.result = { lines };
  s.turn = null;
  if (Math.max(...d.scores) >= target(s)) {
    const low = Math.min(...d.scores);
    s.winner = s.players.map((_, i) => i).filter((i) => d.scores[i] === low);
    s.phase = 'gameOver';
  } else {
    s.phase = 'roundOver';
  }
}

const hearts: GameModule<HeartsData> = {
  config,

  setup(players, seed, options) {
    const s = createState<HeartsData>(config, players, seed, options, {
      round: 0,
      passDir: 'left',
      passes: [],
      received: [],
      heartsBroken: false,
      trickNo: 0,
      points: players.map(() => 0),
      scores: players.map(() => 0),
      lastTrick: null,
      result: null,
    });
    startRound(s);
    return s;
  },

  actions(s, seat) {
    const d = s.data;
    const out: ActionSpec[] = [];
    if (s.phase === 'pass') {
      if (d.passes[seat]) out.push({ type: 'unpass', label: 'Take back', style: 'quiet' });
      else
        out.push({
          type: 'pass',
          label: `Pass ${d.passDir}`,
          style: 'primary',
          select: { min: 3, max: 3, cards: ids(hand(s, seat)) },
        });
    } else if (s.phase === 'play' && s.turn === seat) {
      out.push({ type: 'play', label: 'Play', style: 'primary', quick: true, select: { min: 1, max: 1, cards: legalCards(s, seat) } });
    } else if (s.phase === 'roundOver') {
      out.push({ type: 'next', label: 'Next hand', style: 'primary' });
    } else if (s.phase === 'gameOver') {
      out.push({ type: 'rematch', label: 'New game', style: 'primary' });
    }
    return out;
  },

  apply(s, seat, a) {
    const d = s.data;
    switch (a.type) {
      case 'pass': {
        assertRule(s.phase === 'pass' && !d.passes[seat], 'Not passing now');
        const cards = a.cards ?? [];
        const own = ids(hand(s, seat));
        assertRule(cards.length === 3 && new Set(cards).size === 3 && cards.every((c) => own.includes(c)), 'Choose three cards to pass');
        d.passes[seat] = cards;
        if (d.passes.every(Boolean)) {
          const n = s.players.length;
          d.passes.forEach((cards, from) => {
            const to = passTarget(from, d.passDir, n);
            moveCards(s, `hand:${from}`, `hand:${to}`, cards!);
            d.received[to] = cards!;
          });
          s.players.forEach((_, i) => sortHand(s, i));
          log(s, `Cards passed ${d.passDir}`);
          startPlay(s);
        }
        return;
      }
      case 'unpass':
        assertRule(s.phase === 'pass', 'Too late');
        d.passes[seat] = null;
        return;
      case 'play': {
        assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
        const card = a.cards?.[0];
        assertRule(card && legalCards(s, seat).includes(card), 'You can’t play that card');
        moveCards(s, `hand:${seat}`, 'trick', [card], { by: seat, up: true });
        d.received[seat] = [];
        if (parseCard(card).suit === 'H' && !d.heartsBroken) {
          d.heartsBroken = true;
          log(s, `Hearts are broken ${SUIT_SYMBOL.H}`);
        }
        if (zone(s, 'trick').cards.length === s.players.length) {
          s.phase = 'trickEnd';
          s.turn = null;
        } else {
          s.turn = nextSeat(s, seat);
        }
        return;
      }
      case 'next':
        assertRule(s.phase === 'roundOver', 'Round not over');
        d.round++;
        s.dealer = nextSeat(s, s.dealer);
        startRound(s);
        return;
      case 'rematch':
        assertRule(s.phase === 'gameOver', 'Game not over');
        d.round = 0;
        d.scores = s.players.map(() => 0);
        s.winner = undefined;
        startRound(s);
        return;
    }
    assertRule(false, `Unknown action ${a.type}`);
  },

  system(s) {
    if (s.phase !== 'trickEnd') return null;
    return { delay: 1200, run: collectTrick };
  },

  bot(s, seat) {
    const d = s.data;
    if (s.phase === 'pass' && !d.passes[seat]) {
      const danger = (c: string) => {
        const { rank, suit } = parseCard(c);
        if (c === 'QS') return 100;
        if (suit === 'S' && rank > 12) return 90;
        return rank + (suit === 'H' ? 10 : 0);
      };
      const cards = [...ids(hand(s, seat))].sort((a, b) => danger(b) - danger(a)).slice(0, 3);
      return { type: 'pass', cards };
    }
    if (s.phase === 'play' && s.turn === seat) return { type: 'play', cards: [chooseBotCard(s, seat)] };
    return null;
  },

  redactData(s, viewer) {
    const d = s.data;
    return {
      ...d,
      passes: d.passes.map((p, i) => (p && i !== viewer ? [] : p)),
      received: d.received.map((r, i) => (i === viewer ? r : [])),
    };
  },

  status(s, viewer) {
    const d = s.data;
    let headline = '';
    if (s.phase === 'pass') {
      headline = d.passes[viewer] ? 'Waiting for everyone to pass…' : `Choose 3 cards to pass ${d.passDir}`;
    } else if (s.phase === 'play' || s.phase === 'trickEnd') {
      const leading = zone(s, 'trick').cards.length === 0;
      headline =
        s.turn === viewer
          ? leading
            ? d.trickNo === 0
              ? 'Lead the 2♣'
              : 'Your lead'
            : 'Your turn'
          : s.turn != null
            ? `${name(s, s.turn)} to play`
            : '';
    } else if (s.phase === 'roundOver') headline = 'Hand complete';
    else if (s.phase === 'gameOver') headline = 'Game over';

    return {
      headline,
      seats: s.players.map((_, i) => ({
        badge:
          s.phase === 'pass' && d.passes[i] ? 'Passed ✓' : `${d.scores[i]} pts${d.points[i] ? ` · +${d.points[i]}` : ''}`,
      })),
      scoreboard: {
        columns: ['This hand', 'Total'],
        rows: s.players.map((p, i) => ({ name: p.name, values: [d.points[i], d.scores[i]], highlight: s.winner?.includes(i) })),
      },
      banner:
        s.phase === 'gameOver'
          ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
          : s.phase === 'roundOver'
            ? { title: 'Hand complete', lines: d.result?.lines ?? [] }
            : undefined,
    };
  },
};

/** A simple, reasonable hearts player: duck when possible, dump danger when void. */
function chooseBotCard(s: S, seat: number): string {
  const legal = legalCards(s, seat);
  const trick = zone(s, 'trick').cards;
  const rank = (c: string) => parseCard(c).rank;
  const byRank = [...legal].sort((a, b) => rank(a) - rank(b));
  if (trick.length === 0) {
    const notSpadeDanger = byRank.filter((c) => !(parseCard(c).suit === 'S' && rank(c) >= 12));
    return (notSpadeDanger[0] ?? byRank[0])!;
  }
  const led = parseCard(trick[0].id).suit;
  const following = parseCard(legal[0]).suit === led;
  if (!following) {
    if (legal.includes('QS')) return 'QS';
    const hearts = byRank.filter((c) => parseCard(c).suit === 'H');
    return hearts.length ? hearts[hearts.length - 1] : byRank[byRank.length - 1];
  }
  const high = Math.max(...trick.filter((c) => parseCard(c.id).suit === led).map((c) => rank(c.id)));
  const under = byRank.filter((c) => rank(c) < high);
  if (under.length) return under[under.length - 1];
  const trickHasPoints = trick.some((c) => isPoint(c.id));
  const last = trick.length === s.players.length - 1;
  if (last && !trickHasPoints) {
    const safe = byRank.filter((c) => c !== 'QS');
    return safe[safe.length - 1] ?? byRank[byRank.length - 1];
  }
  return byRank[0];
}

export default hearts;
