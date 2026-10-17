<script lang="ts">
  import { app } from '../../app.svelte';
  import type { GameConfig } from '../../engine/types';
  import { EXPORT_ABOUT, EXPORT_FILE, EXPORT_LABEL, recordFormats } from '../../net/exports/formats';
  import Sheet from '../components/Sheet.svelte';

  /** Saving the game: the spreadsheet for every game; bridge and poker have their own standard records too. */
  let { config, onclose }: { config: GameConfig; onclose: () => void } = $props();
</script>

<Sheet title="Save this game" {onclose}>
  <div class="save-list">
    {#each ['csv' as const, ...recordFormats(config)] as format (format)}
      <button
        class="btn save"
        onclick={() => {
          app.exportGame(format);
          onclose();
        }}
      >
        <b>{EXPORT_LABEL[format]} <span class="ext">.{EXPORT_FILE[format].ext}</span></b>
        <span class="about">{EXPORT_ABOUT[format]}</span>
      </button>
    {/each}
  </div>
  <p class="save-note">Only your own cards are in it, and the cards everyone saw.</p>
</Sheet>

<style>
  .save-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .btn.save {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    padding: 0.7rem 1rem;
    border-radius: 16px;
    white-space: normal;
    text-align: left;
    height: auto;
  }
  .btn.save .ext {
    font-weight: 500;
    color: var(--ink-dim);
  }
  .btn.save .about {
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--ink-dim);
  }
  .save-note {
    margin: 0.8rem 0 0;
    font-size: 0.8rem;
    color: var(--ink-dim);
  }
</style>
