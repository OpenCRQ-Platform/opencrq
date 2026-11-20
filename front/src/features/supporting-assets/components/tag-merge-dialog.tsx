import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@filigran/design-system';
import { msg, plural, t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ManagedTag, TagRow } from './tag-management-utils';
import { SingleSelectField } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { AssetTagChip } from './asset-chips';
import { mergeTargetOptions } from './tag-management-utils';

export const TagMergeDialog: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  tag: TagRow,
  tags: ReadonlyArray<ManagedTag>,
}> = ({ open, onOpenChange, tag, tags }) => {
  const trpc = useTRPC();
  const [targetId, setTargetId] = useState<string | null>(null);
  const mergeTag = useMutation(trpc.supportingAssets.mergeTag.mutationOptions({
    meta: { successMessage: msg`Tags merged successfully.` },
  }));

  const targets = mergeTargetOptions(tags, tag.id);
  const options = targets.map((target) => ({ label: target.name, value: target.id }));
  const { name, assetCount } = tag;

  const close = () => {
    setTargetId(null);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogContent>
        <DialogTitle><Trans>Merge “{name}”</Trans></DialogTitle>
        <DialogDescription>
          <Plural
            value={assetCount}
            one={`The # asset tagged “${name}” will carry the chosen tag.`}
            other={`The # assets tagged “${name}” will carry the chosen tag.`}
          />
        </DialogDescription>

        <DialogBody>
          <SingleSelectField
            options={options}
            value={targetId}
            onChange={setTargetId}
            label={t`Merge into`}
            required
            placeholder={t`Select a tag`}
            emptyMessage={t`No tags found`}
            renderOption={(option) => {
              const target = targets.find((candidate) => candidate.id === option.value);
              return (
                <div className="flex w-full items-center justify-between gap-3">
                  <AssetTagChip name={option.label} color={target?.color ?? null} />
                  <span className="text-muted-foreground">
                    {plural(target?.assetCount ?? 0, { one: '# asset', other: '# assets' })}
                  </span>
                </div>
              );
            }}
          />
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary" onClick={close}><Trans>Cancel</Trans></Button>
          </DialogClose>
          <Button
            disabled={targetId === null}
            onClick={() => {
              if (targetId !== null) {
                mergeTag.mutate({ tagId: tag.id, targetTagId: targetId });
              }
              close();
            }}
          >
            <Trans>Merge</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
