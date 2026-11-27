import type { DependencyRuleNamePatternKind } from '@app/module/client';
import {
  ASSET_CATEGORY_VALUES,
  ASSET_SUBCATEGORY_VALUES,
  DEPENDENCY_RULE_NAME_MAX_LENGTH,
  DEPENDENCY_RULE_PATTERN_MAX_LENGTH,
  INTEGRATION_SOURCES,
  SUBCATEGORY_TO_CATEGORY,
  SUPPORT_TO_PRIMARY_LINK_ROLES,
} from '@app/module/client';
import { Input, Switch } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { DependencyRule } from '../dependency-rules-utils';
import { DrawerForm, DrawerFormActions, FormDrawer, SingleSelectField, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel, getAssetSubcategoryLabel } from '../../../utils';
import { getConnectorNameBySource } from '../../integrations';
import { conditionsDraftOf, isReadableRegex, toConditionsInput } from '../dependency-rules-utils';
import { DependencyRulePreview } from './dependency-rule-preview';
import { LinkRolesField } from './link-roles-field';

const buildFormSchema = () => z.object({
  name: z.string().trim().min(1).max(DEPENDENCY_RULE_NAME_MAX_LENGTH),
  primaryAssetId: z.uuid().nullable(),
  roles: z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES)).min(1),
  enabled: z.boolean(),
  categoryId: z.enum(ASSET_CATEGORY_VALUES).nullable(),
  subcategoryId: z.enum(ASSET_SUBCATEGORY_VALUES).nullable(),
  namePattern: z.string().max(DEPENDENCY_RULE_PATTERN_MAX_LENGTH),
  namePatternKind: z.enum(['glob', 'regex']),
  tagId: z.uuid().nullable(),
  source: z.enum(INTEGRATION_SOURCES).nullable(),
}).refine((values) => values.primaryAssetId !== null, { path: ['primaryAssetId'], error: t`Choose the primary asset the rule links to` })
  .refine((values) => values.namePatternKind !== 'regex' || values.namePattern.trim() === '' || isReadableRegex(values.namePattern.trim()), {
    path: ['namePattern'],
    error: t`This regular expression cannot be read`,
  })
  .refine((values) => [values.categoryId, values.subcategoryId, values.namePattern.trim() === '' ? null : values.namePattern, values.tagId, values.source].some((value) => value !== null), {
    path: ['categoryId'],
    error: t`A rule needs at least one condition`,
  });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

const PATTERN_KIND_OPTIONS: ReadonlyArray<DependencyRuleNamePatternKind> = ['glob', 'regex'];

/** The member of `values` a select answered, or null: a select hands back a plain string. */
const oneOf = <T extends string>(values: ReadonlyArray<T>, next: string | null): T | null =>
  values.find((value) => value === next) ?? null;

const RuleForm: FunctionComponent<{ rule: DependencyRule | null }> = ({ rule }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { data: primaryAssets } = useQuery(trpc.primaryAssets.getPrimaryAssetsWithScope.queryOptions());
  const { data: tags } = useQuery(trpc.supportingAssets.listManagedTags.queryOptions());

  const form = useForm<FormValues>({
    resolver: zodResolver(buildFormSchema()),
    defaultValues: {
      name: rule?.name ?? '',
      primaryAssetId: rule?.primaryAssetId ?? null,
      roles: rule?.roles ?? [],
      enabled: rule?.enabled ?? true,
      ...conditionsDraftOf(rule),
    },
  });
  const [primaryAssetId, categoryId, subcategoryId, namePattern, namePatternKind, tagId, source] = useWatch({
    control: form.control,
    name: ['primaryAssetId', 'categoryId', 'subcategoryId', 'namePattern', 'namePatternKind', 'tagId', 'source'],
  });

  const onSuccess = () => closeDrawer();
  const createRule = useMutation(trpc.assetDependencies.createDependencyRule.mutationOptions({
    meta: { successMessage: msg`Rule created. Its links are written in the background.` },
    onSuccess,
  }));
  const updateRule = useMutation(trpc.assetDependencies.updateDependencyRule.mutationOptions({
    meta: { successMessage: msg`Rule saved. Its links are rewritten in the background.` },
    onSuccess,
  }));

  const onSubmit = (values: FormValues) => {
    if (values.primaryAssetId === null) {
      return;
    }
    const input = {
      name: values.name,
      primaryAssetId: values.primaryAssetId,
      roles: values.roles,
      enabled: values.enabled,
      ...toConditionsInput(values),
    };
    if (rule === null) {
      createRule.mutate(input);
    } else {
      updateRule.mutate({ id: rule.id, ...input });
    }
  };

  const primaryOptions = (primaryAssets ?? []).map((asset) => ({ value: asset.id, label: `${asset.name} (${asset.organization.name})` }));
  const categoryOptions = ASSET_CATEGORY_VALUES.map((value) => ({ value, label: getAssetCategoryLabel(value) }));
  const subcategoryOptions = ASSET_SUBCATEGORY_VALUES
    .filter((value) => categoryId === null || SUBCATEGORY_TO_CATEGORY[value] === categoryId)
    .map((value) => ({ value, label: getAssetSubcategoryLabel(value) }));
  const tagOptions = (tags ?? []).map((tag) => ({ value: tag.id, label: tag.name }));
  const sourceOptions = INTEGRATION_SOURCES.map((value) => ({ value, label: getConnectorNameBySource(value) ?? value }));
  const kindOptions = PATTERN_KIND_OPTIONS.map((value) => ({ value, label: value === 'glob' ? t`Wildcard (* and ?)` : t`Regular expression` }));

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={createRule.isPending || updateRule.isPending} submitLabel={rule === null ? t`Create` : t`Save`} />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required maxLength={DEPENDENCY_RULE_NAME_MAX_LENGTH} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="primaryAssetId"
        render={({ field, fieldState }) => (
          <SingleSelectField
            options={primaryOptions}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            label={t`Primary asset`}
            required
            placeholder={t`Select a primary asset`}
            emptyMessage={t`No primary assets found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="roles"
        render={({ field }) => <LinkRolesField value={field.value} onChange={field.onChange} />}
      />

      <section className="flex flex-col gap-4" aria-labelledby="dependency-rule-conditions">
        <div className="flex flex-col gap-1">
          <h3 id="dependency-rule-conditions" className="txt-category">{t`Conditions`}</h3>
          <p className="txt-sub-content text-muted-foreground">{t`A supporting asset matches when it meets every condition set here.`}</p>
        </div>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4">
          <Controller
            control={form.control}
            name="categoryId"
            render={({ field, fieldState }) => (
              <SingleSelectField
                options={categoryOptions}
                value={field.value}
                onChange={(next) => {
                  const category = oneOf(ASSET_CATEGORY_VALUES, next);
                  field.onChange(category);
                  if (category !== null && subcategoryId !== null && SUBCATEGORY_TO_CATEGORY[subcategoryId] !== category) {
                    form.setValue('subcategoryId', null);
                  }
                }}
                label={t`Category`}
                placeholder={t`Any category`}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="subcategoryId"
            render={({ field }) => (
              <SingleSelectField
                options={subcategoryOptions}
                value={field.value}
                onChange={(next) => field.onChange(oneOf(ASSET_SUBCATEGORY_VALUES, next))}
                label={t`Subcategory`}
                placeholder={t`Any subcategory`}
              />
            )}
          />
          <Controller
            control={form.control}
            name="namePattern"
            render={({ field, fieldState }) => (
              <Input
                {...field}
                label={t`Name or hostname`}
                placeholder={namePatternKind === 'glob' ? '*.example.io' : '^ci-[0-9]+$'}
                maxLength={DEPENDENCY_RULE_PATTERN_MAX_LENGTH}
                helperText={t`Case-insensitive. A wildcard pattern matches the whole name.`}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="namePatternKind"
            render={({ field }) => (
              <SingleSelectField
                options={kindOptions}
                value={field.value}
                onChange={(next) => field.onChange(oneOf(PATTERN_KIND_OPTIONS, next) ?? 'glob')}
                label={t`Pattern kind`}
                clearable={false}
              />
            )}
          />
          <Controller
            control={form.control}
            name="tagId"
            render={({ field }) => (
              <SingleSelectField
                options={tagOptions}
                value={field.value}
                onChange={field.onChange}
                label={t`Tag`}
                placeholder={t`Any tag`}
                emptyMessage={t`No tags found`}
              />
            )}
          />
          <Controller
            control={form.control}
            name="source"
            render={({ field }) => (
              <SingleSelectField
                options={sourceOptions}
                value={field.value}
                onChange={(next) => field.onChange(oneOf(INTEGRATION_SOURCES, next))}
                label={t`Reported by`}
                placeholder={t`Any connector`}
              />
            )}
          />
        </div>
      </section>

      <DependencyRulePreview
        primaryAssetId={primaryAssetId}
        conditions={{ categoryId, subcategoryId, namePattern, namePatternKind, tagId, source }}
      />

      <Controller
        control={form.control}
        name="enabled"
        render={({ field }) => (
          <Switch checked={field.value} onCheckedChange={field.onChange} label={t`Enabled: links matching assets now and at every sync`} />
        )}
      />
    </DrawerForm>
  );
};

interface DependencyRuleDrawerProps {
  open: boolean,
  rule: DependencyRule | null,
  onClose: () => void,
}

export const DependencyRuleDrawer: FunctionComponent<DependencyRuleDrawerProps> = ({ open, rule, onClose }) => (
  <FormDrawer open={open} onClose={onClose} title={rule === null ? t`Create a dependency rule` : t`Edit the dependency rule`}>
    {open && <RuleForm key={rule?.id ?? 'new'} rule={rule} />}
  </FormDrawer>
);
