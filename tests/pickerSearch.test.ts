import { describe, expect, it } from 'vitest';
import { GAME_LIST, searchGames } from './games';

const ids = (q: string) => searchGames(q).map((g) => g.config.id);

describe('game search', () => {
  it('an empty search shows everything, in the usual order', () => {
    expect(ids('  ')).toEqual(GAME_LIST.map((g) => g.config.id));
  });

  it('finds by name, ignoring case, accents and apostrophes', () => {
    expect(ids('hearts')[0]).toBe('hearts');
    expect(ids('HOLDEM')[0]).toBe('holdem');
    expect(ids("hold'em")[0]).toBe('holdem');
    expect(ids('rat screw')).toEqual(['egyptian-rat-screw']);
  });

  it('matches the start of words as you type', () => {
    expect(ids('spa')[0]).toBe('spades');
    expect(ids('spa')).not.toContain('cribbage');
    expect(ids('cri')[0]).toBe('cribbage');
  });

  it('knows other names', () => {
    expect(ids('ers')).toEqual(['egyptian-rat-screw']);
    expect(ids('bullshit')).toEqual(['cheat']);
    expect(ids('shithead')).toEqual(['palace']);
  });

  it('finds a kind of game', () => {
    const poker = ids('poker');
    for (const id of ['holdem', 'omaha', 'five-card-draw', 'seven-card-stud']) expect(poker).toContain(id);
    expect(ids('speed')).toEqual(expect.arrayContaining(['slapjack', 'spit', 'spoons', 'egyptian-rat-screw']));
  });

  it('a number finds the games for that many players, or a game named for it', () => {
    const six = ids('6');
    expect(six).toContain('euchre'); // six-handed euchre
    expect(six).not.toContain('spit');
    expect(ids('500')).toEqual(expect.arrayContaining(['five-hundred', 'rummy-500']));
    expect(ids('2 speed')).toEqual(expect.arrayContaining(['spit', 'slapjack']));
    expect(ids('2 speed')).not.toContain('spoons');
  });

  it('the name itself ranks first', () => {
    // "spades" is in the name of one game, and perhaps the tagline of others
    expect(ids('spades')[0]).toBe('spades');
  });

  it('nothing found', () => {
    expect(ids('mahjong')).toEqual([]);
  });
});
