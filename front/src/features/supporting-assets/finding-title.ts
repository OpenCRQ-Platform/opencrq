import { t } from '@lingui/core/macro';
import type { ExpectationType } from '@app/module/client';
import { getExpectationTypeLabel } from '../../utils';
import { assetNameDisplay } from '../../utils/asset-name-utils';
import { EMPTY_VALUE } from '../../utils/empty-value';

interface FindingTitleSource {
  cveId: string | null,
  mitreTechniqueExternalId: string | null,
  expectationType: ExpectationType | null,
  sourceScenarioName: string | null,
  assetName?: string | null,
  assetDerivedName?: string | null,
}

/** A finding is a pair, so its title names both halves whenever the asset half is known. */
export const getFindingTitle = (finding: FindingTitleSource): string => {
  if (finding.cveId) {
    const cveId = finding.cveId;
    const asset = assetNameDisplay({ name: finding.assetName ?? null, derivedName: finding.assetDerivedName ?? null });
    if (asset.kind === 'unnamed') {
      return cveId;
    }
    const assetName = asset.text;
    return t`${cveId} on ${assetName}`;
  }

  if (finding.mitreTechniqueExternalId && finding.expectationType && finding.sourceScenarioName) {
    const expectationType = getExpectationTypeLabel(finding.expectationType);
    const techniqueId = finding.mitreTechniqueExternalId;
    const scenarioName = finding.sourceScenarioName;
    return t`${expectationType} of ${techniqueId} on ${scenarioName}`;
  }

  return finding.mitreTechniqueExternalId ?? EMPTY_VALUE;
};
