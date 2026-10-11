# Cards 🂡

**Your phone is your hand.** A fast, good-looking card table for friends in the same room.
One person hosts, everyone else scans a QR code, and each phone shows that player's hand plus
the middle of the table. It needs no accounts or app store, and there's no server to pay for.

- **Games are plain JSON config files** run by family engines (trick-taking, poker, rummy, free
  table). Included: Texas Hold'em, Omaha, Hearts, Spades, Oh Hell, Gin Rummy, Crazy Eights, and
  a rules-free **Free Table** for any game. Cribbage and Bridge are next.
- **Always know what just happened:** the last move appears under the headline, pops up as a
  bubble on that player's seat, and poker seats show each player's action this street.
- **Bots** fill empty seats in every rules-enforced game.
- **Pick your look:** each player chooses an emoji avatar and colour, and every seat is labelled
  *your left*, *across* or *your right*.
- **Built for landscape phones:** fanned hand, tap or swipe up to play, haptics, and keeps the screen awake.
- **Table display:** put a tablet or laptop in the middle as the shared board (`Use this device as the table display`).
- **Resilient:** a refreshed phone keeps its seat, and a refreshed host resumes the game.

## How the connection works

GitHub Pages only serves static files, so there is no game server. Devices connect **directly to
each other with WebRTC**, using [Trystero](https://github.com/dmotz/trystero). The first
"introduction" (signalling) goes through public relays. The host listens on three independent
relay networks at once (Nostr, MQTT and WebTorrent trackers); a guest starts with Nostr and adds
the others if nobody answers, so one flaky network can't stop a table forming. After that, all
game traffic flows peer-to-peer, and on the same WiFi it stays on your local network.

The host pings every player every 3 seconds: everyone sees each player's latency, a phone that
goes to sleep is noticed within seconds (it keeps its seat), and a guest that loses the host
rebuilds its connection automatically.

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
pnpm check        # type check
pnpm build        # static site in dist/
```

**Testing multiplayer on one computer:** add `?net=local` to the URL to connect browser tabs
through a `BroadcastChannel` instead of WebRTC (`http://localhost:5173/?net=local`). Host in one
tab and join from others. Each tab is its own player.

**Testing on phones:** `pnpm dev --host`, then open the printed LAN address on each phone.

### Deploying

Pushes to `main` run the tests and deploy to GitHub Pages
(`.github/workflows/deploy.yml`). One-time setup: **Settings → Pages → Source: GitHub Actions**.
The site uses relative paths and hash routing, so it works under any repository name.

## Project layout

```
src/
  engine/     pure TypeScript: cards, seeded RNG, zones, redaction
    families/ family engines: free, trick-taking, poker, rummy (configured by game.json)
    lib/      betting (side pots), pokerEval, trickTaking, passing, melds
  games/      one folder per game: game.json (+ optional rules.ts escape hatch)
  net/      transports (WebRTC / local), authoritative Host, Client, protocol
  ui/       Svelte 5 components and screens
schemas/    JSON schema for game.json
tests/      Vitest suites
```

Adding a game is usually a single JSON file. See **[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md)**.

## Roadmap

1. ✅ Engine, Free Table, multiplayer, lobby, poker & trick-taking families, avatars
2. ✅ Rummy family (Gin) · next: Rummy 500, Cribbage, Contract Bridge (auction, dummy)
3. Polish: sounds, PWA offline install, offline QR pairing, custom card backs
4. Remote play (TURN fallback), leaderboards, tournaments, host migration

## License

MIT
