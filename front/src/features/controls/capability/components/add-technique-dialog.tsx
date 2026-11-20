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
import type { CapabilityFunction } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SingleSelectField } from '../../../../components/shared';
import { useTRPC } from '../../../../lib';

interface AddTechniqueDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  capabilityFunction: CapabilityFunction,
  coveredTechniqueIds: Array<string>,
  onConfirm: (techniqueId: string) => void,
}

export const AddTechniqueDialog: FunctionComponent<AddTechniqueDialogProps> = ({
  open,
  onOpenChange,
  capabilityFunction,
  coveredTechniqueIds,
  onConfirm,
}) => {
  const trpc = useTRPC();
  const [techniqueId, setTechniqueId] = useState<string | null>(null);
  const { data: techniques } = useQuery(trpc.mitreAttack.getTechniques.queryOptions(undefined, { enabled: open }));

  const isPrevention = capabilityFunction === 'prevent';
  const covered = new Set(coveredTechniqueIds);
  const options = (techniques ?? [])
    .filter((technique) => !covered.has(technique.id))
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
        <DialogTitle><Trans>Link a technique</Trans></DialogTitle>
        <DialogDescription>
          {isPrevention
            ? <Trans>Pick a technique this control prevents. The addition lands on prevention and is kept across catalogue updates.</Trans>
            : <Trans>Pick a technique this control detects. The addition lands on detection and is kept across catalogue updates.</Trans>}
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
            <Trans>Link</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
