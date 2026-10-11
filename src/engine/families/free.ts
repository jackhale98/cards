import { buildDeck, sortCards } from '../cards';
import { shuffle } from '../rng';
import { createState, deal, findCard, hand, ids, log, moveCards, moveTop, name, seatOrderFrom, zone } from '../state';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

export interface FreeData {
  pot: number;
  /** Cards in the configured deck (to enable "collect all"). */
  deck: string[];
}

type S = GameState<FreeData>;

/**
 * Build a rules-free module for any config. Games that only ship a `game.json` run through this:
 * the config decides the deck, zones and opening deal, players do the rest.
 */
export function freeFamily(config: GameConfig): GameModule<FreeData> {
  const hasZone = (id: string) => config.zones.some((z) => z.id === id);
  const sharedZones = config.zones.filter((z) => !z.perPlayer && z.area === 'center' && z.visibility === 'all').map((z) => z.id);
  const playZone = hasZone('table') ? 'table' : sharedZones[0];

  function tableCards(s: S) {
    return sharedZones.flatMap((z) => ids(zone(s, z)));
  }

  return {
    config,

    setup(players, seed, options) {
      const deckSpec = {
        ...config.deck,
        ...(options.jokers != null ? { jokers: Number(options.jokers) } : {}),
        ...(options.decks != null ? { decks: Number(options.decks) } : {}),
      };
      const cfg = { ...config, deck: deckSpec };
      const s = createState<FreeData>(cfg, players, seed, options, { pot: 0, deck: buildDeck(deckSpec) });
      const start = options.chips != null ? Number(options.chips) : (config.chips?.start ?? 0);
      s.players.forEach((p) => (p.chips = start));
      s.phase = 'free';
      if (config.deal) deal(s, config.deal);
      return s;
    },

    actions(s, seat) {
      const mine = ids(hand(s, seat));
      const table = tableCards(s);
      const deckCount = s.zones.deck?.cards.length ?? 0;
      const out: ActionSpec[] = [];
      if (mine.length) {
        out.push({ type: 'play', label: 'Play', style: 'primary', quick: true, select: { min: 1, max: mine.length, cards: mine } });
        out.push({ type: 'playDown', label: 'Play face down', select: { min: 1, max: mine.length, cards: mine } });
      }
      if (hasZone('discard') && (mine.length || table.length))
        out.push({ type: 'discard', label: 'Discard', select: { min: 1, max: 99, cards: [...mine, ...ids(zone(s, playZone))] } });
      if (table.length) {
        out.push({ type: 'take', label: 'Take', select: { min: 1, max: 99, cards: table } });
        out.push({ type: 'flip', label: 'Flip', select: { min: 1, max: 99, cards: ids(zone(s, playZone)) } });
      }
      if (deckCount) {
        out.push({ type: 'draw', label: 'Draw', zone: 'deck' });
        out.push({
          type: 'deal',
          label: 'Deal to all',
          menu: true,
          amount: { min: 1, max: Math.max(1, Math.floor(deckCount / s.players.length)), step: 1, default: Math.min(5, Math.floor(deckCount / s.players.length)) || 1, label: 'each' },
        });
        out.push({ type: 'flipTop', label: 'Turn up top card', menu: true });
        out.push({ type: 'shuffle', label: 'Shuffle deck', menu: true });
      }
      out.push({ type: 'collect', label: 'Collect & shuffle all', menu: true, style: 'danger' });
      if (mine.length > 1) out.push({ type: 'sort', label: 'Sort my hand', menu: true });
      const chips = s.players[seat].chips;
      if (chips > 0) out.push({ type: 'bet', label: 'Bet', menu: true, amount: { min: 1, max: chips, step: 1, default: Math.min(10, chips), label: 'chips' } });
      if (s.data.pot > 0) out.push({ type: 'takePot', label: `Take pot (${s.data.pot})`, menu: true });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      const cards = a.cards ?? [];
      const moveFromAnywhere = (to: string, extra = {}) => {
        for (const c of cards) {
          const z = findCard(s, c);
          assertRule(z && (z.id === `hand:${seat}` || sharedZones.includes(z.id)), 'You can’t move that card');
          moveCards(s, z.id, to, [c], extra);
        }
      };
      switch (a.type) {
        case 'play':
          moveFromAnywhere(playZone, { up: true, by: seat });
          return log(s, `${who} plays ${cards.length} card${cards.length > 1 ? 's' : ''}`, seat);
        case 'playDown':
          moveFromAnywhere(playZone, { up: false, by: seat });
          return log(s, `${who} plays ${cards.length} face down`, seat);
        case 'discard':
          moveFromAnywhere('discard', { up: true });
          return log(s, `${who} discards ${cards.length}`, seat);
        case 'take':
          moveFromAnywhere(`hand:${seat}`);
          return log(s, `${who} takes ${cards.length}`, seat);
        case 'flip':
          for (const c of zone(s, playZone).cards) if (cards.includes(c.id)) c.up = c.up === false;
          return;
        case 'draw':
          assertRule(zone(s, 'deck').cards.length, 'The deck is empty');
          moveTop(s, 'deck', `hand:${seat}`, 1);
          return log(s, `${who} draws`, seat);
        case 'flipTop':
          moveTop(s, 'deck', playZone, 1, { up: true });
          return;
        case 'deal': {
          const n = Math.max(1, Math.floor(a.amount ?? 1));
          deal(s, [{ to: 'hand', count: n }], seatOrderFrom(s, seat + 1));
          return log(s, `${who} deals ${n} to everyone`, seat);
        }
        case 'shuffle':
          shuffle(zone(s, 'deck').cards, s);
          return log(s, `${who} shuffles`, seat);
        case 'collect':
          for (const z of Object.values(s.zones)) z.cards = [];
          zone(s, 'deck').cards = shuffle([...d.deck], s).map((id) => ({ id }));
          return log(s, `${who} collects and shuffles`, seat);
        case 'sort': {
          const z = hand(s, seat);
          const order = sortCards(ids(z), config.sort);
          z.cards.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
          return;
        }
        case 'bet': {
          const amt = Math.floor(a.amount ?? 0);
          assertRule(amt > 0 && amt <= s.players[seat].chips, 'Not enough chips');
          s.players[seat].chips -= amt;
          d.pot += amt;
          return log(s, `${who} bets ${amt}`, seat);
        }
        case 'takePot':
          s.players[seat].chips += d.pot;
          log(s, `${who} takes the pot (${d.pot})`, seat);
          d.pot = 0;
          return;
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    status(s) {
      const last = s.log[s.log.length - 1];
      return {
        headline: last?.text ?? 'Deal when ready',
        pot: s.data.pot || undefined,
        seats: s.players.map(() => ({})),
      };
    },
  };
}
