import { compareText } from '@app/utils/text-fold';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, Ref } from 'react';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useTRPC } from '../../../lib';

interface CountrySelectProps {
  value: string | null | undefined,
  onValueChange: (value: string | null) => void,
  onBlur?: () => void,
  triggerRef?: Ref<HTMLButtonElement>,
  label?: string,
  required?: boolean,
  error?: string,
}

export const CountrySelect: FunctionComponent<CountrySelectProps> = ({ value, onValueChange, onBlur, triggerRef, label, required, error }) => {
  const trpc = useTRPC();
  const { data: countries } = useQuery(trpc.countries.getCountries.queryOptions());

  return (
    <div>
      <Select
        value={value ?? ''}
        onValueChange={(v) => onValueChange(v || null)}
        error={error !== undefined}
      >
        {label !== undefined && <SelectLabel required={required}>{label}</SelectLabel>}
        <SelectTrigger ref={triggerRef} className="w-full" onBlur={onBlur}>
          <SelectValue placeholder={t`Select a country`} />
        </SelectTrigger>
        <SelectContent>
          {countries?.toSorted((first, second) => compareText(first.name, second.name)).map((country) => (
            <SelectItem key={country.id} value={country.id}>
              {country.name}
            </SelectItem>
          ))}
        </SelectContent>
        {error !== undefined && <SelectHelperText>{error}</SelectHelperText>}
      </Select>
    </div>
  );
};
