import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';

interface RiskScopeFilterProps {
  value: string,
  scopes: Array<{ id: string, name: string }>,
  onChange: (riskScope: string) => void,
}

export const RiskScopeFilter: FunctionComponent<RiskScopeFilterProps> = ({ value, scopes, onChange }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="w-56" aria-label={t`Risk scope`}>
      <SelectValue placeholder={t`All risk scopes`} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">{t`All risk scopes`}</SelectItem>
      {scopes.toSorted((left, right) => left.name.localeCompare(right.name)).map((scope) => (
        <SelectItem key={scope.id} value={scope.id}>{scope.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);
