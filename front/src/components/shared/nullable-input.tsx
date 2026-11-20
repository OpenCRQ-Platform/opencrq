import { Input, Textarea } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import type { ComponentPropsWithRef, FunctionComponent } from 'react';
import { useState } from 'react';
import { cn, formatNumber } from '../../utils';

type NullableInputProps = Omit<ComponentPropsWithRef<typeof Input>, 'value' | 'onChange'> & {
  value: string | null,
  onChange: (value: string | null) => void,
};

export const NullableInput: FunctionComponent<NullableInputProps> = ({
  value,
  onChange,
  ...props
}) => (
  <Input
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value || null)}
    {...props}
  />
);

type NullableNumberInputProps = Omit<ComponentPropsWithRef<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null,
  onChange: (value: number | null) => void,
};

/**
 * No stepper, and no wheel stepping. Both write a value nobody typed: on a narrow field the down
 * arrow sits where the reader clicks to place the caret, and stepping down from blank yields -1,
 * which then fails a `min(0)` rule the reader never broke.
 */
export const NullableNumberInput: FunctionComponent<NullableNumberInputProps> = ({
  value,
  onChange,
  className,
  ...props
}) => (
  <Input
    type="number"
    value={value === null ? '' : String(value)}
    onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    onWheel={(e) => e.currentTarget.blur()}
    className={cn('[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', className)}
    {...props}
  />
);

type FormattedNumberInputProps = Omit<ComponentPropsWithRef<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null,
  onChange: (value: number | null) => void,
};

const decimalSeparator = (): string =>
  new Intl.NumberFormat(i18n.locale || 'en').formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';

/**
 * Keeps a sign and one decimal point, drops everything else, and returns the amount with a `.`
 * whatever separator the application language writes. A field whose value is a rate or a cost per
 * day is not an integer, and a reader who types a negative must see the rule refuse it rather than
 * watch the minus disappear.
 */
const sanitizeAmount = (raw: string, decimal: string): string => {
  const negative = raw.trimStart().startsWith('-');
  const [whole = '', ...fraction] = raw.replaceAll(decimal, '.').replace(/[^\d.]/g, '').split('.');
  const digits = fraction.length === 0 ? whole : `${whole}.${fraction.join('')}`;
  return negative ? `-${digits}` : digits;
};

/**
 * A monetary amount: locale thousand separators at rest, and while focused the reader's own text,
 * held as typed. Without that draft, `520.` would round-trip through a number and lose the point
 * the reader had just typed, making a decimal impossible to enter.
 */
export const FormattedNumberInput: FunctionComponent<FormattedNumberInputProps> = ({
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? (value === null ? '' : formatNumber(value));
  const decimal = decimalSeparator();

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={(e) => {
        setDraft(value === null ? '' : String(value).replace('.', decimal));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const sanitized = sanitizeAmount(e.target.value, decimal);
        setDraft(sanitized.replace('.', decimal));
        const parsed = Number(sanitized);
        onChange(sanitized === '' || !Number.isFinite(parsed) ? null : parsed);
      }}
      {...props}
    />
  );
};

type NullableTextareaProps = Omit<ComponentPropsWithRef<typeof Textarea>, 'value' | 'onChange'> & {
  value: string | null,
  onChange: (value: string | null) => void,
};

export const NullableTextarea: FunctionComponent<NullableTextareaProps> = ({
  value,
  onChange,
  ...props
}) => (
  <Textarea
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value || null)}
    {...props}
  />
);
