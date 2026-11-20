import { Button, Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, Textarea } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { DismissalType } from '@app/module/client';
import { DISMISSAL_REASON_CODE_VALUES, DISMISSAL_TYPE_VALUES } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { dismissalReasonOptions, dismissalTypeLabel } from '../../finding-detail/dismissal-vocabulary';
import { useTRPC } from '../../../lib';

/** SAFE's own ceiling on the rationale, and the one the mutation enforces server-side. */
const RATIONALE_MAX = 2000;

const dismissFormSchema = z.object({
  dismissalType: z.enum(DISMISSAL_TYPE_VALUES),
  reasonCode: z.enum(DISMISSAL_REASON_CODE_VALUES),
  reason: z.string().trim().min(1).max(RATIONALE_MAX),
});

type DismissFormValues = z.infer<typeof dismissFormSchema>;

const DEFAULT_TYPE: DismissalType = 'risk_accepted';

interface EvidenceStateDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  evidenceId: string,
  targetState: 'applicable' | 'dismissed',
}

/**
 * Setting a finding aside, or bringing it back.
 *
 * Aside takes a type and a reason code from that type's own list, plus a free-text rationale on
 * top of the code and never instead of it: the code serves reporting, the prose serves the next
 * analyst, and `Other` catches what neither list foresaw.
 */
export const EvidenceStateDialog: FunctionComponent<EvidenceStateDialogProps> = ({
  open,
  onOpenChange,
  evidenceId,
  targetState,
}) => {
  const trpc = useTRPC();
  const form = useForm<DismissFormValues>({
    resolver: zodResolver(dismissFormSchema),
    defaultValues: { dismissalType: DEFAULT_TYPE, reasonCode: undefined, reason: '' },
  });

  const { reset, handleSubmit, resetField, control } = form;
  const dismissalType = useWatch({ control, name: 'dismissalType' });

  const updateEvidenceState = useMutation(trpc.supportingAssets.updateEvidenceState.mutationOptions({
    meta: { successMessage: msg`Finding state updated successfully.` },
    onSuccess: () => {
      onOpenChange(false);
      reset();
    },
  }));

  useEffect(() => {
    if (open) {
      reset({ dismissalType: DEFAULT_TYPE, reasonCode: undefined, reason: '' });
    }
  }, [open, reset]);

  const handleApplicable = () => {
    updateEvidenceState.mutate({ evidenceId, state: 'applicable' });
  };

  const handleDismiss = handleSubmit((values) => {
    updateEvidenceState.mutate({ evidenceId, state: 'dismissed', ...values });
  });

  if (targetState === 'applicable') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm">
          <DialogTitle><Trans>Mark as applicable</Trans></DialogTitle>
          <DialogDescription>
            <Trans>This finding will be marked as applicable for this asset.</Trans>
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button priority="secondary"><Trans>Cancel</Trans></Button>
            </DialogClose>
            <DialogClose asChild>
              <Button onClick={handleApplicable} disabled={updateEvidenceState.isPending}>
                <Trans>Confirm</Trans>
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle><Trans context="action">Set aside</Trans></DialogTitle>
        <DialogDescription>
          <Trans>Say what kind of decision this is, pick the reason it falls under, and record why.</Trans>
        </DialogDescription>
        <DialogBody className="flex flex-col gap-4 py-2">
          <Controller
            control={control}
            name="dismissalType"
            render={({ field, fieldState }) => (
              <div>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // The codes are only meaningful under their own type, so switching type
                    // clears a code that would otherwise be submitted under the wrong one.
                    resetField('reasonCode');
                  }}
                  error={fieldState.invalid}
                >
                  <SelectLabel required>{t`Type`}</SelectLabel>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                    <SelectValue placeholder={t`Pick a type`} />
                  </SelectTrigger>
                  <SelectContent>
                    {DISMISSAL_TYPE_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>{dismissalTypeLabel(value)}</SelectItem>
                    ))}
                  </SelectContent>
                  {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
                </Select>
              </div>
            )}
          />
          <Controller
            control={control}
            name="reasonCode"
            render={({ field, fieldState }) => (
              <div>
                <Select value={field.value ?? ''} onValueChange={field.onChange} error={fieldState.invalid}>
                  <SelectLabel required>{t`Reason`}</SelectLabel>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                    <SelectValue placeholder={t`Pick a reason`} />
                  </SelectTrigger>
                  <SelectContent>
                    {dismissalReasonOptions(dismissalType).map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                  {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
                </Select>
              </div>
            )}
          />
          <Controller
            control={control}
            name="reason"
            render={({ field, fieldState }) => (
              <Textarea
                {...field}
                label={t`Rationale`}
                required
                maxLength={RATIONALE_MAX}
                placeholder={t`Explain the decision for whoever reviews it next…`}
                error={fieldState.error?.message}
              />
            )}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary"><Trans>Cancel</Trans></Button>
          </DialogClose>
          <Button
            onClick={() => void handleDismiss()}
            disabled={updateEvidenceState.isPending}>
            <Trans context="action">Set aside</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
