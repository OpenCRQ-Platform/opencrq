import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { t } from '@lingui/core/macro';

export interface MitreTechniqueSummary {
  id: string,
  externalId: string,
  name: string,
}

interface NameParts {
  outcomeName?: string,
  assetNames?: Array<string>,
}

/**
 * Generates a risk scenario name from its component parts.
 * Format: "[Outcome] on [Asset1, Asset2]"
 * Returns null if any part is missing.
 */
export const generateScenarioName = ({ outcomeName, assetNames }: NameParts): string | null => {
  if (!outcomeName || !assetNames || assetNames.length === 0) {
    return null;
  }
  const joinedAssets = assetNames.join(', ');
  return t`${outcomeName} on ${joinedAssets}`;
};

interface LookupItem {
  id: string,
  name: string,
}

/**
 * Resolves primary asset names from a list of IDs.
 */
export const resolveAssetNames = (
  primaryAssetIds: Array<string>,
  primaryAssets?: Array<LookupItem>,
): Array<string> => {
  if (!primaryAssets || primaryAssetIds.length === 0) {
    return [];
  }
  return primaryAssetIds
    .map((id) => primaryAssets.find((a) => a.id === id)?.name)
    .filter((name): name is string => name !== undefined);
};

interface AssetWithCategories {
  id: string,
  businessValueCategories?: Array<{ id: string, name: string }>,
}

/**
 * Splits assets into the ones the attack outcome can actually reach and the rest.
 *
 * Suggestion only: every asset stays in the grid and stays selectable, and an outcome with no
 * compatible category suggests nothing rather than emptying the list.
 */
export const partitionAssetsByCompatibility = <T extends AssetWithCategories>(
  assets: Array<T>,
  compatibleCategoryIds: Array<string>,
): { suggested: Array<T>, others: Array<T> } => {
  const compatible = new Set(compatibleCategoryIds);
  const suggested: Array<T> = [];
  const others: Array<T> = [];
  for (const asset of assets) {
    const isSuggested = compatible.size > 0
      && (asset.businessValueCategories ?? []).some((category) => compatible.has(category.id));
    (isSuggested ? suggested : others).push(asset);
  }
  return { suggested, others };
};

/**
 * How many cells of the activation matrix a selection of assets activates for an outcome, given the
 * business-value categories that outcome is compatible with. Zero means the scenario is legal and
 * recommends nothing.
 */
export const countCompatibleCells = <T extends AssetWithCategories>(
  assets: Array<T>,
  selectedAssetIds: Array<string>,
  compatibleCategoryIds: Array<string>,
): number => {
  const compatible = new Set(compatibleCategoryIds);
  const selected = new Set(selectedAssetIds);
  const activated = new Set<string>();
  for (const asset of assets) {
    if (!selected.has(asset.id)) {
      continue;
    }
    for (const category of asset.businessValueCategories ?? []) {
      if (compatible.has(category.id)) {
        activated.add(category.id);
      }
    }
  }
  return activated.size;
};

/**
 * Whether the scenario page may book a CRQ run, by hand or on its own. A scope that maps nothing
 * would have the job skip, write no row, and the next visit book another; an unanswered scope may be
 * that one. The engine refuses a scenario whose attacker mixture the job has not stored yet, so a run
 * booked before it lands fails for good: held, the auto-enqueue books it once the doorbell brings it.
 */
export const canRunScenario = ({ hasScope, noMappedAsset, isLoadingMixture, isMixturePending }: {
  hasScope: boolean,
  noMappedAsset: boolean,
  isLoadingMixture: boolean,
  isMixturePending: boolean,
}): boolean => hasScope && !noMappedAsset && !isLoadingMixture && !isMixturePending;

export const isControlDeployed =(strengthRung: StrengthRung, coverageBucket: CoverageBucket): boolean => strengthRung !== 'L0' && coverageBucket !== 'L0';

export const showsDeclaredNotDeployed = (isDeployed: boolean, isAssessed: boolean): boolean => isAssessed && !isDeployed;
