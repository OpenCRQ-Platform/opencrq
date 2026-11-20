import { Input } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { Control, FieldValues, UseFormSetValue } from 'react-hook-form';
import { Controller, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  AI_TARGET_MODALITY_VALUES,
  AI_TARGET_PROVIDER_VALUES,
  ASSET_IDENTITY_PROVIDER_VALUES,
  CLOUD_PROVIDER_VALUES,
  ENDPOINT_ARCH_VALUES,
  identityFamilyOf,
} from '@app/module/client';
import type { AssetCategory, AssetSubcategory } from '@app/module/client';
import type { AssetPropertiesFormValues } from './asset-properties-form-utils';
import { NullableInput, NullableTextarea, SingleSelectField } from '../../../components/shared';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  getAiTargetModalityLabel,
  getAiTargetProviderLabel,
  getAssetIdentityProviderLabel,
  getAssetSubcategoryDescription,
  getAssetSubcategoryLabel,
  getCloudProviderLabel,
  getEndpointArchLabel,
  getEndpointPlatformLabel,
} from '../../../utils';
import { isSubcategoryValidFor, showsPersonField, showsUrlField, subcategoriesFor } from './asset-properties-form-utils';
import { DescribedOption } from './described-option';

/**
 * The OS families `normalizePlatform` recognises (`module/src/modules/supporting-assets/normalization.ts`);
 * anything else it stores as `null`. Offering this closed picklist rather than free text is what
 * keeps a hand-typed platform from silently disappearing once the value is saved.
 */
const PLATFORM_VALUES = ['windows', 'macos', 'linux', 'android', 'ios', 'container', 'service'] as const;

// Functions, not module-level constants: a `t` macro call is resolved once, at the moment it
// runs, so a picklist built at import time would freeze in whatever locale was active then.
const getPlatformOptions = () => PLATFORM_VALUES.map((value) => ({ value, label: getEndpointPlatformLabel(value) }));
const getArchOptions = () => ENDPOINT_ARCH_VALUES.map((value) => ({ value, label: getEndpointArchLabel(value) }));
const getCloudProviderOptions = () => CLOUD_PROVIDER_VALUES.map((value) => ({ value, label: getCloudProviderLabel(value) }));
const getAiTargetProviderOptions = () => AI_TARGET_PROVIDER_VALUES.map((value) => ({ value, label: getAiTargetProviderLabel(value) }));
const getAiTargetModalityOptions = () => AI_TARGET_MODALITY_VALUES.map((value) => ({ value, label: getAiTargetModalityLabel(value) }));
const getIdentityProviderOptions = () => ASSET_IDENTITY_PROVIDER_VALUES.map((value) => ({ value, label: getAssetIdentityProviderLabel(value) }));
const getSubcategoryOptions = (categoryId: AssetCategory) => subcategoriesFor(categoryId).map((value) => ({ value, label: getAssetSubcategoryLabel(value) }));

/** The runtime counterpart of {@link AssetPropertiesFormValues}, shared by both drawers so their forms cannot drift apart. */
export const assetPropertiesFormSchema = z.object({
  hostname: z.string().nullable(),
  seenIp: z.string().nullable(),
  ipAddressesText: z.string(),
  macAddressesText: z.string(),
  platform: z.string().nullable(),
  arch: z.enum(ENDPOINT_ARCH_VALUES).nullable(),
  machineVendor: z.string().nullable(),
  machineModel: z.string().nullable(),
  operatingSystem: z.string().nullable(),
  osVersion: z.string().nullable(),
  isEol: z.boolean().nullable(),
  cloudProvider: z.enum(CLOUD_PROVIDER_VALUES).nullable(),
  cloudNativeType: z.string().nullable(),
  cloudRegion: z.string().nullable(),
  provider: z.enum(AI_TARGET_PROVIDER_VALUES).nullable(),
  modality: z.enum(AI_TARGET_MODALITY_VALUES).nullable(),
  model: z.string().nullable(),
  endpointUrl: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  userPrincipalName: z.string().nullable(),
  accountName: z.string().nullable(),
  accountDomain: z.string().nullable(),
  identityProvider: z.enum(ASSET_IDENTITY_PROVIDER_VALUES).nullable(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  isEnabled: z.boolean().nullable(),
  assignedRolesText: z.string(),
  privilegedPimRolesText: z.string(),
});

/** The slice of a form's values `AssetCategoryFields` needs — shared by the create and update sheets, whose overall shapes otherwise differ. */
export interface AssetPropertiesFormFields extends FieldValues {
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  url: string | null,
  linkedPerson: string | null,
  properties: AssetPropertiesFormValues,
}

interface AssetCategoryFieldsProps<TFieldValues extends AssetPropertiesFormFields> {
  control: Control<TFieldValues>,
  setValue: UseFormSetValue<TFieldValues>,
  /** The asset's own URL/Person, not the form's live ones — see {@link showsUrlField}. `null` on a create drawer, which has no asset yet. */
  existingUrl: string | null,
  existingLinkedPerson: string | null,
}

/**
 * The category-dependent fields, shared by the create and update drawers so both offer the same
 * thing. This renders off the form's own `categoryId` — via
 * `useWatch`, not the asset's stored category — which is what makes switching the category select
 * replace Network/Cloud fields with AI target ones immediately, before the form is saved.
 */
export const AssetCategoryFields = <TFieldValues extends AssetPropertiesFormFields>({
  control: genericControl,
  setValue: genericSetValue,
  existingUrl,
  existingLinkedPerson,
}: AssetCategoryFieldsProps<TFieldValues>): ReactNode => {
  // `Path<TFieldValues>` cannot resolve literal field names against a generic type parameter, and
  // every caller's `TFieldValues` carries this exact shape (the constraint above), so narrowing
  // once here is what lets every `Controller`/`useWatch` below use a plain string name.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- TFieldValues extends AssetPropertiesFormFields, so this narrowing only restates the generic constraint
  const control = genericControl as unknown as Control<AssetPropertiesFormFields>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- same narrowing as `control` above, restating the generic constraint
  const setValue = genericSetValue as unknown as UseFormSetValue<AssetPropertiesFormFields>;
  const categoryId = useWatch({ control, name: 'categoryId' });
  const subcategoryId = useWatch({ control, name: 'subcategoryId' });
  const family = identityFamilyOf(categoryId);

  // A category switch can strand a subcategory that no longer belongs to it (e.g. Host → Identity
  // keeps 'server'); left alone, that stale pair would reach the backend and be silently dropped
  // by `subcategoryWithin` at resolution. Clearing it here marks the field dirty, which is what
  // lets the update sheet send the `null` that actually erases the earlier pin — the same
  // deliberate outcome as picking "no subcategory" by hand.
  //
  // An effect, not a render-time `setValue`, on purpose: `setValue` mutates react-hook-form's own
  // store and notifies its subscribers, which is not the kind of pure, repeatable read a render
  // may perform — it belongs in a commit-phase effect, the same reason a React state setter is the
  // one exception to that rule and an arbitrary external store call is not. Handling this at the
  // category `Select`'s own `onChange` instead — reacting the moment it changes rather than after
  // the fact — is not available here either: that `Select` lives in each drawer, not in this
  // shared component, so treating it there would duplicate the clearing logic at both call sites,
  // exactly what this component exists to avoid.
  useEffect(() => {
    if (!isSubcategoryValidFor(categoryId, subcategoryId)) {
      setValue('subcategoryId', null, { shouldDirty: true, shouldTouch: true });
    }
  }, [categoryId, subcategoryId, setValue]);

  const familyFields = family === 'machine' ? (
    <>
      <Controller
        control={control}
        name="properties.hostname"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Hostname`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.seenIp"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Seen IP`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.ipAddressesText"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`IP addresses`}
            placeholder={t`e.g. 10.0.0.1, 10.0.0.2`}
            helperText={fieldState.error?.message ?? t`Separate multiple addresses with commas.`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.macAddressesText"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`MAC addresses`}
            placeholder={t`e.g. AA:BB:CC:DD:EE:FF`}
            helperText={fieldState.error?.message ?? t`Separate multiple addresses with commas.`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.platform"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getPlatformOptions()}
            label={t`Platform`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.arch"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange as (value: string | null) => void}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getArchOptions()}
            label={t`Architecture`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.operatingSystem"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Operating system`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.osVersion"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`OS version`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.machineVendor"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Vendor`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.machineModel"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Model`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.isEol"
        render={({ field, fieldState }) => (
          <div>
            <Select
              value={field.value === null ? 'unknown' : (field.value ? 'yes' : 'no')}
              onValueChange={(value) => field.onChange(value === 'unknown' ? null : value === 'yes')}
              error={fieldState.invalid}
            >
              <SelectLabel>{t`End of life`}</SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue placeholder={t`Select`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t`Unknown`}</SelectItem>
                <SelectItem value="yes">{t`Yes`}</SelectItem>
                <SelectItem value="no">{t`No`}</SelectItem>
              </SelectContent>
              {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
            </Select>
          </div>
        )}
      />
      <Controller
        control={control}
        name="properties.cloudProvider"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange as (value: string | null) => void}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getCloudProviderOptions()}
            label={t`Cloud provider`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.cloudNativeType"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Native type`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.cloudRegion"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Region`} error={fieldState.error?.message} />
        )}
      />
    </>
  ) : family === 'ai_target' ? (
    <>
      <Controller
        control={control}
        name="properties.provider"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange as (value: string | null) => void}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getAiTargetProviderOptions()}
            label={t`Provider`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.modality"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange as (value: string | null) => void}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getAiTargetModalityOptions()}
            label={t`Modality`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.model"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Model`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.endpointUrl"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Endpoint URL`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.systemPrompt"
        render={({ field, fieldState }) => (
          <NullableTextarea value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`System prompt`} error={fieldState.error?.message} />
        )}
      />
    </>
  ) : family === 'identity' ? (
    <>
      <Controller
        control={control}
        name="properties.userPrincipalName"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`User principal name`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.accountName"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Account name`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.accountDomain"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Account domain`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.identityProvider"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange as (value: string | null) => void}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getIdentityProviderOptions()}
            label={t`Directory`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.department"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Department`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.jobTitle"
        render={({ field, fieldState }) => (
          <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Job title`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="properties.isEnabled"
        render={({ field, fieldState }) => (
          <div>
            <Select
              value={field.value === null ? 'unknown' : (field.value ? 'yes' : 'no')}
              onValueChange={(value) => field.onChange(value === 'unknown' ? null : value === 'yes')}
              error={fieldState.invalid}
            >
              <SelectLabel>{t`Account enabled`}</SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue placeholder={t`Select`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t`Unknown`}</SelectItem>
                <SelectItem value="yes">{t`Yes`}</SelectItem>
                <SelectItem value="no">{t`No`}</SelectItem>
              </SelectContent>
              {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
            </Select>
          </div>
        )}
      />
      <Controller
        control={control}
        name="properties.assignedRolesText"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`Directory roles`}
            placeholder={t`e.g. Global Administrator, Security Reader`}
            helperText={fieldState.error?.message ?? t`Separate multiple roles with commas.`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="properties.privilegedPimRolesText"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`Privileged PIM roles`}
            helperText={fieldState.error?.message ?? t`Separate multiple roles with commas.`}
            error={fieldState.error?.message}
          />
        )}
      />
    </>
  ) : null;

  return (
    <>
      <Controller
        control={control}
        name="subcategoryId"
        render={({ field, fieldState }) => (
          <SingleSelectField
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            options={getSubcategoryOptions(categoryId)}
            renderOption={(option) => <DescribedOption label={option.label} description={getAssetSubcategoryDescription(option.value)} />}
            label={t`Subcategory`}
            error={fieldState.error?.message}
          />
        )}
      />
      {showsUrlField(categoryId, existingUrl) && (
        <Controller
          control={control}
          name="url"
          render={({ field, fieldState }) => (
            <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`URL`} error={fieldState.error?.message} />
          )}
        />
      )}
      {showsPersonField(categoryId, existingLinkedPerson) && (
        <Controller
          control={control}
          name="linkedPerson"
          render={({ field, fieldState }) => (
            <NullableInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} label={t`Person`} error={fieldState.error?.message} />
          )}
        />
      )}
      {familyFields}
    </>
  );
};
