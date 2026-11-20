import type { FunctionComponent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { plural, t } from '@lingui/core/macro';

interface UnassessedCountProps {
  count: number,
  rowCount: number,
  filterSignature: string,
  departedName: string | null,
  onDepartureAnnounced: () => void,
}

export const UnassessedCount: FunctionComponent<UnassessedCountProps> = ({ count, rowCount, filterSignature, departedName, onDepartureAnnounced }) => {
  const [message, setMessage] = useState('');
  const announcedDeparture = useRef(false);
  const onAnnounced = useRef(onDepartureAnnounced);
  useEffect(() => {
    onAnnounced.current = onDepartureAnnounced;
  }, [onDepartureAnnounced]);

  useEffect(() => {
    if (departedName === null && announcedDeparture.current) {
      announcedDeparture.current = false;
      return undefined;
    }
    const sentence = departedName === null
      ? t({
        message: plural(rowCount, {
          one: `Showing # control, ${count} not assessed.`,
          other: `Showing # controls, ${count} not assessed.`,
        }),
      })
      : t({
        message: plural(rowCount, {
          one: `${departedName} is now declared and has left the list. Showing # control, ${count} not assessed.`,
          other: `${departedName} is now declared and has left the list. Showing # controls, ${count} not assessed.`,
        }),
      });
    const clear = window.setTimeout(() => setMessage(''), 0);
    const announce = window.setTimeout(() => {
      setMessage(sentence);
      if (departedName !== null) {
        announcedDeparture.current = true;
        onAnnounced.current();
      }
    }, 120);
    return () => {
      window.clearTimeout(clear);
      window.clearTimeout(announce);
    };
  }, [count, rowCount, filterSignature, departedName]);

  return (
    <>
      <p className="txt-sub-content text-muted-foreground">
        <strong className="text-foreground">{count}</strong>
        {' '}
        {t({ message: plural(count, { one: 'control not assessed', other: 'controls not assessed' }) })}
      </p>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
    </>
  );
};
