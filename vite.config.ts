/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * The service worker (src/sw.js), written into the build with the files it keeps on the phone:
 * the page, its icons, and every script and style but the backup networks' libraries (big, and
 * fetched only when needed; kept once they have been). Named after the build, so a new version
 * brings a fresh list.
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
      const assets = readdirSync(join(outDir, 'assets')).filter((f) => /\.(js|css)$/.test(f) && !/^dist-/.test(f));
      const shell = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', ...assets.map((f) => `./assets/${f}`)];
      const id = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 10);
      const src = readFileSync('src/sw.js', 'utf8').replace('__BUILD__', id).replace('[/* __SHELL__ */]', JSON.stringify(shell));
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}

// Relative base + hash routing lets the site work from any GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [svelte(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version()) },
  build: { target: 'es2022' },
  // (the bots' worker loads each game's rules when needed, like the app: that takes ES modules)
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', setupFiles: ['tests/setup.ts'] },
});
