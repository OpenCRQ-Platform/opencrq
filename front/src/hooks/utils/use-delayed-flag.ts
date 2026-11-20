import { useEffect, useRef, useState } from 'react';

interface DelayedFlagOptions {
  /** How long `active` must hold before the flag turns on, so a fast answer shows nothing. */
  delay: number,
  /** Once on, the flag stays on at least this long, so an answer landing just after `delay` does not flash. */
  minDuration: number,
}

export const useDelayedFlag = (active: boolean, { delay, minDuration }: DelayedFlagOptions): boolean => {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active && !shown) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (!active && shown) {
      const timer = setTimeout(() => setShown(false), Math.max(0, minDuration - (Date.now() - shownAt.current)));
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [active, shown, delay, minDuration]);

  return shown;
};
