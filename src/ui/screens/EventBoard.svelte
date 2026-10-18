<script lang="ts">
  import type { Snippet } from 'svelte';
  import { inviteUrl } from '../../app.svelte';
  import type { EventPublic } from '../../engine/events';
  import { getGame } from '../../games';
  import type { BoardShow, EventPerson, TableTile } from '../../net/eventProtocol';
  import type { View } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import EventBracket from '../components/EventBracket.svelte';
  import EventStandings from '../components/EventStandings.svelte';
  import EventTiles from '../components/EventTiles.svelte';
  import EventTraveller from '../components/EventTraveller.svelte';
  import Loader from '../components/Loader.svelte';
  import { BOARD_PAD_X_REM, BOARD_TURN_MS, boardRem, CLOCK_EVERY_MS, standingsRows, TILE_GAP_REM, TRAVELLER_REM, travellerColumns } from '../layout/event';

  /**
   * A tournament on a big screen (a TV, the director's laptop): while people sign up, the code to
   * join and who's in; then what the director chooses: turn about, the round's tables, the
   * standings, and the bracket (a knockout) or the travellers of the boards every table has played
   * (duplicate), or just one of them, or the tables live, one after another (and any table the
   * director picks, live); at the end, the final standings.
   */
  interface Props {
    code: string;
    board: EventPublic | null;
    people: EventPerson[];
    tiles: { table: number; tile: TableTile | null; linked?: boolean }[];
    live: { table: number; view: View } | null;
    show: BoardShow;
    /** The director's own screen: a way back to the desk. */
    onclose?: () => void;
    /** A bar along the bottom (a standby director's), kept clear of what the board shows. */
    bar?: Snippet;
  }
  let { code, board, people, tiles, live, show, onclose, bar }: Props = $props();

  let w = $state(innerWidth);
  let h = $state(innerHeight);
  const rem = $derived(boardRem(w, h));

  const names = $derived(new Map((board?.entrants ?? []).map((x) => [x.id, x.name])));
  const game = $derived(board ? getGame(board.game.id) : null);
  const knockout = $derived(board?.format === 'knockout');
  const FORMAT: Record<string, string> = {
    swiss: 'Swiss',
    roundRobin: 'Round robin',
    knockout: 'Knockout',
    pairs: 'Pairs',
    teams: 'Teams',
    mtt: 'Multi-table',
  };

  // poker: the blinds, and how long until they go up (the minutes, checked now and then while it plays)
  const mtt = $derived(board?.phase === 'playing' ? (board.mtt ?? null) : null);
  let now = $state(Date.now());
  $effect(() => {
    if (!mtt) return;
    const t = setInterval(() => (now = Date.now()), CLOCK_EVERY_MS);
    return () => clearInterval(t);
  });
  const blinds = (b: { sb: number; bb: number; ante?: number }) => `${b.sb}/${b.bb}${b.ante ? ` · ante ${b.ante}` : ''}`;
  const minutesLeft = $derived(mtt?.levelEnds ? Math.max(0, Math.ceil((mtt.levelEnds - now) / 60_000)) : null);
  /** Duplicate: the latest boards every table has played, as many as fit across. */
  const travellers = $derived((board?.travellers ?? []).slice(-travellerColumns(w - 2 * BOARD_PAD_X_REM * rem, rem)));

  // the views it turns between (a timer only while there's more than one)
  type Showing = 'join' | 'tables' | 'standings' | 'bracket' | 'travellers' | 'live';
  const views = $derived.by((): Showing[] => {
    if (!board || board.phase === 'registering') return ['join'];
    const extra: Showing[] = knockout ? ['bracket'] : travellers.length ? ['travellers'] : [];
    const overview: Showing[] = ['tables', 'standings', ...extra];
    if (board.phase === 'done')
      return show === 'bracket' || show === 'travellers'
        ? extra.length
          ? extra
          : ['standings']
        : show === 'standings'
          ? ['standings']
          : ['standings', ...extra];
    // (a table live, when there is one: the director picked it, or the screens show the tables live)
    if (show === 'live') return live ? ['live'] : ['tables'];
    if (show === 'turn') return [...(live ? (['live'] as const) : []), ...overview];
    if (live) return ['live'];
    return [(show === 'bracket' || show === 'travellers') && !extra.includes(show) ? 'tables' : show];
  });
  let turn = $state(0);
  $effect(() => {
    if (views.length < 2) return;
    const t = setInterval(() => (turn = turn + 1), BOARD_TURN_MS);
    return () => clearInterval(t);
  });
  const showing = $derived(views[turn % views.length]);

  // (the board's type follows the screen: everything on it is in rem; a table live sizes itself, as on any table screen)
  $effect(() => {
    document.documentElement.style.fontSize = showing === 'live' ? '' : `${rem}px`;
    return () => (document.documentElement.style.fontSize = '');
  });

  let qr = $state('');
  $effect(() => {
    const url = inviteUrl(code);
    import('qrcode')
      .then((QR) => QR.toDataURL(url, { margin: 1, width: 480, color: { dark: '#0b2a21', light: '#fbf8f1' } }))
      .then((d) => (qr = d))
      .catch(() => {});
  });

  // a featured table, on the table screen's own layout
  const tableP = import('./Table.svelte');
</script>

<svelte:window bind:innerWidth={w} bind:innerHeight={h} />

{#if showing === 'live' && live}
  <div class="live">
    {#await tableP then m}<m.default view={live.view} display={true} replay={null} watching={true} />{/await}
    <div class="live-head panel">
      <span
        ><b>Table {live.table}</b> · {board?.name}{#if mtt}
          · blinds {blinds(mtt.blinds)}{/if}</span
      >
      {#if onclose}<button class="btn quiet" onclick={onclose}>Back to the desk</button>{/if}
    </div>
    {#if bar}<div class="live-bar">{@render bar()}</div>{/if}
  </div>
{:else}
  <main class="board" style:padding-inline="{BOARD_PAD_X_REM}rem">
    <header>
      <div class="title">
        <span class="eyebrow">{game?.config.name ?? ''} · {board ? FORMAT[board.format] : ''}</span>
        <h1>{board?.name ?? 'Tournament'}</h1>
      </div>
      <div class="round">
        {#if mtt}
          <span class="eyebrow">Level {mtt.level + 1} · blinds {blinds(mtt.blinds)}</span>
          <span class="small"
            >{mtt.left} of {mtt.of} left · average {mtt.average}{minutesLeft != null
              ? ` · ${blinds(mtt.next)} in ${minutesLeft} min${minutesLeft === 1 ? '' : 's'}`
              : ''}</span
          >
        {:else if board && board.phase !== 'registering'}
          <span class="eyebrow">{board.phase === 'done' ? 'Final' : `Round ${board.round}${board.rounds ? ` of ${board.rounds}` : ''}`}</span>
          <span class="small"
            >{board.phase === 'between'
              ? 'Next round shortly'
              : board.phase === 'playing'
                ? `${board.tables.filter((t) => !t.done).length} tables playing`
                : ''}</span
          >
        {/if}
      </div>
      <div class="join-code" aria-label={`Code ${code}`}>
        <span class="eyebrow">Join</span>
        <span class="code">{code}</span>
      </div>
      {#if onclose}<button class="btn quiet" onclick={onclose}>Back to the desk</button>{/if}
    </header>

    {#if !board}
      <div class="wait">
        <Loader size={48} />
        <p>Finding the tournament…</p>
      </div>
    {:else if showing === 'join'}
      <section class="signup">
        <div class="how panel">
          {#if qr}<img src={qr} alt="QR code to sign up" />{:else}<div class="qr-space"></div>{/if}
          <p>Scan, or open <b>lamplight.cards</b> and enter <b class="code-inline">{code}</b></p>
        </div>
        <div class="people">
          <span class="eyebrow">Signed up · {people.length}</span>
          <ul>
            {#each people as p (p.id)}
              <li><AvatarBadge avatar={p.avatar} name={p.name} size={Math.round(rem * 2)} /><span>{p.name}</span></li>
            {/each}
          </ul>
        </div>
      </section>
    {:else if showing === 'tables'}
      <EventTiles tables={board.tables} {tiles} {names} />
      {#if board.byes.length}<p class="byes">Bye this round: {board.byes.map((b) => names.get(b) ?? b).join(', ')}</p>{/if}
    {:else if showing === 'standings'}
      <EventStandings rows={board.standings} {people} {knockout} units={board.units} max={standingsRows(h - 8 * rem, rem)} />
    {:else if showing === 'bracket' && board.bracket}
      <EventBracket bracket={board.bracket} {names} />
    {:else if showing === 'travellers'}
      <div class="travellers" style:--traveller="{TRAVELLER_REM}rem" style:--gap="{TILE_GAP_REM}rem">
        {#each travellers as t (t.n)}<EventTraveller {t} {names} />{/each}
      </div>
    {/if}
    {#if bar}<div class="bar">{@render bar()}</div>{/if}
  </main>
{/if}

<style>
  .board {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding-block: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: var(--felt);
  }
  header {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: end;
    gap: 1.4rem;
  }
  h1 {
    margin: 0.1rem 0 0;
    font-family: var(--font-card);
    font-size: 2rem;
    line-height: 1.1;
  }
  .round {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .join-code {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .code {
    font-family: var(--font-card);
    font-size: 1.6rem;
    letter-spacing: 0.18em;
    color: var(--gold);
  }
  .wait {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    color: var(--ink-dim);
  }
  .travellers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--traveller)), 1fr));
    gap: var(--gap);
    align-items: start;
  }
  .signup {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(12rem, 22rem) 1fr;
    gap: 1.6rem;
    align-items: start;
  }
  .how {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    text-align: center;
  }
  .how img,
  .qr-space {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 0.6rem;
  }
  .how p {
    margin: 0;
    color: var(--ink-dim);
  }
  .code-inline {
    color: var(--gold);
    letter-spacing: 0.12em;
  }
  .people ul {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.5rem;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 600;
    min-width: 0;
  }
  .people li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .byes {
    margin: 0;
    color: var(--ink-dim);
  }
  .live {
    position: absolute;
    inset: 0;
  }
  /* (in a corner: the table's seats are along its edges, middles first) */
  .live-head {
    position: absolute;
    left: 0.8rem;
    bottom: 0.8rem;
    padding: 0.3rem 0.9rem;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    white-space: nowrap;
  }
  /* (at the end of the board, and at the bottom of the screen as it scrolls: never over what it shows at the end) */
  .bar {
    margin-top: auto;
    position: sticky;
    bottom: 0;
    align-self: flex-end;
    max-width: 100%;
    z-index: 2;
  }
  .live-bar {
    position: absolute;
    right: 0.8rem;
    bottom: 0.8rem;
    z-index: 30;
    max-width: calc(100% - 1.6rem);
  }
  @media (orientation: portrait), (max-width: 620px) {
    header {
      grid-template-columns: 1fr auto;
    }
    .signup {
      grid-template-columns: 1fr;
    }
  }
</style>
