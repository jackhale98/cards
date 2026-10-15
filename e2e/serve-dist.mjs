// Serves the production build (dist/) with the headers Cloudflare Pages would add from
// public/_headers, for e2e/csp.spec.ts. Usage: node e2e/serve-dist.mjs <port>
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4174);
const root = new URL('../dist/', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

// the rules in _headers: a path pattern, then indented "Name: value" lines
const rules = [];
for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
  else rules.at(-1)?.headers.push(line.trim());
}
const matches = (pattern, path) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(path);

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
  for (const rule of rules.filter((r) => matches(r.pattern, path)))
    for (const h of rule.headers) {
      if (h.startsWith('!')) delete headers[h.slice(1).trim().toLowerCase()];
      else {
        const i = h.indexOf(':');
        headers[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim();
      }
    }
  res.writeHead(200, headers).end(readFileSync(file));
}).listen(port, () => console.log(`dist on http://localhost:${port}`));
