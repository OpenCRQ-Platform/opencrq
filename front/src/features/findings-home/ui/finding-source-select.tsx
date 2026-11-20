import { UserRound } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { getConnectorIconBySource, getConnectorNameBySource } from '../../integrations';

/** Names no connector: a finding attached by hand, with no reporting source at all. */
const NO_SOURCE = 'user';

const sourceFilterLabel = (source: string): string => (source === NO_SOURCE ? t`Set by user` : (getConnectorNameBySource(source) ?? source));

interface FindingSourceSelectProps {
  /** `all` for no filter. */
  value: string,
  /** `undefined` while loading, never as "no source". */
  sourceCounts: Array<{ source: string, findingCount: number }> | undefined,
  onChange: (value: string) => void,
}

export const FindingSourceSelect: FunctionComponent<FindingSourceSelectProps> = ({ value, sourceCounts, onChange }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="w-40" aria-label={t`Filter by source`}>
      <SelectValue placeholder={t`Source: All sources`} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all"><Trans>All sources</Trans></SelectItem>
      {(sourceCounts ?? []).map(({ source, findingCount }) => {
        const icon = source === NO_SOURCE ? null : getConnectorIconBySource(source);
        return (
          <SelectItem key={source} value={source}>
            <span className="flex items-center gap-1.5">
              {source === NO_SOURCE && <UserRound className="h-3.5 w-3.5" />}
              {icon !== null && <img src={icon} alt="" className="h-3.5 w-3.5 rounded-full object-contain" />}
              {sourceFilterLabel(source)}
              <span className="text-muted-foreground">({findingCount})</span>
            </span>
          </SelectItem>
        );
      })}
    </SelectContent>
  </Select>
);
