import { cardName, parseCard } from '../cards';
import { createState, hand, log, name, resetDeck, zone } from '../state';
import { shuffle } from '../rng';
import { botLevel } from '../bots/search';
import { assertRule, type Action, type ActionSpec, type CardRef, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Spit, for two players in real time (pagat.com/patience/spit.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "spit" }
 * ```
 * Each player has half the deck. Each player lays out five stock piles of 1 to 5 cards, top cards face
 * up, and keeps the rest as a spit pile. On "Spit!" both turn their top spit card onto the middle to
 * start two piles. Then, with no turns, anyone may play a top card from their stock onto either
 * middle pile when it's one rank up or down. Ace and king are next to each other. When a pile is
 * played out, the card beneath turns up, and a top card may be moved into an empty space. When
 * neither player can go, both call Spit! again.
 *
 * The first to clear their stock piles, and the quicker of the two, slaps a middle pile. Whoever
 * slaps first takes that pile and the other player takes the other. Each player gathers their cards
 * for the next round. With fewer than 15 cards you lay out what you can and have no spit pile. Run
 * out of stock with no spit pile and you've won.
 *
 * Zones: the face-up top of each stock pile is in your `hand` (`group` = which of the five piles);
 * the face-down cards beneath are in `under` (same groups), and the spit pile in `spit`.
 */
export interface SpitData {
  /** Bumped whenever a middle pile changes: what a slap reacts to. */
  race: number;
  /** Who has called Spit! (both must, when neither can play). */
  ready: boolean[];
  /** End of the round: the slaps on a middle pile, the quickest wins. */
  slaps: { seat: number; rt: number; pile: number }[];
  judgeAt: number;
  /** Who cleared their stock first this round. */
  emptied: number | null;
  round: number;
  result: { lines: string[] } | null;
}

type S = GameState<SpitData>;

const CENTRES = ['left', 'right'] as const;
const SLAP_WINDOW = 350;

const rankOf = (id: string) => parseCard(id).rank;
/** One up or one down, with ace and king next to each other. */
export const fits = (card: string, onto: string | undefined) => {
  if (!onto) return false;
  const d = Math.abs(rankOf(card) - rankOf(onto));
  return d === 1 || d === 12;
};

export function spitFamily(config: GameConfig): GameModule<SpitData> {
  const top = (s: S, pile: number) => zone(s, CENTRES[pile]).cards.at(-1)?.id;
  const tops = (s: S, seat: number) => hand(s, seat).cards;
  const under = (s: S, seat: number) => zone(s, `under:${seat}`).cards;
  const spitPile = (s: S, seat: number) => zone(s, `spit:${seat}`).cards;
  const stockLeft = (s: S, seat: number) => tops(s, seat).length + under(s, seat).length;
  const total = (s: S, seat: number) => stockLeft(s, seat) + spitPile(s, seat).length;
  const seats = (s: S) => s.players.map((_, i) => i);

  const card = (s: S, id: string): CardRef => {
    s.seq = (s.seq ?? 0) + 1;
    return { id, k: s.seq };
  };

  /** The plays `seat` could make: [card, pile]. */
  function plays(s: S, seat: number): [string, number][] {
    const out: [string, number][] = [];
    for (const c of tops(s, seat)) for (const p of [0, 1]) if (fits(c.id, top(s, p))) out.push([c.id, p]);
    return out;
  }
  const stuck = (s: S) => s.phase === 'play' && seats(s).every((i) => !plays(s, i).length);
  /** An empty stock space, and top cards that could move into it (ones with cards beneath). */
  function movable(s: S, seat: number): string[] {
    const used = new Set(tops(s, seat).map((c) => c.group));
    if (used.size >= 5) return [];
    return tops(s, seat)
      .filter((c) => under(s, seat).some((u) => u.group === c.group))
      .map((c) => c.id);
  }
  const freeSpace = (s: S, seat: number) => [0, 1, 2, 3, 4].find((g) => !tops(s, seat).some((c) => c.group === g))!;

  /** Turn up the next card of stock pile `g`, if any. */
  function reveal(s: S, seat: number, g: number) {
    const u = under(s, seat);
    for (let i = u.length - 1; i >= 0; i--)
      if (u[i].group === g) {
        const [c] = u.splice(i, 1);
        tops(s, seat).push({ ...card(s, c.id), up: true, group: g });
        tops(s, seat).sort((a, b) => a.group! - b.group!);
        return;
      }
  }

  /** Lay out five stock piles of 1 to 5 cards (as far as the cards go); the rest is the spit pile. */
  function layOut(s: S, seat: number, cards: string[]) {
    shuffle(cards, s);
    hand(s, seat).cards = [];
    zone(s, `under:${seat}`).cards = [];
    zone(s, `spit:${seat}`).cards = [];
    for (let g = 0; g < 5 && cards.length; g++) {
      for (let i = 0; i < g && cards.length > 1; i++) under(s, seat).push({ ...card(s, cards.pop()!), group: g });
      tops(s, seat).push({ ...card(s, cards.pop()!), up: true, group: g });
    }
    spitPile(s, seat).push(...cards.map((id) => card(s, id)));
  }

  function newRound(s: S, piles: string[][]) {
    const d = s.data;
    for (const c of CENTRES) zone(s, c).cards = [];
    seats(s).forEach((i) => layOut(s, i, piles[i]));
    d.round++;
    d.ready = seats(s).map(() => false);
    d.slaps = [];
    d.emptied = null;
    d.race++;
    s.phase = 'play';
    s.turn = null;
  }

  function start(s: S) {
    resetDeck(s, config);
    const all = zone(s, 'deck').cards.splice(0).map((c) => c.id);
    const half = Math.ceil(all.length / 2);
    s.data.round = 0;
    s.data.result = null;
    newRound(s, [all.slice(0, half), all.slice(half)]);
    log(s, 'Lay out your piles — call Spit! to start');
  }

  /** Both called Spit!: turn up spit cards onto the middle. */
  function spit(s: S) {
    const d = s.data;
    d.ready = seats(s).map(() => false);
    const spitters = seats(s).filter((i) => spitPile(s, i).length);
    if (!spitters.length) {
      // nobody can spit: the round ends, each taking the middle pile on their side
      log(s, 'Nobody can play or spit: each takes the pile on their side');
      return endRound(s, null);
    }
    for (const i of spitters) {
      const c = spitPile(s, i).pop()!;
      zone(s, CENTRES[i]).cards.push({ ...card(s, c.id), up: true, by: i });
    }
    // starting a round, one player spits for both piles if the other has no spit pile
    if (spitters.length === 1)
      for (const p of [0, 1])
        if (!zone(s, CENTRES[p]).cards.length && spitPile(s, spitters[0]).length) {
          const c = spitPile(s, spitters[0]).pop()!;
          zone(s, CENTRES[p]).cards.push({ ...card(s, c.id), up: true, by: spitters[0] });
        }
    d.race++;
    log(s, 'Spit!');
  }

  /** Someone has cleared their stock. */
  function cleared(s: S, seat: number) {
    const d = s.data;
    if (!spitPile(s, seat).length) {
      s.phase = 'gameOver';
      s.winner = [seat];
      d.result = { lines: [`${name(s, seat)} is out of cards and wins!`] };
      log(s, d.result.lines[0], seat, 'Out!');
      return;
    }
    d.emptied = seat;
    d.race++;
    s.phase = 'slap';
    log(s, `${name(s, seat)} has cleared their piles — slap!`, seat, 'Done!');
  }

  /** Gather up for the next round: each player's own cards, plus the middle pile they ended up with. */
  function endRound(s: S, firstPick: { seat: number; pile: number } | null) {
    const takes = firstPick ? [0, 1].map((seat) => (seat === firstPick.seat ? firstPick.pile : 1 - firstPick.pile)) : [0, 1];
    const piles = seats(s).map((i) => [
      ...tops(s, i).map((c) => c.id),
      ...under(s, i).map((c) => c.id),
      ...spitPile(s, i).map((c) => c.id),
      ...zone(s, CENTRES[takes[i]]).cards.map((c) => c.id),
    ]);
    newRound(s, piles);
    log(s, `Round ${s.data.round}: lay out and call Spit!`);
  }

  function judge(s: S) {
    const best = [...s.data.slaps].sort((a, b) => a.rt - b.rt)[0];
    const n = zone(s, CENTRES[best.pile]).cards.length;
    log(s, `${name(s, best.seat)} slaps the ${CENTRES[best.pile]} pile first (${n} card${n === 1 ? '' : 's'})`, best.seat, 'Slap!');
    endRound(s, best);
  }

  function play(s: S, seat: number, a: Action, pile: number | null) {
    const id = a.cards?.[0];
    const c = tops(s, seat).find((x) => x.id === id);
    assertRule(a.cards?.length === 1 && c, 'Play a top card from your piles');
    const onto = pile ?? [0, 1].find((p) => fits(id!, top(s, p)));
    assertRule(onto !== undefined && fits(id!, top(s, onto)), top(s, 0) || top(s, 1) ? 'Too slow — it doesn’t go there now' : 'Call Spit! first');
    tops(s, seat).splice(tops(s, seat).indexOf(c), 1);
    zone(s, CENTRES[onto]).cards.push({ ...card(s, id!), up: true, by: seat });
    reveal(s, seat, c.group!);
    s.data.ready = seats(s).map(() => false);
    s.data.race++;
    log(s, `${name(s, seat)} plays the ${cardName(id!)}`, seat, undefined, undefined, { from: `hand:${seat}`, to: CENTRES[onto] });
    if (!stockLeft(s, seat)) cleared(s, seat);
  }

  const roll = (s: S, seat: number) => ((((s.data.race * 7919 + seat * 104729) >>> 0) * 2654435761) >>> 0) / 2 ** 32;

  return {
    config,
    realtime: true,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<SpitData>(config, players, seed, options, { race: 0, ready: [], slaps: [], judgeAt: 0, emptied: null, round: 0, result: null });
      start(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (seat < 0 || seat > 1) return [];
      const d = s.data;
      if (s.phase === 'slap') {
        if (d.slaps.some((x) => x.seat === seat)) return [];
        return [0, 1].map((p) => ({ type: `slap${p}`, label: `Slap ${CENTRES[p]}`, style: 'danger' as const, react: true, zone: CENTRES[p] }));
      }
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [];
      const mine = plays(s, seat);
      for (const p of [0, 1]) {
        const cards = mine.filter(([, q]) => q === p).map(([c]) => c);
        if (cards.length) out.push({ type: `play${p}`, label: `On ${CENTRES[p]}`, style: 'primary', select: { min: 1, max: 1, cards }, zone: CENTRES[p] });
      }
      if (mine.length) out.push({ type: 'play', label: 'Play', select: { min: 1, max: 1, cards: [...new Set(mine.map(([c]) => c))] }, quick: true, menu: true });
      const mv = movable(s, seat);
      if (mv.length) out.push({ type: 'move', label: 'To empty space', select: { min: 1, max: 1, cards: mv } });
      if (stuck(s) && !d.ready[seat]) out.push({ type: 'spit', label: 'Spit!', style: 'primary', react: true });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        s.winner = undefined;
        return start(s);
      }
      assertRule(seat === 0 || seat === 1, 'Not playing');
      if (s.phase === 'slap') {
        assertRule(a.type === 'slap0' || a.type === 'slap1', 'Slap a pile!');
        assertRule(!d.slaps.some((x) => x.seat === seat), 'You already slapped');
        if (!d.slaps.length) d.judgeAt = (a.at ?? 0) + SLAP_WINDOW;
        d.slaps.push({ seat, rt: Math.max(0, a.rt ?? 0), pile: a.type === 'slap0' ? 0 : 1 });
        return;
      }
      assertRule(s.phase === 'play', 'Not now');
      if (a.type === 'spit') {
        assertRule(stuck(s), 'Someone can still play');
        d.ready[seat] = true;
        log(s, `${name(s, seat)}: Spit!`, seat, 'Spit!');
        if (d.ready.every(Boolean)) spit(s);
        return;
      }
      if (a.type === 'move') {
        const id = a.cards?.[0];
        assertRule(id && movable(s, seat).includes(id), 'Move a top card with cards beneath it');
        const c = tops(s, seat).find((x) => x.id === id)!;
        const from = c.group!;
        c.group = freeSpace(s, seat);
        reveal(s, seat, from);
        tops(s, seat).sort((x, y) => x.group! - y.group!);
        return;
      }
      if (a.type === 'play0' || a.type === 'play1') return play(s, seat, a, a.type === 'play0' ? 0 : 1);
      assertRule(a.type === 'play', `Unknown action ${a.type}`);
      play(s, seat, a, null);
    },

    system(s) {
      if (s.phase === 'slap' && s.data.slaps.length) return { delay: Math.max(0, s.data.judgeAt - Date.now()), run: judge };
      return null;
    },

    bot(s, seat) {
      const d = s.data;
      if (s.phase === 'slap') {
        if (d.slaps.some((x) => x.seat === seat)) return null;
        const small = zone(s, 'left').cards.length <= zone(s, 'right').cards.length ? 0 : 1;
        return { type: `slap${small}`, race: d.race };
      }
      if (s.phase !== 'play') return null;
      const mine = plays(s, seat);
      if (mine.length) {
        // (a steady pick for this moment, so the plan holds while nothing changes)
        const [c, p] = mine[Math.floor(roll(s, seat) * mine.length)];
        return { type: `play${p}`, cards: [c] };
      }
      const mv = movable(s, seat);
      if (mv.length) return { type: 'move', cards: [mv[0]] };
      if (stuck(s) && !d.ready[seat]) return { type: 'spit', race: d.race };
      return null;
    },

    botDelay(s, _seat, a) {
      const level = botLevel(s.options);
      const span = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
      if (a.type.startsWith('slap')) return span(([[800, 1300], [520, 850], [340, 560]] as const)[level]);
      if (a.type === 'spit') return span([500, 1100]);
      return span(([[1500, 2600], [950, 1600], [600, 1000]] as const)[level]);
    },

    standings(s) {
      const left = seats(s).map((i) => total(s, i));
      return left.map((n) => left.filter((m) => m < n).length);
    },

    status(s, viewer) {
      const d = s.data;
      const who = (i: number) => (i === viewer ? 'You' : name(s, i));
      let headline = '';
      if (s.phase === 'gameOver') headline = d.result?.lines[0] ?? '';
      else if (s.phase === 'slap')
        headline = d.slaps.length ? 'Slap!' : `${who(d.emptied!)} cleared ${d.emptied === viewer ? 'your' : 'their'} piles — slap the smaller pile!`;
      else if (stuck(s)) {
        const waiting = seats(s).filter((i) => !d.ready[i]);
        headline = !top(s, 0) && !top(s, 1) && d.round === 1 && !d.ready.some(Boolean) ? 'Ready? Call Spit! to start' : waiting.includes(viewer) || viewer < 0 ? 'Nobody can go — call Spit!' : `Waiting for ${name(s, waiting[0])} to call Spit!`;
      } else headline = 'Play onto either pile — one up or one down';
      const piles = (i: number) =>
        [0, 1, 2, 3, 4].map((g) => (tops(s, i).some((c) => c.group === g) ? 1 + under(s, i).filter((u) => u.group === g).length : 0)).join(' · ');
      return {
        headline,
        race: d.race,
        hint: viewer >= 0 && viewer < 2 && s.phase !== 'gameOver' ? `Piles ${piles(viewer)} · spit pile ${spitPile(s, viewer).length}` : undefined,
        seats: s.players.map((_, i) => ({ badge: `${total(s, i)} cards`, tag: d.ready[i] ? 'Spit!' : undefined })),
        banner: s.phase === 'gameOver' ? { title: `${name(s, s.winner![0])} wins!`, lines: d.result?.lines ?? [] } : undefined,
      };
    },
  };
}
