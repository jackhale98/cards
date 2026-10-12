import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Chromecasts and smart TVs run older browsers. A declaration using `dvh` (Chrome 108) or
 * `color-mix()` (Chrome 111) is dropped there, so each needs a plain one for the same property just
 * before it: without the fallback for #app's height the whole page collapsed to nothing on a TV.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(svelte|css)$/.test(p) ? [p] : [];
  });
}

describe('CSS for older browsers (TVs)', () => {
  it('every dvh or color-mix() declaration has a plain fallback just before it', () => {
    const missing: string[] = [];
    for (const f of files('src')) {
      const lines = readFileSync(f, 'utf8').split('\n');
      // (declarations can run over several lines: join each into one)
      const decls: { prop: string; text: string; line: number }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*([a-z-]+):(.*)$/);
        if (!m) continue;
        let text = m[2];
        let j = i;
        while (!text.trimEnd().endsWith(';') && j + 1 < lines.length && !lines[j + 1].includes('}')) text += ' ' + lines[++j].trim();
        decls.push({ prop: m[1], text, line: i + 1 });
        i = j;
      }
      decls.forEach((d, k) => {
        if (!/\d+dvh|color-mix\(/.test(d.text) || d.prop.startsWith('--')) return;
        const prev = decls[k - 1];
        if (!prev || prev.prop !== d.prop || /\d+dvh|color-mix\(/.test(prev.text)) missing.push(`${f}:${d.line} ${d.prop}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
