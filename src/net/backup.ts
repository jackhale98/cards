import type { HostSnapshot } from './host';

/**
 * Host handoff backups. The host seals a snapshot of the whole game with a key only the relay
 * holds, and sends it to every player: a phone can't read the backup it keeps (so nobody sees
 * anyone's cards), but if the host disappears the relay releases the key to whoever takes over.
 */

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** A fresh random key, as text (base64url, 43 characters). */
export function newBackupKey(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

const importKey = (key: string) => crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function squeeze(data: Uint8Array, how: 'compress' | 'decompress'): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(how === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Seal a snapshot, compressed first: `z.<iv>.<ciphertext>`, both base64url. (A game's state is
 * repetitive JSON: about a fifth the size, which players on a phone's data notice, as a backup goes
 * out every few seconds.)
 */
export async function seal(snap: HostSnapshot, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(snap));
  const data = await squeeze(plain, 'compress');
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), data));
  // (chunked: spreading a large array into btoa's arguments would overflow the stack)
  let text = '';
  for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return `z.${b64(iv)}.${btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Open a sealed snapshot (throws if the key is wrong or the backup was tampered with). An uncompressed one, without the `z.`, is from before backups were compressed (one saved on this phone). */
export async function open(blob: string, key: string): Promise<HostSnapshot> {
  const zip = blob.startsWith('z.');
  const [iv, data] = (zip ? blob.slice(2) : blob).split('.');
  const sealed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await importKey(key), unb64(data)));
  const plain = zip ? await squeeze(sealed, 'decompress') : sealed;
  return JSON.parse(new TextDecoder().decode(plain)) as HostSnapshot;
}
