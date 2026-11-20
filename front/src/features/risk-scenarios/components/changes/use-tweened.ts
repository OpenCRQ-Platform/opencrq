import { useEffect, useRef, useState } from 'react';
import { stepToward } from './run-changes-utils';

/** Follows `target` frame by frame, crossing 0 to 1 in `duration` milliseconds, at once under reduced motion. */
export const useTweened = (target: number, duration: number): number => {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let last: number | null = null;
    const step = (now: number) => {
      current.current = reduced ? target : stepToward(current.current, target, last === null ? 0 : now - last, duration);
      last = now;
      setValue(current.current);
      if (current.current !== target) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
};
