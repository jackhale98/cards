# Lamplight 🂡

**Your phone is your hand.** A fast, good-looking card table for friends in the same room.
One person hosts, everyone else scans a QR code, and each phone shows that player's hand plus
the middle of the table. It needs no accounts or app store, and there's no server to pay for.

- **Games are plain JSON config files** run by family engines (trick-taking, poker, rummy,
  canasta, climbing, cribbage, eights, blackjack, baccarat, cheat, go fish, free table). Included: Texas Hold'em, Omaha, Five Card Draw (antes, one draw; jacks-or-better option), Seven Card Stud (bring-in, up cards on the table), Blackjack (against the house: double, split, insurance), Baccarat (Punto Banco), Cheat, Go Fish, Hearts (moon shooter's choice), Spades (nil, blind nil, bags),
  Oh Hell, Gin Rummy, Rummy 500 (jokers, Rummy! calls), Canasta (may I go out?, play after the stock), President,
  Cribbage (with a pegboard; auto scoring or count-your-own with muggins), Euchre (bowers, going alone), 500 (Avondale bids, misère and open misère, kitty, joker),
  Contract Bridge (full auction, dummy, duplicate scoring with Chicago vulnerability), Whist, Crazy Eights (eights call a suit, last card, Q/A/2 specials),
  and a rules-free **Free Table** for any game.
- **Rules follow [pagat.com](https://www.pagat.com)**, with common variants as lobby options (25-point gin bonuses, defending alone in euchre, Oh Hell's short ladder…).
- **Always know what just happened:** the last move appears under the headline, pops up as a
  bubble on that player's seat, and poker seats show each player's action this street.
- **Bots** fill empty seats in every rules-enforced game; most games let the host pick **Easy / Normal / Hard**.
  In trick-taking games, Crazy Eights, President and Cribbage pegging they think ahead: they imagine the
  hidden cards many times over and play each choice out, with a hard time cap so phones stay cool.
  Poker bots estimate their real odds of winning against the pot; in Gin Hard looks a draw ahead;
  in Go Fish and Cheat difficulty is memory and card counting.
- **Sound:** a card snapping down, a deal, chips, a soft chime when it's your turn (handy with your
  phone face-down) and a fanfare at the end, all made in the browser. Mute it from the table menu.
- **The table's look:** the host picks the card backs (twelve designed decks: Classic, Lamplight,
  Crimson, Art Deco, Moon & Stars, Botanical, Tide, Rosette, Tartan, Sweater, Groovy, Bauhaus) and
  the table cloth (green baize, navy, burgundy, plum, oak, charcoal) in the lobby or mid-game; every
  phone and the TV follow. Each back is a small SVG drawn on the device: nothing to download.
- **Pick your look:** each player chooses an emoji avatar and colour, and every seat is labelled
  *your left*, *across* or *your right*.
- **Built for landscape phones:** fanned hand, tap or swipe up to play, haptics, and keeps the screen awake.
- **Table display:** put a tablet or laptop in the middle as the shared board (`Use this device as the table display`). While one is connected, phones switch to *hand mode*: a bigger hand and your own info, with only the piles you can tap right now (switch back from the menu).
- **Friends far away:** the invite link works over the internet too (through the Lamplight relay), so someone in another city can join the table live.
- **Game night:** every finished game adds to a running scoreboard for the evening (3 / 2 / 1 points for the podium, partners share), shown in the lobby, on the game-over screen and in the scores sheet. The host can start a new night.
- **Big groups:** everyone who joins gets a seat at the table, even past what the game seats. The
  host taps **In / Out** to choose who plays; the rest watch, and whoever sat out plays the next game.
  **Split the table** sends a group off to a table of their own (one of their phones hosts it) with
  tonight's scoreboard, and **Everyone back** brings them home with their games added to the tally.
- **Resilient:** a refreshed phone keeps its seat, and a refreshed host resumes the game.

## Showing the table on a TV

From the lobby (**📺 TV**) or the table menu (**Show on a TV**):

- **Any TV with a web browser** (Samsung, LG, Fire TV, a games console…): open `lamplight.cards/tv` on
  the TV. It shows a five-letter code; type it into the phone and the TV becomes the table display.
  Nobody has to type on the remote. (The pairing goes through the relay in a tiny room of its own.)
- **Chromecast / Google TV:** from Chrome on Android or a computer, tap *Cast*. The TV runs the app at
  `/?cast=1` as a Cast receiver and is told the table code over a custom channel. The receiver is
  published in the Google Cast console (App ID `221DFB34`, built into `src/net/cast.ts`); how it was
  set up, and how to test a change on your own receiver, is in [docs/CHROMECAST.md](docs/CHROMECAST.md).
- **Apple TV:** websites can't send their own picture to an Apple TV, so use Screen Mirroring from a
  spare iPad or phone that has the table open as the table display (not your own phone — it would
  show your hand).

## Contact

Found a bug, or want a game we don't have yet? Email **[contact@lamplight.cards](mailto:contact@lamplight.cards)**
(the site has "Report a bug" and "Request a game" links on the home screen, and "Report a problem" in
the table menu, which fills in the game and table for you).

Lamplight is free, with no ads and no accounts. If it makes your game nights better, you can
[buy us a beer on Ko-fi](https://ko-fi.com/lamplightcards) 🍺

## How the connection works

The site is static files (Cloudflare Pages, [lamplight.cards](https://lamplight.cards)); the
game itself runs on the host's phone. Devices find each other through the **Lamplight relay**
(`relay/`, a Cloudflare Worker with one Durable Object per table):

1. Every device opens a WebSocket to `relay.lamplight.cards` for its table code.
2. Through it, each pair of devices sets up a **direct WebRTC link** (Cloudflare's STUN server
   helps them find each other). Game messages go over the direct link whenever it's open, so on
   the same WiFi your game stays in the room.
3. If a network won't allow direct links (some hotel and guest WiFi), the relay passes the
   messages along instead. It never sees a card, and an idle table costs nothing (WebSocket
   hibernation).

As a backup, three public signalling networks via [Trystero](https://github.com/dmotz/trystero)
(Nostr, MQTT and WebTorrent trackers) stay closed while the relay works, which keeps each phone
to one connection. If the host can't reach the relay for 5 seconds it opens all of them, and a
guest adds them one by one if nobody answers through the relay. A device can be reached on several
networks at once; each view carries the host's id and version, so duplicates are ignored.

The host pings every player every 3 seconds: everyone sees each player's latency, a phone that
goes to sleep is noticed within seconds (it keeps its seat), and a guest that loses the host
rebuilds its connection automatically.

**If the host's phone dies**, the game isn't lost. Every few seconds the host sends each seated
player an encrypted backup of the whole game, and leaves only the key with the relay, so no phone
can read anyone else's cards. Once the host has been gone for 20 seconds (and stopped sending its
heartbeat), players see **Take over hosting**: the first to tap it gets the key from the relay,
opens its backup and hosts from exactly where the game was. Everyone keeps their seat, bots carry
on, and when the old host comes back it rejoins as a player in its own seat (`src/net/backup.ts`,
`takeover` in `relay/src/index.ts`).

The host's device runs the rules and is the single source of truth. Every other device sends
*intents* ("play the 7♣") and gets back a **personalised view**. Your device never receives
another player's hidden cards, so nobody can peek with dev tools.

> Bluetooth isn't used: Web Bluetooth isn't available on iOS, and browsers can't advertise as a
> Bluetooth device. An offline QR-code pairing mode is on the roadmap for the no-internet case.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # engine, rules, networking and schema tests
pnpm test:e2e     # every game dealt in a real browser at phone, laptop and TV sizes
pnpm check        # type check
pnpm build        # static site in dist/
```

**Testing multiplayer on one computer:** add `?net=local` to the URL to connect browser tabs
through a `BroadcastChannel` instead of WebRTC (`http://localhost:5173/?net=local`). Host in one
tab and join from others. Each tab is its own player.

**Testing on phones:** `pnpm dev --host`, then open the printed LAN address on each phone.

### Deploying

Cloudflare Pages builds `main` (`pnpm build` → `dist`) and serves it at
[lamplight.cards](https://lamplight.cards); every other branch gets its own preview URL. Cache
headers live in `public/_headers`. GitHub Actions (`.github/workflows/ci.yml`) type-checks, tests
and builds every push and pull request.
The site uses relative paths and hash routing, so it works under any repository name.

The relay deploys separately from `relay/` (`npx wrangler deploy`, or connect the repo in
Cloudflare with root directory `relay`). Test it locally with `npx wrangler dev` in `relay/`,
`node smoke.mjs`, and the app at `?relay=ws://127.0.0.1:8787` (`&net=relay` to skip the public
networks).

## Project layout

```
src/
  engine/     pure TypeScript: cards, seeded RNG, zones, redaction
    families/ family engines: free, trick-taking, poker, rummy, cribbage (configured by game.json)
    lib/      betting (side pots), pokerEval, trickTaking, passing, melds, cribbageScore
  games/      one folder per game: game.json (+ optional rules.ts escape hatch)
  net/      transports (WebRTC / local), authoritative Host, Client, protocol
  ui/       Svelte 5 components and screens
schemas/    JSON schema for game.json
tests/      Vitest suites
```

Adding a game is usually a single JSON file. See **[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md)**.

## Roadmap

1. ✅ Engine, Free Table, multiplayer, lobby, poker & trick-taking families, avatars
2. ✅ Rummy family (Gin), ✅ Cribbage, ✅ Euchre, ✅ 500, ✅ Contract Bridge
3. Polish: ✅ sounds, ✅ card backs and cloths (next: a back from your own photo), PWA offline install, offline QR pairing
4. Remote play (TURN fallback), leaderboards, tournaments, host migration

## License

MIT
