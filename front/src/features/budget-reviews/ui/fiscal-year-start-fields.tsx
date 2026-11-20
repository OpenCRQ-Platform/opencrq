import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { SingleSelectField } from '../../../components/shared';
import { formatMonthName } from '../../../utils/date-utils';
import { reviewStartMonths } from '../budget-review-utils';

interface FiscalYearStartFieldsProps {
  year: number,
  month: number,
  years: ReadonlyArray<number>,
  onChange: (year: number, month: number) => void,
}

export const FiscalYearStartFields: FunctionComponent<FiscalYearStartFieldsProps> = ({ year, month, years, onChange }) => (
  <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4">
    <SingleSelectField
      options={reviewStartMonths(year).map((option) => ({ label: formatMonthName(option), value: String(option) }))}
      value={String(month)}
      onChange={(next) => {
        if (next !== null) {
          onChange(year, Number(next));
        }
      }}
      label={t`Fiscal year start`}
      required
      placeholder={t`Select a month`}
      emptyMessage={t`No month found`}
    />
    <SingleSelectField
      options={years.map((option) => ({ label: String(option), value: String(option) }))}
      value={String(year)}
      onChange={(next) => {
        if (next === null) {
          return;
        }
        const nextYear = Number(next);
        // A month that has not started yet this year falls back on the latest one that has.
        onChange(nextYear, Math.min(month, reviewStartMonths(nextYear).length));
      }}
      label={t`Year`}
      required
      placeholder={t`Select a year`}
      emptyMessage={t`No year found`}
    />
  </div>
);
