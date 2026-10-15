// Smoke test for the relay protocol. Run `npx wrangler dev` here, then `node smoke.mjs`
// (or `node smoke.mjs wss://relay.lamplight.cards` against the deployed relay).
import { createHash } from 'node:crypto';
const base = (process.argv[2] ?? 'ws://127.0.0.1:8787').replace(/\/$/, '');
const room = `smoke-${Math.random().toString(36).slice(2, 8)}`;
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

function connect(peer, headers, host, at = room, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${base}/room/${at}?peer=${peer}${host ? `&host=${host}` : ''}${secret ? `&secret=${secret}` : ''}`,
      headers ? { headers } : undefined,
    );
    const inbox = [];
    ws.onmessage = (e) => inbox.push(e.data === 'pong' ? 'pong' : JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, inbox });
    ws.onerror = () => reject(new Error(`could not connect ${peer}`));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the first message `pred` matches, waiting up to 3s for it (a cold local relay can be slow to answer)
const take = async (box, pred, ms = 3000) => {
  for (const until = Date.now() + ms; ; await wait(20)) {
    const i = box.inbox.findIndex(pred);
    if (i >= 0) return box.inbox.splice(i, 1)[0];
    if (Date.now() > until) return null;
  }
};

const a = await connect('alice1');
await wait(150);
check((await take(a, (m) => m.t === 'welcome'))?.peers.length === 0, 'first device is welcomed to an empty room');
const b = await connect('bobby1');
await wait(150);
check(JSON.stringify((await take(b, (m) => m.t === 'welcome'))?.peers) === '["alice1"]', 'second device sees the first');
check((await take(a, (m) => m.t === 'join'))?.peer === 'bobby1', 'first device hears the join');
const c = await connect('carol1');
await wait(150);
await take(a, (m) => m.t === 'join');
await take(b, (m) => m.t === 'join');

a.ws.send(JSON.stringify({ to: 'bobby1', d: { hello: 1 } }));
await wait(150);
check((await take(b, (m) => m.t === 'msg'))?.d.hello === 1, 'direct message reaches its target');
check(!c.inbox.some((m) => m.t === 'msg'), '…and nobody else');

a.ws.send(JSON.stringify({ d: { all: 1 } }));
await wait(150);
check(!!(await take(b, (m) => m.t === 'msg' && m.d.all)) && !!(await take(c, (m) => m.t === 'msg' && m.d.all)), 'broadcast reaches everyone else');
check(!a.inbox.some((m) => m.t === 'msg'), '…but not the sender');

b.ws.send(JSON.stringify({ to: 'alice1', s: { sdp: 'x' } }));
await wait(150);
const sig = await take(a, (m) => m.t === 'msg');
check(sig?.s?.sdp === 'x' && sig.from === 'bobby1', 'WebRTC signals are relayed with the sender');

a.ws.send('ping');
await wait(150);
check(!!(await take(a, (m) => m === 'pong')), 'keep-alive ping gets a pong');

// bob reconnects with the same id: no leave/join noise, old socket closed
const b2 = await connect('bobby1');
await wait(250);
check(b.ws.readyState === WebSocket.CLOSED || b.ws.readyState === WebSocket.CLOSING, 'a reconnect replaces the old socket');
check(!a.inbox.some((m) => m.t === 'leave' || m.t === 'join'), '…without announcing a leave or join');
check(JSON.stringify((await take(b2, (m) => m.t === 'welcome'))?.peers.sort()) === '["alice1","carol1"]', '…and gets the current peers');

c.ws.close();
await wait(250);
check((await take(a, (m) => m.t === 'leave'))?.peer === 'carol1', 'closing announces a leave');

let refused = false;
try {
  const bad = await connect('evil01', { Origin: 'https://evil.example' });
  bad.ws.close();
} catch {
  refused = true;
}
check(refused, 'other websites are refused');
const ok = await connect('lamp01', { Origin: 'https://lamplight.cards' });
check(ok.ws.readyState === WebSocket.OPEN, 'lamplight.cards is allowed');
ok.ws.close();

a.ws.close();
b2.ws.close();

// one host per code
const table = `${room}-hosted`;
const h1 = await connect('host01', undefined, 'key-one-1234', table);
await wait(150);
check(!!(await take(h1, (m) => m.t === 'welcome')), 'a host claims a free code');
const h2 = await connect('host02', undefined, 'key-two-5678', table);
await wait(250);
check(!!(await take(h2, (m) => m.t === 'taken')) && h2.ws.readyState !== WebSocket.OPEN, 'a second host on the same code is told it is taken');
const g = await connect('guest1', undefined, undefined, table);
await wait(150);
check(JSON.stringify((await take(g, (m) => m.t === 'welcome'))?.peers) === '["host01"]', 'guests still join the first host');
h1.ws.close();
await wait(250);
const h1b = await connect('host03', undefined, 'key-one-1234', table);
await wait(150);
check(!!(await take(h1b, (m) => m.t === 'welcome')), 'the same host reconnects after a refresh');
h1b.ws.close();
await wait(250);
const h3 = await connect('host04', undefined, 'key-two-5678', table);
await wait(250);
check(!!(await take(h3, (m) => m.t === 'taken')), 'a recently gone host keeps its code for a while');
g.ws.close();

// a host whose phone is asleep: its socket still looks open, but its heartbeat (the deposit) stops
const sleepy = `${room}-asleep`;
const sh = await connect('shost1', undefined, 'sleepy-host-key', sleepy);
sh.ws.send(JSON.stringify({ k: 'deposit', key: 'c'.repeat(43), gate: createHash('sha256').update('sleepy-token').digest('hex') }));
const q1 = await connect('qplay1', undefined, undefined, sleepy);
const q2 = await connect('qplay2', undefined, undefined, sleepy);
const sleptAt = Date.now();

// host handoff: the key to the players' backups is released once the host has gone
const hand = `${room}-handoff`;
const backupKey = 'b'.repeat(43);
const token = 'players-only-token';
const hh = await connect('hhost1', undefined, 'handoff-host-key', hand);
hh.ws.send(JSON.stringify({ k: 'deposit', key: backupKey, gate: createHash('sha256').update(token).digest('hex') }));
const p1 = await connect('player1', undefined, undefined, hand);
const p2 = await connect('player2', undefined, undefined, hand);
await wait(200);
const ask = async (box, host, tok = token) => {
  box.ws.send(JSON.stringify({ k: 'takeover', host, token: tok }));
  await wait(250);
  return await take(box, (m) => m.t === 'takeover');
};
check((await ask(p1, 'taker-key-0001'))?.error === 'host-here', 'no takeover while the host is here');
hh.ws.close();
await wait(250);
check((await ask(p1, 'taker-key-0001'))?.error === 'too-soon', 'no takeover the moment the host leaves');
console.log('  (waiting 21s for the takeover window…)');
await wait(21_000);
check((await ask(p1, 'taker-key-0001', 'a-guess'))?.error === 'not-a-player', 'a device without the players’ token is refused');
check((await ask(p1, 'taker-key-0001'))?.key === backupKey, 'after a while, a player gets the backup key');
check((await ask(p2, 'taker-key-0002'))?.error === 'no-backup', 'only one player gets it');
const back = await connect('hhost2', undefined, 'handoff-host-key', hand);
await wait(250);
check(!!(await take(back, (m) => m.t === 'taken')), 'the old host coming back is told the table has moved');
const nh = await connect('nhost1', undefined, 'taker-key-0001', hand);
await wait(250);
check(!!(await take(nh, (m) => m.t === 'welcome')), 'the player who took over hosts the code');
for (const x of [p1, p2, nh]) x.ws.close();

console.log('  (waiting for the sleeping host to go quiet…)');
await wait(Math.max(0, 41_000 - (Date.now() - sleptAt)));
// two players ask at the same moment: one gets the key, the other is told someone beat them to it
for (const [box, key] of [
  [q1, 'sleepy-taker-01'],
  [q2, 'sleepy-taker-02'],
])
  box.ws.send(JSON.stringify({ k: 'takeover', host: key, token: 'sleepy-token' }));
await wait(400);
const answers = [await take(q1, (m) => m.t === 'takeover'), await take(q2, (m) => m.t === 'takeover')];
check(
  answers.filter((a) => a?.key).length === 1 && answers.some((a) => a?.error === 'no-backup'),
  'a sleeping host’s table can be taken over, by one player only',
);
check(!!(await take(sh, (m) => m.t === 'taken')), '…and the sleeping host is told its table has moved on');
const winner = answers[0]?.key ? 'sleepy-taker-01' : 'sleepy-taker-02';
const sh2 = await connect('shost2', undefined, winner, sleepy);
await wait(250);
check(!!(await take(sh2, (m) => m.t === 'welcome')), '…so the player who took over can host it');
for (const x of [q1, q2, sh2]) x.ws.close();

// who's who: peer ids belong to their secret, and the host's messages are marked
const who = `${room}-who`;
const wh = await connect('whost1', undefined, 'who-host-key-1', who, 'host-secret-1');
const wg = await connect('wguest', undefined, undefined, who, 'guest-secret');
await wait(200);
const welcome = await take(wg, (m) => m.t === 'welcome');
check(welcome?.v === 2 && welcome?.host === 'whost1', 'the welcome names the host');
let stolen = false;
try {
  const thief = await connect('whost1', undefined, undefined, who, 'not-the-secret');
  await wait(200);
  stolen = thief.ws.readyState === WebSocket.OPEN;
  thief.ws.close();
} catch {
  /* refused */
}
check(!stolen && wh.ws.readyState === WebSocket.OPEN, "a device can't take over someone else's peer id");
wh.ws.send(JSON.stringify({ d: { from: 'host' } }));
wg.ws.send(JSON.stringify({ to: 'whost1', d: { from: 'guest' } }));
await wait(200);
check((await take(wg, (m) => m.t === 'msg'))?.h === 1, "the host's messages are marked");
check((await take(wh, (m) => m.t === 'msg'))?.h === undefined, "a guest's are not");
const wh2 = await connect('whost1', undefined, 'who-host-key-1', who, 'host-secret-1');
await wait(250);
check(wh.ws.readyState !== WebSocket.OPEN && wh2.ws.readyState === WebSocket.OPEN, 'with its secret, a device reconnects under its id');
for (const x of [wg, wh2]) x.ws.close();
console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);
