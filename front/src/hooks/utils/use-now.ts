import { useEffect, useState } from 'react';

/** The current instant, refreshed every `intervalMs` while `enabled`; frozen at mount otherwise. */
export const useNow = (intervalMs: number, enabled: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs, enabled]);
  return now;
};
