import { describe, expect, it } from 'vitest';
import type { EvidenceHealthInput, EvidenceHealthSource } from './evidence-health';
import { isSourceEmptied, readEvidenceHealth, readSourceRunHealth } from './evidence-health';

const NOW = new Date('2026-11-22T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const connector = (lastSeenAt: Date | null): EvidenceHealthSource => ({ connectorId: 'c1', origin: 'connector', lastSeenAt });
const manual: EvidenceHealthSource = { connectorId: null, origin: 'user', lastSeenAt: daysAgo(1) };

const input = (overrides: Partial<EvidenceHealthInput>): EvidenceHealthInput => ({
  categoryId: 'host',
  sources: [connector(daysAgo(1))],
  lastVerdictAt: null,
  versionReported: true,
  ...overrides,
});

describe('readEvidenceHealth', () => {
  it('names an asset no source reports, never reading it as safe', () => {
    expect(readEvidenceHealth(input({ sources: [] }), 30, NOW)).toEqual({ state: 'no_source', lastEvidenceAt: null });
  });

  it('reads an asset only a person entered as attested only', () => {
    expect(readEvidenceHealth(input({ sources: [manual] }), 30, NOW).state).toBe('attested_only');
  });

  it('reads a connector source that never dated an observation as never measured', () => {
    expect(readEvidenceHealth(input({ sources: [connector(null)] }), 30, NOW)).toEqual({ state: 'never_measured', lastEvidenceAt: null });
  });

  it('expires evidence older than the re-test delay', () => {
    expect(readEvidenceHealth(input({ sources: [connector(daysAgo(31))] }), 30, NOW)).toEqual({ state: 'expired', lastEvidenceAt: daysAgo(31) });
  });

  it('keeps evidence at the delay current, and a recent test verdict counts as a measurement', () => {
    expect(readEvidenceHealth(input({ sources: [connector(daysAgo(30))] }), 30, NOW).state).toBe('current');
    expect(readEvidenceHealth(input({ sources: [connector(daysAgo(90))], lastVerdictAt: daysAgo(2) }), 30, NOW))
      .toEqual({ state: 'current', lastEvidenceAt: daysAgo(2) });
  });

  it('reads the newest of several sources', () => {
    expect(readEvidenceHealth(input({ sources: [connector(daysAgo(60)), connector(daysAgo(3))] }), 30, NOW).lastEvidenceAt).toEqual(daysAgo(3));
  });

  it('names a machine with no reported version, and only a machine', () => {
    expect(readEvidenceHealth(input({ versionReported: false }), 30, NOW).state).toBe('version_unknown');
    expect(readEvidenceHealth(input({ categoryId: 'saas_application', versionReported: false }), 30, NOW).state).toBe('current');
  });

  it('reads expiry before an unknown version', () => {
    expect(readEvidenceHealth(input({ sources: [connector(daysAgo(40))], versionReported: false }), 30, NOW).state).toBe('expired');
  });
});

describe('isSourceEmptied', () => {
  it('flags a run that drops to zero after one with rows', () => {
    expect(isSourceEmptied(0, 120)).toBe(true);
  });

  it('flags a run far below the previous one', () => {
    expect(isSourceEmptied(5, 1000)).toBe(true);
    expect(isSourceEmptied(500, 1000)).toBe(false);
  });

  it('never flags a first run or one after an empty run', () => {
    expect(isSourceEmptied(0, null)).toBe(false);
    expect(isSourceEmptied(0, 0)).toBe(false);
  });
});

describe('readSourceRunHealth', () => {
  it('reads each sync from its two newest runs, newest first', () => {
    expect(readSourceRunHealth([
      { kind: 'openaev-findings-sync', finishedAt: daysAgo(0), processedTotal: 0 },
      { kind: 'openaev-findings-sync', finishedAt: daysAgo(1), processedTotal: 840 },
      { kind: 'drata-sync', finishedAt: daysAgo(2), processedTotal: 12 },
    ])).toEqual([
      { kind: 'openaev-findings-sync', lastRunAt: daysAgo(0), latestTotal: 0, previousTotal: 840, emptied: true },
      { kind: 'drata-sync', lastRunAt: daysAgo(2), latestTotal: 12, previousTotal: null, emptied: false },
    ]);
  });
});
