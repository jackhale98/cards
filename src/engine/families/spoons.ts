import { parseCard } from '../cards';
import { createState, hand, ids, log, name, placesFromScores, resetDeck, zone } from '../state';
import { shuffle } from '../rng';
import { botLevel } from '../bots/search';
import { msUntil, REACTION_WINDOW, span } from '../lib/realtime';
import { assertRule, type ActionSpec, type GameConfig, type GameModule, type GameState } from '../types';

/**
 * Spoons, in real time (pagat.com/commerce/spoons.html). Configured from `game.json`:
 *
 * ```jsonc
 * "rules": { "family": "spoons" }
 * ```
 * There is one spoon fewer than there are players. Everyone holds four cards. With no turns, the
 * dealer picks up from the deck and everyone else from the cards passed to them. Pick up one, keep
 * four, and pass one on to your left. The player on the dealer's right passes onto a discard pile,
 * which becomes the deck again when the deck runs out.
 *
 * Collect four of a kind and you may quietly take a spoon. Nothing is announced, but the others can
 * see the spoon is gone. Once any spoon is gone, anyone may grab one. Grabbing the first spoon without
 * four of a kind costs you a letter. The player left without a spoon gets a letter too: S, P, O, O,
 * N, and at SPOON they're out. The last player in wins.
 */
export interface SpoonsData {
  /** Bumped when a spoon disappears: what a grab reacts to. */
  race: number;
  /** Spoons still on the table. */
  spoons: number;
  /** Who holds a spoon this round. */
  has: boolean[];
  /** Grabs waiting for the window to close (for the last spoons, the quickest reaction wins). */
  claims: { seat: number; rt: number }[];
  judgeAt: number;
  letters: number[];
  out: boolean[];
  /** The player left without a spoon (or who grabbed too soon) this round. */
  loser: number | null;
  /** Grabbed the first spoon without four of a kind. */
  tooSoon: boolean;
  result: { lines: string[] } | null;
}

type S = GameState<SpoonsData>;

const WORD = 'SPOON';
const NEXT_ROUND = 3500;

export function spoonsFamily(config: GameConfig): GameModule<SpoonsData> {
  const active = (s: S) => s.players.flatMap((_, i) => (s.data.out[i] ? [] : [i]));
  const nextActive = (s: S, seat: number) => {
    const n = s.players.length;
    for (let i = 1; i <= n; i++) if (!s.data.out[(seat + i) % n]) return (seat + i) % n;
    return seat;
  };
  /** Where `seat` picks up from: the deck for the dealer, otherwise the cards passed to them. */
  const source = (s: S, seat: number) => (seat === s.dealer ? 'deck' : `in:${seat}`);
  /** Where `seat` passes to: the next player, or the discard pile for the one before the dealer. */
  const target = (s: S, seat: number) => (nextActive(s, seat) === s.dealer ? 'discard' : `in:${nextActive(s, seat)}`);
  const canPickUp = (s: S, seat: number) => zone(s, source(s, seat)).cards.length > 0 || (seat === s.dealer && zone(s, 'discard').cards.length > 0);
  const fourOfAKind = (s: S, seat: number) => {
    const counts = new Map<number, number>();
    for (const id of ids(hand(s, seat))) counts.set(parseCard(id).rank, (counts.get(parseCard(id).rank) ?? 0) + 1);
    return [...counts.values()].some((c) => c >= 4);
  };
  /** Any spoon gone yet this round (grabs then need no four of a kind). */
  const started = (s: S) => s.data.has.some(Boolean);

  function deal(s: S) {
    const d = s.data;
    resetDeck(s, config);
    for (const i of active(s)) for (let k = 0; k < 4; k++) {
      const c = zone(s, 'deck').cards.pop()!;
      hand(s, i).cards.push({ id: c.id });
    }
    d.spoons = active(s).length - 1;
    d.has = s.players.map(() => false);
    d.claims = [];
    d.loser = null;
    d.tooSoon = false;
    d.race++;
    s.phase = 'play';
    s.turn = null;
    log(s, `${name(s, s.dealer)} deals — ${d.spoons} spoon${d.spoons === 1 ? '' : 's'} on the table`);
  }

  function letter(s: S, seat: number, why: string) {
    const d = s.data;
    d.letters[seat]++;
    d.loser = seat;
    const so = WORD.slice(0, d.letters[seat]);
    log(s, `${name(s, seat)} ${why} — ${so}`, seat, so);
    if (d.letters[seat] >= WORD.length) {
      d.out[seat] = true;
      log(s, `${name(s, seat)} is out`, seat, 'Out');
    }
    s.phase = 'roundOver';
    const left = active(s);
    if (left.length === 1) {
      s.phase = 'gameOver';
      s.winner = left;
      d.result = { lines: [`${name(s, left[0])} is the last one in!`] };
      log(s, d.result.lines[0]);
    }
  }

  function judge(s: S) {
    const d = s.data;
    const claims = [...d.claims].sort((a, b) => a.rt - b.rt);
    d.claims = [];
    const quiet = !started(s);
    for (const c of claims) {
      if (!d.spoons) break;
      d.has[c.seat] = true;
      d.spoons--;
      // the first spoon goes quietly: the others have to notice it's gone
      if (!quiet || c !== claims[0]) log(s, `${name(s, c.seat)} grabs a spoon`, c.seat, '🥄');
    }
    d.race++;
    if (!d.spoons) {
      const loser = active(s).find((i) => !d.has[i])!;
      letter(s, loser, 'is left without a spoon');
    }
  }

  return {
    config,
    realtime: true,
    botLevels: true,

    setup(players, seed, options) {
      const s = createState<SpoonsData>(config, players, seed, options, {
        race: 0,
        spoons: 0,
        has: [],
        claims: [],
        judgeAt: 0,
        letters: players.map(() => 0),
        out: players.map(() => false),
        loser: null,
        tooSoon: false,
        result: null,
      });
      s.dealer = 0;
      deal(s);
      return s;
    },

    actions(s, seat) {
      if (s.phase === 'gameOver') return [{ type: 'rematch', label: 'New game', style: 'primary' }];
      const d = s.data;
      if (s.phase !== 'play' || seat < 0 || d.out[seat]) return [];
      const out: ActionSpec[] = [];
      const h = ids(hand(s, seat));
      if (h.length > 4) out.push({ type: 'pass', label: target(s, seat) === 'discard' ? 'Discard' : 'Pass on', style: 'primary', select: { min: 1, max: 1, cards: h }, quick: true });
      else if (canPickUp(s, seat)) {
        const n = zone(s, source(s, seat)).cards.length;
        out.push({ type: 'take', label: n > 1 && seat !== s.dealer ? `Pick up (${n})` : 'Pick up', style: 'primary', zone: seat === s.dealer ? 'deck' : undefined });
      }
      // always on offer, so the button never gives away that a spoon has gone
      if (!d.has[seat] && !d.claims.some((c) => c.seat === seat)) out.push({ type: 'spoon', label: 'Grab a spoon 🥄', style: 'danger', react: true });
      return out;
    },

    apply(s, seat, a) {
      const d = s.data;
      if (a.type === 'rematch') {
        assertRule(s.phase === 'gameOver', 'Game not over');
        s.winner = undefined;
        d.letters = s.players.map(() => 0);
        d.out = s.players.map(() => false);
        d.result = null;
        s.dealer = (s.dealer + 1) % s.players.length;
        return deal(s);
      }
      assertRule(s.phase === 'play' && !d.out[seat], 'Not now');
      if (a.type === 'spoon') {
        assertRule(!d.has[seat] && !d.claims.some((c) => c.seat === seat), 'You have a spoon');
        if (!started(s) && !d.claims.length && !fourOfAKind(s, seat)) {
          d.tooSoon = true;
          return letter(s, seat, 'grabs a spoon without four of a kind');
        }
        if (!d.claims.length) d.judgeAt = (a.at ?? 0) + REACTION_WINDOW;
        d.claims.push({ seat, rt: a.race !== undefined && a.race !== d.race ? 60_000 : Math.max(0, a.rt ?? 0) });
        return;
      }
      const h = hand(s, seat);
      if (a.type === 'take') {
        assertRule(h.cards.length <= 4, 'Pass a card on first');
        if (seat === s.dealer && !zone(s, 'deck').cards.length) {
          // the deck is used up: the discards are shuffled into a new one
          const back = zone(s, 'discard').cards.splice(0).map((c) => ({ id: c.id }));
          zone(s, 'deck').cards = shuffle(back, s);
        }
        const from = zone(s, source(s, seat)).cards;
        assertRule(from.length, 'Nothing to pick up');
        // the oldest card passed to you comes first
        const c = seat === s.dealer ? from.pop()! : from.shift()!;
        h.cards.push({ id: c.id });
        return;
      }
      assertRule(a.type === 'pass', `Unknown action ${a.type}`);
      const id = a.cards?.[0];
      assertRule(h.cards.length > 4 && a.cards?.length === 1 && ids(h).includes(id!), 'Pass one card');
      h.cards.splice(ids(h).indexOf(id!), 1);
      s.seq = (s.seq ?? 0) + 1;
      zone(s, target(s, seat)).cards.push({ id: id!, k: s.seq });
    },

    system(s) {
      const d = s.data;
      if (s.phase === 'play' && d.claims.length) return { delay: msUntil(d.judgeAt), run: judge };
      if (s.phase === 'roundOver')
        return {
          delay: NEXT_ROUND,
          run: (s) => {
            s.dealer = nextActive(s, s.dealer);
            deal(s);
          },
        };
      return null;
    },

    bot(s, seat) {
      const d = s.data;
      if (s.phase !== 'play' || d.out[seat] || d.claims.some((c) => c.seat === seat)) return null;
      if (!d.has[seat] && (started(s) || fourOfAKind(s, seat))) return { type: 'spoon', race: d.race };
      const h = ids(hand(s, seat));
      if (h.length > 4) {
        // keep the ranks held most; pass on a loner
        const count = (id: string) => h.filter((x) => parseCard(x).rank === parseCard(id).rank).length;
        const pass = [...h].sort((x, y) => count(x) - count(y))[0];
        return { type: 'pass', cards: [pass] };
      }
      if (canPickUp(s, seat)) return { type: 'take' };
      return null;
    },

    botDelay(s, _seat, a) {
      const level = botLevel(s.options);
      if (a.type === 'spoon') {
        // with four of a kind a bot takes the first spoon at once; noticing a missing one takes longer
        if (!started(s)) return span([300, 700]);
        const scramble = s.data.spoons < s.data.has.filter((_, i) => !s.data.out[i]).length - 1;
        return span(
          scramble
            ? ([[700, 1200], [450, 800], [300, 550]] as const)[level]
            : ([[2500, 4500], [1400, 2600], [700, 1400]] as const)[level],
        );
      }
      return span(([[800, 1300], [550, 950], [350, 650]] as const)[level]);
    },

    standings(s) {
      return placesFromScores(s.data.letters, true);
    },

    status(s, viewer) {
      const d = s.data;
      const me = viewer >= 0 && !d.out[viewer];
      let headline: string;
      if (s.phase === 'play') {
        headline = `${'🥄'.repeat(d.spoons)}${me && d.has[viewer] ? ' · You have a spoon!' : ''}`;
      } else if (s.phase === 'roundOver' && d.loser !== null) {
        const so = WORD.slice(0, d.letters[d.loser]);
        headline = `${d.loser === viewer ? 'You get' : `${name(s, d.loser)} gets`} a letter: ${so}`;
      } else headline = d.result?.lines[0] ?? '';
      const waiting = me && s.phase === 'play' && viewer !== s.dealer ? zone(s, `in:${viewer}`).cards.length : 0;
      return {
        headline,
        race: d.race,
        hint: me && s.phase === 'play' ? (fourOfAKind(s, viewer) && !d.has[viewer] ? 'Four of a kind — grab a spoon!' : waiting > 1 ? `${waiting} cards waiting for you` : undefined) : undefined,
        seats: s.players.map((_, i) => ({
          badge: d.out[i] ? 'Out' : WORD.slice(0, d.letters[i]) || '—',
          tag: d.has[i] ? '🥄' : i === s.dealer ? 'D' : undefined,
          out: d.out[i],
        })),
        banner:
          s.phase === 'gameOver'
            ? { title: `${name(s, s.winner![0])} wins!`, lines: [...(d.result?.lines ?? []), ...s.players.map((p, i) => `${p.name}: ${WORD.slice(0, d.letters[i]) || '—'}`)] }
            : undefined,
      };
    },
  };
}
