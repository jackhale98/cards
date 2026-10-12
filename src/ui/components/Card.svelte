<script lang="ts">
  import { parseCard, rankLabel, SUIT_SYMBOL } from '../../engine/cards';
  import { isHidden } from '../../engine/redact';

  interface Props {
    id: string;
    /** Force showing the back (e.g. face-down table card). */
    down?: boolean;
    selected?: boolean;
    playable?: boolean;
    dim?: boolean;
    fresh?: boolean;
  }
  let { id, down = false, selected = false, playable = false, dim = false, fresh = false }: Props = $props();

  const hidden = $derived(down || isHidden(id));
  const info = $derived(hidden ? null : parseCard(id));
  const red = $derived(info?.suit === 'H' || info?.suit === 'D');
  const sym = $derived(info ? SUIT_SYMBOL[info.suit] : '');
  const rank = $derived(info ? rankLabel(info.rank) : '');
  const court = $derived(info && info.rank >= 11 && info.rank <= 13);
</script>

<div
  class="card"
  class:back={hidden}
  class:red
  class:selected
  class:playable
  class:dim
  class:fresh
  aria-label={info ? `${rank}${sym}` : 'card'}
>
  {#if info && info.suit === 'X'}
    <div class="joker"><span>★</span><small>JOKER</small></div>
  {:else if info}
    <div class="corner tl"><b>{rank}</b><i>{sym}</i></div>
    <div class="center" class:court class:ace={info.rank === 14}>
      {#if court}
        <span class="court-letter">{rank}</span><span class="court-suit">{sym}</span>
      {:else}
        {sym}
      {/if}
    </div>
    <div class="corner br"><b>{rank}</b><i>{sym}</i></div>
  {/if}
</div>

<style>
  .card {
    --w: var(--cw, 64px);
    position: relative;
    width: var(--w);
    height: calc(var(--w) * 1.4);
    font-size: calc(var(--w) / 5);
    border-radius: var(--card-radius);
    background: linear-gradient(160deg, #fff 0%, var(--card-face) 60%, #f1ebdd 100%);
    color: var(--card-black);
    box-shadow:
      0 0.08em 0.2em rgba(0, 0, 0, 0.25),
      0 0.6em 1.2em -0.4em rgba(0, 0, 0, 0.45),
      inset 0 0 0 1px var(--card-edge);
    font-family: var(--font-card);
    transition:
      transform 0.22s var(--ease-out),
      box-shadow 0.22s,
      filter 0.2s,
      opacity 0.2s;
    flex: none;
    overflow: hidden;
  }
  .red {
    color: var(--card-red);
  }
  .corner {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 0.95;
    width: 1.3em;
  }
  .corner b {
    font-size: 1.3em;
    font-weight: 700;
    letter-spacing: -0.05em;
  }
  .corner i {
    font-style: normal;
    font-size: 1.05em;
  }
  .tl {
    top: 0.3em;
    left: 0.18em;
  }
  .br {
    bottom: 0.3em;
    right: 0.18em;
    transform: rotate(180deg);
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 2.5em;
    line-height: 1;
  }
  .center.ace {
    font-size: 3.4em;
  }
  .center.court {
    inset: 18% 22%;
    border-radius: 0.12em;
    border: 1px solid currentColor;
    opacity: 1;
    background: linear-gradient(180deg, rgba(233, 196, 106, 0.18), rgba(233, 196, 106, 0.05));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1em;
  }
  .court-letter {
    font-size: 0.85em;
    font-style: italic;
    font-weight: 700;
  }
  .court-suit {
    font-size: 0.45em;
  }
  .joker {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #6b3fa0;
  }
  .joker span {
    font-size: 2.6em;
  }
  .joker small {
    font-size: 0.75em;
    letter-spacing: 0.2em;
    font-family: var(--font-ui);
    font-weight: 700;
  }

  /* the table's card back (see ui/backArt.ts): one drawing of the whole card, margin included */
  .back {
    background: var(--back-art) center / 100% 100% no-repeat, var(--back-a);
    box-shadow:
      0 0.08em 0.2em rgba(0, 0, 0, 0.3),
      0 0.6em 1.2em -0.4em rgba(0, 0, 0, 0.5),
      inset 0 0 0 1px var(--card-edge);
  }

  .selected {
    transform: translateY(-18%);
    box-shadow:
      0 0 0 0.12em var(--gold),
      0 0.8em 1.6em -0.3em rgba(0, 0, 0, 0.55);
  }
  .playable:not(.selected) {
    box-shadow:
      0 0 0 0.08em rgba(233, 196, 106, 0.75),
      0 0.6em 1.2em -0.4em rgba(0, 0, 0, 0.45),
      inset 0 0 0 1px var(--card-edge);
  }
  .dim {
    filter: brightness(0.62) saturate(0.7);
  }
  .fresh::after {
    content: '';
    position: absolute;
    top: 0.25em;
    right: 0.25em;
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background: var(--gold);
    box-shadow: 0 0 0.4em var(--gold);
  }
</style>
