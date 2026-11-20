import type { FunctionComponent, ReactElement } from 'react';
import { EmptyValue } from '../../../components/ui/empty-value';

interface ResourceLevelValueProps {
  value: string | null,
}

/**
 * The threat's STIX `resource_level`. The vocabulary is open — six values ship as built-ins
 * and a tenant may add more — so the string is printed verbatim, capitalised in CSS only. Neither a
 * translation nor a colour rank survives a value the platform has never seen.
 */
export const ResourceLevelValue: FunctionComponent<ResourceLevelValueProps> = ({ value }): ReactElement => {
  if (!value) {
    return <span className="text-muted-foreground"><EmptyValue /></span>;
  }
  return <span className="txt-table text-foreground capitalize">{value}</span>;
};
