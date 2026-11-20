import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@filigran/ui';
import { ProgressBar, Text } from '@filigran/design-system';
import type { RevenueBand } from '@app/module/client';
import { computeProgress, SECTION_KEYS, sectionProgress } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useWatch } from 'react-hook-form';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import { LoadedDailyLabourCostCard } from './financial-profile-cards';
import { SECTION_INTROS, SECTION_TITLES } from './financial-profile-questions';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from './financial-profile-schema';
import { FinancialProfileSectionCards } from './financial-profile-sections';

interface FinancialProfileQuestionnaireFieldsProps {
  form: UseFormReturn<FinancialProfileAnswers>,
  revenueBand: RevenueBand | null,
  countryName: string | undefined,
  countryIsoAlpha3: string | undefined,
}

/**
 * The questionnaire's eight sections, as an accordion, over a form the caller owns. It renders no
 * form element and no actions: its caller's own save writes it with the scope.
 */
export const FinancialProfileQuestionnaireFields: FunctionComponent<FinancialProfileQuestionnaireFieldsProps> = ({
  form,
  revenueBand,
  countryName,
  countryIsoAlpha3,
}) => {
  const values: FinancialProfileAnswers = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, ...useWatch({ control: form.control }) };
  const { answeredCount, totalCount } = computeProgress(values);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Text as="p" variant="content-compact" className="text-default-secondary">
          <Trans>Each scenario's loss estimates derive from these answers; every extra answer sharpens one.</Trans>
        </Text>
        <div className="flex items-center gap-3">
          <ProgressBar aria-label={t`Progress`} value={(answeredCount / totalCount) * 100} className="max-w-[240px] flex-1" />
          <Text as="span" variant="content-compact" className="text-default-secondary whitespace-nowrap">
            {t`${answeredCount} of ${totalCount} answered`}
          </Text>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={[...SECTION_KEYS]}>
        {SECTION_KEYS.map((section) => {
          const { answeredCount: sectionAnswered, totalCount: sectionTotal } = sectionProgress(section, values);
          return (
            <AccordionItem key={section} value={section}>
              <AccordionTrigger>
                <span className="flex w-full items-baseline justify-between gap-3 pr-3">
                  <span>{SECTION_TITLES[section]()}</span>
                  <span className="txt-sub-content text-muted-foreground">
                    {t`${sectionAnswered} of ${sectionTotal}`}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-3 pb-2">
                  <Text as="p" variant="content-compact" className="text-default-secondary">{SECTION_INTROS[section]()}</Text>
                  {section === 'A' && <LoadedDailyLabourCostCard form={form} countryName={countryName} countryIsoAlpha3={countryIsoAlpha3} />}
                  <FinancialProfileSectionCards section={section} form={form} revenueBand={revenueBand} />
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};
