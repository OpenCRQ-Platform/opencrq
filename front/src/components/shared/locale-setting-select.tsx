import type { FunctionComponent } from 'react';
import type { SupportedLocale } from '../../lib/locale-utils';
import { fromLocaleSelectValue, toLocaleSelectValue } from '../../lib/locale-utils';
import { getLocaleSettingOptions } from '../../lib/i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface LocaleSettingSelectProps {
  /** Null is Automatic. */
  value: SupportedLocale | null,
  onValueChange: (value: SupportedLocale | null) => void,
  ariaLabel: string,
  disabled?: boolean,
  className?: string,
}

export const LocaleSettingSelect: FunctionComponent<LocaleSettingSelectProps> = ({ value, onValueChange, ariaLabel, disabled, className }) => (
  <Select
    value={toLocaleSelectValue(value)}
    disabled={disabled}
    onValueChange={(next) => onValueChange(fromLocaleSelectValue(next))}
  >
    <SelectTrigger className={className} aria-label={ariaLabel}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {getLocaleSettingOptions().map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.isAutomatic ? <span className="italic">{option.label}</span> : option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
