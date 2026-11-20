export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once, rather than one at a
 * time. Stops pulling new items once `signal` aborts or any worker throws; an item already in
 * flight is left to the worker's own handling of the signal.
 */
export const mapWithConcurrency = async <T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> => {
  let index = 0;
  // `Promise.all` rejects on the first failure but leaves its siblings running: without this the
  // remaining workers keep hammering a remote that has already refused one call.
  let failed = false;
  const runNext = async (): Promise<void> => {
    while (index < items.length && !failed && signal?.aborted !== true) {
      const item = items[index];
      index += 1;
      try {
        await worker(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
};
