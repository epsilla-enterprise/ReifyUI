// keepPresenceAlive — renew this client's awareness on a clock the browser
// does not throttle.
//
// Yjs awareness renews a client's own state every 15s on a main-thread timer
// and every other client drops a state it has not heard from for 30s. A tab
// in the background gets its timers throttled to once a minute, so its
// presence expires for everyone else and reappears when the timer finally
// fires: a flag that flickers every minute on every other screen. Worker
// clocks are not throttled, so the renewal runs there and the main thread
// only relays it. One helper for every live document (sheets, canvases,
// docs).
const TICK_MS = 10_000;

export function keepPresenceAlive(awareness, intervalMs = TICK_MS) {
  if (!awareness || typeof Worker === 'undefined' || typeof Blob === 'undefined') return () => {};
  let url = '';
  let worker = null;
  try {
    url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.max(1000, intervalMs)});`],
                                        { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch {
    if (url) URL.revokeObjectURL(url);
    return () => {};
  }
  worker.onmessage = () => {
    const state = awareness.getLocalState();
    if (state !== null && state !== undefined) awareness.setLocalState(state);   // same state, new clock
  };
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}
