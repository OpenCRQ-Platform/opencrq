import { t } from '@lingui/core/macro';
import type { AssetCategory, AssetCriticality, AssetCriticalityRule, AssetManualAttribute, AssetSubcategory, SupportingAssetExposure } from '@app/module/client';
import type { AssetNameParts } from '../../utils/asset-name-utils';
import { getConnectorNameBySource } from '../integrations';
import { assetNameText } from '../../utils/asset-name-utils';
import { formatDate, getAssetCategoryLabel, getAssetCriticalityLabel, getAssetExposureLabel, getAssetSubcategoryLabel } from '../../utils';
import { assetManualAttributeLabel } from './asset-manual-attribute-vocabulary';

export type AssetRuleResolvedAttribute = 'name' | 'description' | 'exposure' | 'category' | 'subcategory' | 'criticality' | 'url' | 'linkedPerson' | 'firstSeenAt' | 'lastSeenAt';

export interface AssetResolutionSource {
  source: string | null,
  /** `user` for a hand-typed observation, which no scalar rule reads — see `getAssetFieldCopy`. */
  origin: 'connector' | 'user',
  reportedName: string | null,
  reportedDescription: string | null,
  reportedCategoryId: AssetCategory,
  reportedSubcategoryId: AssetSubcategory | null,
  reportedExposure: SupportingAssetExposure,
  reportedCriticality: AssetCriticality,
  reportedCriticalityRule: AssetCriticalityRule | null,
  reportedUrl: string | null,
  reportedLinkedPerson: string | null,
  firstSeenAt: Date | string | null,
  lastSeenAt: Date | string | null,
}

export interface AssetManualValueEntry {
  attribute: AssetManualAttribute,
  setByUserName: string | null,
  setAt: Date | string,
}

/** The band the asset takes from the identity it is assigned to; `fromAsset` is null once that identity is gone. */
export interface AssetCriticalityLiftEntry {
  criticality: AssetCriticality,
  fromAsset: (AssetNameParts & { criticality: AssetCriticality }) | null,
}

export interface AssetFieldCopy {
  what: string,
  how: string,
  /** Only present when a person overrode the field by hand. */
  caveat: string | null,
}

const sourceLabel = (source: string | null): string => (source === null ? t`Unknown source` : (getConnectorNameBySource(source) ?? source));

const reportedList = (sources: ReadonlyArray<AssetResolutionSource>, reading: (source: AssetResolutionSource) => string | null): string => {
  const entries = sources
    .map((s) => ({ label: sourceLabel(s.source), reading: reading(s) }))
    .filter((e): e is { label: string, reading: string } => e.reading !== null);
  if (entries.length === 0) {
    return t`No source reports it.`;
  }
  return entries.map((e) => `${e.label}: ${e.reading}`).join(', ');
};

const criticalityRuleLabel = (rule: AssetCriticalityRule): string => {
  const labels: Record<AssetCriticalityRule, string> = {
    domain_controller: t`domain controller`,
    certificate_services: t`certificate services`,
    federation_services: t`federation services`,
    entra_connect: t`Microsoft Entra Connect`,
    hypervisor: t`hypervisor`,
    backup: t`backup`,
    asset_value_very_high: t`declared Very High`,
    asset_value_high: t`declared High`,
    asset_value_low: t`declared Low`,
  };
  return labels[rule];
};

const criticalityReading = (source: AssetResolutionSource): string | null => {
  if (source.reportedCriticality === 'unknown') {
    return null;
  }
  const band = getAssetCriticalityLabel(source.reportedCriticality);
  if (source.reportedCriticalityRule === null) {
    return band;
  }
  const rule = criticalityRuleLabel(source.reportedCriticalityRule);
  return t`${band} (${rule})`;
};

export const liftReading = (lift: AssetCriticalityLiftEntry): string => {
  const band = getAssetCriticalityLabel(lift.criticality);
  if (lift.fromAsset === null) {
    return t`an identity no longer in the inventory, which gave ${band}`;
  }
  const name = assetNameText(lift.fromAsset, t`Unnamed asset`);
  const identityBand = getAssetCriticalityLabel(lift.fromAsset.criticality);
  return t`${name} (${identityBand}), which gives ${band}`;
};

const manualCaveat = (manualValue: AssetManualValueEntry | undefined): string | null => {
  if (manualValue === undefined) {
    return null;
  }
  const name = manualValue.setByUserName ?? t`a deleted user`;
  const date = formatDate(manualValue.setAt);
  return t`Edited by ${name} on ${date}. Resync will not undo it.`;
};

/**
 * What a rule-resolved field's `MetricInfo` says: what the value is, the rule that produced it —
 * naming every source's own reading, not just the winner — and, when a person overrode it by
 * hand, the caveat explaining why a routine sync leaves their edit in place.
 */
export const getAssetFieldCopy = (
  attribute: AssetRuleResolvedAttribute,
  allSources: ReadonlyArray<AssetResolutionSource>,
  manualValues: ReadonlyArray<AssetManualValueEntry>,
  criticalityLift: AssetCriticalityLiftEntry | null = null,
): AssetFieldCopy => {
  // The same observations the rule itself reads: `resolveAssetAttributes` (module) sets a manual
  // observation aside before resolving any scalar, so listing its reading here would credit it with
  // a say it does not have — a category it carries only to name its own property block.
  const sources = allSources.filter((s) => s.origin !== 'user');
  const manualAttribute: AssetManualAttribute | null = attribute === 'firstSeenAt' || attribute === 'lastSeenAt' || attribute === 'subcategory' ? null : attribute;
  const caveat = manualAttribute === null ? null : manualCaveat(manualValues.find((v) => v.attribute === manualAttribute));

  switch (attribute) {
    case 'name': {
      const reported = reportedList(sources, (s) => s.reportedName);
      return {
        what: t`The asset's display name.`,
        how: t`The name reported by the source most recently seen. Reported — ${reported}`,
        caveat,
      };
    }
    case 'exposure': {
      const reported = reportedList(sources, (s) => getAssetExposureLabel(s.reportedExposure));
      return {
        what: t`How reachable the asset is.`,
        how: t`The most severe exposure reported: Internet-facing > Internal > Unknown. Reported — ${reported}`,
        caveat,
      };
    }
    case 'category': {
      const reported = reportedList(sources, (s) => getAssetCategoryLabel(s.reportedCategoryId));
      return {
        what: t`The kind of asset this is.`,
        how: t`The most authoritative source wins (Microsoft Defender > OpenAEV > any other), ties broken by the most recently seen. Reported — ${reported}`,
        caveat,
      };
    }
    case 'description': {
      const reported = reportedList(sources, (s) => s.reportedDescription);
      return {
        what: t`What the asset is, in the words of whoever described it.`,
        how: t`The most recently reported description wins. Reported — ${reported}`,
        caveat,
      };
    }
    case 'subcategory': {
      const reported = reportedList(sources, (s) => (s.reportedSubcategoryId === null ? null : getAssetSubcategoryLabel(s.reportedSubcategoryId)));
      return {
        what: t`A finer-grained classification within the asset's category.`,
        how: t`Follows the category's own winning source, dropped if a hand-set category no longer places it there. Reported — ${reported}`,
        caveat,
      };
    }
    case 'criticality': {
      // `unknown` is what a connector files when it states nothing, so it reads as no report at all.
      const reported = reportedList(sources, criticalityReading);
      if (criticalityLift !== null) {
        const lifted = liftReading(criticalityLift);
        return {
          what: t`How critical the asset is.`,
          how: t`The highest band among its sources and the one its assigned user gives it. Assigned to ${lifted}. Reported — ${reported}`,
          caveat,
        };
      }
      return {
        what: t`How critical the asset is.`,
        how: t`The highest band among its sources. Reported — ${reported}`,
        caveat,
      };
    }
    case 'url': {
      const reported = reportedList(sources, (s) => s.reportedUrl);
      return {
        what: t`The asset's web address.`,
        how: t`The most recently reported URL wins. Reported — ${reported}`,
        caveat,
      };
    }
    case 'linkedPerson': {
      const reported = reportedList(sources, (s) => s.reportedLinkedPerson);
      return {
        what: t`The person this identity belongs to.`,
        how: t`The most recently reported name wins. Reported — ${reported}`,
        caveat,
      };
    }
    case 'firstSeenAt': {
      const reported = reportedList(sources, (s) => (s.firstSeenAt === null ? null : formatDate(s.firstSeenAt)));
      return {
        what: t`When the asset was first observed.`,
        how: t`The oldest first observation, across every source. Reported — ${reported}`,
        caveat: null,
      };
    }
    case 'lastSeenAt': {
      const reported = reportedList(sources, (s) => (s.lastSeenAt === null ? null : formatDate(s.lastSeenAt)));
      return {
        what: t`When the asset was last observed.`,
        how: t`The most recent last observation, across every source. Reported — ${reported}`,
        caveat: null,
      };
    }
  }
};

/** The label a rule-resolved field's `MetricInfo` popover repeats as its own header. */
export const getAssetFieldTitle = (attribute: AssetRuleResolvedAttribute): string => {
  if (attribute === 'firstSeenAt') {
    return t`First seen`;
  }
  if (attribute === 'lastSeenAt') {
    return t`Last seen`;
  }
  if (attribute === 'subcategory') {
    return t`Subcategory`;
  }
  return assetManualAttributeLabel(attribute);
};
