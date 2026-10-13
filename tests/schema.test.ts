import Ajv from 'ajv';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import schema from '../schemas/game.schema.json';

const dir = join(__dirname, '../src/games');
const games = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());

describe('game.json files', () => {
  const validate = new Ajv({ allErrors: true }).compile(schema);
  it.each(games.map((d) => d.name))('%s matches the schema', (name) => {
    const config = JSON.parse(readFileSync(join(dir, name, 'game.json'), 'utf8'));
    const ok = validate(config);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(config.id).toBe(name);
  });

  // a game whose rules change with the table size runs on the merged config at that size (as
  // engine/families/index.ts builds it): each of those must be a valid game too
  const sized = games.flatMap((d) => {
    const config = JSON.parse(readFileSync(join(dir, d.name, 'game.json'), 'utf8'));
    return Object.keys(config.byPlayers ?? {}).map((n) => [d.name, n] as const);
  });
  it.each(sized)('%s for %s players matches the schema', (name, n) => {
    const config = JSON.parse(readFileSync(join(dir, name, 'game.json'), 'utf8'));
    const v = config.byPlayers[n];
    const merged = { ...config, rules: { ...config.rules, ...(v.rules ?? {}) }, deck: { ...config.deck, ...(v.deck ?? {}) } };
    delete merged.byPlayers;
    validate(merged);
    expect(validate.errors ?? []).toEqual([]);
  });
});

describe('the TypeScript types for game.json', () => {
  it('are generated from the schema, and up to date (pnpm gen:types)', () => {
    const out = execFileSync(process.execPath, ['scripts/gen-types.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toContain('up to date');
  });
});
