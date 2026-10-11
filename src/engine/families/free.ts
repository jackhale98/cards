import { buildDeck, cardName, parseCard, rankLabel, sortCards, SUIT_SYMBOL } from '../cards';
import { shuffle } from '../rng';
import { createState, deal, findCard, hand, ids, log, moveCards, moveTop, name, seatOrderFrom, seatRelation, zone } from '../state';
import { assertRule, type ActionSpec, type CardRef, type GameConfig, type GameModule, type GameState } from '../types';

const cardLabel = (id: string) => {
  const c = parseCard(id);
  return `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;
};

/** Keep each meld group together and in rank order. */
function sortGroups(s: GameState<any>, zoneId: string) {
  const z = s.zones[zoneId];
  const order = sortCards(z.cards.map((c) => c.id), { aceLow: true });
  z.cards.sort((a, b) => (a.group ?? 0) - (b.group ?? 0) || order.indexOf(a.id) - order.indexOf(b.id));
}

export interface FreeData {
  pot: number;
  /** Cards in the configured deck (to enable "collect all"). */
  deck: string[];
}

type S = GameState<FreeData>;

/**
 * Build a rules-free module for any config. Games that only ship a `game.json` run through this:
 * the config decides the deck, zones and opening deal, players do the rest.
 *
 * Optional zones switch on extra moves: `discard` (discard, face up or down, and take the top
 * discard) and a per-player `melds` zone (lay down melds and add to anyone's melds, rummy style).
 */
export function freeFamily(config: GameConfig): GameModule<FreeData> {
  const hasZone = (id: string) => config.zones.some((z) => z.id === id);
  const sharedZones = config.zones.filter((z) => !z.perPlayer && z.area === 'center' && z.visibility === 'all').map((z) => z.id);
  const playZone = hasZone('table') ? 'table' : sharedZones[0];
  const hasMelds = hasZone('melds');
  const hasDiscard = hasZone('discard');

  /** Face-up zones on the table that anyone may pick cards from. */
  const publicZones = (s: S) => [...sharedZones, ...(hasMelds ? s.players.map((_, i) => `melds:${i}`) : [])];
  const meldCards = (s: S) => (hasMelds ? s.players.flatMap((_, i) => ids(zone(s, `melds:${i}`))) : []);
  const nextGroup = (s: S, zoneId: string) => Math.max(-1, ...zone(s, zoneId).cards.map((c) => c.group ?? 0)) + 1;
  const plural = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

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
      if (hasMelds) s.players.forEach((p, i) => (zone(s, `melds:${i}`).label = `${p.name}'s melds`));
      s.phase = 'free';
      if (config.deal) deal(s, config.deal);
      return s;
    },

    actions(s, seat) {
      const mine = ids(hand(s, seat));
      const onTable = publicZones(s).flatMap((z) => ids(zone(s, z)));
      const discardIds = hasDiscard ? ids(zone(s, 'discard')) : [];
      const movable = [...mine, ...onTable.filter((c) => !discardIds.includes(c))];
      const deckCount = s.zones.deck?.cards.length ?? 0;
      const any = (cards: string[]) => ({ min: 1, max: 99, cards });
      const out: ActionSpec[] = [];
      if (mine.length) out.push({ type: 'play', label: 'Play', style: 'primary', quick: 'swipe', select: any(mine) });
      if (hasDiscard && movable.length) out.push({ type: 'discard', label: 'Discard', select: any(movable) });
      if (hasMelds && mine.length) out.push({ type: 'meld', label: 'Lay down meld', select: any(mine) });
      if (mine.length && s.players.length > 1) {
        // left first, then right, then everyone else in turn order
        const n = s.players.length;
        const others = seatOrderFrom(s, seat + 1).filter((x) => x !== seat);
        const order = [others[0], ...(n > 2 ? [others[others.length - 1]] : []), ...others.slice(1, -1)];
        out.push({ type: 'give', label: 'Pass…', select: any(mine), target: { seats: order, label: 'Pass to' } });
      }
      if (hasMelds && mine.length && meldCards(s).length)
        out.push({ type: 'layoff', label: 'Add to meld', select: { min: 2, max: 99, cards: [...mine, ...meldCards(s)] } });
      if (onTable.length) out.push({ type: 'take', label: 'Take', select: any(onTable) });
      if (deckCount) out.push({ type: 'draw', label: 'Draw', zone: 'deck' });
      if (discardIds.length) out.push({ type: 'takeDiscard', label: 'Take top discard', zone: 'discard', menu: true });

      // less common card moves live in the menu
      if (mine.length) out.push({ type: 'playDown', label: 'Play face down', menu: true, select: any(mine) });
      if (hasDiscard && movable.length) out.push({ type: 'discardDown', label: 'Discard face down', menu: true, select: any(movable) });
      if (hasZone('deck') && movable.length) {
        out.push({ type: 'toBottom', label: 'Put on bottom of deck', menu: true, select: any(movable) });
        out.push({ type: 'toTop', label: 'Put on top of deck', menu: true, select: any(movable) });
      }
      if (onTable.length) out.push({ type: 'flip', label: 'Flip over', menu: true, select: any(onTable) });

      if (deckCount) {
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
      const n = cards.length;
      const allowed = (zoneId: string) => zoneId === `hand:${seat}` || publicZones(s).includes(zoneId);
      const moveFromAnywhere = (to: string, extra: Partial<CardRef> = {}) => {
        assertRule(n > 0, 'Select some cards first');
        for (const c of cards) {
          const z = findCard(s, c);
          assertRule(z && allowed(z.id), 'You can’t move that card');
          moveCards(s, z.id, to, [c], extra);
        }
      };
      /** Name face-up cards; only count face-down ones (nobody may learn what they were). */
      const describe = (list: string[]) => {
        const shown = list.filter((c) => {
          const z = findCard(s, c);
          return z?.visibility === 'all' && z.cards.find((x) => x.id === c)?.up !== false;
        });
        const hidden = list.length - shown.length;
        const parts = [...(shown.length ? [shown.map(cardLabel).join(' ')] : []), ...(hidden ? [`${hidden} face-down card${hidden === 1 ? '' : 's'}`] : [])];
        return { text: parts.join(' and '), short: shown.length && !hidden ? shown.map(cardLabel).join(' ') : `${list.length} card${list.length === 1 ? '' : 's'}` };
      };
      switch (a.type) {
        case 'play':
          moveFromAnywhere(playZone, { up: true, by: seat });
          return log(s, `${who} plays ${plural(n)}`, seat, n === 1 ? `Played ${cardLabel(cards[0])}` : `Played ${n}`);
        case 'playDown':
          moveFromAnywhere(playZone, { up: false, by: seat });
          return log(s, `${who} plays ${plural(n)} face down`, seat, `${n} face down`);
        case 'discard':
          moveFromAnywhere('discard', { up: true });
          return log(s, `${who} discards ${n === 1 ? `the ${cardName(cards[0])}` : plural(n)}`, seat, n === 1 ? cardLabel(cards[0]) : `Discarded ${n}`);
        case 'discardDown':
          moveFromAnywhere('discard', { up: false });
          return log(s, `${who} discards ${plural(n)} face down`, seat, 'Discarded face down');
        case 'toBottom': {
          moveFromAnywhere('deck');
          // moved cards land on top (end of the array); slide them underneath instead
          const deck = zone(s, 'deck');
          const moved = deck.cards.splice(deck.cards.length - n, n).map((c) => ({ id: c.id }));
          deck.cards.unshift(...moved);
          return log(s, `${who} puts ${plural(n)} on the bottom of the deck`, seat, 'To bottom of deck');
        }
        case 'toTop':
          moveFromAnywhere('deck');
          for (const c of zone(s, 'deck').cards.slice(-n)) delete c.up;
          return log(s, `${who} puts ${plural(n)} on top of the deck`, seat, 'To top of deck');
        case 'meld': {
          assertRule(hasMelds, 'This table has no melds');
          const target = `melds:${seat}`;
          const group = nextGroup(s, target);
          for (const c of cards) assertRule(ids(hand(s, seat)).includes(c), 'Melds come from your hand');
          moveCards(s, `hand:${seat}`, target, cards, { up: true, group, by: seat });
          sortGroups(s, target);
          return log(s, `${who} lays down ${cards.map(cardLabel).join(' ')}`, seat, 'Meld!');
        }
        case 'layoff': {
          const inMelds = cards.map((c) => ({ c, z: findCard(s, c) })).filter((x) => x.z?.id.startsWith('melds:'));
          const fromHand = cards.filter((c) => ids(hand(s, seat)).includes(c));
          assertRule(inMelds.length === 1, 'Select one card of the meld you’re adding to');
          assertRule(fromHand.length && fromHand.length + 1 === n, 'Select the cards from your hand to add');
          const targetZone = inMelds[0].z!;
          const group = targetZone.cards.find((c) => c.id === inMelds[0].c)!.group;
          moveCards(s, `hand:${seat}`, targetZone.id, fromHand, { up: true, group, by: seat });
          sortGroups(s, targetZone.id);
          const owner = targetZone.owner === seat ? 'their' : `${name(s, targetZone.owner!)}’s`;
          return log(s, `${who} adds ${fromHand.map(cardLabel).join(' ')} to ${owner} meld`, seat, `Added ${fromHand.map(cardLabel).join(' ')}`);
        }
        case 'give': {
          const to = a.seat ?? -1;
          assertRule(to !== seat && s.players[to], 'Choose who to pass to');
          for (const c of cards) assertRule(ids(hand(s, seat)).includes(c), 'You can only pass cards from your hand');
          moveCards(s, `hand:${seat}`, `hand:${to}`, cards);
          const rel = seatRelation(seat, to, s.players.length);
          const dir = rel === 'left' || rel === 'right' ? `${rel} ` : '';
          return log(s, `${who} passes ${plural(n)} ${dir}to ${name(s, to)}`, seat, `${plural(n)} → ${name(s, to)}`, to);
        }
        case 'takeDiscard': {
          const top = zone(s, 'discard').cards.at(-1);
          assertRule(top, 'The discard pile is empty');
          moveCards(s, 'discard', `hand:${seat}`, [top.id]);
          return log(s, `${who} takes ${top.up === false ? 'the face-down discard' : `the ${cardName(top.id)}`} from the discard pile`, seat, top.up === false ? 'Took discard' : `Took ${cardLabel(top.id)}`);
        }
        case 'take': {
          const what = describe(cards); // before the cards leave the table
          moveFromAnywhere(`hand:${seat}`);
          return log(s, `${who} takes ${what.text} from the table`, seat, `Took ${what.short}`);
        }
        case 'flip': {
          for (const z of publicZones(s)) for (const c of zone(s, z).cards) if (cards.includes(c.id)) c.up = c.up === false;
          const revealed = describe(cards); // after flipping: names the cards now face up
          return log(s, `${who} flips over ${revealed.text}`, seat, `Flipped ${revealed.short}`);
        }
        case 'draw':
          assertRule(zone(s, 'deck').cards.length, 'The deck is empty');
          moveTop(s, 'deck', `hand:${seat}`, 1);
          return log(s, `${who} draws`, seat);
        case 'flipTop': {
          moveTop(s, 'deck', playZone, 1, { up: true });
          const top = zone(s, playZone).cards.at(-1)!.id;
          return log(s, `${who} turns up the ${cardName(top)}`, seat, cardLabel(top));
        }
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
