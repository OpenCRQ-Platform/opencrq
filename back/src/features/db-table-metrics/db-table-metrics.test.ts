import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../../engines/engines-manager';

const state = vi.hoisted(() => {
  const tableStatistics: { enabled: boolean, interval_ms?: number } = { enabled: false };
  const engines: Array<Engine> = [];
  return { tableStatistics, engines, readDatabaseStatistics: vi.fn(), registerDbTableMetrics: vi.fn(), logFromError: vi.fn() };
});

vi.mock('../../config', () => ({
  config: () => ({ telemetry: { observability: { table_statistics: state.tableStatistics } } }),
}));
vi.mock('../../engines/db', () => ({
  dbEngine: { readTableStatistics: state.readDatabaseStatistics, registerTableMetrics: state.registerDbTableMetrics },
}));
vi.mock('../../engines/engines-manager', () => ({
  registerEngine: (engine: Engine) => {
    state.engines.push(engine);
    return {};
  },
}));
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ logTrace: vi.fn(), logFromError: state.logFromError }),
}));

await import('./index');
const [engine] = state.engines;

const statistics = { databaseBytes: 1, tables: [] };
const INTERVAL_MS = 60_000;

const startEngine = async (signal = new AbortController().signal) => {
  state.registerDbTableMetrics.mockClear();
  const handler = await engine.start(signal);
  const lastReading = (): unknown => state.registerDbTableMetrics.mock.calls[0]?.[0]();
  return { handler, lastReading };
};

describe('the database table statistics reader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.tableStatistics = { enabled: true, interval_ms: INTERVAL_MS };
    state.readDatabaseStatistics.mockReset();
    state.logFromError.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers no instrument and never reads when the variable is off', async () => {
    state.tableStatistics = { enabled: false };

    const { handler } = await startEngine();

    expect(handler).toEqual({});
    expect(state.registerDbTableMetrics).not.toHaveBeenCalled();
    expect(state.readDatabaseStatistics).not.toHaveBeenCalled();
  });

  it('reads once the engines have started, then on every interval, and the instruments report the last reading', async () => {
    state.readDatabaseStatistics.mockResolvedValue(statistics);
    const { handler, lastReading } = await startEngine();

    expect(state.readDatabaseStatistics).not.toHaveBeenCalled();
    expect(lastReading()).toBeNull();

    await handler.onEnginesStarted?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.readDatabaseStatistics).toHaveBeenCalledOnce();
    expect(lastReading()).toBe(statistics);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(state.readDatabaseStatistics).toHaveBeenCalledTimes(2);

    await handler.onEnginesStopping?.();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(state.readDatabaseStatistics).toHaveBeenCalledTimes(2);
  });

  it('starts no reading while the previous one is still running', async () => {
    let finish: (value: unknown) => void = () => {};
    state.readDatabaseStatistics.mockReturnValue(new Promise((resolve) => {
      finish = resolve;
    }));
    const { handler } = await startEngine();

    await handler.onEnginesStarted?.();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(state.readDatabaseStatistics).toHaveBeenCalledOnce();

    finish(statistics);
    await handler.onEnginesStopping?.();
  });

  it('logs a failed reading and keeps the one before, which the instruments would serve anyway', async () => {
    state.readDatabaseStatistics.mockResolvedValueOnce(statistics).mockRejectedValueOnce(new Error('lock timeout'));
    const { handler, lastReading } = await startEngine();

    await handler.onEnginesStarted?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastReading()).toBe(statistics);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(lastReading()).toBe(statistics);
    expect(state.logFromError).toHaveBeenCalledOnce();

    await handler.onEnginesStopping?.();
  });
});
