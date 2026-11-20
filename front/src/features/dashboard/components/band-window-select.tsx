import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { BandWindowId } from '../exposure-band-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { BAND_WINDOWS, isBandWindowId } from '../exposure-band-utils';

/**
 * Labels live here, not in the util: the presets are ids in pure code so it stays i18n-free.
 * Built per render so a locale switch reaches them.
 */
const windowLabel = (id: BandWindowId): string => {
  switch (id) {
    case '30d':
      return t`Last 30 days`;
    case '90d':
      return t`Last 90 days`;
    case '6m':
      return t`Last 6 months`;
    case '12m':
      return t`Last 12 months`;
    case 'all':
      return t`All history`;
  }
};

interface BandWindowSelectProps {
  value: BandWindowId,
  onChange: (value: BandWindowId) => void,
}

export const BandWindowSelect: FunctionComponent<BandWindowSelectProps> = ({ value, onChange }) => (
  <Select
    value={value}
    onValueChange={(next) => {
      if (isBandWindowId(next)) {
        onChange(next);
      }
    }}
  >
    <SelectTrigger className="w-40" aria-label={t`Time window`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {BAND_WINDOWS.map((window) => (
        <SelectItem key={window.id} value={window.id}>
          {windowLabel(window.id)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
