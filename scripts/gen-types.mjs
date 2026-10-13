// The TypeScript types for game.json, generated from schemas/game.schema.json (the one place the
// format is defined). `pnpm gen:types` writes src/engine/schema.gen.ts; `--check` only checks it's
// up to date (CI and `pnpm verify` run that).
import { readFileSync, writeFileSync } from 'node:fs';
import { compile } from 'json-schema-to-typescript';
import prettier from 'prettier';

const schemaPath = new URL('../schemas/game.schema.json', import.meta.url);
const out = new URL('../src/engine/schema.gen.ts', import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
// (the editor's title for the file; the type is GameConfig)
schema.title = 'GameConfig';

const banner = `/* Generated from schemas/game.schema.json by scripts/gen-types.mjs (pnpm gen:types). Don't edit by hand: change the schema and regenerate. */`;
let ts = await compile(schema, 'GameConfig', {
  bannerComment: banner,
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: true },
});
ts = await prettier.format(ts, { ...(await prettier.resolveConfig(out.pathname)), filepath: out.pathname });

if (process.argv.includes('--check')) {
  const now = readFileSync(out, 'utf8');
  if (now !== ts) {
    console.error('src/engine/schema.gen.ts is out of date with schemas/game.schema.json: run pnpm gen:types');
    process.exit(1);
  }
  console.log('schema.gen.ts is up to date');
} else {
  writeFileSync(out, ts);
  console.log('wrote src/engine/schema.gen.ts');
}
