<script lang="ts">
  import { app, inviteUrl } from '../../app.svelte';
  import { swissRounds } from '../../engine/events';
  import { GAME_LIST, getGame } from '../../games';
  import type { BoardShow } from '../../net/eventProtocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import EventBracket from '../components/EventBracket.svelte';
  import EventStandings from '../components/EventStandings.svelte';
  import EventTiles from '../components/EventTiles.svelte';
  import Loader from '../components/Loader.svelte';
  import StandbySheet from '../components/StandbySheet.svelte';
  import TvSheet from '../components/TvSheet.svelte';
  import { keepAwake } from '../wakeLock';
  import EventBoard from './EventBoard.svelte';

  /**
   * The director's desk, on the device running a tournament (usually a laptop by the TV): the
   * event's settings and who has signed up, then each round's tables and the standings, the round
   * moving on by itself when every table is done (or held), and the board for the screens.
   */
  const d = $derived(app.events.directing);
  const board = $derived(d?.board ?? null);
  const c = $derived(d?.config ?? null);
  const game = $derived(c ? getGame(c.game.id) : null);
  const names = $derived(new Map((board?.entrants ?? []).map((x) => [x.id, x.name])));
  const pairs = $derived((board?.perSide ?? 1) > 1);
  const FORMAT: Record<string, string> = { swiss: 'Swiss', roundRobin: 'Round robin', knockout: 'Knockout' };
  const SHOWS: { id: BoardShow; label: string }[] = [
    { id: 'turn', label: 'Turn about' },
    { id: 'tables', label: 'Tables' },
    { id: 'standings', label: 'Standings' },
    { id: 'bracket', label: 'Bracket' },
    { id: 'live', label: 'Tables live' },
  ];
  const games = GAME_LIST.filter((g) => g.config.id !== 'freetable');

  let showBoard = $state(false);
  let tv = $state(false);
  let standby = $state(false);
  let error = $state('');

  // the director's device keeps the whole tournament going: it doesn't sleep
  $effect(() => (d ? keepAwake() : undefined));

  let qr = $state('');
  $effect(() => {
    if (!d) return;
    import('qrcode')
      .then((QR) => QR.toDataURL(inviteUrl(d.code), { margin: 1, width: 320, color: { dark: '#0b2a21', light: '#fbf8f1' } }))
      .then((x) => (qr = x))
      .catch(() => {});
  });

  function start() {
    error = app.events.start() ?? '';
  }
  const rounds = $derived(
    c ? (c.rounds ?? swissRounds(Math.max(2, Math.ceil((d?.people.length ?? 2) / Math.max(1, board?.perSide ?? 1))), c.sides.length)) : 0,
  );
</script>

{#if tv && d}<TvSheet table={d.code} onclose={() => (tv = false)} />{/if}
{#if standby && d}<StandbySheet standby={d.standby} onclose={() => (standby = false)} />{/if}

{#if showBoard && d}
  <EventBoard
    code={d.code}
    {board}
    people={d.people}
    tiles={d.tiles}
    live={d.live && d.featured != null ? { table: d.featured, view: d.live } : null}
    show={d.show}
    onclose={() => (showBoard = false)}
  />
{:else}
  <main class="desk">
    {#if !d || !board || !c || !game}
      <div class="wait">
        <Loader size={40} />
        <p>Opening the tournament…</p>
        <button class="btn quiet" onclick={() => app.go('/')}>Home</button>
      </div>
    {:else}
      <header>
        <div class="title">
          <span class="eyebrow">Directing · {game.config.name} · {FORMAT[c.format]}</span>
          {#if board.phase === 'registering'}
            <input
              class="name"
              value={c.name}
              maxlength="40"
              aria-label="Tournament name"
              onchange={(e) => app.events.setConfig({ name: e.currentTarget.value })}
            />
          {:else}
            <h1>{c.name}</h1>
          {/if}
        </div>
        <div class="code" aria-label={`Code ${d.code}`}>
          {#each d.code.split('') as ch, k (k)}<span>{ch}</span>{/each}
        </div>
        <div class="row">
          <button class="btn primary" onclick={() => (showBoard = true)}>Show the board</button>
          <button class="btn" onclick={() => (tv = true)}>TV</button>
          <button class="btn" class:on={d.standby.linked > 0} onclick={() => (standby = true)} aria-label="Standby director"
            >Standby{d.standby.linked ? ' ✓' : ''}</button
          >
        </div>
      </header>

      {#if board.phase === 'registering'}
        <div class="cols">
          <section class="panel setup">
            <label class="opt">
              <span>Game</span>
              <select value={c.game.id} onchange={(e) => app.events.setGame(e.currentTarget.value)} aria-label="Game">
                {#each games as g (g.config.id)}<option value={g.config.id}>{g.config.name}</option>{/each}
              </select>
            </label>
            <div class="opt">
              <span>Format</span>
              <span class="seg">
                {#each d.formats as f (f)}
                  <button class:on={c.format === f} onclick={() => app.events.setConfig({ format: f })}>{FORMAT[f]}</button>
                {/each}
              </span>
            </div>
            {#if c.format === 'swiss'}
              <div class="opt">
                <span>Rounds</span>
                <span class="stepper">
                  <button onclick={() => app.events.setConfig({ rounds: Math.max(1, rounds - 1) })} aria-label="Fewer rounds">−</button>
                  <b>{rounds}</b>
                  <button onclick={() => app.events.setConfig({ rounds: rounds + 1 })} aria-label="More rounds">+</button>
                </span>
              </div>
            {/if}
            {#if c.format === 'knockout' && c.sides.length > 2}
              <div class="opt">
                <span>Through from each table</span>
                <span class="seg">
                  {#each [1, 2] as n (n)}<button class:on={(c.advance ?? 1) === n} onclick={() => app.events.setConfig({ advance: n })}>{n}</button>{/each}
                </span>
              </div>
            {/if}
            {#each game.config.options ?? [] as o (o.id)}
              <div class="opt">
                <span>{o.label}</span>
                {#if o.choices}
                  <span class="seg">
                    {#each o.choices as ch, i (ch)}
                      <button class:on={Number(c.game.options[o.id]) === i} onclick={() => app.events.setConfig({ option: { id: o.id, value: i } })}
                        >{ch}</button
                      >
                    {/each}
                  </span>
                {:else if o.type === 'number'}
                  <span class="stepper">
                    <button
                      onclick={() => app.events.setConfig({ option: { id: o.id, value: Math.max(o.min ?? 0, Number(c.game.options[o.id]) - (o.step ?? 1)) } })}
                      >−</button
                    >
                    <b>{c.game.options[o.id]}</b>
                    <button
                      onclick={() =>
                        app.events.setConfig({ option: { id: o.id, value: Math.min(o.max ?? 1e9, Number(c.game.options[o.id]) + (o.step ?? 1)) } })}>+</button
                    >
                  </span>
                {:else}
                  <input
                    type="checkbox"
                    checked={!!c.game.options[o.id]}
                    onchange={(e) => app.events.setConfig({ option: { id: o.id, value: e.currentTarget.checked } })}
                  />
                {/if}
              </div>
            {/each}
            <p class="small">
              {c.seats} at a table{pairs ? ', in pairs' : ''}. Each table is hosted by one of its players' phones; a table of bots, by this device.
            </p>
          </section>

          <section class="panel people">
            <div class="head">
              <span class="eyebrow">Signed up · {d.people.length}</span>
            </div>
            {#if qr}<img class="qr" src={qr} alt="QR code to sign up" />{/if}
            <p class="small">Players scan this, or enter <b>{d.code}</b> on lamplight.cards.</p>
            <ul>
              {#each d.people as p (p.id)}
                <li>
                  <AvatarBadge avatar={p.avatar} name={p.name} size={28} />
                  <span class="who"
                    >{p.name}{#if p.bot}<em>{pairs ? 'a pair of bots' : 'bot'}</em>{/if}</span
                  >
                  {#if pairs && !p.bot}
                    <select value={p.partner ?? ''} onchange={(e) => app.events.pair(p.id, e.currentTarget.value || null)} aria-label={`${p.name}'s partner`}>
                      <option value="">No partner yet</option>
                      {#each d.people.filter((q) => q.id !== p.id && !q.bot) as q (q.id)}<option value={q.id}>{q.name}</option>{/each}
                    </select>
                  {/if}
                  <button class="x" onclick={() => app.events.remove(p.id)} aria-label={`Remove ${p.name}`}>×</button>
                </li>
              {/each}
            </ul>
            {#if error}<p class="warn-text">{error}</p>{/if}
            <div class="row">
              <button class="btn" onclick={() => app.events.addBot()}>Add a bot</button>
              <button class="btn primary big" disabled={d.people.length < 2} onclick={start}>Start the tournament</button>
            </div>
          </section>
        </div>
      {:else}
        <section class="status">
          <div>
            <span class="eyebrow">{board.phase === 'done' ? 'Final standings' : `Round ${board.round}${board.rounds ? ` of ${board.rounds}` : ''}`}</span>
            <p>
              {#if board.phase === 'playing'}
                {board.tables.filter((t) => t.places).length} of {board.tables.length} tables done
              {:else if board.phase === 'between'}
                Every table's done. {d.holding ? 'Held: the next round waits for you.' : 'The next round starts shortly.'}
              {:else}
                That's the tournament.
              {/if}
            </p>
          </div>
          <div class="row">
            {#if board.phase === 'between'}
              <button class="btn primary" onclick={() => app.events.advance()}
                >{board.format === 'swiss' && board.round === board.rounds ? 'Finish' : 'Next round now'}</button
              >
              <button class="btn" onclick={() => app.events.hold(!d.holding)}>{d.holding ? 'Carry on' : 'Hold'}</button>
            {:else if board.phase === 'done'}
              <button
                class="btn"
                onclick={() => {
                  app.events.endDirecting(true);
                  app.go('/');
                }}>Close the tournament</button
              >
            {/if}
          </div>
        </section>
        <div class="opt shows">
          <span>Screens show</span>
          <span class="seg">
            {#each SHOWS.filter((x) => (x.id !== 'bracket' || board.bracket) && (board.phase !== 'done' || !['tables', 'live'].includes(x.id))) as x (x.id)}
              <button class:on={d.show === x.id} onclick={() => app.events.show(x.id)}>{x.label}</button>
            {/each}
          </span>
        </div>
        {#if board.phase !== 'done'}
          <EventTiles tables={board.tables} tiles={d.tiles} {names} pinned={d.pinned} showing={d.featured} onfeature={(t) => app.events.feature(t)} />
          {#if board.byes.length}<p class="small">Bye this round: {board.byes.map((b) => names.get(b) ?? b).join(', ')}</p>{/if}
        {/if}
        <div class="cols">
          <section><EventStandings rows={board.standings} people={d.people} knockout={board.format === 'knockout'} /></section>
          {#if board.bracket}<section><EventBracket bracket={board.bracket} {names} /></section>{/if}
        </div>
      {/if}
    {/if}
  </main>
{/if}

<style>
  .desk {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: calc(14px + var(--safe-t)) calc(18px + var(--safe-r)) calc(18px + var(--safe-b)) calc(18px + var(--safe-l));
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: var(--felt);
  }
  .wait {
    margin: auto;
    display: grid;
    justify-items: center;
    gap: 0.6rem;
    color: var(--ink-dim);
  }
  header {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 1rem;
    align-items: end;
  }
  h1,
  .name {
    margin: 0.1rem 0 0;
    font-family: var(--font-card);
    font-size: 1.6rem;
  }
  .name {
    width: 100%;
    background: transparent;
    border: 0;
    border-bottom: 1px dashed var(--line);
    color: var(--ink);
    padding: 0;
  }
  .code {
    display: flex;
    gap: 0.2rem;
  }
  .code span {
    width: 1.7rem;
    height: 2.2rem;
    display: grid;
    place-items: center;
    font-family: var(--font-card);
    font-size: 1.3rem;
    border-radius: 0.4rem;
    background: rgba(255, 255, 255, 0.08);
    color: var(--gold);
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
    align-items: start;
  }
  .setup,
  .people {
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .opt {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.8rem;
    min-height: 40px;
  }
  .opt select {
    max-width: 60%;
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .seg button,
  .stepper button {
    min-height: 36px;
    min-width: 36px;
    padding: 0 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.05);
  }
  .seg button.on {
    border-color: var(--gold);
    background: rgba(233, 196, 106, 0.16);
    color: var(--gold);
    font-weight: 700;
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .people .qr {
    width: 9rem;
    align-self: center;
    border-radius: 0.5rem;
  }
  .people ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .who {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who em {
    margin-left: 0.4rem;
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--ink-faint);
  }
  .people .row .big {
    flex: 1;
  }
  .shows {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .shows > span:first-child {
    color: var(--ink-dim);
  }
  .x {
    width: 36px;
    height: 36px;
    font-size: 1.2rem;
    color: var(--ink-dim);
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .status p {
    margin: 0.2rem 0 0;
    color: var(--ink-dim);
  }
  .big {
    min-height: 48px;
  }
  @media (orientation: portrait), (max-width: 620px) {
    header {
      grid-template-columns: 1fr;
    }
  }
</style>
