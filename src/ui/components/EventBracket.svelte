<script lang="ts">
  import type { BracketRound } from '../../engine/events';

  /**
   * A knockout's bracket: each round's places, left to right, those who went through in gold, and
   * the rounds still to come, filled in as far as anyone has got.
   */
  interface Props {
    bracket: BracketRound[];
    names: Map<string, string>;
  }
  let { bracket, names }: Props = $props();
  const last = $derived(bracket.at(-1));
  const title = (r: BracketRound, i: number) => {
    const final = last && last.tables.length === 1;
    if (final && i === bracket.length - 1) return 'Final';
    if (final && i === bracket.length - 2 && r.tables.length === 2) return 'Semi-finals';
    return `Round ${r.round}`;
  };
  /** A place's name: someone, a bot filling a gap, a bye, or nobody yet. */
  const label = (r: BracketRound, t: BracketRound['tables'][number], s: string | null) =>
    s ? (names.get(s) ?? '?') : r.later ? '' : t.bye ? (t.sides.some(Boolean) ? 'bye' : '—') : 'Bot';
</script>

<div class="bracket" style:--rounds={bracket.length}>
  {#each bracket as r, i (r.round)}
    <section class="round" class:later={r.later} aria-label={title(r, i)}>
      <h3 class="eyebrow">{title(r, i)}</h3>
      <div class="tables">
        {#each r.tables as t, j (j)}
          <div class="match" class:bye={t.bye}>
            {#each t.sides as s, m (m)}
              <span class="side" class:through={!!s && t.through.includes(s)} class:bot={!s && !r.later}>{label(r, t, s)}&#8203;</span>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .bracket {
    display: grid;
    grid-template-columns: repeat(var(--rounds), minmax(9em, 1fr));
    gap: 1.2em;
    overflow-x: auto;
  }
  .round {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    min-width: 0;
  }
  h3 {
    margin: 0;
  }
  .tables {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    gap: 0.6em;
  }
  .match {
    display: flex;
    flex-direction: column;
    border-radius: 0.7em;
    overflow: hidden;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.04);
  }
  .side {
    padding: 0.35em 0.7em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ink-dim);
  }
  .side + .side {
    border-top: 1px solid var(--line);
  }
  .through {
    color: var(--gold);
    font-weight: 700;
  }
  .bot {
    font-style: italic;
    color: var(--ink-faint);
  }
  .later .match {
    border-style: dashed;
    background: transparent;
  }
  .match.bye {
    opacity: 0.75;
  }
</style>
