<script lang="ts">
  import { app } from '../../app.svelte';
  import { CastError, castAvailable, castTable } from '../../net/cast';
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
  let casting = $state(false);
  async function cast() {
    casting = true;
    try {
      await castTable(table);
      app.say('The TV is showing the table');
      onclose();
    } catch (e) {
      // (closing Chrome's TV picker isn't an error)
      if (!(e instanceof CastError && e.code === 'cancel')) app.say(e instanceof Error ? e.message : 'Casting didn’t work');
    } finally {
      casting = false;
    }
  }
</script>

<Sheet title="Show on a TV" {onclose}>
  <div class="tvsheet">
    {#if canCast}
      <button class="btn primary wide" onclick={cast} disabled={casting}
        >{casting ? 'Starting Lamplight on the TV…' : 'Cast to a Chromecast or Google TV'}</button
      >
      <div class="or"><span>or any TV with a web browser</span></div>
    {/if}
    <ol>
      <li>On the TV's web browser, open <b>{tvUrl}</b>. It shows a {CODE_LENGTH}-letter code.</li>
      <li>Type that code here:</li>
    </ol>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void pair();
      }}
    >
      <input
        value={code}
        oninput={(e) => (code = normaliseCode(e.currentTarget.value))}
        placeholder="TV CODE"
        maxlength={CODE_LENGTH}
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        aria-label="TV code"
      />
      <button class="btn" class:primary={!canCast} disabled={busy || code.length !== CODE_LENGTH}>{busy ? 'Connecting…' : 'Show table'}</button>
    </form>
    <p class="small">
      Apple TV: use Screen Mirroring from a spare iPad or phone that has this table open as the table display — not from your own phone, or everyone sees your
      hand.
    </p>
  </div>
</Sheet>

<style>
  .tvsheet {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
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
    overflow-wrap: anywhere;
  }
  form {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }
  form .btn {
    flex: none;
  }
  input {
    flex: 1;
    min-width: 0;
    width: 100%;
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
