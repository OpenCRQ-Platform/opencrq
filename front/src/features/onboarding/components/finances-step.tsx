import { Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { ServerOff } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useRef } from 'react';
import type { FinancialProfileAnswers } from '../../financial-profiles';
import { Loader } from '../../../components/ui/loader';
import { FinancialProfileQuestionnaireFields, useFinancialProfileForm } from '../../financial-profiles';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { OnboardingStepLayout } from './onboarding-step-layout';

const sameAnswers = (values: FinancialProfileAnswers, baseline: Partial<FinancialProfileAnswers> | undefined): boolean =>
  baseline !== undefined && Object.keys(values).every((key) => Reflect.get(values, key) === Reflect.get(baseline, key));

const FinancesForm: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const { organization, isLoading, isError, form, save } = useFinancialProfileForm(organizationId);
  const lastSaved = useRef<FinancialProfileAnswers | null>(null);
  // One write at a time, each sending the answers as they are when its turn comes: two answers given in a row cannot land out of order.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const why = t`Your financial figures turn an incident into a loss: downtime, notification, fines, ransom.`;

  /** Called when a field loses focus and when a choice is clicked: a typed number then saves on blur, a choice at once. */
  const saveIfChanged = () => {
    queue.current = queue.current.then(async () => {
      const values = form.getValues();
      if (sameAnswers(values, lastSaved.current ?? form.formState.defaultValues)) {
        return;
      }
      if (!(await form.trigger())) {
        return;
      }
      try {
        await save(values);
        lastSaved.current = values;
      } catch {
        // The failed write already raised its own error toast; the next change tries again.
      }
    });
  };

  // The form holds its empty values until the stored profile lands: a save before then, or after a failed read, would write null over every answer.
  if (isError) {
    return (
      <OnboardingStepLayout stepKey="finances" why={why}>
        <Paper elevation={2} padding={16} className="flex items-center gap-3">
          <ServerOff className="size-5 shrink-0" aria-hidden />
          <Text as="p" variant="content-compact">{t`Your financial figures could not be loaded.`}</Text>
        </Paper>
      </OnboardingStepLayout>
    );
  }
  if (isLoading || !organization) {
    return <Loader />;
  }

  return (
    <OnboardingStepLayout stepKey="finances" why={why}>
      <form noValidate onSubmit={(event) => event.preventDefault()} onBlur={saveIfChanged} onClick={saveIfChanged}>
        <FinancialProfileQuestionnaireFields
          form={form}
          revenueBand={organization.revenueBand}
          countryName={organization.country?.name}
          countryIsoAlpha3={organization.country?.isoAlpha3}
        />
      </form>
    </OnboardingStepLayout>
  );
};

export const FinancesStep: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  if (wizard === null || wizard === undefined) {
    return <Loader />;
  }

  return <FinancesForm organizationId={wizard.organizationId} />;
};
