import type { RevenueBand, SectionKey } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import {
  Q1AnnualRevenueCard,
  Q2GrossMarginCard,
  Q3OperatingDaysCard,
  Q5ItDependentRevenueCard,
  Q6TimeToImpactCard,
  Q7FullRestoreCard,
  Q8RevenueRecaptureCard,
  Q9aRecordsHeldCard,
  Q9bCardTransactionsCard,
  Q9cSensitiveRecordsCard,
  Q10RegulatedServicesCard,
  Q11aCustomerBaseCard,
  Q11bRecurringRevenueCard,
  Q12ContractedRevenueCard,
  Q13PaymentFlowsCard,
  Q14RdIpValueCard,
  Q15RansomPostureCard,
  Q16RestoreTestRecencyCard,
  Q18LossHistoryCard,
  Q19ContractualLiabilityCapCard,
  Q20LargestRepositoryCard,
} from './financial-profile-cards';

interface FinancialProfileSectionCardsProps {
  section: SectionKey,
  form: UseFormReturn<FinancialProfileAnswers>,
  /** The band already stored on the risk scope: what the kernel falls back to while Q1 is blank. */
  revenueBand: RevenueBand | null,
}

/** The single place mapping a lettered section to its cards, shared by the questionnaire and the tab. */
export const FinancialProfileSectionCards: FunctionComponent<FinancialProfileSectionCardsProps> = ({ section, form, revenueBand }) => {
  switch (section) {
    case 'A':
      return (
        <>
          <Q1AnnualRevenueCard form={form} revenueBand={revenueBand} />
          <Q2GrossMarginCard form={form} />
          <Q3OperatingDaysCard form={form} />
        </>
      );
    case 'B':
      return (
        <>
          <Q5ItDependentRevenueCard form={form} />
          <Q6TimeToImpactCard form={form} />
          <Q7FullRestoreCard form={form} />
          <Q8RevenueRecaptureCard form={form} />
          <Q16RestoreTestRecencyCard form={form} />
        </>
      );
    case 'C':
      return (
        <>
          <Q9aRecordsHeldCard form={form} />
          <Q9bCardTransactionsCard form={form} />
          <Q9cSensitiveRecordsCard form={form} />
          <Q20LargestRepositoryCard form={form} />
        </>
      );
    case 'D':
      return <Q10RegulatedServicesCard form={form} />;
    case 'E':
      return (
        <>
          <Q11aCustomerBaseCard form={form} />
          <Q11bRecurringRevenueCard form={form} />
          <Q12ContractedRevenueCard form={form} />
          <Q19ContractualLiabilityCapCard form={form} />
        </>
      );
    case 'F':
      return (
        <>
          <Q13PaymentFlowsCard form={form} />
          <Q14RdIpValueCard form={form} />
        </>
      );
    case 'G':
      return <Q15RansomPostureCard form={form} />;
    case 'H':
      return <Q18LossHistoryCard form={form} />;
    default:
      return null;
  }
};
