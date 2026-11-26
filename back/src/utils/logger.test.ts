import * as winston from 'winston';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

// vi.mock is hoisted before any import resolves, so it is active when logger.ts reads the
// deployment configuration at module load. Only that configuration is stubbed: the winston logger
// under test is the real one, built by the real module.
vi.mock('../config', () => ({
  pmConfig: { telemetry: undefined },
  getProcessName: vi.fn(() => 'test'),
}));

interface EmittedLine {
  level: string,
  message: string,
}

const emitted: Array<EmittedLine> = [];

const isEmittedLine = (value: unknown): value is EmittedLine => typeof value === 'object' && value !== null && 'level' in value && 'message' in value;
const isWriteCallback = (value: unknown): value is () => void => typeof value === 'function';

/**
 * The real logger, caught at its last stop: the console transport every process runs with. Stubbing
 * the transport rather than the logger keeps winston's own level handling in the path, which is
 * where a level that was never declared disappears. The callback is winston's write acknowledgement:
 * a line that never calls it stalls every line behind it.
 */
beforeEach(() => {
  emitted.length = 0;
  vi.spyOn(winston.transports.Console.prototype, 'log').mockImplementation((...args: Array<unknown>) => {
    const [info, next] = args;
    if (isEmittedLine(info)) {
      emitted.push({ level: info.level, message: info.message });
    }
    if (isWriteCallback(next)) {
      next();
    }
  });
});

const settled = async (): Promise<void> => {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
};

describe('the technical levels the logger writes at', () => {
  it('should write a warning at its own level rather than throw', async () => {
    const logger = createLogger({ feature: 'logger-test' });

    expect(() => logger.logWarn('A warning worth a line', { detail: 'value' })).not.toThrow();

    await settled();
    expect(emitted).toContainEqual({ level: 'warn', message: 'A warning worth a line' });
  });

  it('should keep every declared level addressable and distinct', async () => {
    const logger = createLogger({ feature: 'logger-test' });

    logger.logTrace('A trace');
    logger.logWarn('A warning');
    logger.logError('An error');

    await settled();
    expect(emitted).toEqual([
      { level: 'trace', message: 'A trace' },
      { level: 'warn', message: 'A warning' },
      { level: 'error', message: 'An error' },
    ]);
  });

  it('should write a warning that carries an error at the warning level', async () => {
    const logger = createLogger({ feature: 'logger-test' });

    logger.logWarnFromError(new Error('socket hang up'), 'A retried failure');

    await settled();
    expect(emitted).toEqual([{ level: 'warn', message: 'A retried failure' }]);
  });

  it('should carry the warning through an enriched logger too', async () => {
    const logger = createLogger({ feature: 'logger-test' }).enrich({ tenantId: 'tenant-1' }, '[prefix] ');

    expect(() => logger.logWarn('An enriched warning')).not.toThrow();

    await settled();
    expect(emitted).toContainEqual({ level: 'warn', message: '[prefix] An enriched warning' });
  });
});
