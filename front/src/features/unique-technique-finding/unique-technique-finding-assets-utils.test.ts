import { describe, expect, it } from 'vitest';
import type { UniqueTechniqueFindingAssetSource } from './unique-technique-finding-assets-utils';
import { toUniqueTechniqueFindingAssetRow } from './unique-technique-finding-assets-utils';

const source = (overrides: Partial<UniqueTechniqueFindingAssetSource>): UniqueTechniqueFindingAssetSource => ({
  evidenceId: 'e1',
  cveId: null,
  cveTitle: null,
  mitreTechniqueExternalId: 'T1059',
  mitreTechniqueName: 'Command and Scripting Interpreter',
  expectationType: 'detection',
  currentState: 'applicable',
  stateOrigin: null,
  dismissalType: null,
  score: null,
  band: null,
  pendingVector: false,
  assetName: 'ws-fin-014',
  assetDerivedName: null,
  assetCategoryId: 'host',
  assetCriticality: 'high',
  assetPlatforms: ['linux', 'windows'],
  sources: ['openaev'],
  lastEvaluatedAt: null,
  firstSeenAt: null,
  ...overrides,
});

describe('toUniqueTechniqueFindingAssetRow', () => {
  it('should keep the finding row and carry the asset criticality and platforms beside it', () => {
    const row = toUniqueTechniqueFindingAssetRow(source({}));

    expect(row).toMatchObject({
      id: 'e1', name: 'T1059', kind: 'detection_response', assetName: 'ws-fin-014', assetCriticality: 'high', assetPlatforms: ['linux', 'windows'],
    });
  });

  it('should count the age in whole days since the finding was first seen', () => {
    const row = toUniqueTechniqueFindingAssetRow(
      source({ firstSeenAt: new Date('2026-09-17T12:00:00Z') }),
      new Date('2026-10-08T12:00:00Z'),
    );

    expect(row.ageDays).toBe(21);
  });
});
