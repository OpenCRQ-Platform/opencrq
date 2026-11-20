import { computeProgress, SECTION_KEYS } from '@app/module/client';
import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { InfoField, SectionCard } from '../../components/shared';
import { formatNumber, formatRevenueBand } from '../../utils';
import { EMPTY_VALUE } from '../../utils/empty-value';
import { useTRPC } from '../../lib';
import { SECTION_TITLES } from './financial-profile-questions';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from './financial-profile-schema';
import { FinancialProfileSectionSummary } from './financial-profile-section-summary';

interface FinancialProfileTabContentProps {
  organizationId: string,
  onAnswerQuestionnaire: () => void,
}

/** Condensed, read-only summary of the questionnaire. Editing only happens in the scope drawer. */
export const FinancialProfileTabContent: FunctionComponent<FinancialProfileTabContentProps> = ({
  organizationId,
  onAnswerQuestionnaire,
}) => {
  const trpc = useTRPC();
  const { data: organization, isLoading: isOrganizationLoading } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const { data: profile, isLoading: isProfileLoading } = useQuery(trpc.financialProfiles.getFinancialProfile.queryOptions({ organizationId }));

  if (!organization || isOrganizationLoading || isProfileLoading) {
    return null;
  }

  const values = profile ?? EMPTY_FINANCIAL_PROFILE_ANSWERS;
  const { answeredCount, totalCount } = computeProgress(values);
  const loadedDailyLabourCost = values.loadedDailyLabourCost !== null ? formatNumber(values.loadedDailyLabourCost) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-default-secondary">
          {t`${answeredCount} of ${totalCount} answered`}
        </div>
        <Button type="button" priority="primary" onClick={onAnswerQuestionnaire}>{t`Answer the questionnaire`}</Button>
      </div>

      <SectionCard title={t`Risk scope`}>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
          <InfoField title={t`Name`} value={organization.name} />
          <InfoField title={t`Sector`} value={organization.sector?.name ?? EMPTY_VALUE} />
          <InfoField title={t`Country`} value={organization.country?.name ?? EMPTY_VALUE} />
          <InfoField title={t`Revenue band`} value={formatRevenueBand(organization.revenueBand)} />
          <InfoField title={t`Employees`} value={organization.employeeCount != null ? formatNumber(organization.employeeCount) : null} />
          <InfoField title={t`Loaded daily labour cost`} value={loadedDailyLabourCost !== null ? t`${loadedDailyLabourCost} USD / day` : null} />
        </div>
      </SectionCard>

      {SECTION_KEYS.map((section) => (
        <SectionCard key={section} title={SECTION_TITLES[section]()}>
          <FinancialProfileSectionSummary section={section} values={values} />
        </SectionCard>
      ))}
    </div>
  );
};
