import { Input, RadioGroup, Text } from '@filigran/design-system';
import type { EstateMode } from '@app/module/client';
import { DEFAULT_REACTION_TIME_HOURS, ESTATE_MODE_VALUES } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { NullableInput, NullableNumberInput, RadioCard } from '../../../components/shared';
import { formatNumber } from '../../../utils';
import { CountrySelect } from './country-select';
import { EstateAssetsPicker } from './estate-assets-picker';
import { EMPTY_ESTATE_MAPPING_DELTA } from './estate-assets-picker-utils';
import { SectorSelect } from './sector-select';

const isEstateMode = (value: string): value is EstateMode => (ESTATE_MODE_VALUES as ReadonlyArray<string>).includes(value);

export const scopeFormSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  legalEntityName: z.string().nullable(),
  sectorId: z.string().nullable(),
  countryId: z.string().nullable(),
  employeeCount: z.number().int().nonnegative().nullable(),
  domain: z.string().nullable(),
  reactionTimeMin: z.number().nonnegative().nullable(),
  reactionTimeLikely: z.number().positive().nullable(),
  reactionTimeMax: z.number().positive().nullable(),
  estateMode: z.enum(['open', 'closed']),
  mapping: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
}).superRefine((data, ctx) => {
  /*
   * The name is checked here rather than through `min(1)` so its message is translated at
   * validation time: a schema built at module load would freeze the locale.
   */
  if (data.name.trim() === '') {
    ctx.addIssue({ code: 'custom', message: t`A name is required`, path: ['name'] });
  }
  const { reactionTimeMin: min, reactionTimeLikely: likely, reactionTimeMax: max } = data;
  if (min === null && likely === null && max === null) {
    return;
  }
  const incomplete = t`Fill in all three values, or leave all three empty`;
  if (min === null) {
    ctx.addIssue({ code: 'custom', message: incomplete, path: ['reactionTimeMin'] });
  }
  if (likely === null) {
    ctx.addIssue({ code: 'custom', message: incomplete, path: ['reactionTimeLikely'] });
  }
  if (max === null) {
    ctx.addIssue({ code: 'custom', message: incomplete, path: ['reactionTimeMax'] });
  }
  if (min !== null && likely !== null && likely < min) {
    ctx.addIssue({ code: 'custom', message: t`Typical case must be ≥ best case`, path: ['reactionTimeLikely'] });
  }
  if (likely !== null && max !== null && max < likely) {
    ctx.addIssue({ code: 'custom', message: t`Worst case must be ≥ typical case`, path: ['reactionTimeMax'] });
  }
});

export type ScopeFormValues = z.infer<typeof scopeFormSchema>;

export const EMPTY_SCOPE_FORM: ScopeFormValues = {
  name: '',
  description: null,
  legalEntityName: null,
  sectorId: null,
  countryId: null,
  employeeCount: null,
  domain: null,
  reactionTimeMin: null,
  reactionTimeLikely: null,
  reactionTimeMax: null,
  estateMode: 'open',
  mapping: EMPTY_ESTATE_MAPPING_DELTA,
};

/** An empty containment time is priced with the engine's default, which the placeholders show. */
const reactionTimePlaceholder = (hours: number): string => formatNumber(hours);

export const ScopeIdentityFields: FunctionComponent<{ control: Control<ScopeFormValues> }> = ({ control }) => (
  <>
    <Controller
      control={control}
      name="name"
      render={({ field, fieldState }) => (
        <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
      )}
    />
    <Controller
      control={control}
      name="description"
      render={({ field, fieldState }) => (
        <NullableInput
          {...field}
          label={t`Description`}
          placeholder={t`What this risk scope does, in one or two sentences.`}
          error={fieldState.error?.message}
        />
      )}
    />
    <div className="grid grid-cols-2 gap-4">
      <Controller
        control={control}
        name="legalEntityName"
        render={({ field, fieldState }) => (
          <NullableInput {...field} label={t`Legal Entity Name`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="domain"
        render={({ field, fieldState }) => (
          <NullableInput {...field} label={t`Domain`} placeholder="example.com" error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="sectorId"
        render={({ field, fieldState }) => (
          <SectorSelect
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            triggerRef={field.ref}
            label={t`Sector`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="countryId"
        render={({ field, fieldState }) => (
          <CountrySelect
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            triggerRef={field.ref}
            label={t`Country`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="employeeCount"
        render={({ field, fieldState }) => (
          <NullableNumberInput {...field} label={t`Employee Count`} min="0" step="1" error={fieldState.error?.message} />
        )}
      />
    </div>
    <div className="space-y-2">
      <Text as="p" variant="content-compact-bold"><Trans>Containment time (MTTC)</Trans></Text>
      <Text as="p" variant="content-compact" className="text-default-secondary">
        <Trans>From your detection until containment: the attacker can no longer progress toward the objective. Full remediation is not part of this delay. In hours: all three values, or none.</Trans>
      </Text>
      <div className="grid grid-cols-3 gap-4">
        <Controller
          control={control}
          name="reactionTimeMin"
          render={({ field, fieldState }) => (
            <NullableNumberInput
              {...field}
              label={t`Best case (hours)`}
              placeholder={reactionTimePlaceholder(DEFAULT_REACTION_TIME_HOURS.min)}
              min="0"
              step="any"
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="reactionTimeLikely"
          render={({ field, fieldState }) => (
            <NullableNumberInput
              {...field}
              label={t`Typical case (hours)`}
              placeholder={reactionTimePlaceholder(DEFAULT_REACTION_TIME_HOURS.likely)}
              min="1"
              step="any"
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="reactionTimeMax"
          render={({ field, fieldState }) => (
            <NullableNumberInput
              {...field}
              label={t`Worst case (hours)`}
              placeholder={reactionTimePlaceholder(DEFAULT_REACTION_TIME_HOURS.max)}
              min="1"
              step="any"
              error={fieldState.error?.message}
            />
          )}
        />
      </div>
    </div>
    <Text as="p" variant="content-compact" className="text-default-secondary">
      <Trans>Only the name is required. The employee count, the sector and the country place each scenario's reference threat frequency, the size most of all. Without an employee count, the revenue band gives the size.</Trans>
    </Text>
  </>
);

interface ScopeEstateFieldsProps {
  control: Control<ScopeFormValues>,
  /** Absent while the scope is being created, where every tick is an addition. */
  organizationId?: string,
  mappedCount: number,
}

export const ScopeEstateFields: FunctionComponent<ScopeEstateFieldsProps> = ({ control, organizationId, mappedCount }) => {
  const estateMode = useWatch({ control, name: 'estateMode' });
  return (
    <Controller
      control={control}
      name="mapping"
      render={({ field }) => (
        <EstateAssetsPicker
          organizationId={organizationId}
          mappedCount={mappedCount}
          delta={field.value}
          onChange={field.onChange}
          disabled={estateMode === 'open'}
          header={(estateTotal) => (
            <Controller
              control={control}
              name="estateMode"
              render={({ field: modeField }) => (
                <RadioGroup
                  value={modeField.value}
                  onValueChange={(value) => {
                    if (isEstateMode(value)) {
                      modeField.onChange(value);
                    }
                  }}
                  aria-label={t`Estate measured`}
                  className="grid grid-cols-2 items-stretch gap-4"
                >
                  <RadioCard
                    value="open"
                    title={t`Whole estate`}
                    description={estateTotal === undefined
                      ? t`Measured over every asset of the tenant. The choice of a whole company, or of an entity that shares its estate.`
                      : plural(estateTotal, {
                        one: 'Measured over every asset of the tenant, # today. The choice of a whole company, or of an entity that shares its estate.',
                        other: 'Measured over every asset of the tenant, # today. The choice of a whole company, or of an entity that shares its estate.',
                      })}
                  />
                  <RadioCard
                    value="closed"
                    title={t`Mapped assets only`}
                    description={t`Measured over the assets mapped below. The choice of a subsidiary or of a unit running its own estate.`}
                  />
                </RadioGroup>
              )}
            />
          )}
        />
      )}
    />
  );
};
