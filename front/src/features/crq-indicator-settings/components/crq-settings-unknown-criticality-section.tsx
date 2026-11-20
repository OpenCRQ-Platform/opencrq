import { DECLARED_CRITICALITY_VALUES } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { InfoTooltip, SectionCard } from '../../../components/shared';
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { getAssetCriticalityLabel } from '../../../utils';

interface CrqSettingsUnknownCriticalitySectionProps {
  control: Control<CrqIndicatorSettingsFormValues>,
}

export const CrqSettingsUnknownCriticalitySection: FunctionComponent<CrqSettingsUnknownCriticalitySectionProps> = ({ control }) => (
  <SectionCard
    title={(
      <span className="inline-flex items-center gap-1">
        <Trans>Unknown criticality</Trans>
        <InfoTooltip label={t`What the unknown criticality sets`}>
          <span><Trans>The criticality an asset that declares none counts as: in the finding score, and in the simulation, to weigh the assets the attacker moves through.</Trans></span>
        </InfoTooltip>
      </span>
    )}
  >
    <div className="grid grid-cols-2 gap-4">
      <Controller
        control={control}
        name="unknownCriticalityCountsAs"
        render={({ field }) => (
          <div>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectLabel required><Trans>Counts as</Trans></SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECLARED_CRITICALITY_VALUES.map((criticality) => (
                  <SelectItem key={criticality} value={criticality}>{getAssetCriticalityLabel(criticality)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      />
    </div>
  </SectionCard>
);
