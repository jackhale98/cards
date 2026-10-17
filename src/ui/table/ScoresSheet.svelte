<script lang="ts">
  import type { GameStatus, LogEntry, PlayerState } from '../../engine/types';
  import type { Avatar, LobbySeat, Night, ScoreHistory } from '../../net/protocol';
  import NightBoard from '../components/NightBoard.svelte';
  import ScoreChart from '../components/ScoreChart.svelte';
  import Sheet from '../components/Sheet.svelte';
  import SuitText from '../components/SuitText.svelte';
  import Track from '../components/Track.svelte';

  /** The scores: the game's own scoreboard (or chips), the game hand by hand, tonight's tally, the latest moves. */
  let {
    status,
    players,
    chips,
    history,
    night,
    seats,
    log,
    avatars,
    onclose,
  }: {
    status: GameStatus;
    players: PlayerState[];
    /** A chips game: everyone's chips when there's no scoreboard. */
    chips: boolean;
    history: ScoreHistory | null;
    night: Night | undefined;
    seats: LobbySeat[];
    log: LogEntry[];
    /** Each player's face, by game seat (for the score track). */
    avatars: (Avatar | undefined)[];
    onclose: () => void;
  } = $props();
</script>

<Sheet title="Scores" {onclose}>
  {#if status.track}<div class="sheet-track"><Track track={status.track} {avatars} /></div>{/if}
  {#if status.scoreboard}
    <table class="scores">
      <thead
        ><tr
          ><th></th>{#each status.scoreboard.columns as c, k (k)}<th>{c}</th>{/each}</tr
        ></thead
      >
      <tbody>
        {#each status.scoreboard.rows as r, k (k)}
          <tr class:hl={r.highlight}
            ><td>{r.name}</td>{#each r.values as v, j (j)}<td><SuitText text={v} /></td>{/each}</tr
          >
        {/each}
      </tbody>
    </table>
  {:else if chips}
    <table class="scores">
      <tbody>
        {#each [...players].sort((a, b) => b.chips - a.chips) as p (p.seat)}
          <tr><td>{p.name}</td><td>{p.chips.toLocaleString()}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if history}
    <div class="eyebrow">Hand by hand</div>
    <ScoreChart {history} />
  {/if}
  {#if night?.games.length}
    <div class="eyebrow">Game night</div>
    <NightBoard {night} {seats} />
    <div style:height="1rem"></div>
  {/if}
  <div class="eyebrow">Recent</div>
  <ol class="log">
    {#each [...log].reverse().slice(0, 14) as l, k (k)}<li><SuitText text={l.text} /></li>{/each}
  </ol>
</Sheet>

<style>
  .sheet-track {
    display: flex;
    justify-content: center;
    margin-bottom: 0.8rem;
  }
  .scores {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .scores th {
    text-align: right;
    font-size: 0.7rem;
    color: var(--ink-dim);
    font-weight: 600;
    padding: 0.3rem 0.5rem;
  }
  .scores td {
    padding: 0.45rem 0.5rem;
    border-top: 1px solid var(--line);
    text-align: right;
  }
  .scores td:first-child {
    text-align: left;
    font-weight: 600;
  }
  .scores tr.hl td {
    color: var(--gold);
  }
  .log {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    color: var(--ink-dim);
    font-size: 0.85rem;
    line-height: 1.6;
  }
</style>
