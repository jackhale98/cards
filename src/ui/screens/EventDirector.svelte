<script lang="ts">
  import { app, inviteUrl } from '../../app.svelte';
  import { BOARDS_PER_ROUND, duplicateRounds, LEVEL_MINUTES, swissRounds } from '../../engine/events';
  import { GAME_LIST, getGame } from '../../games';
  import type { BoardShow } from '../../net/eventProtocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import EventBracket from '../components/EventBracket.svelte';
  import EventStandings from '../components/EventStandings.svelte';
  import EventTiles from '../components/EventTiles.svelte';
  import EventTraveller from '../components/EventTraveller.svelte';
  import Loader from '../components/Loader.svelte';
  import StandbySheet from '../components/StandbySheet.svelte';
  import TvSheet from '../components/TvSheet.svelte';
  import { keepAwake } from '../wakeLock';
  import EventBoard from './EventBoard.svelte';

  // (a tournament's code is loaded before its screens show: see App.svelte)
  const events = app.events!;

  /**
   * The director's desk, on the device running a tournament (usually a laptop by the TV): the
   * event's settings and who has signed up, then each round's tables and the standings, the round
   * moving on by itself when every table is done (or held), and the board for the screens.
   */
  const d = $derived(events.directing);
  const board = $derived(d?.board ?? null);
  const c = $derived(d?.config ?? null);
  const game = $derived(c ? getGame(c.game.id) : null);
  const names = $derived(new Map((board?.entrants ?? []).map((x) => [x.id, x.name])));
  const pairs = $derived((board?.perSide ?? 1) > 1);
  /** Duplicate bridge: pairs or teams (see engine/events/duplicate.ts). */
  const duplicate = $derived(c?.format === 'pairs' || c?.format === 'teams');
  const teams = $derived(c?.format === 'teams');
  const FORMAT: Record<string, string> = {
    swiss: 'Swiss',
    roundRobin: 'Round robin',
    knockout: 'Knockout',
    pairs: 'Pairs',
    teams: 'Teams',
    mtt: 'Multi-table',
  };
  /** Multi-table poker (see engine/events/mtt.ts). */
  const mtt = $derived(c?.format === 'mtt');
  const SHOWS: { id: BoardShow; label: string }[] = [
    { id: 'turn', label: 'Turn about' },
    { id: 'tables', label: 'Tables' },
    { id: 'standings', label: 'Standings' },
    { id: 'bracket', label: 'Bracket' },
    { id: 'travellers', label: 'Travellers' },
    { id: 'live', label: 'Tables live' },
  ];
  /** Who's in someone's pair (the partner they asked for), for choosing the pairs on their team. */
  const pairOf = (id: string) => [id, d?.people.find((p) => p.id === id)?.partner].filter(Boolean);
  const games = GAME_LIST.filter((g) => g.config.id !== 'freetable');
  /** Directing from a phone (a touch screen, small): hosting every table here is a lot to ask of it. */
  const onPhone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (max-width: 900px)').matches;

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
    error = events.start() ?? '';
  }
  /** The entrants those signed up so far would make: people in pairs or teams of four, and each bot a whole one. */
  const entrants = $derived(
    Math.max(
      2,
      Math.ceil((d?.people.filter((p) => !p.bot).length ?? 0) / Math.max(1, (board?.perSide ?? 1) * (teams ? 2 : 1))) +
        (d?.people.filter((p) => p.bot).length ?? 0),
    ),
  );
  const rounds = $derived(c ? (c.rounds ?? (duplicate ? duplicateRounds(teams, entrants) : swissRounds(entrants, c.sides.length))) : 0);
  const boards = $derived(c?.boards ?? BOARDS_PER_ROUND[teams ? 'teams' : 'pairs']);
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
              onchange={(e) => events.setConfig({ name: e.currentTarget.value })}
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
              <select value={c.game.id} onchange={(e) => events.setGame(e.currentTarget.value)} aria-label="Game">
                {#each games as g (g.config.id)}<option value={g.config.id}>{g.config.name}</option>{/each}
              </select>
            </label>
            <div class="opt">
              <span>Format</span>
              <span class="seg">
                {#each d.formats as f (f)}
                  <button class:on={c.format === f} onclick={() => events.setConfig({ format: f })}>{FORMAT[f]}</button>
                {/each}
              </span>
            </div>
            {#if c.format === 'swiss' || duplicate}
              <div class="opt">
                <span>Rounds</span>
                <span class="stepper">
                  <button onclick={() => events.setConfig({ rounds: Math.max(1, rounds - 1) })} aria-label="Fewer rounds">−</button>
                  <b>{rounds}</b>
                  <button onclick={() => events.setConfig({ rounds: rounds + 1 })} aria-label="More rounds">+</button>
                </span>
              </div>
            {/if}
            {#if mtt}
              <div class="opt">
                <span>Seats a table</span>
                <span class="stepper">
                  <button onclick={() => events.setConfig({ seats: c.seats - 1 })} aria-label="Fewer seats">−</button>
                  <b>{c.seats}</b>
                  <button onclick={() => events.setConfig({ seats: c.seats + 1 })} aria-label="More seats">+</button>
                </span>
              </div>
              <div class="opt">
                <span>Minutes a blind level</span>
                <span class="stepper">
                  <button onclick={() => events.setConfig({ minutes: (c.minutes ?? LEVEL_MINUTES) - 1 })} aria-label="Shorter levels">−</button>
                  <b>{c.minutes ?? LEVEL_MINUTES}</b>
                  <button onclick={() => events.setConfig({ minutes: (c.minutes ?? LEVEL_MINUTES) + 1 })} aria-label="Longer levels">+</button>
                </span>
              </div>
            {/if}
            {#if duplicate}
              <div class="opt">
                <span>Boards a round</span>
                <span class="stepper">
                  <button onclick={() => events.setConfig({ boards: Math.max(1, boards - 1) })} aria-label="Fewer boards">−</button>
                  <b>{boards}</b>
                  <button onclick={() => events.setConfig({ boards: boards + 1 })} aria-label="More boards">+</button>
                </span>
              </div>
            {/if}
            {#if c.format === 'knockout' && c.sides.length > 2}
              <div class="opt">
                <span>Through from each table</span>
                <span class="seg">
                  {#each [1, 2] as n (n)}<button class:on={(c.advance ?? 1) === n} onclick={() => events.setConfig({ advance: n })}>{n}</button>{/each}
                </span>
              </div>
            {/if}
            {#each (game.config.options ?? []).filter((o) => !d.fixed.includes(o.id)) as o (o.id)}
              <div class="opt">
                <span>{o.label}</span>
                {#if o.choices}
                  <span class="seg">
                    {#each o.choices as ch, i (ch)}
                      <button class:on={Number(c.game.options[o.id]) === i} onclick={() => events.setConfig({ option: { id: o.id, value: i } })}>{ch}</button>
                    {/each}
                  </span>
                {:else if o.type === 'number'}
                  <span class="stepper">
                    <button
                      onclick={() => events.setConfig({ option: { id: o.id, value: Math.max(o.min ?? 0, Number(c.game.options[o.id]) - (o.step ?? 1)) } })}
                      >−</button
                    >
                    <b>{c.game.options[o.id]}</b>
                    <button
                      onclick={() => events.setConfig({ option: { id: o.id, value: Math.min(o.max ?? 1e9, Number(c.game.options[o.id]) + (o.step ?? 1)) } })}
                      >+</button
                    >
                  </span>
                {:else}
                  <input
                    type="checkbox"
                    checked={!!c.game.options[o.id]}
                    onchange={(e) => events.setConfig({ option: { id: o.id, value: e.currentTarget.checked } })}
                  />
                {/if}
              </div>
            {/each}
            <div class="opt">
              <span>Tables hosted on</span>
              <span class="seg">
                <button class:on={c.host !== 'director'} onclick={() => events.setConfig({ host: 'player' })}>Players’ phones</button>
                <button class:on={c.host === 'director'} onclick={() => events.setConfig({ host: 'director' })}>This device</button>
              </span>
            </div>
            <p class="small">
              {#if mtt}
                Everyone starts with the same chips at tables drawn at random; the blinds go up every {c.minutes ?? LEVEL_MINUTES} minutes. As players go out the
                tables are kept even and broken up, down to the final table.
              {:else if teams}
                Teams of four: two pairs, one North–South at one table, the other East–West at another, on the same boards; won on IMPs.
              {:else if duplicate}
                Every table plays the same boards; each pair's score is compared with everyone's sitting their way, in matchpoints.
              {:else}
                {c.seats} at a table{pairs ? ', in pairs' : ''}.
              {/if}
              {#if c.host === 'director'}
                Every table is hosted here: keep this device awake and plugged in.{onPhone
                  ? ' A laptop is better: a phone that sleeps stops every table at once.'
                  : ''}
              {:else}
                Each table is hosted by one of its players' phones (here, if that phone goes quiet); a table of bots, by this device.
              {/if}
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
                    <select value={p.partner ?? ''} onchange={(e) => events.pair(p.id, e.currentTarget.value || null)} aria-label={`${p.name}'s partner`}>
                      <option value="">No partner yet</option>
                      {#each d.people.filter((q) => q.id !== p.id && !q.bot) as q (q.id)}<option value={q.id}>{q.name}</option>{/each}
                    </select>
                  {/if}
                  {#if teams && !p.bot}
                    <select value={p.team ?? ''} onchange={(e) => events.team(p.id, e.currentTarget.value || null)} aria-label={`${p.name}'s team`}>
                      <option value="">Any team</option>
                      {#each d.people.filter((q) => !q.bot && !pairOf(p.id).includes(q.id)) as q (q.id)}<option value={q.id}>With {q.name}</option>{/each}
                    </select>
                  {/if}
                  <button class="x" onclick={() => events.remove(p.id)} aria-label={`Remove ${p.name}`}>×</button>
                </li>
              {/each}
            </ul>
            {#if error}<p class="warn-text">{error}</p>{/if}
            <div class="row">
              <button class="btn" onclick={() => events.addBot()}>Add a bot</button>
              <button class="btn primary big" disabled={d.people.length < 2} onclick={start}>Start the tournament</button>
            </div>
          </section>
        </div>
      {:else}
        <section class="status">
          <div>
            <span class="eyebrow"
              >{board.phase === 'done'
                ? 'Final standings'
                : board.mtt
                  ? `Level ${board.mtt.level + 1}`
                  : `Round ${board.round}${board.rounds ? ` of ${board.rounds}` : ''}`}</span
            >
            <p>
              {#if board.phase === 'playing' && board.mtt}
                {board.mtt.left} of {board.mtt.of} left, at {board.tables.length} table{board.tables.length === 1 ? '' : 's'} · blinds {board.mtt.blinds
                  .sb}/{board.mtt.blinds.bb}{board.mtt.blinds.ante ? ` · ante ${board.mtt.blinds.ante}` : ''}
              {:else if board.phase === 'playing'}
                {board.tables.filter((t) => t.done).length} of {board.tables.length} tables done
              {:else if board.phase === 'between'}
                Every table's done. {d.holding ? 'Held: the next round waits for you.' : 'The next round starts shortly.'}
              {:else}
                That's the tournament.
              {/if}
            </p>
          </div>
          <div class="row">
            {#if board.phase === 'between'}
              <button class="btn primary" onclick={() => events.advance()}
                >{board.format === 'swiss' && board.round === board.rounds ? 'Finish' : 'Next round now'}</button
              >
              <button class="btn" onclick={() => events.hold(!d.holding)}>{d.holding ? 'Carry on' : 'Hold'}</button>
            {:else if board.phase === 'done'}
              <button
                class="btn"
                onclick={() => {
                  events.endDirecting(true);
                  app.go('/');
                }}>Close the tournament</button
              >
            {/if}
            {#if duplicate && board.phase !== 'playing'}
              <button class="btn" onclick={() => events.saveResults()} title="Every board's results, and the standings, as PBN (bridge programs read it)"
                >Save the results</button
              >
            {/if}
          </div>
        </section>
        <div class="opt shows">
          <span>Screens show</span>
          <span class="seg">
            {#each SHOWS.filter((x) => (x.id !== 'bracket' || board.bracket) && (x.id !== 'travellers' || board.travellers) && (board.phase !== 'done' || !['tables', 'live'].includes(x.id))) as x (x.id)}
              <button class:on={d.show === x.id} onclick={() => events.show(x.id)}>{x.label}</button>
            {/each}
          </span>
        </div>
        {#if board.phase !== 'done'}
          <EventTiles tables={board.tables} tiles={d.tiles} {names} pinned={d.pinned} showing={d.featured} onfeature={(t) => events.feature(t)} />
          {#if board.byes.length}<p class="small">Bye this round: {board.byes.map((b) => names.get(b) ?? b).join(', ')}</p>{/if}
        {/if}
        <div class="cols">
          <section>
            <EventStandings rows={board.standings} people={d.people} knockout={board.format === 'knockout'} units={board.units} />
          </section>
          {#if board.bracket}<section><EventBracket bracket={board.bracket} {names} /></section>{/if}
        </div>
        {#if board.travellers?.length}
          <section class="travellers" aria-label="Travellers">
            {#each board.travellers as t (t.n)}<EventTraveller {t} {names} hands={false} />{/each}
          </section>
        {/if}
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
  .cols,
  .travellers {
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
