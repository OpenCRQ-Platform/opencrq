import { t } from '@lingui/core/macro';
import type { FunctionComponent, Ref } from 'react';
import { z } from 'zod';
import { NumberFormInput } from '../../components/shared';
import { isToleranceBlank, MIN_TOLERANCE_PERCENT } from './risk-tolerance-utils';

export const riskToleranceFieldsSchema = () => ({
  annualLoss: z.number({ error: t`Enter an annual loss.` }).positive({ error: t`The annual loss must be above zero.` }),
  maxExceedancePercent: z.number({ error: t`Enter a maximum probability.` })
    .min(MIN_TOLERANCE_PERCENT, { error: t`The maximum probability must be between 0.1% and 100%.` })
    .max(100, { error: t`The maximum probability must be between 0.1% and 100%.` }),
});

/** Two blank fields pass. One filled field is checked as the required pair is, so a half-entered tolerance is refused. */
export const optionalRiskToleranceSchema = () => {
  const requiredPair = z.object(riskToleranceFieldsSchema());
  return z.object({
    annualLoss: z.number().or(z.nan()).optional(),
    maxExceedancePercent: z.number().or(z.nan()).optional(),
  }).superRefine((values, ctx) => {
    if (isToleranceBlank(values)) {
      return;
    }
    const parsed = requiredPair.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
    }
  });
};

interface ToleranceFieldProps {
  name: string,
  value: number | undefined,
  onChange: (value: number | undefined) => void,
  onBlur: () => void,
  inputRef: Ref<HTMLInputElement>,
  error: string | undefined,
  /** Off where the tolerance is optional and the two fields are filled together or not at all. */
  required?: boolean,
}

/** react-hook-form reads a field set to `undefined` as its default value, so a cleared field would refill: `NaN` keeps it blank and fails the schema. */
const keepBlank = (onChange: (value: number | undefined) => void) => (value: number | undefined): void => onChange(value ?? Number.NaN);

export const AnnualLossField: FunctionComponent<ToleranceFieldProps> = ({ inputRef, onChange, required, ...props }) => (
  <NumberFormInput {...props} onChange={keepBlank(onChange)} ref={inputRef} label={t`Annual loss (USD)`} required={required ?? true} min={0} step="any" />
);

export const MaxExceedancePercentField: FunctionComponent<ToleranceFieldProps> = ({ inputRef, onChange, required, ...props }) => (
  <NumberFormInput
    {...props}
    onChange={keepBlank(onChange)}
    ref={inputRef}
    label={t`Maximum probability of exceeding it (%)`}
    required={required ?? true}
    min={MIN_TOLERANCE_PERCENT}
    max={100}
    step="any"
    className="max-w-[320px]"
  />
);
