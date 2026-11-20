import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getFindingStream } from './finding-stream';

describe('getFindingStream', () => {
  beforeAll(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('produces one entry for a source seen only once', () => {
    const stream = getFindingStream([], [{
      connectorId: 'conn-1',
      source: 'microsoft_graph',
      reportedSeverity: 'High',
      firstSeenAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-05-01T00:00:00Z',
    }], 'Automatic control');

    expect(stream).toHaveLength(1);
    expect(stream[0].text).toBe('First reported by Microsoft Defender.');
  });

  it('produces two entries for a source seen again later', () => {
    const stream = getFindingStream([], [{
      connectorId: 'conn-1',
      source: 'microsoft_graph',
      reportedSeverity: 'Critical',
      firstSeenAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-08-14T03:58:00Z',
    }], 'Automatic control');

    expect(stream).toHaveLength(2);
    expect(stream[0].text).toBe('First reported by Microsoft Defender.');
    expect(stream[1].text).toBe('Reported again by Microsoft Defender, severity Critical.');
  });

  it('merges two sources into one chronology, oldest first', () => {
    const stream = getFindingStream([], [
      {
        connectorId: 'conn-1',
        source: 'microsoft_graph',
        reportedSeverity: 'High',
        firstSeenAt: '2026-05-02T06:20:00Z',
        lastSeenAt: '2026-05-02T06:20:00Z',
      },
      {
        connectorId: 'conn-2',
        source: 'openaev',
        reportedSeverity: 'High',
        firstSeenAt: '2026-04-28T03:41:00Z',
        lastSeenAt: '2026-04-28T03:41:00Z',
      },
    ], 'Automatic control');

    expect(stream).toHaveLength(2);
    expect(stream[0].text).toBe('First reported by OpenAEV.');
    expect(stream[1].text).toBe('First reported by Microsoft Defender.');
  });

  it('interleaves a state change between two source reports', () => {
    const stream = getFindingStream([
      {
        id: 'hist-1',
        stateChangedAt: '2026-05-15T00:00:00Z',
        state: 'dismissed',
        reason: null,
        dismissalType: 'risk_accepted',
        dismissalReasonCode: 'wont_fix',
        changedByUserId: 'user-1',
        changedByUserName: 'Marie François',
        origin: 'user',
      },
    ], [
      {
        connectorId: 'conn-1',
        source: 'microsoft_graph',
        reportedSeverity: 'High',
        firstSeenAt: '2026-05-01T00:00:00Z',
        lastSeenAt: '2026-05-30T00:00:00Z',
      },
    ], 'Automatic control');

    expect(stream.map((entry) => entry.at)).toEqual([
      '2026-05-01T00:00:00Z',
      '2026-05-15T00:00:00Z',
      '2026-05-30T00:00:00Z',
    ]);
    expect(stream[1].actorName).toBe('Marie François');
  });

  it('drops the opening sync row: the source\'s own "first reported" entry already says it', () => {
    const stream = getFindingStream([
      {
        id: 'hist-1',
        stateChangedAt: '2026-05-01T00:00:00Z',
        state: 'applicable',
        reason: null,
        changedByUserId: null,
        changedByUserName: null,
        origin: 'exposed',
      },
    ], [
      {
        connectorId: 'conn-1',
        source: 'microsoft_graph',
        reportedSeverity: 'High',
        firstSeenAt: '2026-05-01T00:00:00Z',
        lastSeenAt: '2026-05-01T00:00:00Z',
      },
    ], 'Automatic control');

    expect(stream).toHaveLength(1);
    expect(stream[0].text).toBe('First reported by Microsoft Defender.');
  });

  it('keeps the opening sync row when the finding carries no source', () => {
    const stream = getFindingStream([
      {
        id: 'hist-1',
        stateChangedAt: '2026-05-01T00:00:00Z',
        state: 'applicable',
        reason: null,
        changedByUserId: null,
        changedByUserName: null,
        origin: 'exposed',
      },
    ], [], 'Automatic control');

    expect(stream).toHaveLength(1);
    expect(stream[0].text).toBe('Finding reported as applicable.');
  });

  it('words a retirement as no longer reported, never as set aside, without repeating the sync\'s own reason', () => {
    const stream = getFindingStream([
      { id: 'hist-1', stateChangedAt: '2026-05-01T00:00:00Z', state: 'applicable', reason: null, changedByUserId: null, changedByUserName: null, origin: 'exposed' },
      { id: 'hist-2', stateChangedAt: '2026-06-01T00:00:00Z', state: 'dismissed', reason: 'No longer reported by Microsoft Defender', changedByUserId: null, changedByUserName: null, origin: 'no_longer_reported' },
    ], [], 'Microsoft Defender');

    expect(stream[1].text).toBe('No longer reported by any connector.');
    expect(stream[1].actorName).toBe('Microsoft Defender');
  });

  it('dates a late result by when it was learned and carries the day its test ran', () => {
    const stream = getFindingStream([
      { id: 'hist-1', stateChangedAt: '2026-05-01T00:00:00Z', state: 'applicable', reason: null, changedByUserId: null, changedByUserName: null, origin: 'exposed' },
      { id: 'hist-2', stateChangedAt: '2026-06-03T00:00:00Z', observedAt: '2026-06-01T00:00:00Z', state: 'dismissed', reason: 'Prevented', changedByUserId: null, changedByUserName: null, origin: 'not_exposed' },
    ], [], 'OpenAEV');

    expect(stream[1].at).toBe('2026-06-03T00:00:00Z');
    expect(stream[1].testedAt).toEqual(new Date('2026-06-01T00:00:00Z'));
  });
});
