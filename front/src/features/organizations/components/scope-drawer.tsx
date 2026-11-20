import { Tabs, TabsContent, TabsList, TabsTrigger, Text } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useRef, useState } from 'react';
import { useForm, useFormState, useWatch } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ScopeDrawerTab } from '../scope-drawer-tabs';
import type { ScopeSaveOutcome } from './scope-drawer-utils';
import type { ScopeFormValues } from './scope-form-fields';
import {
  DrawerFormActions,
  DrawerFormBody,
  DrawerFormColumn,
  FormDrawer,
  isDeliberateSubmit,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { DeclaredEstateQuestionnaire, useDeclaredEstateForm } from '../../declared-estate';
import { FinancialProfileQuestionnaireFields, useFinancialProfileForm } from '../../financial-profiles';
import { Loader } from '../../../components/ui/loader';
import { useTRPC } from '../../../lib';
import { isScopeDrawerTab } from '../scope-drawer-tabs';
import { EMPTY_ESTATE_MAPPING_DELTA, selectedAssetCount } from './estate-assets-picker-utils';
import { scopeSaveOutcome, tabsInError } from './scope-drawer-utils';
import { EMPTY_SCOPE_FORM, ScopeEstateFields, scopeFormSchema, ScopeIdentityFields } from './scope-form-fields';

/** `unchanged` is the one branch where nothing was written, so it is the one that is not a success. */
const saveOutcomeToast = (outcome: ScopeSaveOutcome) => {
  switch (outcome) {
    case 'repriced':
      return { description: t`Risk scope updated. Every risk scenario's financial impact is being recomputed.` };
    case 'updated':
      return { description: t`Risk scope updated successfully.` };
    case 'unchanged':
      return { description: t`No changes to save.`, variant: 'info' as const };
  }
};

/**
 * Every panel stays mounted, so leaving a tab must not drop what was typed in it. The two display
 * classes are swapped rather than paired with a `data-[state=inactive]:` variant: the design
 * system ships `.flex` and `.hidden` unlayered, which no layered variant of ours can beat.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class lists, not copy
const tabPanelClass = (shown: boolean): string => (shown ? 'flex flex-col gap-4' : 'hidden');

/** The erroring field itself is one panel away. */
const TabErrorDot: FunctionComponent<{ shown: boolean }> = ({ shown }) => (shown
  ? <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-[var(--fds-color-feedback-error-primary)]" />
  : null);

interface ScopeDrawerBodyProps {
  organizationId: string,
  tab: ScopeDrawerTab,
  onTabChange: (tab: ScopeDrawerTab) => void,
}

const ScopeDrawerBody: FunctionComponent<ScopeDrawerBodyProps> = ({ organizationId, tab, onTabChange }) => {
  const trpc = useTRPC();
  const { toast } = useToast();
  const { closeDrawer } = useFormDrawerContext();
  const bodyRef = useRef<HTMLDivElement>(null);
  // The three panels share one scroller, which would carry the previous tab's offset over.
  const changeTab = (next: ScopeDrawerTab) => {
    onTabChange(next);
    if (next !== tab) {
      bodyRef.current?.scrollTo({ top: 0 });
    }
  };
  // The picker's page and its counts are the drawer's heaviest reads, and two of the three tabs
  // never show them.
  const [estateVisited, setEstateVisited] = useState(tab === 'estate');
  if (tab === 'estate' && !estateVisited) {
    setEstateVisited(true);
  }
  const [declaredEstateVisited, setDeclaredEstateVisited] = useState(tab === 'declared-estate');
  if (tab === 'declared-estate' && !declaredEstateVisited) {
    setDeclaredEstateVisited(true);
  }
  const { data: comparison } = useQuery(trpc.declaredEstate.comparison.queryOptions({ organizationId }, { enabled: declaredEstateVisited }));

  const { data: organization } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const { data: countries } = useQuery(trpc.countries.getCountries.queryOptions());

  const form = useForm<ScopeFormValues>({
    resolver: zodResolver(scopeFormSchema),
    defaultValues: EMPTY_SCOPE_FORM,
    // Ticking a row is a change like any other, and a doorbell refetching the scope must not undo it.
    resetOptions: { keepDirtyValues: true },
    values: organization
      ? {
        name: organization.name,
        description: organization.description,
        legalEntityName: organization.legalEntityName,
        sectorId: organization.sectorId,
        countryId: organization.countryId,
        employeeCount: organization.employeeCount,
        domain: organization.domain,
        reactionTimeMin: organization.reactionTimeMin,
        reactionTimeLikely: organization.reactionTimeLikely,
        reactionTimeMax: organization.reactionTimeMax,
        estateMode: organization.estateMode,
        mapping: EMPTY_ESTATE_MAPPING_DELTA,
      }
      : undefined,
  });

  const estateMode = useWatch({ control: form.control, name: 'estateMode' });
  const mapping = useWatch({ control: form.control, name: 'mapping' });
  const countryId = useWatch({ control: form.control, name: 'countryId' });
  // The country the reader is choosing one tab away, not the stored one: the labour benchmark the
  // questionnaire shows as guidance must follow it.
  const country = countries?.find((candidate) => candidate.id === countryId);

  const questionnaire = useFinancialProfileForm(organizationId);
  const declaredEstate = useDeclaredEstateForm(organizationId);
  const identityState = useFormState({ control: form.control });
  const answersState = useFormState({ control: questionnaire.form.control });
  useFormDrawerDirtyState(identityState.isDirty || answersState.isDirty || declaredEstate.isDirty);
  const answersDirty = answersState.isDirty;
  const errorTabs = tabsInError(Object.keys(identityState.errors), Object.keys(answersState.errors), declaredEstate.hasErrors);

  const updateOrganization = useMutation(trpc.organizations.updateOrganization.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const onSubmit = async (values: ScopeFormValues) => {
    const answersValid = await questionnaire.form.trigger();
    if (!answersValid) {
      changeTab('questionnaire');
      return;
    }
    if (declaredEstate.hasErrors) {
      changeTab('declared-estate');
      return;
    }
    const answers = questionnaire.form.getValues();
    const { mapping: delta, ...columns } = values;

    // Gated because the write itself is what wakes the recompute — `organizations` is in its read
    // set — so a drawer opened and saved with nothing touched would book a tenant-wide sweep for
    // no change. `isDirty` covers the estate mapping too, which is a field of this form.
    if (identityState.isDirty) {
      await updateOrganization.mutateAsync({ id: organizationId, ...columns, mapping: delta });
    }
    if (answersDirty) {
      await questionnaire.save(answers);
    }
    if (declaredEstate.isDirty) {
      await declaredEstate.save();
    }
    toast(saveOutcomeToast(scopeSaveOutcome({
      identity: identityState.isDirty,
      answers: answersDirty,
      employeeCount: identityState.dirtyFields.employeeCount === true,
      declaredEstate: declaredEstate.isDirty,
    })));
    closeDrawer();
  };

  const isPending = updateOrganization.isPending || questionnaire.isSaving || declaredEstate.isSaving;

  // Both forms start on their empty values and take the stored row only when the queries land, so
  // a Save pressed before then would write null over every column and every answer.
  if (!organization || questionnaire.isLoading || declaredEstate.isLoading) {
    return <Loader />;
  }

  return (
    <DrawerFormColumn
      onSubmit={(event) => {
        if (!isDeliberateSubmit(event.nativeEvent.submitter)) {
          event.preventDefault();
          return;
        }
        void form.handleSubmit(
          // Each write raises its own error toast; catching here only keeps the rejection handled.
          (values) => void onSubmit(values).catch(() => undefined),
          // A panel the reader cannot see cannot report its own error, so the submit lands on it.
          (errors) => changeTab(tabsInError(Object.keys(errors), [])[0] ?? 'identity'),
        )(event);
      }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (!isScopeDrawerTab(value)) {
            return;
          }
          changeTab(value);
        }}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="identity"><Trans>Identity</Trans><TabErrorDot shown={errorTabs.includes('identity')} /></TabsTrigger>
          <TabsTrigger value="questionnaire"><Trans>Financial profile</Trans><TabErrorDot shown={errorTabs.includes('questionnaire')} /></TabsTrigger>
          <TabsTrigger value="declared-estate"><Trans>Declared estate</Trans><TabErrorDot shown={errorTabs.includes('declared-estate')} /></TabsTrigger>
          <TabsTrigger value="estate"><Trans>Estate</Trans><TabErrorDot shown={errorTabs.includes('estate')} /></TabsTrigger>
        </TabsList>

        <DrawerFormBody ref={bodyRef}>
          <TabsContent value="identity" forceMount className={tabPanelClass(tab === 'identity')}>
            <ScopeIdentityFields control={form.control} />
          </TabsContent>

          <TabsContent value="estate" forceMount className={tabPanelClass(tab === 'estate')}>
            {estateVisited && (
              <>
                <ScopeEstateFields control={form.control} organizationId={organizationId} mappedCount={organization.mappedAssetCount} />
                {estateMode === 'closed' && (
                  <Text as="p" variant="content-compact" className="text-default-secondary">
                    {plural(selectedAssetCount(organization.mappedAssetCount, mapping), {
                      one: 'Saving measures this scope over # asset.',
                      other: 'Saving measures this scope over # assets.',
                    })}
                  </Text>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="questionnaire" forceMount className={tabPanelClass(tab === 'questionnaire')}>
            <FinancialProfileQuestionnaireFields
              form={questionnaire.form}
              revenueBand={organization.revenueBand}
              countryName={country?.name}
              countryIsoAlpha3={country?.isoAlpha3}
            />
          </TabsContent>

          <TabsContent value="declared-estate" forceMount className={tabPanelClass(tab === 'declared-estate')}>
            <DeclaredEstateQuestionnaire
              drafts={declaredEstate.drafts}
              onChange={declaredEstate.setDraft}
              measured={comparison === undefined ? undefined : new Map(comparison.kinds.map((entry) => [entry.kind, entry.measured]))}
            />
          </TabsContent>
        </DrawerFormBody>
      </Tabs>

      <DrawerFormActions isPending={isPending} submitLabel={t`Save`} />
    </DrawerFormColumn>
  );
};

interface ScopeDrawerProps {
  organizationId: string,
  initialTab: ScopeDrawerTab,
  open: boolean,
  onClose: () => void,
}

/**
 * The one drawer a risk scope is edited, mapped and questioned in. Its three tabs are one save, at
 * one width, so switching tab never resizes the panel under the pointer.
 */
export const ScopeDrawer: FunctionComponent<ScopeDrawerProps> = ({ organizationId, initialTab, open, onClose }) => {
  const trpc = useTRPC();
  const [tab, setTab] = useState<ScopeDrawerTab>(initialTab);
  // A details page mounts this drawer for the whole visit, so the tab the opener asked for arrives
  // as a prop change, never as a mount.
  const [opened, setOpened] = useState({ open, initialTab });
  if (opened.open !== open || opened.initialTab !== initialTab) {
    setOpened({ open, initialTab });
    if (open) {
      setTab(initialTab);
    }
  }
  const { data: organization } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const scopeName = organization?.name ?? '';

  return (
    <FormDrawer
      title={t`Edit ${scopeName}`}
      open={open}
      onClose={onClose}
      // The legacy sheet's own right-side width is declared at the `md` breakpoint, so an
      // unprefixed width here would lose to it on every desktop viewport.
      className="max-md:w-full md:w-[70vw] max-w-[1280px] min-w-[min(860px,100vw)]"
    >
      {open && (
        <ScopeDrawerBody
          key={organizationId}
          organizationId={organizationId}
          tab={tab}
          onTabChange={setTab}
        />
      )}
    </FormDrawer>
  );
};
