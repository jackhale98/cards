import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Hand } from '../src/engine/families/trick/systems/hands';
import { estimate, ntFeatures, suitFeatures } from '../src/engine/families/trick/systems/tricks';

/**
 * Fits the bidding bots' trick estimator to double-dummy results. Not part of the normal run:
 *   python tools/dd_deals.py 12000 dd.jsonl     (endplay's solver: every deal's tricks, each strain and declarer)
 *   TRICKS_DD=dd.jsonl pnpm exec vitest run tests/tricks.bench.test.ts
 * prints the weights for src/engine/families/trick/systems/tricks.ts, and how close the estimate
 * comes on deals it wasn't fitted to.
 */
const file = process.env.TRICKS_DD;

const RANKS = 'AKQJT98765432';
const parseHand = (pbn: string): Hand => pbn.split('.').map((x) => [...x].map((c) => 14 - RANKS.indexOf(c)));

function solve(rows: number[][], ys: number[], ridge = 1e-3): number[] {
  const n = rows[0].length;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  rows.forEach((f, r) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += f[i] * f[j];
      A[i][n] += f[i] * ys[r];
    }
  });
  for (let i = 0; i < n; i++) A[i][i] += ridge * rows.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const m = A[r][i] / A[i][i];
      for (let c = i; c <= n; c++) A[r][c] -= m * A[i][c];
    }
  }
  return A.map((row, i) => +(row[n] / row[i]).toFixed(4));
}

test.skipIf(!file)('fit the trick estimator to double dummy', () => {
  const rows = readFileSync(file!, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { deal: string; t: Record<string, Record<string, number>> });
  const pairs: { a: Hand; b: Hand; tricks: number[] }[] = [];
  for (const r of rows) {
    const hands = r.deal.slice(2).split(' ').map(parseHand);
    const strains = ['S', 'H', 'D', 'C', 'NT'];
    pairs.push({ a: hands[0], b: hands[2], tricks: strains.map((x) => Math.max(r.t.N[x], r.t.S[x])) });
    pairs.push({ a: hands[1], b: hands[3], tricks: strains.map((x) => Math.max(r.t.E[x], r.t.W[x])) });
  }
  const cut = Math.floor(pairs.length * 0.8);
  const train = pairs.slice(0, cut);
  const hold = pairs.slice(cut);
  const sf: number[][] = [];
  const sy: number[] = [];
  const nf: number[][] = [];
  const ny: number[] = [];
  for (const p of train) {
    for (let t = 0; t < 4; t++) {
      sf.push(suitFeatures(p.a, p.b, t));
      sy.push(p.tricks[t]);
    }
    nf.push(ntFeatures(p.a, p.b));
    ny.push(p.tricks[4]);
  }
  const suit = solve(sf, sy);
  const nt = solve(nf, ny);
  console.log('SUIT_WEIGHTS', JSON.stringify(suit));
  console.log('NT_WEIGHTS', JSON.stringify(nt));
  // on the held-out deals, with the weights just fitted (as tricks.ts will have them)
  const dot = (w: number[], f: number[]) => f.reduce((n, x, i) => n + x * w[i], 0);
  const err = [0, 0];
  const sq = [0, 0];
  const cnt = [0, 0];
  // where it matters: contracts the side might bid (eight-card fits and better, and no trumps with 20+)
  for (const p of hold) {
    for (let t = 0; t < 4; t++) {
      if (p.a[t].length + p.b[t].length < 8) continue;
      const e = Math.max(0, Math.min(13, dot(suit, suitFeatures(p.a, p.b, t)))) - p.tricks[t];
      err[0] += Math.abs(e);
      sq[0] += e * e;
      cnt[0]++;
    }
    const f = ntFeatures(p.a, p.b);
    if (f[1] < 20) continue;
    const e = Math.max(0, Math.min(13, dot(nt, f))) - p.tricks[4];
    err[1] += Math.abs(e);
    sq[1] += e * e;
    cnt[1]++;
  }
  // calibration at the top: what the solver gives where the estimate says slam
  const bins = new Map<number, { n: number; sum: number; twelve: number }>();
  for (const p of hold)
    for (let t = 0; t < 4; t++) {
      if (p.a[t].length + p.b[t].length < 8) continue;
      const e = Math.max(0, Math.min(13, dot(suit, suitFeatures(p.a, p.b, t))));
      const k = Math.round(e * 2) / 2;
      if (k < 9.5) continue;
      const b = bins.get(k) ?? { n: 0, sum: 0, twelve: 0 };
      b.n++;
      b.sum += p.tricks[t];
      b.twelve += p.tricks[t] >= 12 ? 1 : 0;
      bins.set(k, b);
    }
  const ntBins = new Map<number, { n: number; sum: number }>();
  for (const p of hold) {
    const e = Math.max(0, Math.min(13, dot(nt, ntFeatures(p.a, p.b))));
    const k = Math.round(e * 2) / 2;
    if (k < 6) continue;
    const b = ntBins.get(k) ?? { n: 0, sum: 0 };
    b.n++;
    b.sum += p.tricks[4];
    ntBins.set(k, b);
  }
  for (const [k, b] of [...ntBins].sort((x, y) => x[0] - y[0])) console.log(`NT estimate ${k}: ${b.n} hands, mean ${(b.sum / b.n).toFixed(2)}`);
  for (const [k, b] of [...bins].sort((x, y) => x[0] - y[0]))
    console.log(`estimate ${k}: ${b.n} hands, mean ${(b.sum / b.n).toFixed(2)}, 12+ ${((100 * b.twelve) / b.n).toFixed(0)}%`);
  console.log(`held out: suits (8+ fits) mean error ${(err[0] / cnt[0]).toFixed(3)}, sd ${Math.sqrt(sq[0] / cnt[0]).toFixed(3)} over ${cnt[0]}`);
  console.log(`held out: no trumps (20+ points) mean error ${(err[1] / cnt[1]).toFixed(3)}, sd ${Math.sqrt(sq[1] / cnt[1]).toFixed(3)} over ${cnt[1]}`);
  void estimate;
  expect(cnt[0]).toBeGreaterThan(0);
});
