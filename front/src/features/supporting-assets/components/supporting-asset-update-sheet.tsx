import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useRouter } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ASSET_CATEGORY_VALUES, ASSET_CRITICALITY_VALUES, ASSET_SUBCATEGORY_VALUES } from '@app/module/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { DrawerForm, DrawerFormActions, FormDrawer, NullableTextarea, OwnerSelect, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { getAssetCategoryDescription, getAssetCategoryLabel, getAssetCriticalityLabel } from '../../../utils';
import { assetNameText } from '../../../utils/asset-name-utils';
import { AssetCategoryFields, assetPropertiesFormSchema } from './asset-category-fields';
import { DescribedOption } from './described-option';
import { assetPropertiesFormValuesFrom } from './asset-properties-form-utils';
import { AssetTagsField, assetTagsFormSchema } from './asset-tags-field';
import { assetTagsFormValuesFrom } from './asset-tags-form-utils';
import { buildSupportingAssetUpdatePayload } from './supporting-asset-update-payload-utils';

const formSchema = z.object({
  name: z.string().nullable(),
  ownerId: z.string().nullable(),
  description: z.string().nullable(),
  exposure: z.enum(['internet_facing', 'internal', 'unknown']),
  categoryId: z.enum(ASSET_CATEGORY_VALUES),
  subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable(),
  url: z.string().nullable(),
  linkedPerson: z.string().nullable(),
  criticality: z.enum(ASSET_CRITICALITY_VALUES),
  properties: assetPropertiesFormSchema,
  tags: assetTagsFormSchema,
});

type FormValues = z.infer<typeof formSchema>;

interface SupportingAssetUpdateSheetProps {
  supportingAssetId: string,
  open: boolean,
  onClose: () => void,
}

const SupportingAssetUpdateForm: FunctionComponent<{ supportingAssetId: string }> = ({ supportingAssetId }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions({ id: supportingAssetId }));
  const router = useRouter();

  const updateSupportingAsset = useMutation(trpc.supportingAssets.updateSupportingAsset.mutationOptions({
    meta: { successMessage: msg`Supporting asset updated successfully.` },
    // The breadcrumb reads the displayed name from the route loader, which the live query does not refresh.
    onSuccess: async () => {
      await router.invalidate();
      closeDrawer();
    },
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: supportingAsset ? {
      name: supportingAsset.name ?? '',
      ownerId: supportingAsset.owner?.id ?? null,
      description: supportingAsset.description ?? null,
      exposure: supportingAsset.exposure,
      categoryId: supportingAsset.categoryId,
      subcategoryId: supportingAsset.subcategoryId,
      url: supportingAsset.url,
      linkedPerson: supportingAsset.linkedPerson,
      criticality: supportingAsset.criticality,
      properties: assetPropertiesFormValuesFrom(supportingAsset.propertiesByFamily.map((entry) => entry.properties)),
      tags: assetTagsFormValuesFrom(supportingAsset.tags),
    } : undefined,
  });

  const onSubmit = (values: FormValues) => {
    updateSupportingAsset.mutate({
      id: supportingAssetId,
      ...buildSupportingAssetUpdatePayload(
        values,
        form.formState.dirtyFields,
        (supportingAsset?.propertiesByFamily ?? []).flatMap((entry) => (entry.manualProperties ? [entry.manualProperties] : [])),
      ),
    });
  };

  if (!supportingAsset) {
    return null;
  }

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={updateSupportingAsset.isPending} />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} value={field.value ?? ''} label={t`Name`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
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
        control={form.control}
        name="description"
        render={({ field, fieldState }) => (
          <NullableTextarea {...field} label={t`Description`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="exposure"
        render={({ field, fieldState }) => (
          <div>
            <Select value={field.value} onValueChange={field.onChange} error={fieldState.invalid}>
              <SelectLabel required><Trans>Exposure</Trans></SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue placeholder={t`Select exposure`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t`Unknown`}</SelectItem>
                <SelectItem value="internal">{t`Internal`}</SelectItem>
                <SelectItem value="internet_facing">{t`Internet Facing`}</SelectItem>
              </SelectContent>
              {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
            </Select>
          </div>
        )}
      />
      <Controller
        control={form.control}
        name="categoryId"
        render={({ field, fieldState }) => (
          <div>
            <Select value={field.value} onValueChange={field.onChange} error={fieldState.invalid}>
              <SelectLabel required><Trans>Category</Trans></SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue placeholder={t`Select category`}>{field.value ? getAssetCategoryLabel(field.value) : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ASSET_CATEGORY_VALUES.map((cat) => (
                  <SelectItem key={cat} value={cat} textValue={getAssetCategoryLabel(cat)}>
                    <DescribedOption label={getAssetCategoryLabel(cat)} description={getAssetCategoryDescription(cat)} />
                  </SelectItem>
                ))}
              </SelectContent>
              {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
            </Select>
          </div>
        )}
      />
      <Controller
        control={form.control}
        name="criticality"
        render={({ field, fieldState }) => (
          <div>
            <Select value={field.value} onValueChange={field.onChange} error={fieldState.invalid}>
              <SelectLabel required><Trans>Criticality</Trans></SelectLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                <SelectValue placeholder={t`Select criticality`} />
              </SelectTrigger>
              <SelectContent>
                {ASSET_CRITICALITY_VALUES.map((criticality) => (
                  <SelectItem key={criticality} value={criticality}>{getAssetCriticalityLabel(criticality)}</SelectItem>
                ))}
              </SelectContent>
              {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
            </Select>
          </div>
        )}
      />
      <AssetCategoryFields
        control={form.control}
        setValue={form.setValue}
        existingUrl={supportingAsset.url}
        existingLinkedPerson={supportingAsset.linkedPerson}
      />
      <AssetTagsField control={form.control} />
    </DrawerForm>
  );
};

export const SupportingAssetUpdateSheet: FunctionComponent<SupportingAssetUpdateSheetProps> = ({
  supportingAssetId,
  open,
  onClose,
}) => {
  const trpc = useTRPC();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions({ id: supportingAssetId }));
  const supportingAssetName = supportingAsset ? assetNameText(supportingAsset, t`Unnamed asset`) : '';

  return (
    <FormDrawer
      title={t`Edit ${supportingAssetName}`}
      open={open}
      onClose={onClose}
    >
      <SupportingAssetUpdateForm supportingAssetId={supportingAssetId} />
    </FormDrawer>
  );
};
