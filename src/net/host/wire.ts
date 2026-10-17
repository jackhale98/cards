import { pingBand } from '../protocol';

/** What goes over the wire to players: views as sent, and whether the latency lights have moved. */

/**
 * Whether the latency lights have changed enough to tell anyone: someone arriving or leaving, a
 * light changing colour, or (`exact`: where the numbers show) a round trip moving by 25 ms.
 */
export function pingsMoved(a: (number | null)[], b: (number | null)[], exact: boolean): boolean {
  return (
    a.length !== b.length ||
    b.some((p, i) => (p == null) !== (a[i] == null) || pingBand(p) !== pingBand(a[i]) || (exact && Math.abs((p ?? 0) - (a[i] ?? 0)) > 25))
  );
}

/** Where a view carries its version number. */
export const VERSION_PATHS = new Set(['v', 'state.v']);

/** A copy of a view as it goes over the wire (JSON: what's undefined isn't there). */
export const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
