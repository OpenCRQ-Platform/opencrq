import { afterEach, describe, expect, it, vi } from 'vitest';
import { armExitDeadline, stopEngines } from './stop-engines';

const deferred = () => {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('stopEngines', () => {
  it('should stop a stopsLast engine only once every other engine has stopped', async () => {
    const events: Array<string> = [];
    const record = (event: string) => (): void => {
      events.push(event);
    };
    const slowStop = deferred();
    const stopping = stopEngines([
      { key: 'db', stopsLast: true, stop: record('db stop starts') },
      {
        key: 'http-server',
        stop: async () => {
          events.push('http-server stop starts');
          await slowStop.promise;
        },
      },
      { key: 'edition', stop: record('edition stop starts') },
    ], (key) => events.push(`${key} stopped`));

    await vi.waitFor(() => expect(events).toContain('http-server stop starts'));
    expect(events).not.toContain('db stop starts');
    slowStop.resolve();
    await stopping;

    expect(events.indexOf('db stop starts')).toBeGreaterThan(events.indexOf('http-server stopped'));
    expect(events.indexOf('db stop starts')).toBeGreaterThan(events.indexOf('edition stopped'));
  });

  it('should stop no engine before every engine has finished its stopping wait', async () => {
    const events: Array<string> = [];
    const record = (event: string) => (): void => {
      events.push(event);
    };
    const drain = deferred();
    const stopping = stopEngines([
      { key: 'job-runtime', onEnginesStopping: () => drain.promise, stop: record('job-runtime stop') },
      { key: 'db', stopsLast: true, stop: record('db stop') },
    ], () => {});

    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    drain.resolve();
    await stopping;

    expect(events).toEqual(['job-runtime stop', 'db stop']);
  });
});

describe('armExitDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call onExpired at the deadline and not before', () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    armExitDeadline(25_000, onExpired);

    vi.advanceTimersByTime(24_999);
    expect(onExpired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('should not hold the process open until the deadline', () => {
    const timer = armExitDeadline(25_000, () => {});
    try {
      expect(timer.hasRef()).toBe(false);
    } finally {
      clearTimeout(timer);
    }
  });
});
