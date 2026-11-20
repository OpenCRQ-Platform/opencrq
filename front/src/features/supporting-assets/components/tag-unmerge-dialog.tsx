import { Button, Chip, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTitle } from '@filigran/design-system';
import { msg } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { TagRow } from './tag-management-utils';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils';
import { AssetTagChip } from './asset-chips';
import { sourceLabelsOf } from './tag-source-labels';

export const TagUnmergeDialog: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  tag: TagRow,
}> = ({ open, onOpenChange, tag }) => {
  const trpc = useTRPC();
  const unmergeTag = useMutation(trpc.supportingAssets.unmergeTag.mutationOptions({
    meta: { successMessage: msg`Merge undone.` },
    onSuccess: () => {
      if (tag.mergedTags.length === 1) {
        onOpenChange(false);
      }
    },
  }));
  const { name, mergedTags } = tag;

  return (
    <Dialog open={open && mergedTags.length > 0} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle><Trans>Undo a merge into “{name}”</Trans></DialogTitle>

        <DialogBody>
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {mergedTags.map((merged) => {
              const mergedOn = merged.mergedAt === null ? '' : formatDate(merged.mergedAt);
              return (
                <li key={merged.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <AssetTagChip name={merged.name} color={merged.color} />
                      {sourceLabelsOf(merged).map((label) => <Chip key={label} label={label} />)}
                    </div>
                    <span className="text-muted-foreground">
                      <Plural
                        value={merged.assetCount}
                        one={`# asset · merged on ${mergedOn}`}
                        other={`# assets · merged on ${mergedOn}`}
                      />
                    </span>
                  </div>
                  <Button
                    priority="secondary"
                    disabled={unmergeTag.isPending}
                    onClick={() => unmergeTag.mutate({ tagId: merged.id })}
                  >
                    <Trans>Restore</Trans>
                  </Button>
                </li>
              );
            })}
          </ul>
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary"><Trans>Close</Trans></Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
