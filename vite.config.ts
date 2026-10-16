/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Which build this is, for error reports: Cloudflare Pages' commit, or the local one. */
function version(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

/**
 * The service worker (src/sw.js), written into the build with what it keeps on the phone. It
 * downloads only the app at install (`SHELL`): the page, its icons, and the scripts and styles of
 * the home, lobby, table and TV screens and the host, worked out from the build's manifest. Each
 * game's rules and bots, the bridge solver and the backup networks' libraries come the first time
 * they're needed and are kept from then on; a new version carries over any it still uses
 * (`KNOWN`, every file of this build) rather than fetching them again. Named after the build, so
 * a new version brings a fresh list.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'lamplight-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    // (after the bots' worker is built too: its files are in the list)
    closeBundle() {
      const manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')) as Record<
        string,
        { file: string; imports?: string[]; css?: string[]; isEntry?: boolean }
      >;
      // the entry and the screens it fetches in the background once the home screen is up, with
      // everything they import (not what they load later, on demand)
      const roots = [
        ...Object.keys(manifest).filter((k) => manifest[k].isEntry),
        'src/ui/screens/Lobby.svelte',
        'src/ui/screens/Table.svelte',
        'src/ui/screens/TvScreen.svelte',
        'src/net/host.ts',
      ];
      const files = new Set<string>();
      const seen = new Set<string>();
      const walk = (key: string) => {
        const m = manifest[key];
        if (!m || seen.has(key)) return;
        seen.add(key);
        files.add(m.file);
        for (const c of m.css ?? []) files.add(c);
        for (const i of m.imports ?? []) walk(i);
      };
      for (const r of roots) {
        if (!manifest[r]) throw new Error(`service worker: ${r} is not in the build`);
        walk(r);
      }
      const shell = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', ...[...files].sort().map((f) => `./${f}`)];
      const known = readdirSync(join(outDir, 'assets'))
        .filter((f) => /\.(js|css|wasm)$/.test(f))
        .map((f) => `./assets/${f}`);
      const id = createHash('sha256').update(known.join('\n')).digest('hex').slice(0, 10);
      const src = readFileSync('src/sw.js', 'utf8')
        .replace('__BUILD__', id)
        .replace('[/* __SHELL__ */]', JSON.stringify(shell))
        .replace('[/* __KNOWN__ */]', JSON.stringify(known));
      writeFileSync(join(outDir, 'sw.js'), src);
      // (the manifest was only for this list: it isn't part of the site)
      rmSync(join(outDir, '.vite'), { recursive: true, force: true });
    },
  };
}

// Relative base + hash routing lets the site work from any GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [svelte(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version()) },
  // (the manifest says which files the app itself needs: see serviceWorker)
  build: { target: 'es2022', manifest: true },
  // (the bots' worker loads each game's rules when needed, like the app: that takes ES modules)
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', setupFiles: ['tests/setup.ts'] },
});
