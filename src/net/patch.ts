/**
 * Changes from one view to the next, so the host can send a player only what moved rather than
 * the whole table every time (a view is several kilobytes; most moves change a few dozen bytes).
 * Plain JSON on both sides. An operation is one of:
 *
 * - `['s', path, value]`: set what's at `path` (a new key, a changed value, or a list's next item);
 * - `['d', path]`: delete the key at `path`;
 * - `['t', path, n]`: drop the first `n` items of the list at `path` (the log, trimmed from the front);
 * - `['l', path, n]`: cut the list at `path` to its first `n` items.
 */
export type Path = (string | number)[];
export type Op = ['s', Path, unknown] | ['d', Path] | ['t', Path, number] | ['l', Path, number];

const isObject = (x: unknown): x is object => typeof x === 'object' && x !== null;
const rec = (x: object) => x as Record<string, unknown>;
/** An object's keys as JSON has them: a key set to undefined isn't there at all. */
const keys = (x: object) => Object.keys(x).filter((k) => rec(x)[k] !== undefined);

/** Deep equality of two JSON values. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((k) => same(rec(a)[k], rec(b)[k]));
}

/** The operations that turn `a` into `b`. */
export function diff(a: unknown, b: unknown, path: Path = [], out: Op[] = []): Op[] {
  if (a === b) return out;
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(['s', path, b]);
    return out;
  }
  if (Array.isArray(a)) {
    let from = a as unknown[];
    const to = b as unknown[];
    // a list trimmed from the front, with new items at the end (the log): drop the first few
    const shift = from.length && to.length && !same(from[0], to[0]) ? [1, 2, 3, 4].find((k) => k < from.length && same(from[k], to[0])) : undefined;
    if (shift) {
      out.push(['t', path, shift]);
      from = from.slice(shift);
    }
    const common = Math.min(from.length, to.length);
    for (let i = 0; i < common; i++) diff(from[i], to[i], [...path, i], out);
    for (let i = common; i < to.length; i++) out.push(['s', [...path, i], to[i]]);
    if (to.length < from.length) out.push(['l', path, to.length]);
    return out;
  }
  const ao = rec(a);
  const bo = rec(b);
  for (const k of keys(a)) if (bo[k] === undefined) out.push(['d', [...path, k]]);
  for (const k of keys(b)) {
    if (ao[k] === undefined) out.push(['s', [...path, k], bo[k]]);
    else diff(ao[k], bo[k], [...path, k], out);
  }
  return out;
}

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * `ops` applied to a copy of `base`, or null if they don't fit it (a path that isn't there, or
 * isn't a key or index at all: the client then asks for the whole view). Hostile input is refused,
 * not trusted: only plain keys and indexes, and only within the depth a view has.
 */
export function apply<T>(base: T, ops: unknown): T | null {
  if (!Array.isArray(ops) || ops.length > 5000) return null;
  const root = { v: structuredClone(base) as unknown };
  for (const op of ops) {
    if (!Array.isArray(op) || !Array.isArray(op[1]) || op[1].length > 32) return null;
    const [kind, path] = op as [string, Path];
    if (!path.every((p) => (typeof p === 'string' && !UNSAFE.has(p)) || (Number.isInteger(p) && (p as number) >= 0))) return null;
    // the parent of the last step ('v' holds the whole view, so a path may be empty)
    const full: Path = ['v', ...path];
    let at: unknown = root;
    for (const p of full.slice(0, -1)) {
      if (!isObject(at)) return null;
      at = (at as Record<string | number, unknown>)[p];
    }
    const last = full[full.length - 1];
    if (!isObject(at)) return null;
    const node = at as Record<string | number, unknown>;
    if (kind === 's') node[last] = op[2];
    else if (kind === 'd') delete node[last];
    else if (kind === 't' || kind === 'l') {
      const list = node[last];
      const n = op[2];
      if (!Array.isArray(list) || !Number.isInteger(n) || n < 0) return null;
      if (kind === 't') list.splice(0, n);
      else list.length = Math.min(list.length, n);
    } else return null;
  }
  return root.v as T;
}
