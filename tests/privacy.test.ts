import { describe, expect, it } from 'vitest';
import { buildDeck, cardName, parseCard, rankLabel, SUIT_SYMBOL } from '../src/engine/cards';
import { canSee, isHidden } from '../src/engine/redact';
import { RuleError, type Action, type GameModule, type GameState } from '../src/engine/types';
import { GAMES, GAME_LIST } from '../src/games';
import { Host } from '../src/net/host';

const label = (id: string) => `${rankLabel(parseCard(id).rank)}${SUIT_SYMBOL[parseCard(id).suit]}`;

/** Cards everyone at the table can see right now. */
function publicCards(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const z of Object.values(s.zones))
    for (const c of z.cards) if ((z.visibility === 'all' && c.up !== false) || (z.visibility === 'owner' && c.up)) out.add(c.id);
  return out;
}

/** Cards named in a log entry. */
function mentioned(text: string, deck: string[]) {
  return deck.filter((c) => text.includes(cardName(c)) || new RegExp(`(^|[^0-9])${label(c).replace(/[♠♥♦♣]/, '\\$&')}`).test(text));
}

/** Play `steps` moves using `pick`, checking every new log line only names public cards. */
function checkLogs(g: GameModule, s: GameState, pick: (s: GameState) => { seat: number; a: Action } | 'system' | null, steps: number) {
  const deck = buildDeck(g.config.deck);
  for (let i = 0; i < steps; i++) {
    const before = publicCards(s);
    const logLen = s.log.length;
    const move = pick(s);
    if (!move) break;
    // like the host: apply to a copy, keep it only if the move was legal
    const next = structuredClone(s);
    try {
      if (move === 'system') g.system!(next)!.run(next);
      else g.apply(next, move.seat, move.a);
    } catch (e) {
      if (e instanceof RuleError) continue;
      throw e;
    }
    Object.assign(s, next);
    const after = publicCards(s);
    for (const entry of s.log.slice(logLen)) {
      for (const c of mentioned(`${entry.text} | ${entry.short ?? ''}`, deck)) {
        expect(before.has(c) || after.has(c), `"${entry.text}" names hidden ${c}`).toBe(true);
      }
    }
  }
}

/** Bot-driven play for games with bots; "next" between hands. */
const botPick = (g: GameModule) => (s: GameState) => {
  if (s.phase === 'gameOver') return null;
  if (g.system?.(s)) return 'system' as const;
  for (const p of s.players) {
    const a = g.bot!(s, p.seat);
    if (a) return { seat: p.seat, a };
  }
  const seat = s.players.findIndex((p) => g.actions(s, p.seat).some((x) => x.type === 'next'));
  return seat >= 0 ? { seat, a: { type: 'next' } } : null;
};

describe('privacy: log lines never name hidden cards', () => {
  for (const id of ['gin-rummy', 'hearts', 'spades', 'oh-hell', 'holdem', 'omaha', 'cribbage']) {
    it(id, () => {
      const g = GAMES[id];
      const n = g.config.players.max >= 4 ? 4 : 2;
      const s = g.setup(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true })), 21, {});
      checkLogs(g, s, botPick(g), 3000);
    });
  }

  it('free table with random moves, including face-down ones', () => {
    const g = GAMES.freetable;
    let r = 7;
    const rand = (k: number) => ((r = (r * 1103515245 + 12345) % 2 ** 31), r % k);
    const s = g.setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 3, {});
    g.apply(s, 0, { type: 'deal', amount: 7 });
    checkLogs(
      g,
      s,
      (s) => {
        const seat = rand(3);
        const specs = g.actions(s, seat).filter((a) => !['collect', 'bet', 'takePot', 'deal'].includes(a.type));
        const spec = specs[rand(specs.length)];
        const cards = spec.select ? [...spec.select.cards].sort(() => rand(3) - 1).slice(0, Math.max(spec.select.min, 1 + rand(2))) : undefined;
        if (spec.select && cards!.length < spec.select.min) return null;
        const target = spec.target ? spec.target.seats[rand(spec.target.seats.length)] : undefined;
        return { seat, a: { type: spec.type, cards, amount: spec.amount?.default, seat: target } };
      },
      400,
    );
  });
});

describe('privacy: what each device receives', () => {
  it('action card lists only contain cards the player can see (or placeholders)', () => {
    for (const g of GAME_LIST) {
      const n = Math.max(2, g.config.players.min);
      const s = g.setup(Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), 5, {});
      // put a face-down card on the table where the game has one
      if (s.zones.table) s.zones.table.cards.push({ ...s.zones.deck.cards.pop()!, up: false });
      for (let seat = 0; seat < n; seat++) {
        const host = new Host(null, 'TEST', { cid: 'h', name: 'H' });
        Object.assign(host, { state: s, module: g });
        host.lobby.seats = Array.from({ length: n }, (_, i) => ({ id: i === 0 ? 'h' : `c${i}`, name: `P${i}`, connected: true, host: i === 0 }));
        host.lobby.started = true;
        const view = host.viewFor(seat === 0 ? 'h' : `c${seat}`);
        for (const spec of view.actions)
          for (const id of spec.select?.cards ?? []) {
            const z = Object.values(s.zones).find((z) => z.cards.some((c) => c.id === id));
            if (!isHidden(id)) expect(z && canSee(z, z.cards.find((c) => c.id === id)!, seat), `${g.config.id}: ${id} leaked to seat ${seat}`).toBe(true);
          }
      }
    }
  });

  it('a face-down table card can be taken by its placeholder without revealing it', () => {
    const g = GAMES.freetable;
    const host = new Host(null, 'TEST', { cid: 'h', name: 'H' });
    host.lobby.seats.push({ id: 'b', name: 'B', connected: true });
    host.setGame('freetable');
    host.start();
    expect(host.act('h', { type: 'deal', amount: 3 })).toBeNull();
    const mine = host.state!.zones['hand:0'].cards[0].id;
    expect(host.act('h', { type: 'playDown', cards: [mine] })).toBeNull();
    const view = host.viewFor('b');
    const take = view.actions.find((a) => a.type === 'take')!;
    expect(take.select!.cards).not.toContain(mine);
    const placeholder = take.select!.cards.find(isHidden)!;
    expect(placeholder).toBeTruthy();
    expect(host.act('b', { type: 'take', cards: [placeholder] })).toBeNull();
    expect(host.state!.zones['hand:1'].cards.some((c) => c.id === mine)).toBe(true);
    const last = host.state!.log.at(-1)!;
    expect(last.text).toContain('1 face-down card');
    expect(`${last.text}${last.short}`).not.toContain(label(mine));
    void g;
  });

  it('face-up cards are named when taken', () => {
    const g = GAMES.freetable;
    const s = g.setup([{ name: 'A' }, { name: 'B' }], 2, {});
    g.apply(s, 0, { type: 'deal', amount: 2 });
    const card = s.zones['hand:0'].cards[0].id;
    g.apply(s, 0, { type: 'play', cards: [card] });
    g.apply(s, 1, { type: 'take', cards: [card] });
    expect(s.log.at(-1)!.text).toContain(label(card));
  });
});

describe('privacy: placeholder ids', () => {
  it('hands and the deck use positional placeholders; face-down table cards use a fresh key per move', async () => {
    const { redact } = await import('../src/engine/redact');
    const g = GAMES.freetable;
    const s = g.setup([{ name: 'A' }, { name: 'B' }], 4, {});
    g.apply(s, 0, { type: 'deal', amount: 4 });
    const [x, y] = s.zones['hand:0'].cards.map((c) => c.id);
    g.apply(s, 0, { type: 'playDown', cards: [x, y] });
    const v = redact(g, s, 1);
    expect(v.zones['hand:0'].cards.map((c) => c.id)).toEqual(['?hand:0.0', '?hand:0.1']);
    expect(v.zones.deck.cards[0].id).toBe('?deck.0');
    const keyed = v.zones.table.cards.map((c) => c.id);
    expect(keyed.every((id) => id.startsWith('?table~'))).toBe(true);
    // taking the first face-down card leaves the other's placeholder unchanged (smooth animation)
    g.apply(s, 1, { type: 'take', cards: [x] });
    expect(redact(g, s, 0).zones.table.cards.map((c) => c.id)).toEqual([keyed[1]].map((id) => id));
    // …but a card's key changes whenever it moves, so it can't be followed into a hand
    g.apply(s, 0, { type: 'take', cards: [y] });
    g.apply(s, 0, { type: 'playDown', cards: [y] });
    expect(redact(g, s, 1).zones.table.cards[0].id).not.toBe(keyed[1]);
  });
});
