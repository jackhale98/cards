<script lang="ts">
  import { app } from '../../app.svelte';
  import { castAvailable, castTable } from '../../net/cast';
  import { CODE_LENGTH, normaliseCode } from '../../net/protocol';
  import { sendToTv } from '../../net/tvPair';
  import Sheet from './Sheet.svelte';

  /** Put this table on a TV: Chromecast, or a TV browser showing a pairing code at lamplight.cards/tv. */
  let { table, onclose }: { table: string; onclose: () => void } = $props();

  let code = $state('');
  let busy = $state(false);
  let canCast = $state(false);
  void castAvailable().then((ok) => (canCast = ok));
  const tvUrl = `${location.host}/tv`;

  async function pair() {
    busy = true;
    const ok = await sendToTv(app.net, code, table);
    busy = false;
    if (ok) {
      app.say('The TV is showing the table');
      onclose();
    } else app.say(`No TV answered with code ${code} — check it's showing on the TV`);
  }
  async function cast() {
    try {
      await castTable(table);
      app.say('Casting the table');
      onclose();
    } catch {
      /* cancelled */
    }
  }
</script>

<Sheet title="Show on a TV" {onclose}>
  <div class="tvsheet">
    {#if canCast}
      <button class="btn primary wide" onclick={cast}>Cast to a Chromecast or Google TV</button>
      <div class="or"><span>or any TV with a web browser</span></div>
    {/if}
    <ol>
      <li>On the TV's web browser, open <b>{tvUrl}</b>. It shows a {CODE_LENGTH}-letter code.</li>
      <li>Type that code here:</li>
    </ol>
    <form onsubmit={(e) => { e.preventDefault(); void pair(); }}>
      <input value={code} oninput={(e) => (code = normaliseCode(e.currentTarget.value))} placeholder="TV CODE" maxlength={CODE_LENGTH} autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="TV code" />
      <button class="btn" class:primary={!canCast} disabled={busy || code.length !== CODE_LENGTH}>{busy ? 'Connecting…' : 'Show table'}</button>
    </form>
    <p class="small">Apple TV: use Screen Mirroring from a spare iPad or phone that has this table open as the table display — not from your own phone, or everyone sees your hand.</p>
  </div>
</Sheet>

<style>
  .tvsheet {
    display: grid;
    gap: 0.6rem;
  }
  ol {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--ink-dim);
    line-height: 1.5;
  }
  ol b {
    color: var(--ink);
  }
  form {
    display: flex;
    gap: 0.5rem;
  }
  input {
    flex: 1;
    min-width: 0;
    text-align: center;
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }
  .or {
    text-align: center;
    font-size: 0.8rem;
    color: var(--ink-dim);
  }
  .small {
    font-size: 0.78rem;
    color: var(--ink-dim);
    margin: 0.2rem 0 0;
  }
</style>
