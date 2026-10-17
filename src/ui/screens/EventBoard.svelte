<script lang="ts">
  import { inviteUrl } from '../../app.svelte';
  import type { EventPublic } from '../../engine/events';
  import { getGame } from '../../games';
  import type { BoardShow, EventPerson, TableTile } from '../../net/eventProtocol';
  import type { View } from '../../net/protocol';
  import AvatarBadge from '../components/AvatarBadge.svelte';
  import EventBracket from '../components/EventBracket.svelte';
  import EventStandings from '../components/EventStandings.svelte';
  import EventTiles from '../components/EventTiles.svelte';
  import Loader from '../components/Loader.svelte';
  import { BOARD_TURN_MS, boardRem, standingsRows } from '../layout/event';

  /**
   * A tournament on a big screen (a TV, the director's laptop): while people sign up, the code to
   * join and who's in; then what the director chooses: turn about, the round's tables, the
   * standings and (a knockout) the bracket, or just one of them, or the tables live, one after
   * another (and any table the director picks, live); at the end, the final standings.
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
  }
  let { code, board, people, tiles, live, show, onclose }: Props = $props();

  let w = $state(innerWidth);
  let h = $state(innerHeight);
  const rem = $derived(boardRem(w, h));

  const names = $derived(new Map((board?.entrants ?? []).map((x) => [x.id, x.name])));
  const game = $derived(board ? getGame(board.game.id) : null);
  const knockout = $derived(board?.format === 'knockout');
  const FORMAT: Record<string, string> = { swiss: 'Swiss', roundRobin: 'Round robin', knockout: 'Knockout' };

  // the views it turns between (a timer only while there's more than one)
  type Showing = 'join' | 'tables' | 'standings' | 'bracket' | 'live';
  const views = $derived.by((): Showing[] => {
    if (!board || board.phase === 'registering') return ['join'];
    const overview: Showing[] = ['tables', 'standings', ...(knockout ? (['bracket'] as const) : [])];
    if (board.phase === 'done')
      return show === 'bracket' && knockout ? ['bracket'] : show === 'standings' || !knockout ? ['standings'] : ['standings', 'bracket'];
    // (a table live, when there is one: the director picked it, or the screens show the tables live)
    if (show === 'live') return live ? ['live'] : ['tables'];
    if (show === 'turn') return [...(live ? (['live'] as const) : []), ...overview];
    if (live) return ['live'];
    return [show === 'bracket' && !knockout ? 'tables' : show];
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
      <span><b>Table {live.table}</b> · {board?.name}</span>
      {#if onclose}<button class="btn quiet" onclick={onclose}>Back to the desk</button>{/if}
    </div>
  </div>
{:else}
  <main class="board">
    <header>
      <div class="title">
        <span class="eyebrow">{game?.config.name ?? ''} · {board ? FORMAT[board.format] : ''}</span>
        <h1>{board?.name ?? 'Tournament'}</h1>
      </div>
      <div class="round">
        {#if board && board.phase !== 'registering'}
          <span class="eyebrow">{board.phase === 'done' ? 'Final' : `Round ${board.round}${board.rounds ? ` of ${board.rounds}` : ''}`}</span>
          <span class="small"
            >{board.phase === 'between'
              ? 'Next round shortly'
              : board.phase === 'playing'
                ? `${board.tables.filter((t) => !t.places).length} tables playing`
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
      <EventStandings rows={board.standings} {people} {knockout} max={standingsRows(h - 8 * rem, rem)} />
    {:else if showing === 'bracket' && board.bracket}
      <EventBracket bracket={board.bracket} {names} />
    {/if}
  </main>
{/if}

<style>
  .board {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 1.2rem 1.6rem;
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
  @media (orientation: portrait), (max-width: 620px) {
    header {
      grid-template-columns: 1fr auto;
    }
    .signup {
      grid-template-columns: 1fr;
    }
  }
</style>
