import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { NumberFormInput, SectionCard } from '../../../components/shared';

interface CrqSettingsExposureWeightsSectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
}

export const CrqSettingsExposureWeightsSection: FunctionComponent<CrqSettingsExposureWeightsSectionProps> = ({ control }) => (
  <SectionCard title={t`Exposure Weights`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>Multipliers the finding score applies by exposure type, to how reachable a flaw is and to how relevant an asset is for each technique. Internet-facing assets typically carry more weight than internal ones. An asset of unknown exposure takes the weight of the exposure set under “Unknown exposure” below.</Trans>
    </p>
    <div className="grid grid-cols-2 gap-4">
      {(
        [
          ['exposureWeightInternetFacing', t`Internet facing`],
          ['exposureWeightInternal', t`Internal`],
        ] as const
      ).map(([name, label]) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field, fieldState }) => (
            <NumberFormInput
              label={label}
              required
              step="0.01"
              min={0.01}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              error={fieldState.error?.message}
            />
          )}
        />
      ))}
    </div>
  </SectionCard>
);
