import type { MaturityLevel } from '@app/module/client';
import { MATURITY_LEVELS } from '@app/module/client';
import { Button, Textarea } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { AssessmentAnswer, AssessmentControlLink, AssessmentNodeRow } from './compliance-assessment-types';
import type { ComplianceAnswerFormValues } from './compliance-answer-schema';
import type { AnswerDraftField } from '../compliance-assessments-utils';
import {
  CardField,
  ControlIdPill,
  DateFormInput,
  DescriptionField,
  DrawerForm,
  DrawerFormActions,
  FormDrawer,
  InfoField,
  InfoTooltip,
  OwnerSelect,
  SavedMeanwhile,
  STALE_WRITE_TOAST_DURATION,
  useFormDrawerContext,
  useFormDrawerNavigationGuard,
} from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils';
import { answerFieldDiffers, conflictingAnswerFields, rebaseAnswerDraft, toMaturityLevel } from '../compliance-assessments-utils';
import { AnswerChip } from '../ui/maturity-chips';
import { maturityLevelDefinition, maturityLevelName } from '../ui/maturity-labels';
import { complianceAnswerFormSchema } from './compliance-answer-schema';

export interface AnswerDrawerTarget {
  requirement: AssessmentNodeRow,
  /** The function, then the category, the requirement sits in. */
  path: Array<AssessmentNodeRow>,
  answer: AssessmentAnswer | undefined,
  controls: ReadonlyArray<AssessmentControlLink>,
}

interface AnswerDrawerProps {
  assessmentId: string,
  locked: boolean,
  target: AnswerDrawerTarget | null,
  onClose: () => void,
}

const LevelDefinitions: FunctionComponent = () => (
  <>
    {MATURITY_LEVELS.map((level) => (
      <span key={level}>
        <span className="font-medium">{level} {maturityLevelName(level)}</span>
        {' · '}
        {maturityLevelDefinition(level)}
      </span>
    ))}
  </>
);

const LevelPicker: FunctionComponent<{
  value: number | null,
  notApplicable: boolean,
  onPick: (level: MaturityLevel | null, notApplicable: boolean) => void,
}> = ({ value, notApplicable, onPick }) => (
  <div className="flex flex-col gap-3">
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 txt-default font-medium">
        <Trans>What is the maturity level?</Trans>
        <InfoTooltip label={t`What each maturity level requires`} side="bottom">
          <LevelDefinitions />
        </InfoTooltip>
      </span>
      <span className="txt-sub-content text-default-secondary">
        <Trans>Maturity scale, from 0 to 5</Trans>
      </span>
    </span>
    <div role="group" aria-label={t`Maturity level`} className="grid grid-cols-3 gap-2">
      {MATURITY_LEVELS.map((level) => {
        const selected = !notApplicable && value === level;
        return (
          <Button
            key={level}
            type="button"
            priority={selected ? 'primary' : 'secondary'}
            aria-pressed={selected}
            onClick={() => onPick(selected ? null : level, false)}
            className="justify-start"
          >
            <span className="font-semibold">{level}</span>
            {' '}
            {maturityLevelName(level)}
          </Button>
        );
      })}
    </div>
    <Button
      type="button"
      priority={notApplicable ? 'primary' : 'secondary'}
      aria-pressed={notApplicable}
      onClick={() => onPick(null, !notApplicable)}
      className="self-start"
    >
      <Trans>Not applicable</Trans>
    </Button>
  </div>
);

const FedControls: FunctionComponent<{ controls: ReadonlyArray<AssessmentControlLink> }> = ({ controls }) => {
  const count = controls.length;
  return (
    <section className="flex flex-col gap-2 border-t border-[var(--fds-border-elevation-subtle-soft)] pt-4">
      <h3 className="txt-container-title text-default-secondary"><Trans>Controls fed · {count}</Trans></h3>
      {count === 0
        ? <p className="txt-sub-content text-default-secondary"><Trans>This requirement feeds no OpenCRQ control.</Trans></p>
        : (
          <ul className="flex flex-col gap-2">
            {controls.map((control) => (
              <li key={control.capabilityId}>
                <Link
                  from="/$tenantId/{-$organizationId}"
                  to="controls/$controlId"
                  params={{ controlId: control.capabilityId }}
                  className="flex items-center gap-3 rounded border border-[var(--fds-border-elevation-subtle-soft)] px-3 py-2 hover:bg-elevation-hover"
                >
                  <ControlIdPill externalId={control.externalId} />
                  <span className="txt-default min-w-0 flex-1 truncate text-primary">{control.name}</span>
                  <ChevronRight className="size-4 text-primary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
};

const toValues = (answer: AssessmentAnswer | undefined): ComplianceAnswerFormValues => ({
  ownerId: answer?.owner?.id ?? null,
  dueDate: answer?.dueDate ?? null,
  level: answer?.level ?? null,
  notApplicable: answer?.notApplicable ?? false,
  comment: answer?.comment ?? null,
});

const AnswerForm: FunctionComponent<{ assessmentId: string, target: AnswerDrawerTarget }> = ({ assessmentId, target }) => {
  const { closeDrawer } = useFormDrawerContext();
  useFormDrawerNavigationGuard();
  const { toast } = useToast();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // The version the form was filled from, not `target.answer`: the doorbell refreshes that one under
  // the open form, and saving against it would overwrite a concurrent edit without a conflict.
  const [loadedAnswer, setLoadedAnswer] = useState(target.answer);
  const [conflicts, setConflicts] = useState<Array<AnswerDraftField>>([]);
  const form = useForm<ComplianceAnswerFormValues>({ resolver: zodResolver(complianceAnswerFormSchema), defaultValues: toValues(loadedAnswer) });
  const [ownerId, dueDate, level, notApplicable, comment] = useWatch({
    control: form.control,
    name: ['ownerId', 'dueDate', 'level', 'notApplicable', 'comment'],
  });
  const storedValues = toValues(loadedAnswer);
  const unsettled = (field: AnswerDraftField) => conflicts.includes(field)
    && answerFieldDiffers(field, { ownerId, dueDate, level, notApplicable, comment }, storedValues);
  const takeStored = (field: AnswerDraftField) => {
    const names = field === 'rating' ? (['level', 'notApplicable'] as const) : [field];
    for (const name of names) {
      form.setValue(name, storedValues[name], { shouldDirty: true });
    }
    setConflicts((previous) => previous.filter((settled) => settled !== field));
  };

  const reloadAnswer = async () => {
    // eslint-disable-next-line no-restricted-syntax -- the retry needs the stored answer right after this response, not whenever the async doorbell round-trip lands.
    await queryClient.invalidateQueries(trpc.complianceAssessments.getAssessment.queryFilter({ id: assessmentId }));
    const stored = queryClient.getQueryData(trpc.complianceAssessments.getAssessment.queryKey({ id: assessmentId }))?.answers
      .find((answer) => answer.requirementId === target.requirement.id);
    const base = toValues(loadedAnswer);
    const draft = form.getValues();
    const reloaded = toValues(stored);
    form.reset(reloaded);
    form.reset(rebaseAnswerDraft(base, draft, reloaded), { keepDefaultValues: true });
    setConflicts((previous) => conflictingAnswerFields(base, draft, reloaded, previous));
    setLoadedAnswer(stored);
  };

  const answerRequirement = useMutation(trpc.complianceAssessments.answerRequirement.mutationOptions({
    meta: { successMessage: msg`Answer saved successfully.`, skipErrorToast: true },
    onSuccess: () => closeDrawer(),
    // Async so the mutation stays pending, and Save disabled, until the form is rebased.
    onError: async (error) => {
      if (error.data?.reason === 'STALE_WRITE') {
        await reloadAnswer();
        toast({
          title: t`Error`,
          description: t`This answer changed since you opened it. It now shows the saved version with your changes on top: review it and save again.`,
          variant: 'destructive',
          duration: STALE_WRITE_TOAST_DURATION,
        });
        return;
      }
      toast({ title: t`Error`, description: error.message, variant: 'destructive', duration: 2000 });
    },
  }));

  const onSubmit = (values: ComplianceAnswerFormValues) => {
    answerRequirement.mutate({
      assessmentId,
      requirementId: target.requirement.id,
      ownerId: values.ownerId,
      dueDate: values.dueDate,
      level: values.notApplicable ? null : toMaturityLevel(values.level),
      notApplicable: values.notApplicable,
      comment: values.comment === null || values.comment.trim() === '' ? null : values.comment,
      updatedAt: loadedAnswer?.updatedAt ?? null,
    });
  };

  return (
    <DrawerForm form={form} onSubmit={onSubmit}>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Controller
            control={form.control}
            name="ownerId"
            render={({ field, fieldState }) => (
              <OwnerSelect
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                label={t`Owner`}
                error={fieldState.error?.message}
              />
            )}
          />
          {unsettled('ownerId') && (
            <SavedMeanwhile onUse={() => takeStored('ownerId')}>
              {loadedAnswer?.owner?.name ?? loadedAnswer?.owner?.email ?? <EmptyValue />}
            </SavedMeanwhile>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Controller
            control={form.control}
            name="dueDate"
            render={({ field, fieldState }) => (
              <DateFormInput
                label={t`Due date`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                error={fieldState.error?.message}
              />
            )}
          />
          {unsettled('dueDate') && (
            <SavedMeanwhile onUse={() => takeStored('dueDate')}>
              {storedValues.dueDate === null ? <EmptyValue /> : formatDate(storedValues.dueDate)}
            </SavedMeanwhile>
          )}
        </div>
      </div>
      <Controller
        control={form.control}
        name="level"
        render={({ field }) => (
          <LevelPicker
            value={field.value}
            notApplicable={notApplicable}
            onPick={(pickedLevel, nextNotApplicable) => {
              field.onChange(pickedLevel);
              form.setValue('notApplicable', nextNotApplicable, { shouldDirty: true });
            }}
          />
        )}
      />
      {unsettled('rating') && (
        <SavedMeanwhile onUse={() => takeStored('rating')}>
          <AnswerChip level={storedValues.level} notApplicable={storedValues.notApplicable} />
        </SavedMeanwhile>
      )}
      <div className="flex flex-col gap-2">
        <Controller
          control={form.control}
          name="comment"
          render={({ field, fieldState }) => (
            <Textarea
              {...field}
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
              rows={5}
              label={t`Comment`}
              placeholder={t`What is in place, and what is missing.`}
              error={fieldState.error?.message}
            />
          )}
        />
        {unsettled('comment') && (
          <SavedMeanwhile onUse={() => takeStored('comment')}>
            <span className="whitespace-pre-wrap">{storedValues.comment ?? <EmptyValue />}</span>
          </SavedMeanwhile>
        )}
      </div>
      <FedControls controls={target.controls} />
      <DrawerFormActions isPending={answerRequirement.isPending} submitLabel={t`Save`} />
    </DrawerForm>
  );
};

const PublishedAnswer: FunctionComponent<{ answer: AssessmentAnswer | undefined, controls: ReadonlyArray<AssessmentControlLink> }> = ({ answer, controls }) => (
  <div className="flex flex-col gap-5">
    <p className="txt-sub-content text-default-secondary">
      <Trans>This assessment is published: its answers can no longer change until it is reopened.</Trans>
    </p>
    <div className="grid grid-cols-2 gap-4">
      <InfoField title={t`Owner`} value={answer?.owner?.name ?? answer?.owner?.email} />
      <InfoField title={t`Due date`} value={answer?.dueDate ? formatDate(answer.dueDate) : null} />
    </div>
    <CardField title={t`Maturity level`}>
      <AnswerChip level={answer?.level ?? null} notApplicable={answer?.notApplicable ?? false} />
    </CardField>
    <DescriptionField title={t`Comment`} value={answer?.comment} />
    <FedControls controls={controls} />
  </div>
);

export const ComplianceAnswerDrawer: FunctionComponent<AnswerDrawerProps> = ({ assessmentId, locked, target, onClose }) => {
  const location = target?.path.map((node) => node.title).join(' · ') ?? '';
  const code = target?.requirement.code;
  return (
    <FormDrawer
      open={target !== null}
      onClose={onClose}
      className="w-[600px]"
      category={code === undefined ? undefined : <Trans>Requirement {code}</Trans>}
      title={target?.requirement.title ?? ''}
    >
      {target !== null && (
        <div className="flex flex-1 flex-col gap-4">
          <p className="txt-sub-content text-default-secondary">{location}</p>
          {locked
            ? <PublishedAnswer answer={target.answer} controls={target.controls} />
            : <AnswerForm key={target.requirement.id} assessmentId={assessmentId} target={target} />}
        </div>
      )}
    </FormDrawer>
  );
};
