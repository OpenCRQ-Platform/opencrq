import { describe, expect, it } from 'vitest';
import type { ConnectorRunRead } from './connector-list-utils';
import { lastRunRead, objectsRead } from './connector-card-utils';

const lastRun: ConnectorRunRead = {
  status: 'succeeded',
  startedAt: '2026-11-05T16:31:04.000Z',
  finishedAt: '2026-11-05T16:31:11.000Z',
  processedTotal: 235,
  expectedTotal: 235,
};

describe('connector card run figures', () => {
  it('reads the last run of a connector that is on', () => {
    expect(objectsRead({ enabled: true, activeRun: null, lastRun })).toBe('235 / 235');
  });

  it('reads nothing for a connector switched off, whatever its last run held', () => {
    const switchedOff = { enabled: false, activeRun: null, lastRun };
    expect(objectsRead(switchedOff)).toBe('-');
    expect(lastRunRead(switchedOff)).toBe('-');
  });
});
