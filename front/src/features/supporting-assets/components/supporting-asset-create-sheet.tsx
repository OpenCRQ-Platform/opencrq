import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { ASSET_CATEGORY_VALUES, ASSET_CRITICALITY_VALUES, ASSET_SUBCATEGORY_VALUES } from '@app/module/client';
import { useMutation } from '@tanstack/react-query';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { getAssetCategoryDescription, getAssetCategoryLabel, getAssetCriticalityLabel } from '../../../utils';
import { DrawerForm, DrawerFormActions, FormDrawer, NullableTextarea, OwnerSelect } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { AssetCategoryFields, assetPropertiesFormSchema } from './asset-category-fields';
import { DescribedOption } from './described-option';
import { buildManualAssetProperties, emptyAssetPropertiesFormValues } from './asset-properties-form-utils';
import { AssetTagsField, assetTagsFormSchema } from './asset-tags-field';
import { emptyAssetTagsFormValue, tagNamesFrom } from './asset-tags-form-utils';

const formSchema = z.object({
  name: z.string().nullable(),
  ownerId: z.string().nullable(),
  description: z.string().nullable(),
  exposure: z.enum(['internet_facing', 'internal', 'unknown']),
  categoryId: z.enum(ASSET_CATEGORY_VALUES),
  criticality: z.enum(ASSET_CRITICALITY_VALUES),
  subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable(),
  url: z.string().nullable(),
  linkedPerson: z.string().nullable(),
  properties: assetPropertiesFormSchema,
  tags: assetTagsFormSchema,
});

type FormValues = z.infer<typeof formSchema>;

interface SupportingAssetCreateSheetProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  /** The risk scope the creation happens inside: on a closed one, the asset is mapped into it. */
  organizationId: string | undefined,
}

export const SupportingAssetCreateSheet: FunctionComponent<SupportingAssetCreateSheetProps> = ({
  open,
  onOpenChange,
  organizationId,
}) => {
  const trpc = useTRPC();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      ownerId: null,
      description: null,
      exposure: 'unknown',
      categoryId: 'host',
      criticality: 'unknown',
      subcategoryId: null,
      url: null,
      linkedPerson: null,
      properties: emptyAssetPropertiesFormValues,
      tags: emptyAssetTagsFormValue,
    },
  });

  const { reset } = form;

  const createSupportingAsset = useMutation(trpc.supportingAssets.createSupportingAsset.mutationOptions({
    meta: { successMessage: msg`Supporting asset created successfully.` },
    onSuccess: () => {
      onOpenChange(false);
      reset();
    },
  }));

  useEffect(() => {
    if (open) {
      reset({
        name: '',
        ownerId: null,
        description: null,
        exposure: 'unknown',
        categoryId: 'host',
        criticality: 'unknown',
        subcategoryId: null,
        url: null,
        linkedPerson: null,
        properties: emptyAssetPropertiesFormValues,
        tags: emptyAssetTagsFormValue,
      });
    }
  }, [open, reset]);

  const onSubmit = (values: FormValues) => {
    const { properties: propertiesValues, tags, ...assetValues } = values;
    const properties = buildManualAssetProperties(values.categoryId, propertiesValues, form.formState.dirtyFields.properties, []);
    createSupportingAsset.mutate({
      id: uuidv7(),
      ...assetValues,
      organizationId: organizationId ?? null,
      tagNames: tagNamesFrom(tags),
      ...(properties ? { properties } : {}),
    });
  };

  return (
    <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`Create a new supporting asset`}>
      <DrawerForm
        form={form}
        onSubmit={onSubmit}
        footer={(
          <DrawerFormActions isPending={createSupportingAsset.isPending} submitLabel={t`Create`} pendingLabel={t`Creating...`} />
        )}
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
            <NullableTextarea
              value={field.value}
              onChange={field.onChange}
              label={t`Description`}
              error={fieldState.error?.message}
            />
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
          existingUrl={null}
          existingLinkedPerson={null}
        />
        <AssetTagsField control={form.control} />
      </DrawerForm>
    </FormDrawer>
  );
};
