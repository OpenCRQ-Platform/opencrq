import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CONFIDENCE_GATE_LEVELS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { ThreatRelevanceSettingsFormValues } from './threat-relevance-settings-schema';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { SectionCard } from '../../../components/shared';
import { confidenceGateLevelLabel } from '../confidence-gate-utils';

interface ThreatRelevanceConfidenceGateSectionProps {
  control: Control<ThreatRelevanceSettingsFormValues>,
}

export const ThreatRelevanceConfidenceGateSection: FunctionComponent<ThreatRelevanceConfidenceGateSectionProps> = ({ control }) => (
  <SectionCard title={t`Confidence gate`}>
    <p className="txt-sub-content text-muted-foreground">
      <Trans>A claim from a producer is read only when the source confidence it carries reaches this level. Claims below it are stored, not read: nothing is discarded, and lowering the gate brings them back without re-importing anything. The attack outcome probabilities OpenCRQ's internal model gives each threat do not depend on this gate. A new level applies the next time a list is read.</Trans>
    </p>
    <Controller
      control={control}
      name="confidenceGate"
      render={({ field, fieldState }) => (
        <div>
          <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))} error={fieldState.invalid}>
            <SelectLabel required>{t`Confidence gate`}</SelectLabel>
            <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONFIDENCE_GATE_LEVELS.map((level) => (
                <SelectItem key={level} value={String(level)}>{confidenceGateLevelLabel(level)}</SelectItem>
              ))}
            </SelectContent>
            {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
          </Select>
        </div>
      )}
    />
  </SectionCard>
);
