import { REVENUE_BAND_VALUES } from '@app/module/client';
import type { RevenueBand } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, Ref } from 'react';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { formatRevenueBand } from '../../../utils/format-revenue-band';

interface RevenueBandSelectProps {
  value: RevenueBand | null | undefined,
  onValueChange: (value: RevenueBand | null) => void,
  onBlur?: () => void,
  triggerRef?: Ref<HTMLButtonElement>,
  label?: string,
  required?: boolean,
  error?: string,
  helperText?: string,
}

export const RevenueBandSelect: FunctionComponent<RevenueBandSelectProps> = ({ value, onValueChange, onBlur, triggerRef, label, required, error, helperText }) => (
  <div>
    <Select
      value={value ?? ''}
      onValueChange={(v) => onValueChange(REVENUE_BAND_VALUES.find((band) => band === v) ?? null)}
      error={error !== undefined}
    >
      {label !== undefined && <SelectLabel required={required}>{label}</SelectLabel>}
      <SelectTrigger ref={triggerRef} className="w-full" onBlur={onBlur}>
        <SelectValue placeholder={t`Select a revenue band`} />
      </SelectTrigger>
      <SelectContent>
        {REVENUE_BAND_VALUES.map((band) => <SelectItem key={band} value={band}>{formatRevenueBand(band)}</SelectItem>)}
      </SelectContent>
      {(error ?? helperText) !== undefined && <SelectHelperText>{error ?? helperText}</SelectHelperText>}
    </Select>
  </div>
);
