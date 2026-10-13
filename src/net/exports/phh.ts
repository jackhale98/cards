import type { PokerData } from '../../engine/families/poker';
import * as bet from '../../engine/lib/betting';
import { canSee } from '../../engine/redact';
import type { PokerRules } from '../../engine/schema.gen';
import type { Action, GameState } from '../../engine/types';
import { EVERYONE, type HandFormat, type RecordMeta } from './types';

/**
 * Poker Hand History (PHH, phh.readthedocs.io), the open format of the University of Toronto's
 * PokerKit: TOML, one table a hand. We write it for no-limit Hold'em so PokerKit can replay our
 * hands through its own rules (tools/check_records.py): every action legal, the pot paid out the
 * same. Not offered at the table (Open Hand History is what poker tools read).
 *
 * PHH lists players by position, not seat: the small blind first and the button last; heads-up
 * the big blind first and the button (who posts the small blind) second.
 */
interface PhhHand {
  number: number;
  /** Game seats in PHH order. */
  order: number[];
  sb: number;
  bb: number;
  stacks: number[];
  hole: string[][];
  /** "p1 cbr 30" and the like, with seats for players ("p{seat}") until written. */
  actions: { seat: number | null; text: string }[];
  /** Board cards dealt so far (they're dealt a street at a time). */
  board: number;
  shown: number[];
  finishing: number[];
}

/** A card the PHH way: rank then lower-case suit ("As", "Td"). */
const card = (id: string) => `${id[0]}${id[1].toLowerCase()}`;

export function phh(rules: PokerRules): HandFormat<PhhHand> {
  // the board in streets: flop, turn, river
  const streets = rules.board;

  /** New board cards, a street at a time ("d db 7h8h9h"). */
  function dealBoard(hand: PhhHand, s: GameState) {
    const board = s.zones.board.cards.map((c) => c.id);
    let at = 0;
    for (const n of streets) {
      if (board.length >= at + n && hand.board < at + n) {
        hand.actions.push({
          seat: null,
          text: `d db ${board
            .slice(at, at + n)
            .map(card)
            .join('')}`,
        });
        hand.board = at + n;
      }
      at += n;
    }
  }

  return {
    start(deal) {
      const d = deal.data as PokerData;
      const seats = deal.players.filter((p) => !d.b.out[p.seat]).map((p) => p.seat);
      const sbSeat = seats.find((x) => d.acted[x]?.startsWith('Small'))!;
      const bbSeat = seats.find((x) => d.acted[x]?.startsWith('Big'))!;
      const from = seats.indexOf(sbSeat);
      const order = seats.length === 2 ? [bbSeat, sbSeat] : [...seats.slice(from), ...seats.slice(0, from)];
      const hand: PhhHand = {
        number: d.handNo,
        order,
        sb: d.sb,
        bb: d.bb,
        stacks: order.map((x) => deal.players[x].chips + d.b.committed[x]),
        hole: deal.players.map((p) => deal.zones[`hand:${p.seat}`].cards.map((c) => c.id)),
        actions: [],
        board: 0,
        shown: [],
        finishing: [],
      };
      for (const x of order) hand.actions.push({ seat: x, text: `d dh {p} ${hand.hole[x].map(card).join('')}` });
      return hand;
    },

    step(hand, prev, next, move?: { seat: number; action: Action }) {
      if (move && prev.phase === 'betting') {
        const before = prev.data as PokerData;
        // the move again on a copy of the betting, for how far it raised (the move that ends a
        // hand has already paid the pot out)
        const b = structuredClone(before.b);
        const t = move.action.type;
        try {
          if (t === 'raise')
            bet.act(
              b,
              prev.players.map((p) => p.chips),
              move.seat,
              { type: 'raise', to: Math.floor(move.action.amount ?? 0) },
            );
          else if (t === 'fold' || t === 'check' || t === 'call' || t === 'allin')
            bet.act(
              b,
              prev.players.map((p) => p.chips),
              move.seat,
              { type: t },
            );
        } catch {
          return;
        }
        const to = b.bets[move.seat];
        const text = t === 'fold' ? '{p} f' : to > before.b.currentBet ? `{p} cbr ${to}` : '{p} cc';
        hand.actions.push({ seat: move.seat, text });
      }
      dealBoard(hand, next);
    },

    end(hand, last) {
      const d = last.data as PokerData;
      dealBoard(hand, last);
      if (d.showdown)
        for (const x of hand.order) {
          const z = last.zones[`hand:${x}`];
          if (!d.b.folded[x] && z.cards.length && z.cards.every((c) => canSee(z, c, -1))) {
            hand.shown.push(x);
            hand.actions.push({ seat: x, text: `{p} sm ${z.cards.map((c) => card(c.id)).join('')}` });
          }
        }
      hand.finishing = hand.order.map((x) => last.players[x].chips);
    },

    write(hands, seat, meta: RecordMeta) {
      return hands
        .filter((h) => h.finishing.length)
        .map((h, i) => {
          const p = (x: number) => `p${h.order.indexOf(x) + 1}`;
          // hole cards: your own (or all of them, for checking), the rest unknown
          const actions = h.actions.map((a) => {
            if (a.seat == null) return a.text;
            let text = a.text.replace('{p}', p(a.seat));
            if (text.startsWith('d dh') && seat !== EVERYONE && seat !== a.seat) text = `d dh ${p(a.seat)} ${'??'.repeat(h.hole[a.seat].length)}`;
            return text;
          });
          const list = (xs: (string | number)[]) => `[${xs.map((x) => (typeof x === 'string' ? JSON.stringify(x) : x)).join(', ')}]`;
          const n = h.order.length;
          return [
            `[${i + 1}]`,
            `variant = "NT"`,
            `ante_trimming_status = true`,
            `antes = ${list(h.order.map(() => 0))}`,
            `blinds_or_straddles = ${list(h.order.map((_, k) => (k === 0 ? h.sb : k === 1 ? h.bb : 0)).slice(0, Math.max(2, n)))}`,
            `min_bet = ${h.bb}`,
            `starting_stacks = ${list(h.stacks)}`,
            `actions = ${list(actions)}`,
            `players = ${list(h.order.map((x) => meta.names[x] ?? ''))}`,
            `hand = ${h.number}`,
            `finishing_stacks = ${list(h.finishing)}`,
            `currency = "XPM"`,
          ].join('\n');
        })
        .join('\n\n');
    },
  };
}
