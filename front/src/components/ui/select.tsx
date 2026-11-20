import { Select as DesignSystemSelect } from '@filigran/design-system';
import type { SelectProps } from '@filigran/design-system';
import type { FunctionComponent } from 'react';

export {
  SelectContent,
  SelectHelperText,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@filigran/design-system';

/**
 * The design system's Select, minus the empty value it reports for a selection nobody made: Radix
 * keeps a hidden native select in sync and dispatches a `change` from it, and a value arriving
 * before the items have registered their options finds nothing to match, so the echo carries the
 * empty string. No item in this app declares an empty value, so such an echo is never a selection.
 */
export const Select: FunctionComponent<SelectProps> = ({ onValueChange, ...props }) => (
  <DesignSystemSelect
    {...props}
    onValueChange={(value) => {
      if (value !== '') {
        onValueChange?.(value);
      }
    }}
  />
);
