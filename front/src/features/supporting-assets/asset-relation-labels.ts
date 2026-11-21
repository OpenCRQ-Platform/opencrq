import { t } from '@lingui/core/macro';
import type { AssetRelationKind, AssetRelationSource } from '@app/module/client';
import type { AssetRelationDirection } from './asset-relations-utils';

/**
 * Never "owner": the Information card's `Owner` is the asset owner, the accountable person, a
 * different fact. An inventory names the person using a machine "assigned to", beside its owner.
 */
export const assetRelationGroupLabel = (kind: AssetRelationKind, direction: AssetRelationDirection): string => {
  const labels: Record<AssetRelationKind, Record<AssetRelationDirection, string>> = {
    primary_user_of: { outgoing: t`Assigned devices`, incoming: t`Assigned to` },
    reachable_from: { outgoing: t`Reached from`, incoming: t`Leads to` },
  };
  return labels[kind][direction];
};

export const assetRelationGroupLine = (kind: AssetRelationKind, direction: AssetRelationDirection, named: string): string => {
  const lines: Record<AssetRelationKind, Record<AssetRelationDirection, string>> = {
    primary_user_of: { outgoing: t`Assigned devices: ${named}`, incoming: t`Assigned to: ${named}` },
    reachable_from: { outgoing: t`Reached from: ${named}`, incoming: t`Leads to: ${named}` },
  };
  return lines[kind][direction];
};

/** One relation read from the asset it ends on, with the band it gives that asset when it gives one. */
export const assetRelationSentence = (kind: AssetRelationKind, holder: string, other: string, band: string | null): string => {
  if (band === null) {
    const plain: Record<AssetRelationKind, string> = {
      primary_user_of: t`${holder}, assigned to ${other}.`,
      reachable_from: t`${holder}, leads to ${other} on an attack path.`,
    };
    return plain[kind];
  }
  const lifting: Record<AssetRelationKind, string> = {
    primary_user_of: t`${holder}, assigned to ${other}, which gives it ${band}.`,
    reachable_from: t`${holder}, leads to ${other} on an attack path, which gives it ${band}.`,
  };
  return lifting[kind];
};

/** Read from the end the graph's arrow leaves: the device of a `primary_user_of`, the asset an attack path leaves on a `reachable_from`. */
export const assetRelationKindLabel = (kind: AssetRelationKind): string => assetRelationGroupLabel(kind, 'incoming');

/** The legend's own, in the lower case its other link entries take. */
export const assetRelationLegendLabel = (kind: AssetRelationKind): string => {
  const labels: Record<AssetRelationKind, string> = {
    primary_user_of: t`assigned to`,
    reachable_from: t`attack path`,
  };
  return labels[kind];
};

export const assetRelationSourceLabel = (source: AssetRelationSource): string => {
  const labels: Record<AssetRelationSource, string> = {
    entra_registered_owner: t`Microsoft Entra ID`,
    intune_primary_user: t`Intune`,
    openaev_attack_path_proven: t`OpenAEV, proven by a test`,
    openaev_attack_path_inferred: t`OpenAEV, inferred`,
  };
  return labels[source];
};
