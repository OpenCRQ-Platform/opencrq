import { describe, expect, it } from 'vitest';
import type { DrataControlOutput, DrataFrameworkOutput, DrataRequirementOutput } from './drata-types';
import { buildMirrorInput, isImportedFramework } from './drata-mapping-utils';

const framework = (overrides: Partial<DrataFrameworkOutput> = {}): DrataFrameworkOutput => ({
  id: 1,
  name: 'ISO 27001:2022',
  slug: 'iso2022',
  tag: 'ISO270012022',
  ...overrides,
});

const requirement = (overrides: Partial<DrataRequirementOutput> = {}): DrataRequirementOutput => ({
  id: 10,
  name: 'Requirement',
  ...overrides,
});

const control = (overrides: Partial<DrataControlOutput> = {}): DrataControlOutput => ({
  id: 100,
  code: 'DCF-1001',
  name: 'Control',
  ...overrides,
});

describe('isImportedFramework', () => {
  it.each(['ISO270012022', 'SOC_2'])('imports frameworks tagged %s', (tag) => {
    expect(isImportedFramework(framework({ tag }))).toBe(true);
  });

  it.each(['ISO27001', 'GDPR', 'FEDRAMP', 'CYBER_ESSENTIALS_32', 'SOC_1'])('ignores frameworks tagged %s', (tag) => {
    expect(isImportedFramework(framework({ tag }))).toBe(false);
  });
});

describe('buildMirrorInput', () => {
  const build = (overrides: Partial<Parameters<typeof buildMirrorInput>[0]> = {}) =>
    buildMirrorInput({
      frameworks: [framework()],
      requirementsByFramework: new Map([[1, [requirement()]]]),
      inScopeIdsByFramework: new Map([[1, new Set([10])]]),
      readyIdsByFramework: new Map([[1, new Set<number>()]]),
      controls: [control()],
      syncedAt: new Date('2026-08-25T10:00:00Z'),
      ...overrides,
    });

  it('defaults missing framework counters and readiness to zero values', () => {
    const mirror = build();
    expect(mirror.frameworks[0]).toMatchObject({
      drataId: 1,
      isReady: false,
      numInScopeRequirements: 0,
      numReadyInScopeRequirements: 0,
      numInScopeControls: 0,
    });
  });

  it('derives requirement flags from filtered id set membership', () => {
    const mirror = build({
      requirementsByFramework: new Map([[1, [requirement({ id: 10 }), requirement({ id: 11 })]]]),
      inScopeIdsByFramework: new Map([[1, new Set([10])]]),
      readyIdsByFramework: new Map([[1, new Set([11])]]),
    });
    const [first, second] = mirror.frameworks[0].requirements;
    expect(first).toMatchObject({ drataId: 10, isInScope: true, isReady: false });
    expect(second).toMatchObject({ drataId: 11, isInScope: false, isReady: true });
  });

  it('drops archived requirements', () => {
    const mirror = build({
      requirementsByFramework: new Map([[1, [requirement({ id: 10, archivedAt: '2026-01-01T00:00:00Z' })]]]),
    });
    expect(mirror.frameworks[0].requirements).toHaveLength(0);
  });

  it('maps control flags with false defaults when the expand is missing', () => {
    const mirror = build({ controls: [control({ flags: null })] });
    expect(mirror.controls[0]).toMatchObject({
      isReady: false,
      isMonitored: false,
      hasEvidence: false,
      hasPolicy: false,
      archivedAt: null,
    });
  });

  it('maps expanded control flags verbatim', () => {
    const mirror = build({
      controls: [control({ flags: { isReady: true, isMonitored: true, hasEvidence: false, hasPolicy: true } })],
    });
    expect(mirror.controls[0]).toMatchObject({
      isReady: true,
      isMonitored: true,
      hasEvidence: false,
      hasPolicy: true,
    });
  });

  it('links requirements to their controls through the control-side requirement ids', () => {
    const mirror = build({
      requirementsByFramework: new Map([[1, [requirement({ id: 10 }), requirement({ id: 11 })]]]),
      controls: [
        control({ id: 100, requirements: [{ id: 10 }, { id: 11 }] }),
        control({ id: 101, requirements: [{ id: 10 }] }),
        control({ id: 102, requirements: [{ id: 99 }] }),
      ],
    });
    const [first, second] = mirror.frameworks[0].requirements;
    expect(first.controlDrataIds).toEqual([100, 101]);
    expect(second.controlDrataIds).toEqual([100]);
  });

  it('parses control archivedAt and rejects invalid dates', () => {
    const mirror = build({
      controls: [
        control({ id: 100, archivedAt: '2026-02-01T00:00:00Z' }),
        control({ id: 101, archivedAt: 'not-a-date' }),
      ],
    });
    expect(mirror.controls[0].archivedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(mirror.controls[1].archivedAt).toBeNull();
  });
});
