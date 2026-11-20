import { t } from '@lingui/core/macro';
import type { AssetManualAttribute, AssetObservationProperties } from '@app/module/client';

/** The one place an asset's hand-editable attribute is named: the Information card and the resync confirmation share it. */
export const assetManualAttributeLabel = (attribute: AssetManualAttribute): string => {
  const labels: Record<AssetManualAttribute, string> = {
    name: t`Name`,
    exposure: t`Exposure`,
    category: t`Category`,
    criticality: t`Criticality`,
    description: t`Description`,
    subcategory: t`Subcategory`,
    url: t`URL`,
    linkedPerson: t`Person`,
  };
  return labels[attribute];
};

/**
 * Whether a manual observation's own field carries a value. An empty address list counts as unset,
 * as the merge in `resolveObservationProperties` (module) treats it.
 */
export const isManualPropertyValue = (value: string | boolean | ReadonlyArray<string> | null | undefined): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  return !(Array.isArray(value) && value.length === 0);
};

/** The fields of the manual property block a person filled, named as the Network, Machine, Cloud, AI target connection and Identity cards name them. */
export const manualPropertyFieldLabels = (manualProperties: AssetObservationProperties | null): Array<string> => {
  if (manualProperties === null) {
    return [];
  }
  const fields: Array<[string, string | boolean | ReadonlyArray<string> | null]> = (() => {
    switch (manualProperties.family) {
      case 'ai_target':
        return [
          [t`Provider`, manualProperties.provider],
          [t`Modality`, manualProperties.modality],
          [t`Model`, manualProperties.model],
          [t`Endpoint URL`, manualProperties.endpointUrl],
          [t`System prompt`, manualProperties.systemPrompt],
        ];
      case 'identity':
        return [
          [t`User principal name`, manualProperties.userPrincipalName],
          [t`Account name`, manualProperties.accountName],
          [t`Account domain`, manualProperties.accountDomain],
          [t`Directory`, manualProperties.identityProvider],
          [t`Department`, manualProperties.department],
          [t`Job title`, manualProperties.jobTitle],
          [t`Account enabled`, manualProperties.isEnabled],
          [t`Directory roles`, manualProperties.assignedRoles],
          [t`Privileged PIM roles`, manualProperties.privilegedPimRoles],
        ];
      case 'machine':
        return [
          [t`Hostname`, manualProperties.hostname],
          [t`Seen IP`, manualProperties.seenIp],
          [t`Platform`, manualProperties.platform],
          [t`Architecture`, manualProperties.arch],
          [t`Operating system`, manualProperties.operatingSystem],
          [t`OS version`, manualProperties.osVersion],
          [t`Vendor`, manualProperties.vendor],
          [t`Model`, manualProperties.model],
          [t`IP addresses`, manualProperties.ipAddresses],
          [t`MAC addresses`, manualProperties.macAddresses],
          [t`End of life`, manualProperties.isEol],
          [t`Cloud provider`, manualProperties.cloudProvider],
          [t`Native type`, manualProperties.cloudNativeType],
          [t`Region`, manualProperties.cloudRegion],
        ];
    }
  })();
  return fields.flatMap(([label, value]) => (isManualPropertyValue(value) ? [label] : []));
};
