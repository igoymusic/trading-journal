// Network requests that give up instead of waiting forever. A server that never answers would
// otherwise leave a chart on "Loading prices…" for good.

/** `fetchFn`, but each request fails after `ms` if the server hasn't finished answering. */
export function fetchWithTimeout(fetchFn: typeof fetch, ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    if (init.signal) return fetchFn(input, init);
    const controller = new AbortController();
    const host = (() => { try { return new URL(String(input)).host; } catch { return 'the server'; } })();
    const gaveUp = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`No answer from ${host} after ${Math.round(ms / 1000)} seconds.`);
        controller.abort(err);
        reject(err);
      }, ms);
      (timer as { unref?: () => void }).unref?.();
    });
    gaveUp.catch(() => {});
    return Promise.race([fetchFn(input, { ...init, signal: controller.signal }), gaveUp]);
  }) as typeof fetch;
}
