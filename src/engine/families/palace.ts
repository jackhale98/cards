import { cardLabel, parseCard, rankLabel } from '../cards';
import { createState, hand, ids, log, moveCards, moveTop, name, nextSeat, resetDeck, sortHand, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Palace, also Shithead or Karma (pagat.com/beating/shithead.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "palace" }
 * ```
 * Each player has three cards face down on the table, three face up on top of them, and three in
 * hand; the rest is the draw pile. Before play you may swap hand cards with your face-up cards.
 * In turn, play a card (or several of one rank) equal to or higher than the top of the pile, then
 * draw back up to three. Can't (or won't)? Pick up the whole pile. A 2 goes on anything and anything
 * goes on a 2; a 10 goes on anything and burns the pile, as does four of a kind on top — and the
 * same player goes again. With your hand gone and the draw pile empty, play your face-up cards,
 * then turn your face-down cards over blind: if one can't be played, pick it up with the pile.
 * Players drop out as they run out of cards; the last left holding cards loses.
 *
 * Zones: `up:<seat>` (face-up table cards) and `down:<seat>` (face-down, hidden from everyone). The
 * face-down row is only drawn once its owner's face-up cards are gone, so the table stays compact.
 */
export interface PalaceData {
  /** Swap phase: who has said they're ready. */
  ready: boolean[];
  /** Seats in the order they went out. */
  finished: number[];
  /** The last thing that happened, for the headline. */
  last: string | null;
  result: { lines: string[] } | null;
}

type S = GameState<PalaceData>;

const rankOf = (id: string) => parseCard(id).rank;
const plural = (n: number, r: number) => (n === 1 ? `a ${rankLabel(r)}` : `${['', '', 'two', 'three', 'four'][n] ?? n} ${rankLabel(r)}s`);
/** 2 and 10 are wild: they go on anything. */
const wild = (r: number) => r === 2 || r === 10;

export function palaceFamily(config: GameConfig): GameModule<PalaceData> {
  const upZ = (seat: number) => `up:${seat}`;
  const downZ = (seat: number) => `down:${seat}`;
  const faceUp = (s: S, seat: number) => ids(zone(s, upZ(seat)));
  const faceDown = (s: S, seat: number) => ids(zone(s, downZ(seat)));
  const out = (s: S, seat: number) => s.data.finished.includes(seat);
  const pile = (s: S) => ids(zone(s, 'pile'));
  /** The rank to equal or beat (0: anything goes — an empty pile, or a 2 on top). */
  const toBeat = (s: S) => {
    const top = pile(s).at(-1);
    return top == null || rankOf(top) === 2 ? 0 : rankOf(top);
  };
  const canGoOn = (s: S, r: number) => wild(r) || r >= toBeat(s);
  /** Where `seat` plays from now: hand, then face-up, then face-down cards. */
  const source = (s: S, seat: number): 'hand' | 'up' | 'down' | null =>
    hand(s, seat).cards.length ? 'hand' : faceUp(s, seat).length ? 'up' : faceDown(s, seat).length ? 'down' : null;
  const sourceCards = (s: S, seat: number) => (source(s, seat) === 'hand' ? ids(hand(s, seat)) : source(s, seat) === 'up' ? faceUp(s, seat) : []);
  const playable = (s: S, seat: number) => sourceCards(s, seat).filter((c) => canGoOn(s, rankOf(c)));
  const nextIn = (s: S, seat: number) => nextSeat(s, seat, (x) => out(s, x));

  function start(s: S) {
    const d = s.data;
    resetDeck(s, config);
    for (const z of Object.values(s.zones)) if (z.id !== 'deck') z.cards = [];
    const order = s.players.map((_, k) => (s.dealer + 1 + k) % s.players.length);
    for (let k = 0; k < 3; k++) for (const i of order) moveTop(s, 'deck', downZ(i), 1, { up: false });
    for (let k = 0; k < 3; k++) for (const i of order) moveTop(s, 'deck', upZ(i), 1, { up: true });
    for (let k = 0; k < 3; k++) for (const i of order) moveTop(s, 'deck', `hand:${i}`, 1);
    s.players.forEach((p, i) => {
      sortHand(s, i);
      zone(s, upZ(i)).label = `${p.name} · face up`;
      zone(s, downZ(i)).label = `${p.name} · face down`;
    });
    d.ready = s.players.map(() => false);
    d.finished = [];
    d.last = null;
    d.result = null;
    s.phase = 'swap';
    s.turn = null;
    tidy(s);
    log(s, `${name(s, s.dealer)} deals: three down, three up and three in hand each`);
  }

  /** Labels and layout after every change: the pile says what to beat; face-down rows appear when needed. */
  function tidy(s: S) {
    const z = zone(s, 'pile');
    z.label = !z.cards.length ? 'Pile · play anything' : toBeat(s) ? `Pile · ${rankLabel(toBeat(s))} or higher` : 'Pile · anything on a 2';
    s.players.forEach((_, i) => (zone(s, downZ(i)).area = faceUp(s, i).length ? 'none' : 'strip'));
  }

  /** Everyone's ready: whoever shows the lowest card (face up first, then in hand) starts. */
  function startPlay(s: S) {
    const order = s.players.map((_, k) => (s.dealer + 1 + k) % s.players.length);
    let first = order[0];
    find: for (const r of [3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]) {
      for (const where of [(i: number) => faceUp(s, i), (i: number) => ids(hand(s, i))])
        for (const i of order)
          if (where(i).some((c) => rankOf(c) === r)) {
            first = i;
            break find;
          }
    }
    s.phase = 'play';
    s.turn = first;
    tidy(s);
    log(s, `${name(s, first)} starts`);
  }

  /** Refill to three from the draw pile. */
  function drawUp(s: S, seat: number) {
    const n = Math.min(3 - hand(s, seat).cards.length, zone(s, 'deck').cards.length);
    if (n > 0) moveTop(s, 'deck', `hand:${seat}`, n);
    sortHand(s, seat);
  }

  /** Burn the pile: a 10, or four of a kind on top. */
  function burns(s: S): boolean {
    const p = pile(s);
    const top = p.at(-1);
    if (top == null) return false;
    if (rankOf(top) === 10) return true;
    let run = 0;
    for (let i = p.length - 1; i >= 0 && rankOf(p[i]) === rankOf(top); i--) run++;
    return run >= 4;
  }

  /** After `seat` played: burn, go out, or pass the turn. */
  function afterPlay(s: S, seat: number) {
    const d = s.data;
    drawUp(s, seat);
    const burned = burns(s);
    if (burned) {
      moveCards(s, 'pile', 'burned', pile(s));
      log(s, 'The pile burns!', seat, 'Burn!');
    }
    if (!source(s, seat)) {
      d.finished.push(seat);
      log(s, `${name(s, seat)} is out of cards!`, seat, 'Out!');
      if (s.players.filter((p) => !out(s, p.seat)).length <= 1) return endGame(s);
      s.turn = nextIn(s, seat);
    } else {
      // a burn lets the same player go again; otherwise play moves on
      s.turn = burned ? seat : nextIn(s, seat);
    }
    tidy(s);
  }

  function pickUp(s: S, seat: number, why: string) {
    const n = pile(s).length;
    moveCards(s, 'pile', `hand:${seat}`, pile(s));
    sortHand(s, seat);
    s.data.last = `${name(s, seat)} picked up ${n} card${n === 1 ? '' : 's'}`;
    log(s, `${name(s, seat)} ${why} and picks up the pile (${n})`, seat, `+${n}`);
    s.turn = nextIn(s, seat);
    tidy(s);
  }

  function endGame(s: S) {
    const d = s.data;
    const loser = s.players.find((p) => !out(s, p.seat))!.seat;
    d.finished.push(loser);
    s.winner = [d.finished[0]];
    s.phase = 'gameOver';
    s.turn = null;
    d.result = {
      lines: [...d.finished.slice(0, -1).map((seat, k) => `${k + 1}. ${name(s, seat)}`), `${name(s, loser)} is left holding the cards — the Shithead!`],
    };
    log(s, d.result.lines.at(-1)!, loser);
    s.dealer = loser; // the loser deals next
  }

  // ---- bots ------------------------------------------------------------------------------

  const worth = (c: string) => (wild(rankOf(c)) ? 20 : rankOf(c));
  const lowest = (cards: string[]) => [...cards].sort((a, b) => worth(a) - worth(b))[0];

  /** Swap: strong cards (2s, 10s, aces) face up to finish with, low cards in hand to play early. */
  function botSwap(s: S, seat: number): Action {
    const h = [...ids(hand(s, seat))].sort((a, b) => worth(b) - worth(a));
    const u = [...faceUp(s, seat)].sort((a, b) => worth(a) - worth(b));
    if (h.length && u.length && worth(h[0]) > worth(u[0])) return { type: 'swap', cards: [h[0], u[0]] };
    return { type: 'ready' };
  }

  /** Play the lowest cards that go (all of that rank), saving 2s and 10s; pick up if nothing goes. */
  function botMove(s: S, seat: number): Action {
    const src = source(s, seat);
    if (src === 'down') return { type: 'flip', cards: [faceDown(s, seat)[0]] };
    const options = playable(s, seat);
    if (!options.length) return src === 'up' ? { type: 'pickup', cards: [lowest(faceUp(s, seat))] } : { type: 'pickup' };
    // a 10 clears a big pile; otherwise 2s and 10s only when nothing plain goes
    const tens = options.filter((c) => rankOf(c) === 10);
    if (tens.length && pile(s).length >= 6) return { type: 'play', cards: [tens[0]] };
    const plain = options.filter((c) => !wild(rankOf(c)));
    const pick = lowest(plain.length ? plain : options);
    return { type: 'play', cards: sourceCards(s, seat).filter((c) => rankOf(c) === rankOf(pick)) };
  }

  function quickBot(s: S, seat: number): Action | null {
    if (s.phase === 'swap') return s.data.ready[seat] ? null : botSwap(s, seat);
    if (s.phase === 'play' && s.turn === seat) return botMove(s, seat);
    return null;
  }

  const module: GameModule<PalaceData> = {
    config,

    setup(players, seed, options) {
      const s = createState<PalaceData>(config, players, seed, options, { ready: [], finished: [], last: null, result: null });
      s.dealer = players.length - 1;
      start(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase === 'swap') {
        if (d.ready[seat]) return [];
        return [
          { type: 'ready', label: 'Ready', style: 'primary' },
          { type: 'swap', label: 'Swap', select: { min: 2, max: 2, cards: [...ids(hand(s, seat)), ...faceUp(s, seat)] } },
        ];
      }
      if (s.phase !== 'play' || s.turn !== seat) return [];
      const src = source(s, seat);
      if (src === 'down') return [{ type: 'flip', label: 'Turn one over', style: 'primary', select: { min: 1, max: 1, cards: faceDown(s, seat) } }];
      const out: ActionSpec[] = [{ type: 'play', label: 'Play', style: 'primary', quick: 'swipe', select: { min: 1, max: 4, cards: playable(s, seat) } }];
      if (pile(s).length)
        out.push(
          src === 'up'
            ? { type: 'pickup', label: 'Pick up (add a face-up card)', select: { min: 1, max: 1, cards: faceUp(s, seat) } }
            : { type: 'pickup', label: 'Pick up the pile', style: playable(s, seat).length ? 'quiet' : 'primary', zone: 'pile' },
        );
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      const who = name(s, seat);
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        s.winner = undefined;
        return start(s);
      }
      if (s.phase === 'swap') {
        assertRule(!d.ready[seat], 'You’re ready already');
        if (a.type === 'ready') {
          d.ready[seat] = true;
          log(s, `${who} is ready`, seat, 'Ready');
          if (d.ready.every(Boolean)) startPlay(s);
          return;
        }
        assertRule(a.type === 'swap', 'Swap or say you’re ready');
        const cards = a.cards ?? [];
        const h = cards.find((c) => ids(hand(s, seat)).includes(c));
        const u = cards.find((c) => faceUp(s, seat).includes(c));
        assertRule(cards.length === 2 && h && u, 'Pick one card from your hand and one of your face-up cards');
        moveCards(s, `hand:${seat}`, upZ(seat), [h], { up: true });
        moveCards(s, upZ(seat), `hand:${seat}`, [u]);
        sortHand(s, seat);
        log(s, `${who} swaps the ${cardLabel(u)} into hand for the ${cardLabel(h)}`, seat, 'Swap');
        return;
      }
      assertRule(s.phase === 'play' && s.turn === seat, 'Not your turn');
      const src = source(s, seat);
      switch (a.type) {
        case 'play': {
          assertRule(src === 'hand' || src === 'up', 'Turn over a face-down card');
          const from = sourceCards(s, seat);
          const cards = a.cards ?? [];
          assertRule(cards.length >= 1 && new Set(cards).size === cards.length && cards.every((c) => from.includes(c)), src === 'hand' ? 'Play from your hand' : 'Play your face-up cards');
          const r = rankOf(cards[0]);
          assertRule(cards.every((c) => rankOf(c) === r), 'Play cards of one rank');
          assertRule(canGoOn(s, r), `Play a ${rankLabel(toBeat(s))} or higher, a 2 or a 10 — or pick up`);
          moveCards(s, src === 'hand' ? `hand:${seat}` : upZ(seat), 'pile', cards, { up: true, by: seat });
          d.last = `${who} played ${plural(cards.length, r)}`;
          log(s, `${who} plays ${plural(cards.length, r)}`, seat, cards.length === 1 ? cardLabel(cards[0]) : `${cards.length}× ${rankLabel(r)}`, undefined, { to: 'pile' });
          return afterPlay(s, seat);
        }
        case 'pickup': {
          assertRule(pile(s).length > 0, 'The pile is empty — play any card');
          assertRule(src === 'hand' || src === 'up', 'Turn over a face-down card');
          if (src === 'up') {
            // with only table cards left you add one face-up card before taking the pile
            const c = a.cards?.[0];
            assertRule(c && faceUp(s, seat).includes(c), 'Choose a face-up card to add to the pile');
            moveCards(s, upZ(seat), 'pile', [c], { up: true, by: seat });
          }
          return pickUp(s, seat, 'can’t beat it');
        }
        case 'flip': {
          assertRule(src === 'down', 'Play your other cards first');
          const c = a.cards?.[0];
          assertRule(c && faceDown(s, seat).includes(c), 'Choose one of your face-down cards');
          // judged against what was on top before it
          const beat = toBeat(s);
          moveCards(s, downZ(seat), 'pile', [c], { up: true, by: seat });
          log(s, `${who} turns over the ${cardLabel(c)}`, seat, cardLabel(c), undefined, { to: 'pile' });
          if (!wild(rankOf(c)) && rankOf(c) < beat) return pickUp(s, seat, `turns over the ${cardLabel(c)}, which doesn’t go,`);
          d.last = `${who} turned over the ${cardLabel(c)}`;
          return afterPlay(s, seat);
        }
      }
      assertRule(false, `Unknown action ${a.type}`);
    },

    // (a search bot tried here played worse: playouts of Palace favour picking up the pile)
    bot: quickBot,

    standings(s) {
      // by the order players went out; anyone still holding cards shares the next place
      const d = s.data;
      return s.players.map((p) => {
        const k = d.finished.indexOf(p.seat);
        return k >= 0 ? k + 1 : d.finished.length + 1;
      });
    },

    status(s, viewer) {
      const d = s.data;
      let headline: string;
      if (s.phase === 'swap') {
        headline = viewer < 0 || d.ready[viewer] ? 'Waiting for everyone to swap…' : 'Swap hand cards with your face-up cards, then Ready';
      } else if (s.phase === 'play') {
        const need = toBeat(s) ? `${rankLabel(toBeat(s))} or higher` : 'anything';
        const turn =
          s.turn === viewer
            ? source(s, viewer) === 'down'
              ? 'Your turn: turn over a face-down card'
              : toBeat(s)
                ? `Your turn: play ${need} (or a 2 or 10) — or pick up`
                : 'Your turn: play anything'
            : `${name(s, s.turn!)} to play · ${need}`;
        headline = [d.last, turn].filter(Boolean).join(' · ');
      } else headline = d.result?.lines.at(-1) ?? '';
      return {
        headline,
        seats: s.players.map((_, i) => ({
          badge:
            out(s, i) && s.phase === 'play'
              ? `Out · #${d.finished.indexOf(i) + 1}`
              : `${hand(s, i).cards.length} in hand · ${faceUp(s, i).length} up · ${faceDown(s, i).length} down`,
          tag: s.phase === 'swap' && d.ready[i] ? '✓' : undefined,
        })),
        banner: s.phase === 'gameOver' ? { title: `${name(s, d.finished[0])} goes out first!`, lines: d.result?.lines ?? [] } : undefined,
      };
    },
  };
  return module;
}
