import {
  Combobox,
  ComboboxChips,
  ComboboxClear,
  ComboboxControls,
  ComboboxField,
  ComboboxHelperText,
  ComboboxInput,
  ComboboxLabel,
  ComboboxTrigger,
} from '@filigran/design-system';
import type { ComboboxValue } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode, Ref } from 'react';
import { filterOptionsByLabel } from '../../utils';
import { ComboboxPanel } from './combobox-panel';

export interface SelectFieldOption {
  label: string,
  value: string,
}

interface SelectFieldBaseProps {
  options: Array<SelectFieldOption>,
  label: string,
  onBlur?: () => void,
  inputRef?: Ref<HTMLInputElement>,
  required?: boolean,
  error?: string,
  helperText?: ReactNode,
  placeholder?: string,
  emptyMessage?: string,
  disabled?: boolean,
  /** Drops the label element; the field is then named through the input alone. */
  hideLabel?: boolean,
  /** Shows the clear control; `false` for a field that always holds a value. Defaults to true. */
  clearable?: boolean,
  /** Draws an option's row in the list; the input still shows the option's label. */
  renderOption?: (option: SelectFieldOption) => ReactNode,
  /** Multiple only: shows at most this many chips, then a "+N" chip, and keeps the field on one line, for a narrow table cell. */
  maxVisibleChips?: number,
}

/**
 * Password managers ignore `autocomplete="off"` and classify a field by the text around it, so a
 * combobox labelled like an address field ("Country") gets their inline menu. A combobox is never an
 * autofill target: these are the opt-outs 1Password, Bitwarden and LastPass document.
 */
const PASSWORD_MANAGER_IGNORE = {
  'data-1p-ignore': true,
  'data-bwignore': true,
  'data-lpignore': 'true',
} as const;

const toOptions = (next: ComboboxValue<SelectFieldOption>): Array<SelectFieldOption> => {
  if (Array.isArray(next)) {
    return next;
  }
  return next === null ? [] : [next];
};

interface OptionComboboxProps extends SelectFieldBaseProps {
  multiple: boolean,
  selected: Array<SelectFieldOption>,
  onSelectionChange: (options: Array<SelectFieldOption>) => void,
}

const OptionCombobox: FunctionComponent<OptionComboboxProps> = ({
  multiple,
  selected,
  onSelectionChange,
  options,
  label,
  onBlur,
  inputRef,
  required,
  error,
  helperText,
  placeholder,
  emptyMessage,
  disabled,
  hideLabel,
  clearable,
  renderOption,
  maxVisibleChips,
}) => {
  const message = error ?? helperText;

  return (
    <Combobox
      multiple={multiple}
      options={options}
      value={multiple ? selected : (selected[0] ?? null)}
      onValueChange={(next) => onSelectionChange(toOptions(next))}
      getOptionLabel={(option) => option.label}
      filterOptions={filterOptionsByLabel((option) => option.label)}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
      required={required}
      error={error !== undefined}
      labelPosition={hideLabel ? 'none' : 'top'}
      clearable={clearable !== false}
      renderOption={renderOption}
      maxVisibleChips={multiple ? maxVisibleChips : undefined}
    >
      <ComboboxLabel required={required}>{label}</ComboboxLabel>
      <ComboboxField>
        {multiple && (
          <ComboboxChips
            aria-label={label}
            overflowLabel={(count, labels) => i18n._({ id: '+{count} more: {labels}', message: '+{count} more: {labels}', values: { count, labels: labels.join(', ') } })}
          />
        )}
        <ComboboxInput
          ref={inputRef}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-label={hideLabel ? label : undefined}
          {...PASSWORD_MANAGER_IGNORE}
        />
        <ComboboxControls>
          <ComboboxClear aria-label={t`Clear the selection`} />
          <ComboboxTrigger aria-label={t`Toggle the options`} />
        </ComboboxControls>
      </ComboboxField>
      <ComboboxPanel emptyMessage={emptyMessage ?? t`No results`} listAriaLabel={t`Suggestions`} />
      {message !== undefined && <ComboboxHelperText>{message}</ComboboxHelperText>}
    </Combobox>
  );
};

interface SingleSelectFieldProps extends SelectFieldBaseProps {
  value: string | null,
  onChange: (value: string | null) => void,
}

export const SingleSelectField: FunctionComponent<SingleSelectFieldProps> = ({
  value,
  onChange,
  options,
  ...props
}) => (
  <OptionCombobox
    multiple={false}
    options={options}
    selected={options.filter((option) => option.value === value)}
    onSelectionChange={(next) => onChange(next[0]?.value ?? null)}
    {...props}
  />
);

interface MultiSelectFieldProps extends SelectFieldBaseProps {
  value: Array<string>,
  onChange: (value: Array<string>) => void,
}

export const MultiSelectField: FunctionComponent<MultiSelectFieldProps> = ({
  value,
  onChange,
  options,
  ...props
}) => (
  <OptionCombobox
    multiple
    options={options}
    selected={options.filter((option) => value.includes(option.value))}
    onSelectionChange={(next) => onChange(next.map((option) => option.value))}
    {...props}
  />
);
