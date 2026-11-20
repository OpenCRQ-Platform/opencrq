/** @vitest-environment jsdom */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReaderTimeZone } from './use-reader-time-zone';

vi.mock('../../utils/date-utils', () => ({ browserTimeZone: () => 'Factory' }));

afterEach(() => {
  cleanup();
});

const REFUSAL = { data: { httpStatus: 400 } };
const OUTAGE = { data: { httpStatus: 503 } };

describe('useReaderTimeZone', () => {
  it('should count in UTC once the server refuses the browser\'s zone', () => {
    const { result, rerender } = renderHook(({ error }) => {
      const zone = useReaderTimeZone();
      zone.fallBackOn(error);
      return zone;
    }, { initialProps: { error: null as typeof REFUSAL | null } });

    expect(result.current.timeZone).toBe('Factory');

    rerender({ error: REFUSAL });

    expect(result.current).toMatchObject({ timeZone: 'UTC', queryOptions: { meta: { skipErrorToast: false } } });
  });

  it('should keep the browser\'s zone when the server fails otherwise', () => {
    const { result } = renderHook(() => {
      const zone = useReaderTimeZone();
      zone.fallBackOn(OUTAGE);
      return zone;
    });

    expect(result.current.timeZone).toBe('Factory');
  });

  it('should retry an outage but not a refusal', () => {
    const { result } = renderHook(() => useReaderTimeZone());
    const { retry } = result.current.queryOptions;

    expect([retry(0, OUTAGE), retry(3, OUTAGE), retry(0, REFUSAL)]).toEqual([true, false, false]);
  });
});
