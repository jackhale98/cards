import type { BridgeContract, Call } from '../../engine/families/trick/contracts';
import type { TrickData } from '../../engine/families/trick/types';
import type { HandFormat } from './types';

/**
 * Portable Bridge Notation (PBN 2.1, export format), the standard record of bridge deals that
 * bridge programs read: one game per deal, with the deal, auction, play and result.
 *
 * Seats map to compass points in turn order: seat 0 North, 1 East, 2 South, 3 West (partners
 * across, as at the table). A hand appears in the deal only if the player saving the file saw
 * all of it by the end: their own, dummy's, and any hand whose cards were all played; the rest
 * are "-", as the standard allows for hands not given.
 */
interface PbnHand {
  board: number;
  at: Date;
  dealer: number;
  vul: boolean[];
  dealt: string[][];
  plays: { seat: number; card: string }[];
  calls: { seat: number; call: Call }[];
  contract: BridgeContract | null;
  declarer: number | null;
  dummy: number | null;
  tricks: number[];
}

const SEAT = ['N', 'E', 'S', 'W'];
const RANKS = 'AKQJT98765432';

/** One hand in PBN: spades, hearts, diamonds and clubs, highest first ("AKJ.T9.-.Q8"…; void: empty). */
function handText(cards: string[]): string {
  return ['S', 'H', 'D', 'C']
    .map((suit) =>
      cards
        .filter((c) => c[1] === suit)
        .map((c) => c[0])
        .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
        .join(''),
    )
    .join('.');
}

// (a bid is a number, five to a level, as in trick/contracts.ts: spelled out here so that saving a
// file never loads the bridge rules)
const STRAINS = ['C', 'D', 'H', 'S', 'NT'];
export const callText = (call: Call) => (typeof call === 'number' ? `${Math.floor(call / 5) + 1}${STRAINS[call % 5]}` : call === 'P' ? 'Pass' : call);
/** A card in PBN's play section: suit then rank ("SK", "HT"). */
const cardText = (id: string) => `${id[1]}${id[0]}`;
/** PBN is Latin-1 text: names in plain letters (accents dropped, anything else "?"), no quotes. */
const ascii = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/["\\]/g, "'");

export const pbn: HandFormat<PbnHand> = {
  start(deal, at) {
    const d = deal.data as TrickData;
    return {
      board: d.round + 1,
      at,
      dealer: deal.dealer,
      vul: [...(d.vul ?? [false, false])],
      dealt: deal.players.map((p) => deal.zones[`hand:${p.seat}`].cards.map((c) => c.id)),
      plays: [],
      calls: [],
      contract: null,
      declarer: null,
      dummy: null,
      tricks: [],
    };
  },

  step(hand, prev, next) {
    // each card as it lands on the trick (the trick is cleared when it's collected)
    const before = new Set(prev.zones.trick.cards.map((c) => c.id));
    for (const c of next.zones.trick.cards) if (!before.has(c.id) && c.by != null) hand.plays.push({ seat: c.by, card: c.id });
  },

  end(hand, last) {
    const d = last.data as TrickData;
    hand.calls = [...(d.calls ?? [])];
    hand.contract = d.bridge ?? null;
    hand.declarer = d.bridge ? (d.maker ?? null) : null;
    hand.dummy = d.dummy ?? null;
    hand.tricks = [...d.tricks];
  },

  write(hands, seat, meta) {
    const games = hands.map((h) => {
      const played = (s: number) => h.plays.filter((p) => p.seat === s).length;
      const known = (s: number) => s === seat || (h.contract && s === h.dummy) || played(s) === h.dealt[s].length;
      const deal = [0, 1, 2, 3].map((i) => (h.dealer + i) % 4).map((s) => (known(s) ? handText(h.dealt[s]) : '-'));
      const vul = h.vul[0] && h.vul[1] ? 'All' : h.vul[0] ? 'NS' : h.vul[1] ? 'EW' : 'None';
      const date = `${h.at.getFullYear()}.${String(h.at.getMonth() + 1).padStart(2, '0')}.${String(h.at.getDate()).padStart(2, '0')}`;
      const c = h.contract;
      const decl = c && h.declarer != null ? h.declarer : null;
      const won = decl != null ? (h.tricks[decl] ?? 0) + (h.tricks[(decl + 2) % 4] ?? 0) : null;
      const tag = (name: string, value: string) => `[${name} "${value}"]`;
      const lines = [
        tag('Event', 'Lamplight'),
        tag('Site', 'lamplight.cards'),
        tag('Date', date),
        tag('Board', String(h.board)),
        tag('West', ascii(meta.names[3] ?? '')),
        tag('North', ascii(meta.names[0] ?? '')),
        tag('East', ascii(meta.names[1] ?? '')),
        tag('South', ascii(meta.names[2] ?? '')),
        tag('Dealer', SEAT[h.dealer]),
        tag('Vulnerable', vul),
        tag('Deal', `${SEAT[h.dealer]}:${deal.join(' ')}`),
        tag('Scoring', 'Chicago'),
        tag('Declarer', decl != null ? SEAT[decl] : ''),
        tag('Contract', c ? `${c.level}${c.strain}${'X'.repeat(c.dbl)}` : 'Pass'),
        tag('Result', won != null ? String(won) : ''),
      ];
      // the auction, from the dealer, four calls a line
      lines.push(tag('Auction', SEAT[h.dealer]));
      for (let i = 0; i < h.calls.length; i += 4)
        lines.push(
          h.calls
            .slice(i, i + 4)
            .map((x) => callText(x.call))
            .join(' '),
        );
      // the play, from the opening leader, a trick a line, each card in its player's column
      if (c && h.plays.length) {
        const leader = h.plays[0].seat;
        lines.push(tag('Play', SEAT[leader]));
        for (let t = 0; t < h.plays.length; t += 4) {
          const trick = h.plays.slice(t, t + 4);
          const col = [0, 1, 2, 3].map((i) => trick.find((p) => p.seat === (leader + i) % 4));
          lines.push(col.map((p) => (p ? cardText(p.card) : '-')).join(' '));
        }
        if (h.plays.length < 52) lines.push('*');
      }
      return lines.join('\r\n');
    });
    return ['% PBN 2.1', '% EXPORT', '', games.join('\r\n\r\n'), ''].join('\r\n');
  },
};
