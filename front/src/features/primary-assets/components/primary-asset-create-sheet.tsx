import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { uuidv7 } from 'uuidv7';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { PrimaryAssetFormValues } from './primary-asset-form-fields';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { businessFunctionSuggestions, isReferenceTaken } from '../primary-asset-fields-utils';
import {
  businessResourceOptionsFrom,
  emptyPrimaryAssetFormValues,
  PrimaryAssetFormFields,
  primaryAssetFormSchema,
  primaryAssetInputFrom,
} from './primary-asset-form-fields';

interface PrimaryAssetCreateFormProps {
  organizationId: string,
  open: boolean,
}

const PrimaryAssetCreateForm: FunctionComponent<PrimaryAssetCreateFormProps> = ({
  organizationId,
  open,
}) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { data: businessValueCategories } = useQuery(trpc.businessValueCategories.getBusinessValueCategories.queryOptions());
  const { data: scopeAssets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions({ organizationId }));

  const form = useForm<PrimaryAssetFormValues>({
    resolver: zodResolver(primaryAssetFormSchema),
    defaultValues: emptyPrimaryAssetFormValues(),
  });

  const { reset } = form;

  const createPrimaryAsset = useMutation(trpc.primaryAssets.createPrimaryAsset.mutationOptions({
    meta: { successMessage: msg`Primary asset created successfully.` },
    onSuccess: () => {
      closeDrawer();
      reset();
    },
  }));

  useEffect(() => {
    if (open) {
      reset(emptyPrimaryAssetFormValues());
    }
  }, [open, reset]);

  const onSubmit = (values: PrimaryAssetFormValues) => {
    if (isReferenceTaken(scopeAssets ?? [], values.reference, null)) {
      form.setError('reference', { message: t`Another primary asset of this risk scope already uses this reference.` });
      return;
    }
    createPrimaryAsset.mutate({
      id: uuidv7(),
      organizationId,
      ...primaryAssetInputFrom(values),
    });
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={(
        <DrawerFormActions isPending={createPrimaryAsset.isPending} submitLabel={t`Create`} pendingLabel={t`Creating...`} />
      )}
    >
      <PrimaryAssetFormFields
        control={form.control}
        businessResourceOptions={businessResourceOptionsFrom(businessValueCategories ?? [])}
        businessFunctionSuggestions={businessFunctionSuggestions(scopeAssets ?? [])}
      />
    </DrawerForm>
  );
};

interface PrimaryAssetCreateSheetProps {
  organizationId: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}

export const PrimaryAssetCreateSheet: FunctionComponent<PrimaryAssetCreateSheetProps> = ({
  organizationId,
  open,
  onOpenChange,
}) => (
  <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`Create a new primary asset`}>
    <PrimaryAssetCreateForm organizationId={organizationId} open={open} />
  </FormDrawer>
);
