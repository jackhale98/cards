<script lang="ts">
  import { app } from '../../app.svelte';
  import EventBoard from './EventBoard.svelte';

  // (a tournament's code is loaded before its screens show: see App.svelte)
  const events = app.events!;

  /**
   * A standby director's screen: the tournament's board, as on any screen, and a bar saying how
   * fresh its copy of the tournament is. If the director's device goes quiet, the bar offers to
   * take over directing (the copy opens only then, with the key the relay hands over).
   */
  const s = $derived(events.standby);
  const age = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)} min`);
</script>

{#if s}
  <EventBoard code={s.code} board={s.board} people={s.people} tiles={s.tiles} live={s.live} show={s.show}>
    {#snippet bar()}
      <div class="standby panel" role="status">
        {#if s.quiet}
          <p><b>The director’s device has gone quiet.</b> Take over to keep the tournament going.</p>
          <button class="btn primary" disabled={s.taking || s.copyAge == null} onclick={() => events.takeOverDirecting()}
            >{s.taking ? 'Taking over…' : 'Take over directing'}</button
          >
        {:else}
          <p>
            <b>Standing by.</b>
            {s.copyAge == null ? 'Waiting for the director’s copy…' : `Copy of the tournament from ${age(s.copyAge)} ago.`}
          </p>
        {/if}
        {#if s.error}<p class="warn-text">{s.error}</p>{/if}
      </div>
    {/snippet}
  </EventBoard>
{/if}

<style>
  .standby {
    width: min(26rem, 100%);
    padding: 0.6rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.9rem;
  }
  .standby p {
    margin: 0;
    line-height: 1.4;
  }
</style>
