import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getFindingTitle } from './finding-title';

const TECHNIQUE_FINDING = {
  cveId: null,
  mitreTechniqueExternalId: 'T1003',
  expectationType: 'prevention' as const,
  sourceScenarioName: 'Credential harvesting',
};

describe('getFindingTitle', () => {
  beforeAll(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('names both halves of the pair on a CVE finding', () => {
    expect(getFindingTitle({
      cveId: 'CVE-2023-4863',
      mitreTechniqueExternalId: null,
      expectationType: null,
      sourceScenarioName: null,
      assetName: 'wks-fin-042',
    })).toBe('CVE-2023-4863 on wks-fin-042');
  });

  it('names the asset by its derived name when it has no name of its own', () => {
    expect(getFindingTitle({
      cveId: 'CVE-2023-4863',
      mitreTechniqueExternalId: null,
      expectationType: null,
      sourceScenarioName: null,
      assetName: null,
      assetDerivedName: '10.0.0.7',
    })).toBe('CVE-2023-4863 on 10.0.0.7');
  });

  it('prefers the name over the derived name', () => {
    expect(getFindingTitle({
      cveId: 'CVE-2023-4863',
      mitreTechniqueExternalId: null,
      expectationType: null,
      sourceScenarioName: null,
      assetName: 'wks-fin-042',
      assetDerivedName: '10.0.0.7',
    })).toBe('CVE-2023-4863 on wks-fin-042');
  });

  it('falls back to the flaw alone where the asset half is not known', () => {
    // The asset name is optional on the payloads that carry no join to it, and a title reading
    // "CVE-2023-4863 on " would state a pair the caller never gave.
    expect(getFindingTitle({
      cveId: 'CVE-2023-4863',
      mitreTechniqueExternalId: null,
      expectationType: null,
      sourceScenarioName: null,
    })).toBe('CVE-2023-4863');
    expect(getFindingTitle({
      cveId: 'CVE-2023-4863',
      mitreTechniqueExternalId: null,
      expectationType: null,
      sourceScenarioName: null,
      assetName: null,
      assetDerivedName: null,
    })).toBe('CVE-2023-4863');
  });

  it('leaves a technique-expectation finding on its scenario wording', () => {
    expect(getFindingTitle(TECHNIQUE_FINDING)).toBe('Prevention of T1003 on Credential harvesting');
    // An asset name reaching this branch changes nothing: the scenario is what the pair reads as.
    expect(getFindingTitle({ ...TECHNIQUE_FINDING, assetName: 'wks-fin-042' }))
      .toBe('Prevention of T1003 on Credential harvesting');
  });

  it('falls back to the technique id where the scenario half is missing', () => {
    expect(getFindingTitle({ ...TECHNIQUE_FINDING, sourceScenarioName: null })).toBe('T1003');
  });
});
