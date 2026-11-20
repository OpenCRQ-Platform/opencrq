import type { SearchFieldProps } from '@filigran/design-system';
import { SearchField } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { useDebouncedDraft } from '../../hooks';

type DebouncedSearchFieldProps = Omit<SearchFieldProps, 'value' | 'defaultValue' | 'onChange' | 'onClear'> & {
  /** The committed search, usually a `useUrlListFilters` field. */
  value: string,
  onCommit: (next: string) => void,
  /** Required: the clear button is always rendered, and FDS falls back to an untranslated label. */
  clearLabel: string,
};

/**
 * Holds the typed draft itself, so a keystroke re-renders this field and nothing else: the list
 * that owns `value` only re-renders when `onCommit` fires, trailing-only after the debounce or on
 * blur.
 */
export const DebouncedSearchField: FunctionComponent<DebouncedSearchFieldProps> = ({
  value: committed,
  onCommit,
  onBlur,
  ...props
}) => {
  const { value, setValue, onBlur: flush } = useDebouncedDraft(committed, onCommit);
  return (
    <SearchField
      {...props}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClear={() => setValue('')}
      onBlur={(event) => {
        flush();
        onBlur?.(event);
      }}
    />
  );
};
