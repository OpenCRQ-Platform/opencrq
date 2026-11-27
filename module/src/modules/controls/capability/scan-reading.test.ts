import { describe, expect, it } from 'vitest';
import { poolCapabilityAssessments } from './pooled-derivation';
import { OPENAEV_SCAN_SOURCE, readScanCapability } from './scan-reading';

const SCAN_FEED = { source: OPENAEV_SCAN_SOURCE, complianceAssessmentId: null, complianceAssessmentName: null };

describe('readScanCapability (opencrq #332)', () => {
  it('reads nothing while no asset was scanned recently, so the capability stays as other sources leave it', () => {
    expect(readScanCapability('PATCH', { known: 10, scanned: 4, recent: 0, recentClean: 0 })).toBeNull();
  });

  it('measures coverage as the share of known assets a recent scan reached', () => {
    expect(readScanCapability('PATCH', { known: 10, scanned: 10, recent: 9, recentClean: 9 })?.coverageBucket).toBe('L3');
    expect(readScanCapability('PATCH', { known: 10, scanned: 10, recent: 6, recentClean: 6 })?.coverageBucket).toBe('L2');
    expect(readScanCapability('PATCH', { known: 10, scanned: 10, recent: 2, recentClean: 2 })?.coverageBucket).toBe('L1');
  });

  it('reads L2 when four in five recently scanned assets are clean, L1 otherwise, never L3', () => {
    expect(readScanCapability('PATCH', { known: 5, scanned: 5, recent: 5, recentClean: 5 })?.strengthRung).toBe('L2');
    expect(readScanCapability('PATCH', { known: 5, scanned: 5, recent: 5, recentClean: 4 })?.strengthRung).toBe('L2');
    expect(readScanCapability('PATCH', { known: 5, scanned: 5, recent: 5, recentClean: 3 })?.strengthRung).toBe('L1');
  });

  it('never divides by an asset count below the scanned assets', () => {
    expect(readScanCapability('PATCH', { known: 0, scanned: 3, recent: 3, recentClean: 3 })?.coverageBucket).toBe('L3');
  });
});

describe('poolCapabilityAssessments with a scan reading', () => {
  it('assesses a control no other source reaches from recent scans alone, coverage measured', () => {
    const pooled = poolCapabilityAssessments([], [], [{ capabilityId: 'PATCH', strengthRung: 'L2', coverageBucket: 'L3' }]);

    expect(pooled).toEqual([{
      capabilityId: 'PATCH',
      strengthRung: 'L2',
      strengthSources: [OPENAEV_SCAN_SOURCE],
      strengthFeeds: [SCAN_FEED],
      coverageBucket: 'L3',
      coverageBasis: 'measured',
      coverageSources: [OPENAEV_SCAN_SOURCE],
      coverageFeeds: [SCAN_FEED],
      assumedFromLevel: null,
    }]);
  });

  it('weighs the scans like Drata on strength and keeps Drata\'s measured coverage first', () => {
    const [entry] = poolCapabilityAssessments(
      [{ capabilityId: 'PATCH', strengthRung: 'L3', coverageBucket: 'L1', coverageMeasured: true, atCeiling: false }],
      [],
      [{ capabilityId: 'PATCH', strengthRung: 'L1', coverageBucket: 'L3' }],
    );

    expect(entry.strengthRung).toBe('L2');
    expect(entry.coverageBucket).toBe('L1');
    expect(entry.strengthSources).toEqual(['drata', OPENAEV_SCAN_SOURCE]);
  });

  it('leaves every other control as it was', () => {
    const without = poolCapabilityAssessments([{ capabilityId: 'IDP', strengthRung: 'L2', coverageBucket: 'L2', coverageMeasured: true, atCeiling: false }], []);
    const withScans = poolCapabilityAssessments(
      [{ capabilityId: 'IDP', strengthRung: 'L2', coverageBucket: 'L2', coverageMeasured: true, atCeiling: false }],
      [],
      [{ capabilityId: 'PATCH', strengthRung: 'L2', coverageBucket: 'L3' }],
    );

    expect(withScans.filter((entry) => entry.capabilityId === 'IDP')).toEqual(without);
  });
});
