<script lang="ts">
  import { app } from '../../app.svelte';
  import { startReceiver } from '../../net/cast';
  import { isValidCode, normaliseCode } from '../../net/protocol';
  import { makeTvCode, waitForTable } from '../../net/tvPair';

  /**
   * A TV waiting for a table: a smart TV's browser at lamplight.cards/tv, or a Chromecast running
   * our receiver. It shows a pairing code; a phone at the table types it in ("Show on a TV") and
   * the TV opens that table's display. A TV with a keyboard can also type a table code directly.
   */
  const casting = new URLSearchParams(location.search).has('cast');
  function tvCode() {
    try {
      const saved = sessionStorage.getItem('cards.tvCode');
      if (saved) return saved;
      const fresh = makeTvCode();
      sessionStorage.setItem('cards.tvCode', fresh);
      return fresh;
    } catch {
      return makeTvCode();
    }
  }
  const code = tvCode();
  const open = (table: string) => isValidCode(normaliseCode(table)) && app.go(`/display/${normaliseCode(table)}`);
  $effect(() => waitForTable(app.net, code, open));
  $effect(() => {
    if (casting) startReceiver(open);
  });

  let typed = $state('');
</script>

<div class="tv">
  <div class="brand">Lamplight</div>
  <p class="lead">Table screen</p>
  <div class="code" aria-label="Pairing code">{#each code.split('') as ch, k (k)}<span>{ch}</span>{/each}</div>
  <p class="how">
    On a phone at the table, open the lobby (or the table menu), tap <b>Show on a TV</b>, and enter this code.
  </p>
  {#if !casting}
    <form class="join" onsubmit={(e) => { e.preventDefault(); open(typed); }}>
      <input value={typed} oninput={(e) => (typed = normaliseCode(e.currentTarget.value))} placeholder="or type a table code" aria-label="Table code" autocapitalize="characters" autocomplete="off" spellcheck="false" />
      <button class="btn" disabled={!isValidCode(typed)}>Show table</button>
    </form>
  {/if}
</div>

<style>
  .tv {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1.2vmin;
    padding: 4vmin;
    text-align: center;
    background:
      radial-gradient(ellipse 85% 150% at -6% -12%, rgba(255, 196, 118, 0.45) 0%, rgba(255, 186, 104, 0) 70%),
      radial-gradient(ellipse 80% 70% at 50% 42%, #2f5e3e 0%, #1b3b28 55%, #0d1a10 100%);
  }
  .brand {
    font-family: var(--font-card);
    font-size: clamp(2.4rem, 8vmin, 6rem);
    color: #f7dfa4;
  }
  .lead {
    margin: 0 0 2vmin;
    font-size: clamp(1rem, 3vmin, 2rem);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }
  .code {
    display: flex;
    gap: 1.6vmin;
  }
  .code span {
    display: grid;
    place-items: center;
    width: clamp(3rem, 12vmin, 9rem);
    height: clamp(4rem, 16vmin, 12rem);
    border-radius: 2vmin;
    background: #fbf8f1;
    color: #14231b;
    font-family: var(--font-card);
    font-size: clamp(2.2rem, 11vmin, 8rem);
    font-weight: 700;
    box-shadow: 0 1vmin 3vmin rgba(0, 0, 0, 0.35);
  }
  .how {
    max-width: 44rem;
    margin-top: 3vmin;
    font-size: clamp(1rem, 2.6vmin, 1.8rem);
    line-height: 1.45;
    color: var(--ink-dim);
  }
  .how b {
    color: var(--ink);
  }
  .join {
    display: flex;
    gap: 0.6rem;
    margin-top: 2vmin;
  }
  .join input {
    width: 14rem;
    text-align: center;
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }
</style>
