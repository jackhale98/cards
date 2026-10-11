// Smoke test for the relay protocol. Run `npx wrangler dev` here, then `node smoke.mjs`
// (or `node smoke.mjs wss://relay.lamplight.cards` against the deployed relay).
const base = (process.argv[2] ?? 'ws://127.0.0.1:8787').replace(/\/$/, '');
const room = `smoke-${Math.random().toString(36).slice(2, 8)}`;
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

function connect(peer, headers, host, at = room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/room/${at}?peer=${peer}${host ? `&host=${host}` : ''}`, headers ? { headers } : undefined);
    const inbox = [];
    ws.onmessage = (e) => inbox.push(e.data === 'pong' ? 'pong' : JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, inbox });
    ws.onerror = () => reject(new Error(`could not connect ${peer}`));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const take = (box, pred) => {
  const i = box.inbox.findIndex(pred);
  return i < 0 ? null : box.inbox.splice(i, 1)[0];
};

const a = await connect('alice1');
await wait(150);
check(take(a, (m) => m.t === 'welcome')?.peers.length === 0, 'first device is welcomed to an empty room');
const b = await connect('bobby1');
await wait(150);
check(JSON.stringify(take(b, (m) => m.t === 'welcome')?.peers) === '["alice1"]', 'second device sees the first');
check(take(a, (m) => m.t === 'join')?.peer === 'bobby1', 'first device hears the join');
const c = await connect('carol1');
await wait(150);
take(a, (m) => m.t === 'join');
take(b, (m) => m.t === 'join');

a.ws.send(JSON.stringify({ to: 'bobby1', d: { hello: 1 } }));
await wait(150);
check(take(b, (m) => m.t === 'msg')?.d.hello === 1, 'direct message reaches its target');
check(!c.inbox.some((m) => m.t === 'msg'), '…and nobody else');

a.ws.send(JSON.stringify({ d: { all: 1 } }));
await wait(150);
check(
  !!take(b, (m) => m.t === 'msg' && m.d.all) && !!take(c, (m) => m.t === 'msg' && m.d.all),
  'broadcast reaches everyone else',
);
check(!a.inbox.some((m) => m.t === 'msg'), '…but not the sender');

b.ws.send(JSON.stringify({ to: 'alice1', s: { sdp: 'x' } }));
await wait(150);
const sig = take(a, (m) => m.t === 'msg');
check(sig?.s?.sdp === 'x' && sig.from === 'bobby1', 'WebRTC signals are relayed with the sender');

a.ws.send('ping');
await wait(150);
check(a.inbox.includes('pong'), 'keep-alive ping gets a pong');

// bob reconnects with the same id: no leave/join noise, old socket closed
const b2 = await connect('bobby1');
await wait(250);
check(b.ws.readyState === WebSocket.CLOSED || b.ws.readyState === WebSocket.CLOSING, 'a reconnect replaces the old socket');
check(!a.inbox.some((m) => m.t === 'leave' || m.t === 'join'), '…without announcing a leave or join');
check(JSON.stringify(take(b2, (m) => m.t === 'welcome')?.peers.sort()) === '["alice1","carol1"]', '…and gets the current peers');

c.ws.close();
await wait(250);
check(take(a, (m) => m.t === 'leave')?.peer === 'carol1', 'closing announces a leave');

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
check(!!take(h1, (m) => m.t === 'welcome'), 'a host claims a free code');
const h2 = await connect('host02', undefined, 'key-two-5678', table);
await wait(250);
check(!!take(h2, (m) => m.t === 'taken') && h2.ws.readyState !== WebSocket.OPEN, 'a second host on the same code is told it is taken');
const g = await connect('guest1', undefined, undefined, table);
await wait(150);
check(JSON.stringify(take(g, (m) => m.t === 'welcome')?.peers) === '["host01"]', 'guests still join the first host');
h1.ws.close();
await wait(250);
const h1b = await connect('host03', undefined, 'key-one-1234', table);
await wait(150);
check(!!take(h1b, (m) => m.t === 'welcome'), 'the same host reconnects after a refresh');
h1b.ws.close();
await wait(250);
const h3 = await connect('host04', undefined, 'key-two-5678', table);
await wait(250);
check(!!take(h3, (m) => m.t === 'taken'), 'a recently gone host keeps its code for a while');
g.ws.close();
console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);
