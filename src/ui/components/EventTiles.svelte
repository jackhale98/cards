<script lang="ts">
  import type { EventPublic } from '../../engine/events';
  import type { TableTile } from '../../net/eventProtocol';
  import { TILE_GAP_REM, TILE_REM } from '../layout/event';

  /**
   * The round's tables as tiles: who's at each, how far it's got (still waiting for someone, hands
   * played, the game's totals) and, once it's done, who finished where. With `onfeature`, a tap
   * puts that table on the screens (`pinned`: the one that's there); `showing` is the table the
   * screens show live now.
   */
  interface Props {
    tables: EventPublic['tables'];
    tiles: { table: number; tile: TableTile | null; linked?: boolean }[];
    names: Map<string, string>;
    pinned?: number | null;
    showing?: number | null;
    onfeature?: (table: number | null) => void;
  }
  let { tables, tiles, names, pinned = null, showing = null, onfeature }: Props = $props();
  const tileOf = (n: number) => tiles.find((t) => t.table === n);
  const name = (id: string | null) => (id ? (names.get(id) ?? '?') : 'Bot');
  const ordinal = (p: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][p] ?? `${p + 1}th`;
</script>

<div class="tiles" style:--tile="{TILE_REM}rem" style:--gap="{TILE_GAP_REM}rem">
  {#each tables as t (t.table)}
    {@const x = tileOf(t.table)}
    {@const tile = x?.tile ?? null}
    <article class="tile panel" class:done={!!t.places} class:featured={showing === t.table} aria-label={`Table ${t.table}`}>
      <header>
        <span class="eyebrow">Table {t.table}</span>
        <span class="state">
          {#if t.places}Done{:else if x && x.linked === false && !tile}Setting up…{:else if tile?.waiting.length}Waiting for {tile.waiting.join(
              ', ',
            )}{:else if tile?.started}Hand
            {tile.hands + 1}{:else}Starting…{/if}
        </span>
      </header>
      <ul>
        {#each t.sides as s, i (i)}
          <li class:first={t.places?.[i] === 0} class:bot={!s}>
            <span class="who">{name(s)}</span>
            {#if t.places}<span class="place">{ordinal(t.places[i])}</span>{/if}
          </li>
        {/each}
      </ul>
      {#if tile?.totals && !t.places}
        <p class="totals">{tile.totals.map((r) => `${r.name} ${r.total}`).join(' · ')}</p>
      {/if}
      {#if onfeature && !t.places}
        <button class="btn quiet feature" onclick={() => onfeature?.(pinned === t.table ? null : t.table)}
          >{pinned === t.table ? 'Stop showing' : 'Show on screens'}</button
        >
      {/if}
    </article>
  {/each}
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--tile)), 1fr));
    gap: var(--gap);
  }
  .tile {
    padding: 0.7em 0.9em;
    display: flex;
    flex-direction: column;
    gap: 0.4em;
    min-width: 0;
  }
  .tile.featured {
    outline: 2px solid var(--gold);
  }
  .tile.done {
    opacity: 0.8;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 0.6em;
    align-items: baseline;
  }
  .state {
    font-size: 0.8em;
    color: var(--ink-dim);
    text-align: right;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.2em;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 0.6em;
    font-weight: 600;
  }
  li.first {
    color: var(--gold);
  }
  li.bot {
    color: var(--ink-faint);
    font-style: italic;
    font-weight: 400;
  }
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .place {
    font-variant-numeric: tabular-nums;
  }
  .totals {
    margin: 0;
    font-size: 0.8em;
    color: var(--ink-dim);
  }
  .feature {
    align-self: flex-start;
    font-size: 0.8em;
    min-height: 32px;
  }
</style>
