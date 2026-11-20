import type { SupportToPrimaryLinkRole } from '@app/module/client';
import { SUPPORT_TO_PRIMARY_LINK_ROLES } from '@app/module/client';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { LinkRolesField } from './link-roles-field';

const formSchema = z.object({
  roles: z.array(z.enum(SUPPORT_TO_PRIMARY_LINK_ROLES)).min(1),
});

type FormValues = z.infer<typeof formSchema>;

export interface EditedSupportToPrimaryLink {
  id: string,
  roles: Array<SupportToPrimaryLinkRole>,
  supportingAssetName: string,
  primaryAssetName: string,
}

const SupportToPrimaryLinkEditForm: FunctionComponent<{ link: EditedSupportToPrimaryLink }> = ({ link }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { roles: link.roles },
  });

  const updateLink = useMutation(trpc.assetDependencies.updateSupportToPrimaryLinks.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: ({ skippedIds }) => {
      toast(skippedIds.length === 0
        ? { description: t`Dependency updated successfully.` }
        : { description: t`This dependency was removed in the meantime.`, variant: 'info' });
      closeDrawer();
    },
  }));

  const onSubmit = (values: FormValues) => {
    updateLink.mutate([{ id: link.id, roles: values.roles }]);
  };

  const { supportingAssetName, primaryAssetName } = link;

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={updateLink.isPending} />}
    >
      <p className="txt-body2 text-default-secondary">{`${supportingAssetName} → ${primaryAssetName}`}</p>
      <Controller
        control={form.control}
        name="roles"
        render={({ field }) => <LinkRolesField value={field.value} onChange={field.onChange} />}
      />
    </DrawerForm>
  );
};

interface SupportToPrimaryLinkEditSheetProps {
  link: EditedSupportToPrimaryLink | null,
  onClose: () => void,
}

export const SupportToPrimaryLinkEditSheet: FunctionComponent<SupportToPrimaryLinkEditSheetProps> = ({ link, onClose }) => (
  <FormDrawer open={link !== null} onClose={onClose} title={t`Edit dependency`}>
    {link && <SupportToPrimaryLinkEditForm key={link.id} link={link} />}
  </FormDrawer>
);
