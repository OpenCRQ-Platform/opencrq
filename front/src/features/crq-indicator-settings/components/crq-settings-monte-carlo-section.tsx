import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { NumberFormInput, SectionCard } from '../../../components/shared';

interface CrqSettingsMonteCarloSectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
}

export const CrqSettingsMonteCarloSection: FunctionComponent<CrqSettingsMonteCarloSectionProps> = ({ control }) => (
  <SectionCard title={t`Monte Carlo`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>Number of iterations run per simulation. Higher values increase accuracy but slow down computation.</Trans>
    </p>
    <Controller
      control={control}
      name="iterations"
      render={({ field, fieldState }) => (
        <NumberFormInput
          label={t`Iterations`}
          required
          step="1"
          min={1}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
          error={fieldState.error?.message}
        />
      )}
    />
  </SectionCard>
);
