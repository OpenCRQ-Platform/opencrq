import { Button, Chip, Textarea } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { Suspense, useEffect, useId } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { ArrowRight, Pencil, Sparkles } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useParams, useRouter } from '@tanstack/react-router';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { PostureDimension, ScopeDeclaration, ScopeSave } from '../utils/scope-posture-utils';
import type { AxisState, ModeSwitch } from '../utils/assessment-axes-utils';
import { useTRPC } from '../../../../lib';
import { Loader } from '../../../../components/ui/loader';
import { ControlIdPill, DrawerForm, DrawerFormActions, FormDrawer, InfoTooltip, useFormDrawerContext } from '../../../../components/shared';
import { coverageLabel } from '../ui/coverage-label';
import { strengthInfo } from '../ui/strength-info';
import { strengthLabel } from '../ui/strength-label';
import { EffectivenessBadge, effectivenessText } from '../ui/effectiveness-badge';
import { computeSoloEffectiveness, isSameEffectiveness } from '../utils/capability-effectiveness';
import { hasSaveWork, isSaveComplete, modeSwitchesOf, planAssessmentSave } from '../utils/assessment-axes-utils';
import { inheritedPostureOf, planScopeSave, scopeDeclarationOf } from '../utils/scope-posture-utils';

interface AssessmentEditFormProps {
  capabilityId: string,
  onSuccess?: () => void,
}

const formSchema = z.object({
  strengthRung: z.enum(STRENGTH_RUNGS).nullable(),
  coverageBucket: z.enum(COVERAGE_BUCKETS).nullable(),
  comment: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

interface AxisChoicesProps<T extends string> {
  question: string,
  infoLabel: string,
  info: ReactNode,
  values: ReadonlyArray<T>,
  labelOf: (value: T) => string,
  value: T | null,
  onChange: (value: T) => void,
  footer?: ReactNode,
}

const AxisChoices = <T extends string>({ question, infoLabel, info, values, labelOf, value, onChange, footer }: AxisChoicesProps<T>): ReactNode => {
  const questionId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span id={questionId} className="txt-category">{question}</span>
        <InfoTooltip label={infoLabel}>{info}</InfoTooltip>
      </div>
      <div role="group" aria-labelledby={questionId} className="grid grid-cols-4 gap-2">
        {values.map((option) => (
          <Button
            key={option}
            type="button"
            fullWidth
            priority={option === value ? 'primary' : 'secondary'}
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {labelOf(option)}
          </Button>
        ))}
      </div>
      {footer}
    </div>
  );
};

interface EffectivenessInputs {
  strength: StrengthRung | null,
  coverage: CoverageBucket | null,
}

const EffectivenessLine: FunctionComponent<{ initial: EffectivenessInputs, current: EffectivenessInputs }> = ({ initial, current }) => {
  const before = initial.strength === null || initial.coverage === null
    ? null
    : computeSoloEffectiveness({ strengthRung: initial.strength, coverageBucket: initial.coverage });
  const after = current.strength === null || current.coverage === null
    ? null
    : computeSoloEffectiveness({ strengthRung: current.strength, coverageBucket: current.coverage });
  const changed = before !== null && after !== null && !isSameEffectiveness(before, after);
  return (
    <div className="flex items-center gap-2 border-t border-border pt-4" aria-live="polite">
      <span className="txt-container-title text-muted-foreground"><Trans>Effectiveness</Trans></span>
      {changed && (
        <>
          <del className="txt-sub-content text-muted-foreground">{effectivenessText(before.band, before.score)}</del>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
        </>
      )}
      {after === null
        ? <Chip label={t`Not assessed`} />
        : <EffectivenessBadge band={after.band} score={after.score} />}
    </div>
  );
};

const tenantFormSchema = formSchema.extend({
  strengthAttached: z.boolean(),
  coverageAttached: z.boolean(),
});

type TenantFormValues = z.infer<typeof tenantFormSchema>;

type AxisTarget<T extends string> = 'auto' | T | null;

const targetOf = <T extends string>(state: AxisState<T>): AxisTarget<T> => (state.attached ? 'auto' : state.value);

interface AxisFromToProps<T extends string> {
  question: string,
  infoLabel: string,
  info: ReactNode,
  values: ReadonlyArray<T>,
  labelOf: (value: T) => string,
  saved: AxisState<T>,
  current: AxisState<T>,
  /** The value auto reads now, null when no source feeds the axis. */
  derived: T | null,
  onPick: (target: AxisTarget<T>) => void,
}

const AxisFromTo = <T extends string>({ question, infoLabel, info, values, labelOf, saved, current, derived, onPick }: AxisFromToProps<T>): ReactNode => {
  const questionId = useId();
  const target = targetOf(current);
  const moved = target !== targetOf(saved);
  const derivedName = derived === null ? null : labelOf(derived);
  const autoHint = derivedName === null ? t`No source` : t({ context: 'derived value', message: `${derivedName} today` });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span id={questionId} className="txt-category">{question}</span>
        <InfoTooltip label={infoLabel}>{info}</InfoTooltip>
      </div>
      {/*
        48rem holds the current value, the arrow and five buttons wide enough for the longest label ("Intermédiaire");
        narrower, the buttons go under the current value and wrap at that width rather than cut their labels.
      */}
      <div className="@container">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 [grid-template-areas:'current-label_current-label'_'current_current'_'arrow_target-label'_'targets_targets'] @[48rem]:grid-cols-[9rem_1.25rem_minmax(0,1fr)] @[48rem]:[grid-template-areas:'current-label_._target-label'_'current_arrow_targets']">
          <span className="txt-container-title text-muted-foreground [grid-area:current-label]">{t`Current`}</span>
          <div className="flex w-36 flex-col justify-center gap-0.5 rounded-sm border border-border px-3 py-2 [grid-area:current]">
            <span className="inline-flex items-center gap-1 txt-sub-content text-muted-foreground">
              {saved.attached ? <Sparkles className="size-3" aria-hidden /> : <Pencil className="size-3" aria-hidden />}
              {saved.attached ? t`Auto` : t`Manual`}
            </span>
            <span className={saved.value === null ? 'italic text-muted-foreground' : 'font-semibold'}>
              {saved.value === null ? t`Not assessed` : labelOf(saved.value)}
            </span>
          </div>
          <ArrowRight className={`size-4 self-center [grid-area:arrow] ${moved ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
          <span className="self-center txt-container-title text-primary [grid-area:target-label]">{t`Target`}</span>
          <div role="group" aria-labelledby={questionId} className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 [grid-area:targets] @[48rem]:grid-cols-[repeat(5,minmax(0,1fr))]">
            <Button
              type="button"
              fullWidth
              className="h-auto min-h-12 whitespace-normal px-2 py-1"
              priority={target === 'auto' ? 'primary' : 'secondary'}
              aria-pressed={target === 'auto'}
              disabled={derived === null}
              onClick={() => onPick('auto')}
            >
              <span className="flex flex-col items-center">
                <span className="inline-flex items-center gap-1"><Sparkles className="size-3.5" aria-hidden />{t`Auto`}</span>
                <span className="txt-mini font-normal">{autoHint}</span>
              </span>
            </Button>
            {values.map((option) => (
              <Button
                key={option}
                type="button"
                fullWidth
                className="h-auto min-h-12 whitespace-normal px-2 py-1"
                priority={option === target ? 'primary' : 'secondary'}
                aria-pressed={option === target}
                onClick={() => onPick(option)}
              >
                {labelOf(option)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const justificationPlaceholder = (switches: ReadonlyArray<ModeSwitch>): string => {
  const [only] = switches;
  if (only === undefined) {
    return t`Add your comments here...`;
  }
  if (switches.length > 1) {
    return t`Why change the mode of these axes?`;
  }
  switch (only.axis) {
    case 'strength':
      return only.toAuto ? t`Why re-attach the strength to its sources?` : t`Why switch the strength to manual?`;
    case 'coverage':
      return only.toAuto ? t`Why re-attach the coverage to its sources?` : t`Why switch the coverage to manual?`;
  }
};

/** Each axis is set to auto or to a declared value in one choice, against the state it is saved in. */
const AssessmentEditForm: FunctionComponent<AssessmentEditFormProps> = ({ capabilityId, onSuccess }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();
  const { data: capability } = useSuspenseQuery(trpc.controlCapabilities.getControlCapability.queryOptions({ id: capabilityId }));
  const { data: pooled } = useQuery(trpc.controlCapabilities.getPooledAssessment.queryOptions({ capabilityId }));

  const assessment = capability?.assessment ?? null;
  const initial = {
    strength: { value: assessment?.strengthRung ?? null, attached: assessment?.strengthMode === 'auto' },
    coverage: { value: assessment?.coverageBucket ?? null, attached: assessment?.coverageMode === 'auto' },
  };

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    mode: 'onChange',
    // The drawer can open on a stale cached assessment: `values` moves untouched fields onto the refetched one.
    values: {
      strengthRung: initial.strength.value,
      coverageBucket: initial.coverage.value,
      strengthAttached: initial.strength.attached,
      coverageAttached: initial.coverage.attached,
      comment: '',
    },
    resetOptions: { keepDirtyValues: true },
  });

  const [currentStrength, currentCoverage, strengthAttached, coverageAttached] = useWatch({
    control: form.control,
    name: ['strengthRung', 'coverageBucket', 'strengthAttached', 'coverageAttached'],
  });
  const current = {
    strength: { value: currentStrength, attached: strengthAttached },
    coverage: { value: currentCoverage, attached: coverageAttached },
  };
  const plan = planAssessmentSave(initial, current);
  const switches = modeSwitchesOf(initial, current);
  const hasAnyChange = hasSaveWork(plan) || switches.length > 0;

  const router = useRouter();
  const upsertAssessment = useMutation(trpc.controlCapabilities.upsertAssessment.mutationOptions({ meta: { skipSuccessToast: true } }));

  // Reset comment when user reverts changes, so RHF isDirty auto-clears
  useEffect(() => {
    if (!hasAnyChange) {
      form.resetField('comment');
    }
  }, [hasAnyChange, form]);

  if (!capability) {
    return null;
  }

  const onSubmit = async (values: TenantFormValues) => {
    const input = {
      capabilityId,
      reattach: plan.reattach,
      strengthRung: plan.declare?.strengthRung ?? null,
      coverageBucket: plan.declare?.coverageBucket ?? null,
      comment: values.comment.trim() || null,
    };
    try {
      await upsertAssessment.mutateAsync(input);
    } catch {
      // The global mutation handler has already reported it.
      return;
    }
    toast({ description: t`Assessment updated successfully.` });
    await onSuccess?.();
    await router.invalidate();
    closeDrawer();
  };

  const derivedStrength = initial.strength.attached ? initial.strength.value : pooled?.strengthRung ?? null;
  const derivedCoverage = initial.coverage.attached ? initial.coverage.value : pooled?.coverageBucket ?? null;

  const pickStrength = (target: AxisTarget<StrengthRung>) => {
    form.setValue('strengthRung', target === 'auto' ? derivedStrength : target, { shouldDirty: true });
    form.setValue('strengthAttached', target === 'auto', { shouldDirty: true });
  };
  const pickCoverage = (target: AxisTarget<CoverageBucket>) => {
    form.setValue('coverageBucket', target === 'auto' ? derivedCoverage : target, { shouldDirty: true });
    form.setValue('coverageAttached', target === 'auto', { shouldDirty: true });
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={(
        <DrawerFormActions isPending={upsertAssessment.isPending} disabled={!hasAnyChange || !isSaveComplete(current)} />
      )}
    >
      <AxisFromTo
        question={t`How is the control implemented?`}
        infoLabel={t`What each strength rung demands`}
        info={strengthInfo(capability.rungs)}
        values={STRENGTH_RUNGS}
        labelOf={strengthLabel}
        saved={initial.strength}
        current={current.strength}
        derived={derivedStrength}
        onPick={pickStrength}
      />

      <AxisFromTo
        question={t`How widely is it deployed?`}
        infoLabel={t`What coverage measures`}
        info={<Trans>Coverage says how much of the concerned perimeter the control is deployed on, not how well it works there.</Trans>}
        values={COVERAGE_BUCKETS}
        labelOf={coverageLabel}
        saved={initial.coverage}
        current={current.coverage}
        derived={derivedCoverage}
        onPick={pickCoverage}
      />

      <EffectivenessLine
        initial={{ strength: initial.strength.value, coverage: initial.coverage.value }}
        current={{ strength: currentStrength, coverage: currentCoverage }}
      />

      {hasAnyChange && (
        <Controller
          control={form.control}
          name="comment"
          render={({ field, fieldState }) => (
            <Textarea
              label={switches.length > 0 ? t`Justification` : t`Comment`}
              placeholder={justificationPlaceholder(switches)}
              rows={4}
              {...field}
              error={fieldState.error?.message}
            />
          )}
        />
      )}
    </DrawerForm>
  );
};

const ScopeAxisState: FunctionComponent<{ declared: boolean, onRevert: () => void }> = ({ declared, onRevert }) => (declared
  ? (
    <div>
      <Button type="button" priority="tertiary" size="sm" onClick={onRevert}>
        <Trans>Revert to the tenant value</Trans>
      </Button>
    </div>
  )
  : <span className="txt-sub-content text-muted-foreground"><Trans>Inherited from the tenant</Trans></span>);

interface ScopeWrites {
  declare: (declaration: ScopeDeclaration, comment: string | null) => Promise<unknown>,
  clear: (dimension: PostureDimension) => Promise<unknown>,
}

/** False when nothing was written; a failed write has already been reported by the global mutation handler. */
const writeScopeSave = async (save: ScopeSave, comment: string | null, writes: ScopeWrites): Promise<boolean> => {
  if (save.kind === 'none') {
    return false;
  }
  try {
    if (save.kind === 'declare') {
      await writes.declare(save.declaration, comment);
      return true;
    }
    for (const dimension of save.dimensions) {
      await writes.clear(dimension);
    }
    return true;
  } catch {
    return false;
  }
};

/** Choosing a rung declares its axis, the tenant's own rung included, so the form holds the declaration rather than the value shown. */
const ScopeAssessmentEditForm: FunctionComponent<AssessmentEditFormProps & { organizationId: string }> = ({ capabilityId, organizationId, onSuccess }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();
  const router = useRouter();
  const { data: capability } = useSuspenseQuery(trpc.controlCapabilities.getControlCapability.queryOptions({ id: capabilityId }));
  const { data: postures } = useSuspenseQuery(trpc.controlCapabilities.getResolvedControlPosture.queryOptions({ organizationId }));
  const posture = postures.find((entry) => entry.capabilityId === capabilityId);

  const initial = posture === undefined ? { strengthRung: null, coverageBucket: null } : scopeDeclarationOf(posture);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    // A stale cached posture moves untouched axes onto the refetched one.
    values: { strengthRung: initial.strengthRung, coverageBucket: initial.coverageBucket, comment: '' },
    resetOptions: { keepDirtyValues: true },
  });

  const declaredStrength = useWatch({ control: form.control, name: 'strengthRung' });
  const declaredCoverage = useWatch({ control: form.control, name: 'coverageBucket' });
  const hasAnyChange = planScopeSave(initial, { strengthRung: declaredStrength, coverageBucket: declaredCoverage }).kind !== 'none';

  const declare = useMutation(trpc.controlCapabilities.declareScopeControlPosture.mutationOptions({ meta: { skipSuccessToast: true } }));
  const clear = useMutation(trpc.controlCapabilities.clearScopeControlPosture.mutationOptions({ meta: { skipSuccessToast: true } }));

  useEffect(() => {
    if (!hasAnyChange) {
      form.resetField('comment');
    }
  }, [hasAnyChange, form]);

  if (!capability || posture === undefined) {
    return null;
  }

  const inherited = inheritedPostureOf(posture);
  const shownStrength = declaredStrength ?? inherited.strengthRung;
  const shownCoverage = declaredCoverage ?? inherited.coverageBucket;

  const onSubmit = async (values: FormValues) => {
    const save = planScopeSave(initial, { strengthRung: values.strengthRung, coverageBucket: values.coverageBucket });
    const saved = await writeScopeSave(save, values.comment.trim() || null, {
      declare: (declaration, comment) => declare.mutateAsync({ organizationId, capabilityId, ...declaration, comment }),
      clear: (dimension) => clear.mutateAsync({ organizationId, capabilityId, dimension }),
    });
    if (!saved) {
      return;
    }
    toast({ description: t`Assessment updated successfully.` });
    await onSuccess?.();
    await router.invalidate();
    closeDrawer();
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={(
        <DrawerFormActions isPending={declare.isPending || clear.isPending} disabled={!hasAnyChange} />
      )}
    >
      <Controller
        control={form.control}
        name="strengthRung"
        render={({ field }) => (
          <AxisChoices
            question={t`How is the control implemented?`}
            infoLabel={t`What each strength rung demands`}
            info={strengthInfo(capability.rungs)}
            values={STRENGTH_RUNGS}
            labelOf={strengthLabel}
            value={shownStrength}
            onChange={field.onChange}
            footer={<ScopeAxisState declared={field.value !== null} onRevert={() => field.onChange(null)} />}
          />
        )}
      />

      <Controller
        control={form.control}
        name="coverageBucket"
        render={({ field }) => (
          <AxisChoices
            question={t`How widely is it deployed?`}
            infoLabel={t`What coverage measures`}
            info={<Trans>Coverage says how much of the concerned perimeter the control is deployed on, not how well it works there.</Trans>}
            values={COVERAGE_BUCKETS}
            labelOf={coverageLabel}
            value={shownCoverage}
            onChange={field.onChange}
            footer={<ScopeAxisState declared={field.value !== null} onRevert={() => field.onChange(null)} />}
          />
        )}
      />

      <EffectivenessLine
        initial={{ strength: posture.strengthRung, coverage: posture.coverageBucket }}
        current={{ strength: shownStrength, coverage: shownCoverage }}
      />

      {hasAnyChange && (
        <Controller
          control={form.control}
          name="comment"
          render={({ field, fieldState }) => (
            <Textarea
              label={t`Comment`}
              placeholder={t`Add your comments here...`}
              rows={4}
              {...field}
              error={fieldState.error?.message}
            />
          )}
        />
      )}

      {hasAnyChange && (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Its scenarios will be recalculated.</Trans>
        </p>
      )}
    </DrawerForm>
  );
};

interface CapabilityAssessmentEditDrawerProps {
  capabilityId: string,
  externalId: string,
  name: string,
  onClose: () => void,
  onSuccess?: () => void,
}

export const CapabilityAssessmentEditDrawer: FunctionComponent<CapabilityAssessmentEditDrawerProps> = ({ capabilityId, externalId, name, onClose, onSuccess }) => {
  const { organizationId } = useParams({ strict: false });
  return (
    <FormDrawer
      open
      onClose={onClose}
      // The design system's lg drawer width, capped to the viewport as its Drawer is: AxisFromTo's one-row layout fits in it.
      // Through the minimum width, since fds.css ships the legacy drawer's w-[30vw] unlayered.
      className="min-w-[min(var(--fds-width-overlay-lg),calc(100vw-var(--fds-spacing)*8))]"
      category={<Trans>Assessment</Trans>}
      title={(
        <span className="flex items-center gap-2">
          <ControlIdPill externalId={externalId} />
          <span className="min-w-0 line-clamp-2">{name}</span>
        </span>
      )}
    >
      <Suspense fallback={<Loader />}>
        {organizationId === undefined
          ? <AssessmentEditForm capabilityId={capabilityId} onSuccess={onSuccess} />
          : <ScopeAssessmentEditForm capabilityId={capabilityId} organizationId={organizationId} onSuccess={onSuccess} />}
      </Suspense>
    </FormDrawer>
  );
};
