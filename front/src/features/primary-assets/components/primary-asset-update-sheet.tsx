import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useForm } from 'react-hook-form';
import type { PrimaryAssetFormValues } from './primary-asset-form-fields';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { businessFunctionSuggestions, isReferenceTaken } from '../primary-asset-fields-utils';
import {
  businessResourceOptionsFrom,
  PrimaryAssetFormFields,
  primaryAssetFormSchema,
  primaryAssetFormValuesFrom,
  primaryAssetInputFrom,
} from './primary-asset-form-fields';

interface PrimaryAssetUpdateSheetProps {
  primaryAssetId: string,
  open: boolean,
  onClose: () => void,
}

const PrimaryAssetUpdateForm: FunctionComponent<{ primaryAssetId: string }> = ({ primaryAssetId }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { data: primaryAsset } = useQuery(trpc.primaryAssets.getPrimaryAsset.queryOptions({ id: primaryAssetId }));
  const { data: businessValueCategories } = useQuery(trpc.businessValueCategories.getBusinessValueCategories.queryOptions());
  const { data: scopeAssets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions(
    primaryAsset ? { organizationId: primaryAsset.organizationId } : skipToken,
  ));

  const updatePrimaryAsset = useMutation(trpc.primaryAssets.updatePrimaryAsset.mutationOptions({
    meta: { successMessage: msg`Primary asset updated successfully.` },
    onSuccess: () => {
      closeDrawer();
    },
  }));

  const form = useForm<PrimaryAssetFormValues>({
    resolver: zodResolver(primaryAssetFormSchema),
    values: primaryAsset ? primaryAssetFormValuesFrom(primaryAsset) : undefined,
  });

  const onSubmit = (values: PrimaryAssetFormValues) => {
    if (isReferenceTaken(scopeAssets ?? [], values.reference, primaryAssetId)) {
      form.setError('reference', { message: t`Another primary asset of this risk scope already uses this reference.` });
      return;
    }
    updatePrimaryAsset.mutate({
      id: primaryAssetId,
      ...primaryAssetInputFrom(values),
    });
  };

  if (!primaryAsset) {
    return null;
  }

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={updatePrimaryAsset.isPending} />}
    >
      <PrimaryAssetFormFields
        control={form.control}
        businessResourceOptions={businessResourceOptionsFrom(businessValueCategories ?? [])}
        businessFunctionSuggestions={businessFunctionSuggestions(scopeAssets ?? [])}
      />
    </DrawerForm>
  );
};

export const PrimaryAssetUpdateSheet: FunctionComponent<PrimaryAssetUpdateSheetProps> = ({
  primaryAssetId,
  open,
  onClose,
}) => {
  const trpc = useTRPC();
  const { data: primaryAsset } = useQuery(trpc.primaryAssets.getPrimaryAsset.queryOptions({ id: primaryAssetId }));
  const primaryAssetName = primaryAsset?.name ?? '';

  return (
    <FormDrawer
      title={t`Edit ${primaryAssetName}`}
      open={open}
      onClose={onClose}
    >
      <PrimaryAssetUpdateForm primaryAssetId={primaryAssetId} />
    </FormDrawer>
  );
};
