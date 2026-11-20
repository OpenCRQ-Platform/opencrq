import { Input } from '@filigran/design-system';
import type { ComponentPropsWithRef, FunctionComponent } from 'react';

type NumberFormInputProps = Omit<ComponentPropsWithRef<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | undefined,
  onChange: (value: number | undefined) => void,
};

export const NumberFormInput: FunctionComponent<NumberFormInputProps> = ({
  value,
  onChange,
  ...props
}) => (
  <Input
    type="number"
    value={value === undefined || Number.isNaN(value) ? '' : String(value)}
    onChange={(e) => {
      const parsed = e.target.valueAsNumber;
      onChange(Number.isNaN(parsed) ? undefined : parsed);
    }}
    {...props}
  />
);
