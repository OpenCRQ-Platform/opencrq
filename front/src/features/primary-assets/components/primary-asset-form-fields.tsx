import type { SecurityNeedCriterion, SecurityNeedLevel } from '@app/module/client';
import {
  Combobox,
  ComboboxClear,
  ComboboxControls,
  ComboboxField,
  ComboboxHelperText,
  ComboboxInput,
  ComboboxLabel,
  ComboboxTrigger,
  Input,
  Text,
} from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import {
  PRIMARY_ASSET_BUSINESS_FUNCTION_MAX_LENGTH,
  PRIMARY_ASSET_DURATION_MAX_MINUTES,
  PRIMARY_ASSET_REFERENCE_MAX_LENGTH,
  SECURITY_NEED_CRITERIA,
  SECURITY_NEED_LEVELS,
} from '@app/module/client';
import { Controller, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ComboboxPanel, MultiSelectField, NullableInput, NullableNumberInput, NullableTextarea, OwnerSelect, SingleSelectField } from '../../../components/shared';
import { filterOptionsByLabel } from '../../../utils';
import { businessResourceName } from '../../business-value-categories';
import { durationUnitLabel, securityCriterionLabel, securityNeedLabel } from '../primary-asset-fields-labels';
import { DURATION_UNITS, durationMinutes, isRtoAboveMtpd, splitDuration } from '../primary-asset-fields-utils';

const durationPartsSchema = z.object({
  amount: z.number().min(0).nullable(),
  unit: z.enum(DURATION_UNITS),
});

const DURATION_FIELDS = ['rto', 'rpo', 'mtpd'] as const;
type DurationField = (typeof DURATION_FIELDS)[number];

export const primaryAssetFormSchema = z.object({
  name: z.string().min(1),
  reference: z.string().nullable(),
  ownerId: z.string().nullable(),
  businessFunction: z.string().nullable(),
  description: z.string().nullable(),
  businessValueCategoryIds: z.array(z.string()),
  availability: z.enum(SECURITY_NEED_LEVELS).nullable(),
  integrity: z.enum(SECURITY_NEED_LEVELS).nullable(),
  confidentiality: z.enum(SECURITY_NEED_LEVELS).nullable(),
  traceability: z.enum(SECURITY_NEED_LEVELS).nullable(),
  rto: durationPartsSchema,
  rpo: durationPartsSchema,
  mtpd: durationPartsSchema,
}).superRefine((data, ctx) => {
  // Checked here rather than through `min(1)` so the message is translated at validation time: a
  // schema built at module load would freeze the locale.
  if (data.businessValueCategoryIds.length === 0) {
    ctx.addIssue({ code: 'custom', message: t`At least one business resource is required`, path: ['businessValueCategoryIds'] });
  }
  if ((data.reference?.trim().length ?? 0) > PRIMARY_ASSET_REFERENCE_MAX_LENGTH) {
    ctx.addIssue({ code: 'custom', message: i18n._({ id: 'At most {max} characters', message: 'At most {max} characters', values: { max: PRIMARY_ASSET_REFERENCE_MAX_LENGTH } }), path: ['reference'] });
  }
  if ((data.businessFunction?.trim().length ?? 0) > PRIMARY_ASSET_BUSINESS_FUNCTION_MAX_LENGTH) {
    ctx.addIssue({ code: 'custom', message: i18n._({ id: 'At most {max} characters', message: 'At most {max} characters', values: { max: PRIMARY_ASSET_BUSINESS_FUNCTION_MAX_LENGTH } }), path: ['businessFunction'] });
  }
  for (const field of DURATION_FIELDS) {
    if ((durationMinutes(data[field]) ?? 0) > PRIMARY_ASSET_DURATION_MAX_MINUTES) {
      ctx.addIssue({ code: 'custom', message: t`At most ten years`, path: [field, 'amount'] });
    }
  }
});

export type PrimaryAssetFormValues = z.infer<typeof primaryAssetFormSchema>;

interface StoredPrimaryAsset {
  name: string,
  reference: string | null,
  owner: { id: string } | null,
  businessFunction: string | null,
  description: string | null,
  businessValueCategories: Array<{ id: string }>,
  availability: SecurityNeedLevel | null,
  integrity: SecurityNeedLevel | null,
  confidentiality: SecurityNeedLevel | null,
  traceability: SecurityNeedLevel | null,
  rtoMinutes: number | null,
  rpoMinutes: number | null,
  mtpdMinutes: number | null,
}

export const emptyPrimaryAssetFormValues = (): PrimaryAssetFormValues => ({
  name: '',
  reference: null,
  ownerId: null,
  businessFunction: null,
  description: null,
  businessValueCategoryIds: [],
  availability: null,
  integrity: null,
  confidentiality: null,
  traceability: null,
  rto: splitDuration(null),
  rpo: splitDuration(null),
  mtpd: splitDuration(null),
});

export const primaryAssetFormValuesFrom = (asset: StoredPrimaryAsset): PrimaryAssetFormValues => ({
  name: asset.name,
  reference: asset.reference,
  ownerId: asset.owner?.id ?? null,
  businessFunction: asset.businessFunction,
  description: asset.description,
  businessValueCategoryIds: asset.businessValueCategories.map((category) => category.id),
  availability: asset.availability,
  integrity: asset.integrity,
  confidentiality: asset.confidentiality,
  traceability: asset.traceability,
  rto: splitDuration(asset.rtoMinutes),
  rpo: splitDuration(asset.rpoMinutes),
  mtpd: splitDuration(asset.mtpdMinutes),
});

/** What the create and update procedures take: every field sent, a blank one as `null`. */
export const primaryAssetInputFrom = ({ rto, rpo, mtpd, ...values }: PrimaryAssetFormValues) => ({
  ...values,
  rtoMinutes: durationMinutes(rto),
  rpoMinutes: durationMinutes(rpo),
  mtpdMinutes: durationMinutes(mtpd),
});

const levelOptions = () => SECURITY_NEED_LEVELS.map((level) => ({ value: level, label: securityNeedLabel(level) }));
const unitOptions = () => DURATION_UNITS.map((unit) => ({ value: unit, label: durationUnitLabel(unit) }));

const isLevel = (value: string | null): value is SecurityNeedLevel => SECURITY_NEED_LEVELS.some((level) => level === value);

const durationLabel = (field: DurationField): string => {
  switch (field) {
    case 'rto': return t`RTO`;
    case 'rpo': return t`RPO`;
    case 'mtpd': return t`MTPD`;
  }
};

interface PrimaryAssetFormFieldsProps {
  control: Control<PrimaryAssetFormValues>,
  businessResourceOptions: Array<{ label: string, value: string }>,
  businessFunctionSuggestions: Array<string>,
}

const SecurityNeedField: FunctionComponent<{ control: Control<PrimaryAssetFormValues>, criterion: SecurityNeedCriterion }> = ({ control, criterion }) => (
  <Controller
    control={control}
    name={criterion}
    render={({ field, fieldState }) => (
      <SingleSelectField
        options={levelOptions()}
        value={field.value}
        onChange={(next) => field.onChange(isLevel(next) ? next : null)}
        onBlur={field.onBlur}
        inputRef={field.ref}
        label={securityCriterionLabel(criterion)}
        placeholder={t`Not set`}
        clearable
        error={fieldState.error?.message}
      />
    )}
  />
);

const DurationFields: FunctionComponent<{ control: Control<PrimaryAssetFormValues>, field: DurationField, warning: string | undefined }> = ({ control, field: name, warning }) => (
  <div className="grid grid-cols-2 gap-4">
    <Controller
      control={control}
      name={`${name}.amount`}
      render={({ field, fieldState }) => (
        <NullableNumberInput
          ref={field.ref}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          min={0}
          label={durationLabel(name)}
          error={fieldState.error?.message}
          helperText={warning}
        />
      )}
    />
    <Controller
      control={control}
      name={`${name}.unit`}
      render={({ field }) => (
        <SingleSelectField
          options={unitOptions()}
          value={field.value}
          onChange={(next) => field.onChange(DURATION_UNITS.find((unit) => unit === next) ?? field.value)}
          onBlur={field.onBlur}
          inputRef={field.ref}
          label={t`Unit`}
          clearable={false}
        />
      )}
    />
  </div>
);

export const PrimaryAssetFormFields: FunctionComponent<PrimaryAssetFormFieldsProps> = ({
  control,
  businessResourceOptions,
  businessFunctionSuggestions,
}) => {
  const [rto, mtpd] = useWatch({ control, name: ['rto', 'mtpd'] });
  const rtoWarning = isRtoAboveMtpd(durationMinutes(rto), durationMinutes(mtpd))
    ? t`The RTO is longer than the MTPD.`
    : undefined;

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
            )}
          />
        </div>
        <Controller
          control={control}
          name="reference"
          render={({ field, fieldState }) => (
            <NullableInput
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              label={t`Reference`}
              placeholder={t`e.g. FIN-03`}
              error={fieldState.error?.message}
            />
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          control={control}
          name="ownerId"
          render={({ field, fieldState }) => (
            <OwnerSelect
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              label={t`Owner`}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="businessFunction"
          render={({ field, fieldState }) => (
            <Combobox
              options={businessFunctionSuggestions}
              value={field.value}
              onValueChange={(next) => field.onChange(next)}
              getOptionLabel={(option) => option}
              filterOptions={filterOptionsByLabel((option) => option)}
              allowCustomValue
              createValueFromInput={(input) => input.trim()}
              createOptionLabel={(input) => t`Use “${input}”`}
              createHintLabel={(input) => t`Press Enter to use “${input}”`}
              error={fieldState.invalid}
            >
              <ComboboxLabel>{t`Business function`}</ComboboxLabel>
              <ComboboxField>
                <ComboboxInput ref={field.ref} onBlur={field.onBlur} placeholder={t`e.g. Finance`} />
                <ComboboxControls>
                  <ComboboxClear aria-label={t`Clear the selection`} />
                  <ComboboxTrigger aria-label={t`Toggle the options`} />
                </ComboboxControls>
              </ComboboxField>
              <ComboboxPanel emptyMessage={t`No matching business function`} listAriaLabel={t`Suggestions`} />
              {fieldState.error?.message !== undefined && <ComboboxHelperText>{fieldState.error.message}</ComboboxHelperText>}
            </Combobox>
          )}
        />
      </div>
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <NullableTextarea
            value={field.value}
            onChange={field.onChange}
            label={t`Description`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="businessValueCategoryIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={businessResourceOptions}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            required
            label={t`Business resources`}
            placeholder={t`Select business resources`}
            emptyMessage={t`No business resources found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Text as="h3" variant="content-compact-bold"><Trans>Security needs</Trans></Text>
      <div className="grid grid-cols-2 gap-4">
        {SECURITY_NEED_CRITERIA.map((criterion) => (
          <SecurityNeedField key={criterion} control={control} criterion={criterion} />
        ))}
      </div>
      <Text as="h3" variant="content-compact-bold"><Trans>Recovery objectives</Trans></Text>
      {DURATION_FIELDS.map((field) => (
        <DurationFields key={field} control={control} field={field} warning={field === 'rto' ? rtoWarning : undefined} />
      ))}
    </>
  );
};

export const businessResourceOptionsFrom = (categories: ReadonlyArray<{ id: string, code: string, name: string }>) =>
  categories.map((category) => ({ label: businessResourceName(category), value: category.id }));
