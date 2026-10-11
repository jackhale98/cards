import { parseCard } from '../cards';
import { createState, deal, hand, ids, log, moveCards, name, nextSeat, placesFromScores, resetDeck, sortHand, zone } from '../state';
import { assertRule, type Action, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Cheat, aka Bullshit or I Doubt It (pagat.com/beating/cheat.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "cheat" }
 * ```
 * All the cards are dealt. In turn, players put one or more cards face down on the pile and say
 * they are the next rank in sequence (aces, then twos, threes … kings, aces again) — truthfully or
 * not. Before the next player plays, anyone may call "Cheat!": the cards are turned up, and whoever
 * was wrong (the player, if any card isn't that rank; otherwise the caller) picks up the whole pile.
 * Play carries on to the left of the player who was challenged. The first to get rid of their
 * cards, and survive any challenge to that last play, wins.
 */
export interface CheatData {
  /** The rank (2–14) that must be claimed next. */
  rank: number;
  /** The last play: who, how many, which rank they said — open to challenge until the next play. */
  last: { seat: number; count: number; rank: number } | null;
  /** The last challenge: the cards turned up (also in the `shown` zone), and how it went. */
  reveal: { caller: number; player: number; lied: boolean } | null;
  /** Who claimed each rank, and how many (public — bots use it). */
  claims: { seat: number; count: number; rank: number }[];
  result: { lines: string[] } | null;
}

type S = GameState<CheatData>;

/** Ranks in calling order: A, 2 … K. */
const SEQ = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const after = (rank: number) => SEQ[(SEQ.indexOf(rank) + 1) % SEQ.length];
const NAMES: Record<number, string> = { 14: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'jack', 12: 'queen', 13: 'king' };
const plural = (r: number) => (r === 6 ? 'sixes' : `${NAMES[r]}s`);
const COUNT = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
/** "two sevens", "one ace". */
const said = (count: number, rank: number) => `${COUNT[count] ?? count} ${count === 1 ? NAMES[rank] : plural(rank)}`;

export function cheatFamily(config: GameConfig): GameModule<CheatData> {
  const decks = (s: S) => (s.players.length >= 7 ? 2 : 1);
  const maxPlay = (s: S) => 4 * decks(s);

  function start(s: S) {
    const d = s.data;
    resetDeck(s, { ...config, deck: { ...config.deck, decks: decks(s) } });
    for (const z of Object.values(s.zones)) if (z.id !== 'deck') z.cards = [];
    while (zone(s, 'deck').cards.length) deal(s, [{ to: 'hand', count: 1 }]);
    s.players.forEach((_, i) => sortHand(s, i));
    d.rank = 14;
    d.last = null;
    d.reveal = null;
    d.claims = [];
    d.result = null;
    s.phase = 'play';
    s.turn = nextSeat(s, s.dealer);
    log(s, `${name(s, s.dealer)} deals; ${name(s, s.turn)} starts with aces`);
  }

  /** Someone has played their last cards and nobody challenged in time: they win. */
  function finish(s: S, seat: number) {
    s.winner = [seat];
    s.phase = 'gameOver';
    s.turn = null;
    s.data.result = { lines: [`${name(s, seat)} is out of cards!`] };
    log(s, s.data.result.lines[0], seat, 'Out!');
  }

  /** The challenge window closes when the next player moves; an unchallenged empty hand wins. */
  function closeWindow(s: S) {
    const d = s.data;
    if (d.last && !hand(s, d.last.seat).cards.length) {
      finish(s, d.last.seat);
      return true;
    }
    return false;
  }

  function challenge(s: S, caller: number) {
    const d = s.data;
    collectShown(s);
    const last = d.last!;
    const pile = zone(s, 'pile').cards;
    const played = pile.slice(-last.count).map((c) => c.id);
    const lied = played.some((c) => parseCard(c).rank !== last.rank);
    const loser = lied ? last.seat : caller;
    // the challenged cards are shown face up; the rest of the pile goes straight to the loser
    moveCards(s, 'pile', 'shown', played, { up: true });
    const rest = ids(zone(s, 'pile'));
    moveCards(s, 'pile', `hand:${loser}`, rest);
    d.reveal = { caller, player: last.seat, lied };
    log(
      s,
      `${name(s, caller)} calls Cheat! on ${name(s, last.seat)} — ${lied ? 'caught lying' : 'it was true'}; ${name(s, loser)} picks up the pile`,
      caller,
      'Cheat!',
    );
    d.last = null;
    // play goes on from the left of the player who was challenged; the next rank follows on
    s.turn = nextSeat(s, last.seat);
    d.rank = after(last.rank);
    // a player who went out and was truthful wins now
    if (!lied && !hand(s, last.seat).cards.length) return finish(s, last.seat);
    // the turned-up cards join the loser's hand once everyone has seen them (at the next play)
  }

  /** Cards turned up in a challenge go to whoever picked up the pile, when play moves on. */
  function collectShown(s: S) {
    const d = s.data;
    if (!d.reveal) return;
    const loser = d.reveal.lied ? d.reveal.player : d.reveal.caller;
    moveCards(s, 'shown', `hand:${loser}`, ids(zone(s, 'shown')), { up: false });
    sortHand(s, loser);
    d.reveal = null;
  }

  // ---- bots ------------------------------------------------------------------------------

  /** How many of `rank` a seat can see (its own hand and the cards turned up). */
  function seen(s: S, seat: number, rank: number) {
    return [...ids(hand(s, seat)), ...ids(zone(s, 'shown'))].filter((c) => parseCard(c).rank === rank).length;
  }

  function botPlay(s: S, seat: number): Action {
    const d = s.data;
    const own = ids(hand(s, seat));
    const true_ = own.filter((c) => parseCard(c).rank === d.rank);
    if (true_.length) {
      // the truth, sometimes padded with one more card when holding few
      const extra = own.filter((c) => parseCard(c).rank !== d.rank);
      const pad = Math.random() < 0.25 && extra.length && true_.length < maxPlay(s) ? [extra[0]] : [];
      return { type: 'play', cards: [...true_, ...pad] };
    }
    // nothing of the rank: get rid of a card we won't need for a while
    const soon = (r: number) => (SEQ.indexOf(r) - SEQ.indexOf(d.rank) + 13) % 13;
    const pick = [...own].sort((a, b) => soon(parseCard(b).rank) - soon(parseCard(a).rank))[0];
    return { type: 'play', cards: [pick] };
  }

  function botCalls(s: S, seat: number): boolean {
    const d = s.data;
    const last = d.last;
    if (!last || last.seat === seat) return false;
    const total = 4 * decks(s);
    // certain: more claimed than can exist besides ours
    if (last.count + seen(s, seat, last.rank) > total) return true;
    // one decision per bot per play (the host asks bots again and again: don't re-roll)
    const roll = (((d.claims.length * 7919 + seat * 104729 + (s.rng % 997)) * 2654435761) >>> 0) / 2 ** 32;
    // their last cards: worth a look
    if (!hand(s, last.seat).cards.length) return roll < 0.6;
    const odds = (last.count >= 3 ? 0.25 : last.count === 2 ? 0.08 : 0.03) + seen(s, seat, last.rank) * 0.1;
    return roll < odds;
  }

  return {
    config,

    setup(players, seed, options) {
      const s = createState<CheatData>(config, players, seed, options, { rank: 14, last: null, reveal: null, claims: [], result: null });
      s.dealer = players.length - 1;
      start(s);
      return s;
    },

    actions(s, seat) {
      const d = s.data;
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      if (s.phase !== 'play') return [];
      const out: ActionSpec[] = [];
      if (d.last && d.last.seat !== seat) out.push({ type: 'cheat', label: `Cheat! (${name(s, d.last.seat)})`, style: 'danger' });
      if (s.turn === seat) {
        const own = ids(hand(s, seat));
        out.unshift({ type: 'play', label: `Play as ${plural(d.rank)}`, style: 'primary', select: { min: 1, max: Math.min(maxPlay(s), own.length), cards: own } });
        if (d.last && !hand(s, d.last.seat).cards.length) out.push({ type: 'accept', label: `Let ${name(s, d.last.seat)} win` });
      }
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        s.winner = undefined;
        s.dealer = nextSeat(s, s.dealer);
        return start(s);
      }
      assertRule(s.phase === 'play', 'Not now');
      if (a.type === 'cheat') {
        assertRule(d.last && d.last.seat !== seat, 'Nothing to challenge');
        return challenge(s, seat);
      }
      assertRule(s.turn === seat, 'Not your turn');
      if (a.type === 'accept') {
        assertRule(d.last && !hand(s, d.last.seat).cards.length, 'Nothing to accept');
        return void closeWindow(s);
      }
      assertRule(a.type === 'play', `Unknown action ${a.type}`);
      const cards = a.cards ?? [];
      const own = ids(hand(s, seat));
      assertRule(cards.length >= 1 && cards.length <= maxPlay(s) && new Set(cards).size === cards.length && cards.every((c) => own.includes(c)), `Play 1 to ${maxPlay(s)} cards`);
      // playing on accepts the last play
      if (closeWindow(s)) return;
      collectShown(s);
      moveCards(s, `hand:${seat}`, 'pile', cards, { up: false, by: seat });
      d.last = { seat, count: cards.length, rank: d.rank };
      d.claims.push(d.last);
      log(s, `${name(s, seat)}: “${said(cards.length, d.rank)}”`, seat, said(cards.length, d.rank));
      d.rank = after(d.rank);
      s.turn = nextSeat(s, seat);
    },

    bot(s, seat) {
      if (s.phase !== 'play') return null;
      const d = s.data;
      if (d.last && d.last.seat !== seat && botCalls(s, seat)) return { type: 'cheat' };
      if (s.turn !== seat) return null;
      if (d.last && !hand(s, d.last.seat).cards.length) return { type: 'accept' };
      return botPlay(s, seat);
    },

    standings(s) {
      // fewest cards left places best
      return placesFromScores(s.players.map((_, i) => (s.winner?.includes(i) ? -1 : hand(s, i).cards.length)), true);
    },

    status(s, viewer) {
      const d = s.data;
      let headline = '';
      if (s.phase === 'play') {
        const lastText = d.last ? `${name(s, d.last.seat)} said “${said(d.last.count, d.last.rank)}”` : '';
        const shown = d.reveal
          ? `${name(s, d.reveal.player)} ${d.reveal.lied ? 'was lying' : 'told the truth'} — ${name(s, d.reveal.lied ? d.reveal.player : d.reveal.caller)} takes the pile`
          : '';
        const turnText = s.turn === viewer ? `Your turn: play ${plural(d.rank)}` : `${name(s, s.turn!)} plays ${plural(d.rank)}`;
        headline = [shown || lastText, turnText].filter(Boolean).join(' · ');
      } else headline = d.result?.lines[0] ?? '';
      return {
        headline,
        seats: s.players.map((_, i) => ({ badge: `${hand(s, i).cards.length} card${hand(s, i).cards.length === 1 ? '' : 's'}`, tag: i === s.dealer ? 'D' : undefined })),
        banner: s.phase === 'gameOver' ? { title: `${name(s, s.winner![0])} wins!`, lines: d.result?.lines ?? [] } : undefined,
      };
    },
  };
}
