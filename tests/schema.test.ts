import Ajv from 'ajv';
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
});
