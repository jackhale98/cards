/**
 * Cards that came into your hand (drawn, picked up, passed to you) stay marked until you next act,
 * so you can see what you got; not a whole new hand being dealt, where every card is new.
 * Worked out from your hand before and after (no game has to say). `hidden`: a card you can't see
 * (a placeholder) isn't marked.
 */
export function freshAfter(before: string[] | null, now: string[], fresh: string[], hidden: (id: string) => boolean): string[] {
  if (!before) return fresh;
  const had = new Set(before);
  const gained = now.filter((id) => !had.has(id) && !hidden(id));
  // (a new deal: none of the old hand is left, or a few cards at most beside a lot of new ones)
  const kept = now.length - gained.length;
  if (gained.length && (kept === 0 || (gained.length >= 5 && kept <= 2))) return [];
  const still = fresh.filter((id) => now.includes(id));
  if (gained.length) return [...still, ...gained];
  return still.length !== fresh.length ? still : fresh;
}
