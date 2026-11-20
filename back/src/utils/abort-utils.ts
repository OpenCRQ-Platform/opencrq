const generateAbortPromise = <T>(signal: AbortSignal): Promise<T> => new Promise<T>((_, reject) => {
  if (signal.aborted) {
    return reject(signal.reason);
  }
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

export const abortOnSignal = async <T>(executionPromise: Promise<T>, signal: AbortSignal): Promise<T> => (
  Promise.race([executionPromise, generateAbortPromise<T>(signal)])
);
