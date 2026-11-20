import { t } from '@lingui/core/macro';
import type { ManagedTag, TagSource } from './tag-management-utils';
import { getConnectorNameBySource } from '../../integrations';
import { MANUAL_SOURCE, XTM_ONE_SOURCE } from './tag-management-utils';

export const sourceLabel = (source: TagSource): string => {
  if (source === MANUAL_SOURCE) {
    return t`Manual`;
  }
  if (source === XTM_ONE_SOURCE) {
    return t`XTM One`;
  }
  return getConnectorNameBySource(source) ?? source;
};

export const sourceLabelsOf = (tag: ManagedTag): Array<string> => [
  ...new Set(tag.sources.map((entry) => sourceLabel(entry.kind === 'connector' ? entry.source : entry.kind))),
];

/** The header of the column listing the names connectors report, naming the connector when only one reports tags. */
export const connectorNamesHeader = (sources: ReadonlyArray<TagSource>): string => {
  const connectors = sources.filter((source) => source !== MANUAL_SOURCE && source !== XTM_ONE_SOURCE);
  if (connectors.length !== 1) {
    return t`Name in connectors`;
  }
  const connector = sourceLabel(connectors[0]);
  return t`Name in ${connector}`;
};
