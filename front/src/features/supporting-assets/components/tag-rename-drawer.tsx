import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import type { ManagedTag, TagRow } from './tag-management-utils';
import { ConfirmDialog, DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { getConnectorNameBySource } from '../../integrations';
import { findTagNameOwner } from './tag-management-utils';

const renameSchema = z.object({ name: z.string().trim().min(1) });

type RenameValues = z.infer<typeof renameSchema>;

interface MergeConflict {
  owner: ManagedTag,
  target: ManagedTag,
}

const RenameForm: FunctionComponent<{ tag: TagRow, tags: ReadonlyArray<ManagedTag> }> = ({ tag, tags }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const form = useForm<RenameValues>({ resolver: zodResolver(renameSchema), defaultValues: { name: tag.name } });
  const [conflict, setConflict] = useState<MergeConflict | null>(null);

  const renameTag = useMutation(trpc.supportingAssets.renameTag.mutationOptions({
    meta: { successMessage: msg`Tag renamed successfully.` },
    onSuccess: closeDrawer,
  }));
  const mergeTag = useMutation(trpc.supportingAssets.mergeTag.mutationOptions({
    meta: { successMessage: msg`Tags merged successfully.` },
    onSuccess: closeDrawer,
  }));

  const submit = ({ name }: RenameValues) => {
    const verdict = findTagNameOwner(tags, tag.id, name);
    switch (verdict.kind) {
      case 'unchanged':
        closeDrawer();
        break;
      case 'free':
        renameTag.mutate({ tagId: tag.id, name });
        break;
      case 'ownMergedTag':
        form.setError('name', { message: t`This name is already taken.` });
        break;
      case 'mergeInto':
        setConflict({ owner: verdict.owner, target: verdict.target });
        break;
    }
  };

  const ownerName = conflict === null ? '' : conflict.owner.name;
  const targetName = conflict === null ? '' : conflict.target.name;
  const ownerIsRoot = conflict !== null && conflict.owner.id === conflict.target.id;
  const name = tag.name;

  return (
    <>
      <DrawerForm
        form={form}
        onSubmit={submit}
        footer={<DrawerFormActions isPending={renameTag.isPending} submitLabel={t`Save`} />}
      >
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
          )}
        />
        {tag.connectorNames.map((entry) => {
          const connector = getConnectorNameBySource(entry.source) ?? entry.source;
          return (
            <div key={entry.source} className="flex flex-col gap-1.5">
              <span className="text-muted-foreground"><Trans>Name in {connector}</Trans></span>
              <span>{entry.reportedName}</span>
            </div>
          );
        })}
      </DrawerForm>
      <ConfirmDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConflict(null);
          }
        }}
        onConfirm={() => {
          if (conflict !== null) {
            mergeTag.mutate({ tagId: tag.id, targetTagId: conflict.target.id });
          }
        }}
        title={<Trans>This name is already taken</Trans>}
        description={ownerIsRoot
          ? <Trans>A tag “{targetName}” already exists. Merge “{name}” into “{targetName}”?</Trans>
          : <Trans>“{ownerName}” was merged into “{targetName}”. Merge “{name}” into “{targetName}”?</Trans>}
        submitButtonText={<Trans>Merge</Trans>}
      />
    </>
  );
};

export const TagRenameDrawer: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  tag: TagRow,
  tags: ReadonlyArray<ManagedTag>,
}> = ({ open, onOpenChange, tag, tags }) => (
  <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`Rename the tag`}>
    {open && <RenameForm tag={tag} tags={tags} />}
  </FormDrawer>
);
