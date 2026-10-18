<script lang="ts">
  import type { StandingRow } from '../../engine/events';
  import type { EventPerson } from '../../net/eventProtocol';
  import AvatarBadge from './AvatarBadge.svelte';

  /** A tournament's standings: rank, who (with their looks), points, games played, and the game's own score where it keeps one. */
  interface Props {
    rows: StandingRow[];
    people: EventPerson[];
    /** Highlight this entrant (yours). */
    me?: string | null;
    /** Show only this many (the rest: "+ n more"). */
    max?: number;
    knockout?: boolean;
    /** What the numbers are, when not points and the game's score (duplicate: a percentage and matchpoints, or points and IMPs; poker: chips, and no games played). */
    units?: { points: string; score: string; played?: false };
  }
  let { rows, people, me = null, max = Infinity, knockout = false, units }: Props = $props();

  const looks = $derived(new Map(people.map((p) => [p.id, p])));
  /** An entrant's people: one, or a partnership ("a+b"). */
  const membersOf = (id: string) => id.split('+').map((m) => looks.get(m));
  const scored = $derived(rows.some((r) => r.score != null));
  const played = $derived(units?.played !== false);
  const shown = $derived(rows.slice(0, max));
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
</script>

<ol class="standings" aria-label="Standings">
  <li class="head" aria-hidden="true">
    <span></span><span></span><span class="name">Player</span><span class="num">{units?.points ?? (knockout ? 'Won' : 'Pts')}</span>
    {#if played}<span class="num">Pl</span>{:else}<span></span>{/if}
    {#if scored}<span class="num">{units?.score ?? 'Score'}</span>{/if}
  </li>
  {#each shown as r (r.entrant)}
    <li class:me={r.entrant === me} class:out={r.out || r.alive === false}>
      <span class="rank">{r.rank}</span>
      <span class="avs">
        {#each membersOf(r.entrant) as p, i (i)}<AvatarBadge avatar={p?.avatar} name={p?.name ?? r.name} size={26} />{/each}
      </span>
      <span class="name"
        >{r.name}{#if r.out}<em> · withdrew</em>{/if}</span
      >
      <span class="num pts">{knockout ? r.wins : r.alive === false && !played ? 'Out' : fmt(r.points)}</span>
      {#if played}<span class="num">{r.played}</span>{:else}<span></span>{/if}
      {#if scored}<span class="num">{r.score ?? '–'}</span>{/if}
    </li>
  {/each}
  {#if rows.length > shown.length}<li class="more">+ {rows.length - shown.length} more</li>{/if}
</ol>

<style>
  .standings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.2rem;
    font-variant-numeric: tabular-nums;
  }
  li {
    display: grid;
    grid-template-columns: 1.8em auto 1fr 3em 2.4em auto;
    align-items: center;
    gap: 0.6em;
    padding: 0.35em 0.6em;
    border-radius: 0.6em;
    background: rgba(255, 255, 255, 0.04);
  }
  .head {
    background: none;
    padding-block: 0;
    font-size: 0.75em;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .me {
    background: rgba(233, 196, 106, 0.16);
    outline: 1px solid rgba(233, 196, 106, 0.4);
  }
  .out {
    opacity: 0.55;
  }
  .rank {
    font-weight: 800;
    color: var(--gold);
    text-align: center;
  }
  .avs {
    display: flex;
    gap: 0.15em;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .name em {
    font-weight: 400;
    color: var(--ink-faint);
  }
  .num {
    text-align: right;
  }
  .pts {
    font-weight: 800;
  }
  .more {
    display: block;
    background: none;
    color: var(--ink-faint);
    text-align: center;
  }
</style>
