import { Chip, Input } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { useNavigate } from '@tanstack/react-router';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { Suspense, useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { msg, t } from '@lingui/core/macro';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, FormDrawer, Loader, MultiSelectField, NullableTextarea } from '../../../components';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { BadgeCellList } from '../../../components/ui/badge-cell-list';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useHasManageSecurity } from '../../../hooks';
import { useTRPC } from '../../../lib';

const createFormSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  groupIds: z.array(z.string()),
});

const CreateServiceAccountFormInner: FunctionComponent<{
  onCreated: () => void,
}> = ({ onCreated }) => {
  const trpc = useTRPC();
  const { data: allGroups } = useSuspenseQuery(trpc.groups.getGroups.queryOptions());

  const connectorsGroup = allGroups.find((g) => g.slug === 'connectors');

  const form = useForm<z.infer<typeof createFormSchema>>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { name: '', description: null, groupIds: connectorsGroup ? [connectorsGroup.id] : [] },
  });

  const createMutation = useMutation(trpc.serviceAccounts.createServiceAccount.mutationOptions({ meta: { successMessage: msg`Service account created successfully.` } }));
  const addGroupMutation = useMutation(trpc.serviceAccounts.addGroupToServiceAccount.mutationOptions({ meta: { skipSuccessToast: true } }));

  const onSubmit = async (values: z.infer<typeof createFormSchema>) => {
    const id = uuidv7();
    await createMutation.mutateAsync({ id, name: values.name, description: values.description });
    await Promise.all(values.groupIds.map((groupId) =>
      addGroupMutation.mutateAsync({ serviceAccountId: id, groupId }),
    ));
    onCreated();
  };

  const groupOptions = allGroups.map((group) => ({ label: group.name, value: group.id }));

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={form.formState.isSubmitting} />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`Name`}
            required
            placeholder={t`Service account name`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="description"
        render={({ field, fieldState }) => (
          <NullableTextarea
            {...field}
            label={t`Description`}
            placeholder={t`Optional description`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="groupIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={groupOptions}
            value={field.value}
            onChange={(next) => field.onChange([...next].sort())}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Groups`}
            placeholder={t`Select groups`}
            emptyMessage={t`No groups found`}
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};

interface ServiceAccount {
  id: string,
  name: string,
  active: boolean,
  groups: Array<{ id: string, name: string }>,
  roles: Array<{ id: string, name: string }>,
}

export const ServiceAccountsDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const hasManageSecurity = useHasManageSecurity();

  const { data, isLoading } = useQuery(trpc.serviceAccounts.listServiceAccounts.queryOptions());
  const updateServiceAccount = useMutation(trpc.serviceAccounts.updateServiceAccount.mutationOptions());

  const columns: Array<ColumnDefWithOptionsHeader<ServiceAccount, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 250,
      cell: ({ row }): ReactElement => (
        <span className="font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'status',
      header: t`Status`,
      size: 120,
      cell: ({ row }): ReactElement => (
        row.original.active
          ? <Chip severity="low" label={t`Active`} />
          : <Chip label={t`Inactive`} />
      ),
    },
    {
      id: 'groups',
      header: t`Groups`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={row.original.groups} />,
    },
    {
      id: 'roles',
      header: t`Roles`,
      size: 250,
      cell: ({ row }): ReactElement => <BadgeCellList items={row.original.roles} />,
    },
    {
      id: 'actions',
      header: '',
      size: 50,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }): ReactElement => (
        <div
          className="flex items-center justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem onClick={() => void navigate({
              from: '/$tenantId/{-$organizationId}',
              to: 'settings/security/service-accounts/$serviceAccountId',
              params: { serviceAccountId: row.original.id },
            })}
            >
              {t`View details`}
            </IconActionsItem>
            {hasManageSecurity && (
              <IconActionsItem
                onClick={() => updateServiceAccount.mutate({
                  id: row.original.id,
                  active: !row.original.active,
                })}
              >
                {row.original.active ? t`Disable` : t`Enable`}
              </IconActionsItem>
            )}
          </IconActions>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataPageLayout
        data={data ?? []}
        columns={columns}
        isLoading={isLoading}
        storageKey="serviceAccounts"
        search={{ placeholder: t`Search service accounts...`, texts: (account) => [account.name] }}
        filters={[{
          id: 'status',
          label: t`Status`,
          allLabel: t`All statuses`,
          options: [{ value: 'active', label: t`Active` }, { value: 'inactive', label: t`Inactive` }],
          valueOf: (account) => (account.active ? 'active' : 'inactive'),
        }]}
        onCreate={hasManageSecurity ? () => setCreateDrawerOpen(true) : undefined}
        onClickRow={(row) => void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'settings/security/service-accounts/$serviceAccountId',
          params: { serviceAccountId: row.original.id },
        })}
      />

      <FormDrawer open={createDrawerOpen} onClose={() => setCreateDrawerOpen(false)} title={t`Create a new service account`}>
        <Suspense fallback={<Loader />}>
          <CreateServiceAccountFormInner onCreated={() => setCreateDrawerOpen(false)} />
        </Suspense>
      </FormDrawer>
    </>
  );
};
