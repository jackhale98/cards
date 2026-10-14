<script lang="ts">
  import { gameWinners, nightTotals } from '../../net/night';
  import type { LobbySeat, Night } from '../../net/protocol';
  import AvatarBadge from './AvatarBadge.svelte';
  import GameIcon from './GameIcon.svelte';
  import { getGame } from '../../games';
  import type { NightGame } from '../../net/protocol';
  import Sheet from './Sheet.svelte';
  import SuitText from './SuitText.svelte';

  interface Props {
    night: Night | undefined;
    seats: LobbySeat[];
    /** Host only: start a new tally. */
    onreset?: () => void;
  }
  let { night, seats, onreset }: Props = $props();
  const rows = $derived(nightTotals(night));
  const games = $derived([...(night?.games ?? [])].reverse());
  const avatarOf = (id: string) => seats.find((s) => s.id === id)?.avatar;
  const icon = (id: string) => {
    try {
      return getGame(id).config.icon;
    } catch {
      return '♠';
    }
  };
  let confirming = $state(false);
  /** A finished game opened to see its own final scores. */
  let open = $state<NightGame | null>(null);
  const when = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
</script>

<div class="night">
  <ol class="board">
    {#each rows as r, i (r.id)}
      <li class:lead={r.rank === 0}>
        <span class="rank">{r.rank === 0 ? '★' : r.rank + 1}</span>
        <AvatarBadge avatar={avatarOf(r.id)} name={r.name} seat={i} size={26} />
        <span class="who">{r.name}</span>
        <span class="wins">{r.wins ? `${r.wins} win${r.wins > 1 ? 's' : ''}` : ''}</span>
        <b>{r.points}</b>
      </li>
    {/each}
  </ol>
  <ul class="games">
    {#each games as g (g.at)}
      <li>
        <button class="game" onclick={() => (open = g)} aria-label="{g.name}: final scores">
          <GameIcon id={g.game} icon={icon(g.game)} size={22} /><span>{g.name}</span><em>{gameWinners(g)}</em>
        </button>
      </li>
    {/each}
  </ul>
  {#if onreset}
    {#if confirming}
      <div class="confirm">
        Clear tonight's scores?
        <button class="btn small-btn" onclick={() => (confirming = false)}>Keep</button>
        <button
          class="btn small-btn danger"
          onclick={() => {
            onreset();
            confirming = false;
          }}>Clear</button
        >
      </div>
    {:else}
      <button class="link" onclick={() => (confirming = true)}>New night</button>
    {/if}
  {/if}
</div>

{#if open}
  <Sheet title="{open.name} · {when(open.at)}" onclose={() => (open = null)}>
    {#if open.final?.lines.length}
      <div class="lines">
        {#each open.final.lines as line, k (k)}<p><SuitText text={line} /></p>{/each}
      </div>
    {/if}
    {#if open.final?.rows.length}
      <table class="final">
        {#if open.final.columns.length}<thead
            ><tr
              ><th></th>{#each open.final.columns as c, k (k)}<th>{c}</th>{/each}</tr
            ></thead
          >{/if}
        <tbody>
          {#each open.final.rows as r, k (k)}
            <tr class:hl={r.highlight}
              ><td>{r.name}</td>{#each r.values as v, j (j)}<td><SuitText text={v} /></td>{/each}</tr
            >
          {/each}
        </tbody>
      </table>
    {/if}
    <!-- (where each finished tonight, and the points it earned on the night's board) -->
    <ol class="places">
      {#each [...open.results].sort((a, b) => a.place - b.place) as r (r.id)}
        <li><span class="rank">{r.place === 0 ? '★' : r.place + 1}</span><span class="who">{r.name}</span><span class="pts">+{r.points} tonight</span></li>
      {/each}
    </ol>
  </Sheet>
{/if}

<style>
  .game {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 32px;
    padding: 0;
    color: inherit;
    font: inherit;
  }
  .lines p {
    margin: 0.15rem 0;
    color: var(--ink-dim);
  }
  .final {
    width: 100%;
    border-collapse: collapse;
    margin: 0.6rem 0;
    font-variant-numeric: tabular-nums;
  }
  .final th {
    font-size: 0.72rem;
    color: var(--ink-dim);
    font-weight: 600;
    text-align: right;
  }
  .final td {
    padding: 0.3rem 0.4rem;
    text-align: right;
    border-top: 1px solid var(--line);
  }
  .final td:first-child {
    text-align: left;
  }
  .final tr.hl td {
    color: var(--gold);
    font-weight: 700;
  }
  .places {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .places li {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    gap: 0.5rem;
  }
  .places .pts {
    color: var(--ink-dim);
  }
  .night {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .board {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .board li {
    display: grid;
    grid-template-columns: 1.4rem auto 1fr auto 2.4rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.18);
  }
  .board li.lead {
    background: rgba(233, 196, 106, 0.14);
    box-shadow: inset 0 0 0 1px rgba(233, 196, 106, 0.35);
  }
  .rank {
    text-align: center;
    color: var(--ink-dim);
    font-weight: 700;
  }
  .lead .rank {
    color: var(--gold);
  }
  .who {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wins {
    font-size: 0.75rem;
    color: var(--ink-dim);
  }
  .board b {
    text-align: right;
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
  }
  .games {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .games li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.6rem 0.2rem 0.3rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.18);
    font-size: 0.75rem;
  }
  .games em {
    font-style: normal;
    color: var(--gold);
  }
  .link {
    align-self: flex-start;
    font-size: 0.78rem;
    color: var(--ink-dim);
    text-decoration: underline;
  }
  .small-btn {
    min-height: 32px;
    padding: 0.2em 0.8em;
    font-size: 0.8rem;
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--ink-dim);
  }
</style>
