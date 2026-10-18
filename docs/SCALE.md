# How big a tournament runs well

A tournament is run by one device, the director's (usually a laptop), with each table hosted on
one of its players' phones or on the director's device, and everything passing through our relay.
This page says how many tables that carries, as measured, what was changed because of it, and what
would need changing for more.

**In short:** a laptop directs 64 tables (256 players at four a table, 576 at nine), wherever the
tables are hosted. With the tables on players' phones it hardly notices them. With them on itself,
it's busy an eighth to a fifth of the time at bots' pace (a third, for poker, while every table is
full), and pauses for 0.4 seconds at worst.
What sets the limit first is the venue rather than the director: its Wi-Fi, and how many new
connections the relay allows from one address (every phone joins its next table at once).

## How it's measured

`pnpm load` (tests/load.bench.test.ts) runs a whole tournament in one process, as many devices:

- the director, as the app runs it: its desk, its own screen's figures after every change, and its
  save soon after;
- a TV showing the event;
- a phone for every player, each the app's own code: signing up, following its moves, hosting a
  table or sitting at one.

The network is in memory, but behaves as our relay does (relay/src/index.ts): a room holds 24, and
a full room turns a phone away until it tries again (as the relay transport does, half a second
later, then a second, two, and so on); whatever one connection sends beyond 120 messages or 1 MB in
a second is dropped, and so is a room's beyond 4 MB.

Players arrive over five minutes and sign up. Then every table makes a move a second, bots playing
every seat: busier than people play. Each device's time is counted on its own, as if it were its
own machine; the bots' thinking is counted apart (in the app it's in a worker, off the page).

The formats:

- **Swiss, tables on phones:** Hearts to 50, two rounds, each table hosted on one of its players'
  phones (the default for Swiss, round robin and knockout).
- **Swiss, tables on the director:** the same with every table on the director's device.
- **Duplicate pairs:** bridge, two rounds of three boards, tables on the director's device (the
  default for duplicate: nobody at the venue holds boards being played at other tables).
- **Poker (MTT):** Hold'em, nine a table, 30 big blinds each, the blinds up every four minutes, its
  first 40 minutes: players knocked out, tables balanced and broken, players moving between them.
  Tables on the director's device.

Measured on a 4-core cloud machine, a little slower than a recent laptop. A phone directing would be
three to five times slower again.

`FORMATS=mtt TABLES=16 MINUTES=5 pnpm load` runs one; `PROFILE=1` saves a CPU profile of each run
(open it in Chrome's DevTools).

## Results

What the columns mean:

- **Director busy:** its share of the time spent working (the rest it's idle).
- **Busiest second:** its work in the busiest second (over 1000 ms: behind for a moment).
- **Longest task:** the longest it's blocked at once (over about 100 ms, its screen stutters).
- **A move:** its time for each move made anywhere, all its work counted.
- **Save:** what it keeps in the browser's storage (about 5 MB is allowed).
- **Standby copy:** its sealed copy for a standby director (up to 480 KB).
- **Busiest connection:** the most one of the director's connections sent in a second (the relay
  passes on 120 messages and 1 MB).
- **Turned away:** a phone finding a room full, and the longest anyone waited to get in.
- **Connections in a minute:** the most opened from the venue's one address in any minute (the relay
  allows 2000).
- **Longest to a table:** from a round's seating to the last player at their table.

Nothing was dropped in any of them, and every player was at their table within two seconds of a round's seating.

### Swiss, tables on phones

| Tables | Players | Director busy | Busiest second | Longest task | A move |  Save | Standby copy |
| -----: | ------: | ------------: | -------------: | -----------: | -----: | ----: | -----------: |
|      4 |      16 |          0.0% |           8 ms |         7 ms | 0.1 ms |  5 KB |         2 KB |
|      8 |      32 |          0.1% |           6 ms |         4 ms | 0.1 ms | 10 KB |         4 KB |
|     16 |      64 |          0.1% |          20 ms |         7 ms | 0.1 ms | 19 KB |         7 KB |
|     32 |     128 |          0.2% |         155 ms |        74 ms | 0.1 ms | 37 KB |        13 KB |
|     64 |     256 |          0.7% |         167 ms |        29 ms | 0.2 ms | 75 KB |        26 KB |

| Tables | Messages a second | Busiest connection | Dropped | Peers in a room | Turned away (longest wait) | Connections in a minute | Longest to a table |
| -----: | ----------------: | -----------------: | ------: | --------------: | -------------------------: | ----------------------: | -----------------: |
|      4 |      18 (18 KB/s) |      38/s, 29 KB/s |       0 |              13 |                    0 (0 s) |                      28 |                1 s |
|      8 |      34 (32 KB/s) |      46/s, 29 KB/s |       0 |              24 |                    5 (1 s) |                      63 |                1 s |
|     16 |      60 (53 KB/s) |      70/s, 30 KB/s |       0 |              24 |                   12 (1 s) |                     132 |                1 s |
|     32 |    138 (124 KB/s) |      84/s, 30 KB/s |       0 |              24 |                   25 (1 s) |                     256 |                1 s |
|     64 |    260 (217 KB/s) |     100/s, 62 KB/s |       0 |              24 |                  103 (2 s) |                     571 |                1 s |

### Swiss, tables on the director

| Tables | Players | Director busy | Busiest second | Longest task | A move |   Save | Standby copy |
| -----: | ------: | ------------: | -------------: | -----------: | -----: | -----: | -----------: |
|      4 |      16 |          0.9% |          31 ms |        24 ms | 3.1 ms |  37 KB |         2 KB |
|      8 |      32 |          1.5% |          60 ms |        24 ms | 2.9 ms |  73 KB |         4 KB |
|     16 |      64 |          3.0% |          94 ms |        27 ms | 2.8 ms | 147 KB |         7 KB |
|     32 |     128 |          4.5% |         184 ms |        48 ms | 2.9 ms | 293 KB |        13 KB |
|     64 |     256 |         12.0% |         467 ms |        39 ms | 3.1 ms | 590 KB |        26 KB |

| Tables | Messages a second | Busiest connection | Dropped | Peers in a room | Turned away (longest wait) | Connections in a minute | Longest to a table |
| -----: | ----------------: | -----------------: | ------: | --------------: | -------------------------: | ----------------------: | -----------------: |
|      4 |       16 (9 KB/s) |      19/s, 39 KB/s |       0 |              12 |                    0 (0 s) |                      26 |                1 s |
|      8 |      29 (15 KB/s) |      40/s, 39 KB/s |       0 |              21 |                    0 (0 s) |                      53 |                1 s |
|     16 |      63 (33 KB/s) |      40/s, 39 KB/s |       0 |              21 |                    0 (0 s) |                     104 |                1 s |
|     32 |     101 (48 KB/s) |      40/s, 39 KB/s |       0 |              21 |                    0 (0 s) |                     211 |                1 s |
|     64 |    247 (117 KB/s) |      40/s, 57 KB/s |       0 |              21 |                    0 (0 s) |                     424 |                1 s |

### Duplicate pairs

| Tables | Players | Director busy | Busiest second | Longest task | A move |   Save | Standby copy |
| -----: | ------: | ------------: | -------------: | -----------: | -----: | -----: | -----------: |
|      4 |      16 |          1.3% |          52 ms |        35 ms | 3.7 ms |  55 KB |         3 KB |
|      8 |      32 |          2.6% |          61 ms |        30 ms | 3.7 ms | 110 KB |         5 KB |
|     16 |      64 |          5.0% |         122 ms |        29 ms | 3.6 ms | 218 KB |         8 KB |
|     32 |     128 |          9.9% |         332 ms |        32 ms | 3.5 ms | 440 KB |        15 KB |
|     64 |     256 |         21.1% |         653 ms |        76 ms | 3.7 ms | 876 KB |        28 KB |

| Tables | Messages a second | Busiest connection | Dropped | Peers in a room | Turned away (longest wait) | Connections in a minute | Longest to a table |
| -----: | ----------------: | -----------------: | ------: | --------------: | -------------------------: | ----------------------: | -----------------: |
|      4 |      19 (12 KB/s) |      19/s, 43 KB/s |       0 |              12 |                    0 (0 s) |                      26 |                1 s |
|      8 |      38 (23 KB/s) |      40/s, 43 KB/s |       0 |              21 |                    0 (0 s) |                      53 |                1 s |
|     16 |      79 (48 KB/s) |      40/s, 43 KB/s |       0 |              21 |                    0 (0 s) |                     104 |                1 s |
|     32 |     165 (94 KB/s) |      40/s, 43 KB/s |       0 |              21 |                    0 (0 s) |                     211 |                1 s |
|     64 |    366 (191 KB/s) |      40/s, 43 KB/s |       0 |              21 |                    0 (0 s) |                     424 |                1 s |

### Poker (MTT)

| Tables | Players | Director busy | Busiest second | Longest task | A move |   Save | Standby copy |
| -----: | ------: | ------------: | -------------: | -----------: | -----: | -----: | -----------: |
|      4 |      36 |          0.8% |          88 ms |        43 ms | 5.8 ms |  52 KB |        11 KB |
|      8 |      72 |          1.3% |         147 ms |        73 ms | 6.2 ms | 108 KB |        16 KB |
|     16 |     144 |          2.9% |         351 ms |       159 ms | 7.4 ms | 229 KB |        30 KB |
|     32 |     288 |          5.3% |         626 ms |       181 ms | 7.8 ms | 469 KB |        53 KB |
|     64 |     576 |         12.5% |        1232 ms |       394 ms | 9.6 ms | 963 KB |       113 KB |

| Tables | Messages a second | Busiest connection | Dropped | Peers in a room | Turned away (longest wait) | Connections in a minute | Longest to a table |
| -----: | ----------------: | -----------------: | ------: | --------------: | -------------------------: | ----------------------: | -----------------: |
|      4 |      16 (11 KB/s) |     57/s, 104 KB/s |       0 |              21 |                    0 (0 s) |                      65 |                1 s |
|      8 |      29 (21 KB/s) |     58/s, 104 KB/s |       0 |              21 |                    0 (0 s) |                     119 |                1 s |
|     16 |      69 (65 KB/s) |     65/s, 255 KB/s |       0 |              21 |                    0 (0 s) |                     236 |                1 s |
|     32 |    159 (248 KB/s) |     78/s, 614 KB/s |       0 |              21 |                    0 (0 s) |                     527 |                2 s |
|     64 |    363 (1.2 MB/s) |     80/s, 773 KB/s |       0 |              22 |                    0 (0 s) |                    1201 |                2 s |

## What the numbers showed, and what changed

The first runs, at 64 tables, found these. Each is fixed, and each has a test.

1. **Everyone's place, on every table's news.** When a table reported a hand or a result, every
   phone was told its place there and then, and each telling worked out the whole standings again.
   At a round's end, with 64 tables finishing together, the director did 11 seconds' work in one
   second, and the relay dropped thousands of those messages for coming too fast. Places now go out
   on the board's half-second beat, the standings worked out once for everyone.
2. **The whole board, on every change.** Phones waiting at the event (a bye, knocked out of the
   poker) and the screens were sent the whole board each time anything changed: in the poker, after
   every hand at every table, the board with all 576 players' standings. That was 7.9 MB a second,
   and 76,000 messages dropped. They're now sent what changed (`evBoardPatch`), and a device whose
   board doesn't fit the change (one that missed a message) asks for the whole board again.
3. **The front door was full.** The event's own room is everyone's way in: signing up, finding
   your table after a reload, a table's host linking up each round. It filled with the first twenty
   to sign up, so the relay turned away whoever came next until a place came free. It now keeps
   room, sending newcomers on to the event's other rooms once it holds ten, and a table's host links
   up through the room its own phone is in.
4. **Too much at once from one connection.** A round's moves and everyone's places go out together
   to a room of twenty phones, and a dozen players knocked out at once each get the whole board:
   over the relay's rates, so the rest were dropped. The director's connections are now paced
   (src/net/director/pacer.ts): at most 100 messages and 800 KB in any second, the rest waiting
   their turn, in order.
5. **Every table's tile, at every change.** Each change anywhere asked every table for its tile, and
   a tile worked out the table's whole status: at a poker showdown, every shown hand named again,
   at 64 tables. A table's tile is now worked out once a change at that table: a third less of the
   director's time at 64 poker tables.
6. **Connections from one address.** A round's change opens about one connection a player (to
   their next table) and one for each table's host (its link to the director), all from the venue's
   one address. The relay allowed 120 a minute, to slow anyone trying table codes. 64 tables of nine
   starting just after the last of them signed up open about 1200 in a minute, so it's 2000 a minute
   now (relay/wrangler.jsonc).

A smaller one: a table hosted on the director made each player's view as JSON twice, once to send
and once to measure. It's made once now, which took a sixth off the director's time for each move
of the poker.

## Practical limits

- **Tables on players' phones** (Swiss, round robin, knockout, by default): the director does
  little. At 64 tables it's busy under 1% of the time, and a table's host phone a fraction of 1%.
- **Tables on the director's device** (duplicate and poker by default, or by choice): each move at
  one of them costs the director a few milliseconds here: about 3 for four players, 8 for nine.
  At 64 tables each making a move a second, a laptop is busy an eighth to a fifth (Hearts, bridge) to a third
  (poker, while every table is full) of the time; people play slower than that. It pauses for up to
  0.4 seconds when poker tables are re-seated. A phone directing should keep to 16 or so
  tables on itself, and leave the rest on players' phones.
- **The save** is under 1 MB at 64 tables on the director (each table's game is in it). The browser
  allows about 5 MB, so a few hundred tables would fit.
- **The standby's copy**, sealed and compressed, is a fraction of the save: at most about 110 KB at
  64 poker tables, under its 480 KB.
- **The relay:** 24 to a room (the event spreads its players over rooms of 20, keeping 10 in its own
  room for newcomers), 2000 new connections a minute from one address.
- **The venue:** every phone talks through the relay, so the Wi-Fi has to carry it all: at 64
  tables, a few hundred messages a second, and up to about 2 MB a second at the start of a big
  poker tournament (every table dealt at once).

## Not needed yet

The plan held two changes in reserve, to make if the numbers called for them. They didn't:

- **Saving to IndexedDB** rather than localStorage: the save would have to grow past a few MB, which
  is a few hundred tables on the director.
- **Tables on the director in a worker**, off the page: even at 64 tables moving at bots' pace, the
  director has two thirds of its time to spare, and its longest pause is 0.4 seconds. That
  would change at a few hundred tables on the director, or with a phone directing many.

If it ever does, the place to start is the views a table on the director makes after each move, one
for each player: they're most of its time (made as JSON, then compared with the last one sent).

For more than that, the limits are the relay's allowance of connections from one address (raise it
in relay/wrangler.jsonc), and how many people one room of Wi-Fi can carry.
