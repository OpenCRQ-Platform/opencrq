import { Checkbox, Input, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { Controller, useFormState } from 'react-hook-form';
import { z } from 'zod';
import { MultiSelectField, NullableTextarea } from '../../../components/shared';
import { securityCriterionLabel } from '../../primary-assets/primary-asset-fields-labels';
import { protectsField, REQUIREMENT_CRITERIA, requirementFormErrors } from '../requirements-utils';

export const requirementFormSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  interestedParty: z.string().trim().min(1),
  protectsConfidentiality: z.boolean(),
  protectsIntegrity: z.boolean(),
  protectsAvailability: z.boolean(),
  primaryAssetIds: z.array(z.string()),
  businessValueCategoryIds: z.array(z.string()),
  lossDriverIds: z.array(z.string()),
}).superRefine((data, ctx) => {
  // Translated at validation time: a schema built at module load would freeze the locale.
  const errors = requirementFormErrors(data);
  if (errors.noCriterion) {
    ctx.addIssue({ code: 'custom', message: t`Tick at least one criterion`, path: ['protectsAvailability'] });
  }
  if (errors.noTarget) {
    ctx.addIssue({ code: 'custom', message: t`Choose at least one primary asset or business resource`, path: ['primaryAssetIds'] });
  }
  if (errors.noLossDriver) {
    ctx.addIssue({ code: 'custom', message: t`Choose at least one loss driver`, path: ['lossDriverIds'] });
  }
});

export type RequirementFormValues = z.infer<typeof requirementFormSchema>;

export const emptyRequirementFormValues = (): RequirementFormValues => ({
  name: '',
  description: null,
  interestedParty: '',
  protectsConfidentiality: false,
  protectsIntegrity: false,
  protectsAvailability: false,
  primaryAssetIds: [],
  businessValueCategoryIds: [],
  lossDriverIds: [],
});

interface StoredRequirement {
  name: string,
  description: string | null,
  interestedParty: string,
  protectsConfidentiality: boolean,
  protectsIntegrity: boolean,
  protectsAvailability: boolean,
  primaryAssets: Array<{ id: string }>,
  businessValueCategories: Array<{ id: string }>,
  lossDrivers: Array<{ id: string }>,
}

export const requirementFormValuesFrom = (requirement: StoredRequirement): RequirementFormValues => ({
  name: requirement.name,
  description: requirement.description,
  interestedParty: requirement.interestedParty,
  protectsConfidentiality: requirement.protectsConfidentiality,
  protectsIntegrity: requirement.protectsIntegrity,
  protectsAvailability: requirement.protectsAvailability,
  primaryAssetIds: requirement.primaryAssets.map((asset) => asset.id),
  businessValueCategoryIds: requirement.businessValueCategories.map((category) => category.id),
  lossDriverIds: requirement.lossDrivers.map((driver) => driver.id),
});

type Options = Array<{ label: string, value: string }>;

interface RequirementFormFieldsProps {
  control: Control<RequirementFormValues>,
  primaryAssetOptions: Options,
  businessResourceOptions: Options,
  lossDriverOptions: Options,
}

export const RequirementFormFields: FunctionComponent<RequirementFormFieldsProps> = ({
  control,
  primaryAssetOptions,
  businessResourceOptions,
  lossDriverOptions,
}) => {
  const { errors } = useFormState({ control, name: 'protectsAvailability' });
  const criterionError = errors.protectsAvailability?.message;
  return (
    <>
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} placeholder={t`e.g. Hosting availability commitment`} required error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="interestedParty"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Interested party`} placeholder={t`e.g. a customer, a partner, a regulator`} required error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <NullableTextarea value={field.value} onChange={field.onChange} label={t`Description`} error={fieldState.error?.message} />
        )}
      />
      <div className="flex flex-col gap-2">
        <Text as="h3" variant="content-compact-bold"><Trans>Protects</Trans></Text>
        <div className="flex flex-wrap gap-6">
          {REQUIREMENT_CRITERIA.map((criterion) => (
            <Controller
              key={criterion}
              control={control}
              name={protectsField(criterion)}
              render={({ field }) => (
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  label={securityCriterionLabel(criterion)}
                />
              )}
            />
          ))}
        </div>
        {criterionError !== undefined && <Text variant="content-compact" className="text-feedback-error-primary">{criterionError}</Text>}
      </div>
      <Text as="h3" variant="content-compact-bold"><Trans>Targets</Trans></Text>
      <Controller
        control={control}
        name="primaryAssetIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={primaryAssetOptions}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Primary assets`}
            placeholder={t`Select primary assets`}
            emptyMessage={t`No primary assets found`}
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
            label={t`Business resources`}
            placeholder={t`Every primary asset carrying one of them`}
            emptyMessage={t`No business resources found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="lossDriverIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={lossDriverOptions}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            required
            label={t`Loss drivers opened when broken`}
            placeholder={t`Select loss drivers`}
            emptyMessage={t`No loss drivers found`}
            error={fieldState.error?.message}
          />
        )}
      />
    </>
  );
};
