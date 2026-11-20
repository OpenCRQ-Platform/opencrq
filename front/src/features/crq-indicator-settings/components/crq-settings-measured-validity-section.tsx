import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { NullableNumberInput, SectionCard } from '../../../components/shared';

interface CrqSettingsMeasuredValiditySectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
}

export const CrqSettingsMeasuredValiditySection: FunctionComponent<CrqSettingsMeasuredValiditySectionProps> = ({ control }) => (
  <SectionCard title={t`Validity of a test result`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>
        Control validation reads a control's test results where they exist, and what the control
        declarations claim where none does. This setting decides when a test result expires and
        stops counting as a validation of the control, and when a declared phishing simulation
        expires and gives way to the default.
      </Trans>
    </p>
    <div className="grid grid-cols-2 gap-4">
      <Controller
        control={control}
        name="measuredValidityDays"
        render={({ field, fieldState }) => (
          <NullableNumberInput
            label={t`Result stays valid for (days)`}
            helperText={t`Leave empty to let a result count however old it is.`}
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
    </div>
  </SectionCard>
);
