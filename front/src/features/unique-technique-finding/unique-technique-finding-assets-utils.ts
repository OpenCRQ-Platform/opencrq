import type { AssetCriticality } from '@app/module/client';
import type { FindingTableRow, FindingTableSource } from '../findings-home/findings-table-utils';
import { toFindingTableRow } from '../findings-home/findings-table-utils';

export interface UniqueTechniqueFindingAssetSource extends FindingTableSource {
  assetCriticality: AssetCriticality,
  assetPlatforms: Array<string>,
}

export interface UniqueTechniqueFindingAssetRow extends FindingTableRow {
  assetCriticality: AssetCriticality,
  assetPlatforms: Array<string>,
}

export const toUniqueTechniqueFindingAssetRow = (
  finding: UniqueTechniqueFindingAssetSource,
  now: Date = new Date(),
): UniqueTechniqueFindingAssetRow => ({
  ...toFindingTableRow(finding, now),
  assetCriticality: finding.assetCriticality,
  assetPlatforms: finding.assetPlatforms,
});
