import { PgDialect } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import type { EventOrigin, GatekeeperResult } from '../policy';
import { openctiStreamObjects, openctiStreamReportRefs, threatAnalyses, threatAnalysisAliases } from '../../modules';
import { originMarkingScope, reportRefMarkingPolicy, streamObjectMarkingPolicy, threatAnalysisMarkingPolicy, threatMarkingPolicy } from './marking-policies';

const userId = uuidv7();
const tenantId = uuidv7();
const TLP_GREEN = 'marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da';
const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

const client = (markings?: ReadonlyArray<string> | null): EventOrigin => ({ type: 'client', userId, tenantId, markings });

const render = (result: GatekeeperResult) => {
  if (!result) {
    throw new Error('expected a predicate, got undefined');
  }
  return new PgDialect().sqlToQuery(result);
};

const readThreats = (origin: EventOrigin) => threatMarkingPolicy.read?.(origin, threatAnalyses);
const readAliases = (origin: EventOrigin) => threatAnalysisMarkingPolicy.read?.(origin, threatAnalysisAliases);

describe('originMarkingScope', () => {
  it('should carry the markings of a person reading for themselves', () => {
    expect(originMarkingScope(client([TLP_GREEN]))).toEqual([TLP_GREEN]);
  });

  it('should fail closed for a person whose markings OpenCTI did not answer', () => {
    expect(originMarkingScope(client(null))).toBeNull();
  });

  it('should not narrow a person no marking scope was resolved for', () => {
    expect(originMarkingScope(client())).toBeUndefined();
  });

  it.each<EventOrigin>([
    { type: 'auth' },
    { type: 'system' },
    { type: 'platform', userId },
    { type: 'connector', serviceAccountId: uuidv7(), tenantId },
    { type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false },
    { type: 'client', userId, tenantId, job: { jobKind: 'crq-simulation', interactive: true } },
  ])('should not narrow a $type origin, so scores blend every source', (origin) => {
    expect(originMarkingScope(origin)).toBeUndefined();
  });
});

describe('threatMarkingPolicy', () => {
  it('should leave only unmarked mirrored threats to a person whose markings are unknown (no clearance)', () => {
    const { sql, params } = render(readThreats(client(null)));

    expect(sql).toContain('<> \'connector\'');
    expect(sql).toContain('<@ \'{}\'::text[]');
    expect(params).toEqual([]);
  });

  it('should keep a mirrored threat only when all its markings are the reader\'s', () => {
    const { sql, params } = render(readThreats(client([TLP_GREEN, TLP_RED])));

    expect(sql).toContain('"marking_refs" is not null');
    expect(sql).toContain('<@ array[');
    expect(params).toEqual([TLP_GREEN, TLP_RED]);
  });

  it('should still show unmarked mirrored threats to a reader with no marking', () => {
    const { sql } = render(readThreats(client([])));

    expect(sql).toContain('<@ \'{}\'::text[]');
  });

  it('should add no predicate for a job, so a recompute reads every threat', () => {
    expect(readThreats({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false })).toBeUndefined();
  });

  it('should leave writes to the tenant rules', () => {
    expect(threatMarkingPolicy.update?.(client([]), threatAnalyses)).toBeUndefined();
    expect(threatMarkingPolicy.delete?.(client([]), threatAnalyses)).toBeUndefined();
    expect(threatMarkingPolicy.create).toBeUndefined();
  });
});

describe('threatAnalysisMarkingPolicy', () => {
  it('should make a child row follow the markings of its threat', () => {
    const { sql, params } = render(readAliases(client([TLP_GREEN])));

    expect(sql).toContain('from threat_analyses as marked');
    expect(sql).toContain('"analysis_id"');
    expect(params).toEqual([TLP_GREEN]);
  });

  it('should add no predicate for a connector origin', () => {
    expect(readAliases({ type: 'connector', serviceAccountId: uuidv7(), tenantId })).toBeUndefined();
  });
});

describe('streamObjectMarkingPolicy', () => {
  const readMirror = (origin: EventOrigin) => streamObjectMarkingPolicy.read?.(origin, openctiStreamObjects);

  it('should keep a mirrored object only when all the markings of its body are the reader\'s', () => {
    const { sql, params } = render(readMirror(client([TLP_GREEN])));

    expect(sql).toContain('object_marking_refs');
    expect(sql).toContain('<@ array[');
    expect(params).toEqual([TLP_GREEN]);
  });

  it('should leave only unmarked mirrored objects to a person whose markings are unknown (no clearance)', () => {
    const { sql, params } = render(readMirror(client(null)));

    expect(sql).toContain('<@ \'{}\'::text[]');
    expect(params).toEqual([]);
  });

  it('should add no predicate for the rebuild job', () => {
    expect(readMirror({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false })).toBeUndefined();
  });

  it('should leave the connector writes to the tenant rules', () => {
    expect(streamObjectMarkingPolicy.update?.(client([]), openctiStreamObjects)).toBeUndefined();
    expect(streamObjectMarkingPolicy.delete?.(client([]), openctiStreamObjects)).toBeUndefined();
  });
});

describe('reportRefMarkingPolicy', () => {
  const readRefs = (origin: EventOrigin) => reportRefMarkingPolicy.read?.(origin, openctiStreamReportRefs);

  it('should make a citation follow the markings of its report', () => {
    const { sql, params } = render(readRefs(client([TLP_RED])));

    expect(sql).toContain('from opencti_stream_objects as cited_report');
    expect(sql).toContain('"report_stix_id"');
    expect(params).toEqual([TLP_RED]);
  });

  it('should not narrow a person no marking scope was resolved for', () => {
    expect(readRefs(client())).toBeUndefined();
  });
});
