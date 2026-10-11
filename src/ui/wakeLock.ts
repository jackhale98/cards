/**
 * Keep the screen on while this is active (a table, or a host's lobby waiting for friends): a
 * phone that sleeps pauses the page, and a sleeping host drops the whole table. Re-acquired when
 * the page comes back, since browsers release it whenever the page is hidden. Returns a cleanup.
 */
export function keepAwake(): () => void {
  let lock: { release?: () => Promise<void> } | null = null;
  const get = async () => {
    try {
      lock = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<typeof lock> } }).wakeLock?.request('screen') ?? null;
    } catch {
      /* not supported, or refused (e.g. low battery) */
    }
  };
  const onVis = () => document.visibilityState === 'visible' && get();
  void get();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    void lock?.release?.();
  };
}
