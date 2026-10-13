import { buildDeck, cardLabel, parseCard } from '../cards';
import { shuffle } from '../rng';
import { createState, ids, log, moveCards, moveTop, name, placesFromScores, zone } from '../state';
import { familyRules, assertRule, type Action, type GameConfig, type GameModule, type GameState } from '../types';
/** This family's settings in game.json (generated from the schema). */
export type { BaccaratRules } from '../schema.gen';

export type BaccaratSide = 'player' | 'banker' | 'tie';

export interface BaccaratData {
  round: number;
  /** Each seat's bet this round (null = not yet placed, amount 0 = sitting out). */
  bets: ({ side: BaccaratSide; amount: number } | null)[];
  before: number[];
  /** Who won the coup, once it's settled. */
  outcome: BaccaratSide | null;
  result: { lines: string[] } | null;
}

type S = GameState<BaccaratData>;

/** A card's baccarat value: aces 1, two to nine face value, tens and faces nothing. */
export const pointValue = (id: string): number => {
  const r = parseCard(id).rank;
  return r === 14 ? 1 : r >= 10 ? 0 : r;
};
export const baccaratTotal = (cards: string[]): number => cards.reduce((t, c) => t + pointValue(c), 0) % 10;

/** Whether the Banker draws on `banker`, given the Player's third card (null when the Player stood). */
export function bankerDraws(banker: number, third: number | null): boolean {
  if (third === null) return banker <= 5;
  if (banker <= 2) return true;
  if (banker === 3) return third !== 8;
  if (banker === 4) return third >= 2 && third <= 7;
  if (banker === 5) return third >= 4 && third <= 7;
  if (banker === 6) return third === 6 || third === 7;
  return false;
}

const SIDE_NAME: Record<BaccaratSide, string> = { player: 'Player', banker: 'Banker', tie: 'Tie' };

export function baccaratFamily(config: GameConfig): GameModule<BaccaratData> {
  const R = familyRules(config, 'baccarat');
  const decks = (s: S) => Number(s.options.decks ?? 8);
  const rounds = (s: S) => Number(s.options.rounds ?? 10);
  const minBet = (s: S) => Number(s.options.minBet ?? R.minBet);
  const maxBet = (s: S) => Math.max(minBet(s), R.maxBet);
  const cards = (s: S, side: 'player' | 'banker') => ids(zone(s, side));
  const inRound = (s: S, seat: number) => (s.data.bets[seat]?.amount ?? 0) > 0;

  function relabel(s: S) {
    for (const side of ['player', 'banker'] as const) {
      const c = cards(s, side);
      zone(s, side).label = c.length ? `${SIDE_NAME[side]} · ${baccaratTotal(c)}` : SIDE_NAME[side];
    }
  }

  function draw(s: S, to: 'player' | 'banker') {
    if (!zone(s, 'deck').cards.length) {
      zone(s, 'deck').cards = shuffle(ids(zone(s, 'discard')), s).map((id) => ({ id }));
      zone(s, 'discard').cards = [];
      log(s, 'The shoe is reshuffled');
    }
    moveTop(s, 'deck', to, 1, { up: true });
    relabel(s);
    return cards(s, to).at(-1)!;
  }

  function startRound(s: S) {
    const d = s.data;
    for (const z of ['player', 'banker']) moveCards(s, z, 'discard', ids(zone(s, z)));
    // a fresh shoe once it's down to its last sixth or so (the cut card)
    if (zone(s, 'deck').cards.length < (52 * decks(s)) / 6) {
      zone(s, 'deck').cards = shuffle([...ids(zone(s, 'deck')), ...ids(zone(s, 'discard'))], s).map((id) => ({ id }));
      zone(s, 'discard').cards = [];
      if (d.round > 0) log(s, 'A fresh shoe is shuffled');
    }
    d.round++;
    d.bets = s.players.map((p) => (p.chips >= minBet(s) ? null : { side: 'player', amount: 0 }));
    d.before = s.players.map((p) => p.chips);
    d.outcome = null;
    d.result = null;
    s.phase = 'bet';
    s.turn = null;
    relabel(s);
  }

  /** One step of the coup, run by the house with a pause between cards. */
  function step(s: S) {
    const p = cards(s, 'player');
    const b = cards(s, 'banker');
    if (p.length < 2) {
      // Player, Banker, Player, Banker
      draw(s, 'player');
      draw(s, 'banker');
      draw(s, 'player');
      draw(s, 'banker');
      const pt = baccaratTotal(cards(s, 'player'));
      const bt = baccaratTotal(cards(s, 'banker'));
      log(s, `Player ${pt}, Banker ${bt}${pt >= 8 || bt >= 8 ? ' — a natural' : ''}`);
      return;
    }
    const pt = baccaratTotal(p);
    const bt = baccaratTotal(b);
    if (p.length === 2 && b.length === 2 && (pt >= 8 || bt >= 8)) return settle(s);
    if (p.length === 2 && pt <= 5) {
      const c = draw(s, 'player');
      log(s, `The Player draws ${cardLabel(c)} — ${baccaratTotal(cards(s, 'player'))}`);
      return;
    }
    if (b.length === 2 && bankerDraws(bt, p.length === 3 ? pointValue(p[2]) : null)) {
      const c = draw(s, 'banker');
      log(s, `The Banker draws ${cardLabel(c)} — ${baccaratTotal(cards(s, 'banker'))}`);
      return;
    }
    settle(s);
  }

  function settle(s: S) {
    const d = s.data;
    const pt = baccaratTotal(cards(s, 'player'));
    const bt = baccaratTotal(cards(s, 'banker'));
    const outcome: BaccaratSide = pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
    d.outcome = outcome;
    s.players.forEach((pl, i) => {
      const bet = d.bets[i];
      if (!bet?.amount) return;
      if (bet.side === outcome) {
        const win = outcome === 'tie' ? bet.amount * 8 : outcome === 'banker' ? Math.floor((bet.amount * 19) / 20) : bet.amount;
        pl.chips += bet.amount + win;
      } else if (outcome === 'tie') pl.chips += bet.amount; // Player and Banker bets push
    });
    const head = outcome === 'tie' ? `A tie at ${pt}` : `${SIDE_NAME[outcome]} wins, ${Math.max(pt, bt)} to ${Math.min(pt, bt)}`;
    log(s, head);
    const lines = [head];
    for (const pl of s.players) {
      const bet = d.bets[pl.seat];
      if (!bet?.amount) continue;
      const delta = pl.chips - d.before[pl.seat];
      lines.push(`${pl.name} (${SIDE_NAME[bet.side]} ${bet.amount}): ${delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0'} → ${pl.chips}`);
    }
    endRound(s, lines);
  }

  function endRound(s: S, lines: string[]) {
    const d = s.data;
    s.turn = null;
    const broke = s.players.every((p) => p.chips < minBet(s));
    if (d.round >= rounds(s) || broke) {
      const best = Math.max(...s.players.map((p) => p.chips));
      s.winner = s.players.filter((p) => p.chips === best).map((p) => p.seat);
      s.phase = 'gameOver';
      lines.push(broke ? 'The house has everyone’s chips!' : `After ${d.round} rounds, most chips wins`);
    } else s.phase = 'roundOver';
    d.result = { lines };
  }

  const betLimit = (s: S, seat: number) => Math.min(maxBet(s), s.players[seat].chips);

  return {
    config,

    setup(players, seed, options) {
      const s = createState<BaccaratData>(config, players, seed, options, { round: 0, bets: [], before: [], outcome: null, result: null });
      s.zones.deck.cards = shuffle(buildDeck({ ...config.deck, decks: decks(s) }), s).map((id) => ({ id }));
      const stack = Number(options.stack ?? config.chips?.start ?? 1000);
      s.players.forEach((p) => (p.chips = stack));
      s.dealer = 0; // (the house deals)
      startRound(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'roundOver') return [{ type: 'next', label: 'Next coup', style: 'primary' }];
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase !== 'bet' || s.data.bets[seat] !== null) return [];
      const amount = { min: minBet(s), max: betLimit(s, seat), step: minBet(s), default: minBet(s), label: 'chips' };
      return [
        { type: 'betBanker', label: 'Banker', style: 'primary', amount },
        { type: 'betPlayer', label: 'Player', amount },
        { type: 'betTie', label: 'Tie · 8:1', amount },
      ];
    },

    apply(s, seat, a) {
      const d = s.data;
      switch (a.type) {
        case 'next':
          assertRule(s.phase === 'roundOver', 'Round in progress');
          return startRound(s);
        case 'rematch': {
          assertRule(s.phase === 'gameOver', 'Game not over');
          const stack = Number(s.options.stack ?? config.chips?.start ?? 1000);
          s.players.forEach((p) => (p.chips = stack));
          s.winner = undefined;
          d.round = 0;
          return startRound(s);
        }
        case 'betPlayer':
        case 'betBanker':
        case 'betTie': {
          assertRule(s.phase === 'bet' && d.bets[seat] === null, 'Not betting now');
          const amount = Math.floor(a.amount ?? 0);
          assertRule(amount >= minBet(s) && amount <= betLimit(s, seat), `Bet ${minBet(s)} to ${betLimit(s, seat)}`);
          const side = a.type.slice(3).toLowerCase() as BaccaratSide;
          d.bets[seat] = { side, amount };
          s.players[seat].chips -= amount;
          log(s, `${name(s, seat)} bets ${amount} on ${SIDE_NAME[side]}`, seat, `${SIDE_NAME[side]} ${amount}`);
          if (d.bets.every((b) => b !== null)) {
            if (d.bets.every((b) => !b!.amount)) return endRound(s, ['Nobody can cover the minimum bet']);
            s.phase = 'deal';
          }
          return;
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    system(s) {
      if (s.phase !== 'deal') return null;
      return { delay: 900, run: step };
    },

    bot(s, seat): Action | null {
      if (s.phase !== 'bet' || s.data.bets[seat] !== null) return null;
      const units = Math.max(1, Math.min(Math.floor(betLimit(s, seat) / minBet(s)), 1 + Math.floor(Math.random() * 3)));
      // the Banker bet has the smallest house edge; mix in some Player and the odd long shot
      const r = Math.random();
      const type = r < 0.6 ? 'betBanker' : r < 0.95 ? 'betPlayer' : 'betTie';
      return { type, amount: units * minBet(s) };
    },

    standings(s) {
      return placesFromScores(s.players.map((p) => p.chips));
    },

    status(s, viewer) {
      const d = s.data;
      let headline: string;
      if (s.phase === 'bet') headline = d.bets[viewer] === null ? `Coup ${d.round} of ${rounds(s)} · Banker, Player or Tie?` : 'Waiting for bets…';
      else if (s.phase === 'deal') {
        const p = cards(s, 'player');
        headline = p.length ? `Player ${baccaratTotal(p)} · Banker ${baccaratTotal(cards(s, 'banker'))}` : 'Dealing…';
      } else headline = d.result?.lines[0] ?? '';
      const badge = (i: number) => {
        const bet = d.bets[i];
        if (bet === null) return 'Betting…';
        if (!bet.amount) return 'Out';
        const tag = `${SIDE_NAME[bet.side]} ${bet.amount}`;
        if (!d.outcome) return tag;
        return `${tag} · ${bet.side === d.outcome ? 'win' : d.outcome === 'tie' ? 'push' : 'lose'}`;
      };
      return {
        headline,
        seats: s.players.map((p, i) => ({ badge: badge(i), out: p.chips < minBet(s) && !inRound(s, i) })),
        scoreboard: {
          columns: ['Chips'],
          rows: s.players.map((p) => ({ name: p.name, values: [p.chips], highlight: s.winner?.includes(p.seat) })),
        },
        banner:
          s.phase === 'gameOver'
            ? { title: `${s.winner!.map((w) => name(s, w)).join(' & ')} win${s.winner!.length > 1 ? '' : 's'}!`, lines: d.result?.lines ?? [] }
            : s.phase === 'roundOver'
              ? { title: `Coup ${d.round}`, lines: d.result?.lines ?? [] }
              : undefined,
      };
    },
  };
}
