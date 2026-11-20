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
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SingleSelectField } from '../../../components/shared';
import { useTRPC } from '../../../lib';

interface AddCweTechniqueDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  listedTechniqueIds: Array<string>,
  onConfirm: (techniqueId: string) => void,
}

export const AddCweTechniqueDialog: FunctionComponent<AddCweTechniqueDialogProps> = ({
  open,
  onOpenChange,
  listedTechniqueIds,
  onConfirm,
}) => {
  const trpc = useTRPC();
  const [techniqueId, setTechniqueId] = useState<string | null>(null);
  const { data: techniques } = useQuery(trpc.mitreAttack.getTechniques.queryOptions(undefined, { enabled: open }));

  const listed = new Set(listedTechniqueIds);
  const options = (techniques ?? [])
    .filter((technique) => !listed.has(technique.id))
    .map((technique) => ({ label: `${technique.externalId} - ${technique.name}`, value: technique.id }));

  const close = () => {
    setTechniqueId(null);
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
        <DialogTitle><Trans>Add a technique</Trans></DialogTitle>
        <DialogDescription>
          <Trans>Pick a technique this weakness makes possible.</Trans>
        </DialogDescription>

        <DialogBody>
          <SingleSelectField
            options={options}
            value={techniqueId}
            onChange={setTechniqueId}
            label={t`Technique`}
            placeholder={t`Select a technique`}
            emptyMessage={t`No techniques found`}
          />
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary" onClick={close}><Trans>Cancel</Trans></Button>
          </DialogClose>
          <Button
            disabled={techniqueId === null}
            onClick={() => {
              if (techniqueId !== null) {
                onConfirm(techniqueId);
              }
              close();
            }}
          >
            <Trans>Add</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
