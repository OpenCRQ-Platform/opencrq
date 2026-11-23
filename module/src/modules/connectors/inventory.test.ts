import { describe, expect, it } from 'vitest';
import { isWellFormedSchedule, offeredCadences } from '../job-schedules/cadence';
import { CONNECTOR_ENTRIES, CONNECTOR_INVENTORY, JOB_BACKED_CONNECTOR_KINDS, jobBackedConnector } from './inventory';

describe('connector inventory', () => {
  it('gives the stream connector no job and none of a job\'s options', () => {
    expect(CONNECTOR_INVENTORY.opencti).toMatchObject({
      jobKind: null,
      idempotencyPrefix: null,
      maxRuntimeMs: null,
      maxAttempts: null,
    });
    expect(jobBackedConnector('opencti')).toBeNull();
  });

  it('gives every other connector a job and the options to enqueue it', () => {
    for (const entry of CONNECTOR_ENTRIES.filter((candidate) => candidate.source !== 'opencti')) {
      expect(jobBackedConnector(entry.source)).not.toBeNull();
      expect(entry.idempotencyPrefix).toBeTruthy();
      expect(entry.maxRuntimeMs).toBeGreaterThan(0);
      expect(entry.maxAttempts).toBeGreaterThan(0);
    }
  });

  // The wiring below reached the queue from three separate constants before it was declared here.
  // A transcription slip changes production behaviour on a path no screen renders.
  it('keeps the job wiring the queue was already receiving', () => {
    expect(CONNECTOR_INVENTORY.first).toMatchObject({ jobKind: 'cve-epss-sync', idempotencyPrefix: 'first-sync', maxAttempts: 3 });
    expect(CONNECTOR_INVENTORY.nist).toMatchObject({ jobKind: 'cve-cvss-sync', idempotencyPrefix: 'nist-sync', maxRuntimeMs: 30 * 60 * 1000, maxAttempts: 5 });
    expect(CONNECTOR_INVENTORY.cisa).toMatchObject({ jobKind: 'cve-kev-sync', idempotencyPrefix: 'cisa-sync', maxAttempts: 3 });
    expect(CONNECTOR_INVENTORY.microsoft_graph).toMatchObject({ jobKind: 'microsoft-graph-sync', idempotencyPrefix: 'graph-sync', maxRuntimeMs: 30 * 60 * 1000, maxAttempts: 3 });
    expect(CONNECTOR_INVENTORY.openaev).toMatchObject({ jobKind: 'openaev-findings-sync', idempotencyPrefix: 'openaev-sync', maxRuntimeMs: 30 * 60 * 1000, maxAttempts: 3 });
    expect(CONNECTOR_INVENTORY.drata).toMatchObject({ jobKind: 'drata-sync', idempotencyPrefix: 'drata-sync', maxRuntimeMs: 10 * 60 * 1000, maxAttempts: 3 });
    expect(CONNECTOR_INVENTORY.default_threats).toMatchObject({ jobKind: 'default-threats-sync', idempotencyPrefix: 'default-threats-sync', maxAttempts: 3 });
  });

  it('gives every job-backed connector a default its own minimum still offers', () => {
    for (const entry of CONNECTOR_ENTRIES) {
      if (entry.jobKind === null) {
        continue;
      }
      expect(isWellFormedSchedule(entry.defaultSchedule)).toBe(true);
      expect(offeredCadences(entry.minIntervalHours)).toContain(entry.defaultSchedule.cadence);
    }
  });

  it('counts the OpenAEV run in observations, the unit its progress reports', () => {
    expect(CONNECTOR_INVENTORY.openaev.runUnit).toBe('observations');
  });

  it('declares the supporting assets the OpenAEV inventory writes, beside its findings', () => {
    expect(CONNECTOR_INVENTORY.openaev.scopeKinds).toEqual(['supporting_assets', 'findings']);
  });

  it('lists exactly the kinds a run summary is read for', () => {
    expect([...JOB_BACKED_CONNECTOR_KINDS]).toEqual([
      'cve-epss-sync',
      'cve-cvss-sync',
      'cve-kev-sync',
      'microsoft-graph-sync',
      'openaev-findings-sync',
      'drata-sync',
      'default-threats-sync',
    ]);
  });
});
