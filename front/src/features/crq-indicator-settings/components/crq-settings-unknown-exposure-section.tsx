import { UNKNOWN_EXPOSURE_COUNTS_AS_VALUES } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { InfoTooltip, SectionCard } from '../../../components/shared';
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { getAssetExposureLabel } from '../../../utils';

interface CrqSettingsUnknownExposureSectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
}

export const CrqSettingsUnknownExposureSection: FunctionComponent<CrqSettingsUnknownExposureSectionProps> = ({ control }) => (
  <SectionCard
    title={(
      <span className="inline-flex items-center gap-1">
        <Trans>Unknown exposure</Trans>
        <InfoTooltip label={t`What the unknown exposure sets`}>
          <span><Trans>The exposure an asset that declares none counts as: on the asset's TTP tab; in the finding score, which reads that exposure's weight; and in the simulation, at initial access and to weigh the assets the attacker moves through.</Trans></span>
        </InfoTooltip>
      </span>
    )}
  >
    <div className="grid grid-cols-2 gap-4">
      <Controller
        control={control}
        name="unknownExposureCountsAs"
        render={({ field }) => (
          <div>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectLabel required><Trans>Counts as</Trans></SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNKNOWN_EXPOSURE_COUNTS_AS_VALUES.map((exposure) => (
                  <SelectItem key={exposure} value={exposure}>{getAssetExposureLabel(exposure)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      />
    </div>
  </SectionCard>
);
