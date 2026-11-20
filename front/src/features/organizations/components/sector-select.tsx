import { compareText } from '@app/utils/text-fold';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, Ref } from 'react';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useTRPC } from '../../../lib';

interface SectorSelectProps {
  value: string | null | undefined,
  onValueChange: (value: string | null) => void,
  onBlur?: () => void,
  triggerRef?: Ref<HTMLButtonElement>,
  label?: string,
  required?: boolean,
  error?: string,
}

export const SectorSelect: FunctionComponent<SectorSelectProps> = ({ value, onValueChange, onBlur, triggerRef, label, required, error }) => {
  const trpc = useTRPC();
  const { data: sectors } = useQuery(trpc.sectors.getSectors.queryOptions());

  return (
    <div>
      <Select
        value={value ?? ''}
        onValueChange={(v) => onValueChange(v || null)}
        error={error !== undefined}
      >
        {label !== undefined && <SelectLabel required={required}>{label}</SelectLabel>}
        <SelectTrigger ref={triggerRef} className="w-full" onBlur={onBlur}>
          <SelectValue placeholder={t`Select a sector`} />
        </SelectTrigger>
        <SelectContent>
          {sectors?.toSorted((first, second) => compareText(first.name, second.name)).map((sector) => (
            <SelectItem key={sector.id} value={sector.id}>
              {sector.name}
            </SelectItem>
          ))}
        </SelectContent>
        {error !== undefined && <SelectHelperText>{error}</SelectHelperText>}
      </Select>
    </div>
  );
};
