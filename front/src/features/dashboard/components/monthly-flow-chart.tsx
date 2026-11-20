import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { ApexChart } from '../../../components/shared/apex-chart';
import { buildMonthlyFlowChartOptions, chartTooltipRow, escapeHtml } from '../../../components/shared/chart-utils';
import { useTheme } from '../../../providers';
import { monthStartTimestamp } from '../remediation-pace-utils';
import { formatDateWith, formatNumber } from '../../../utils';
import { formatRate } from './remediation-pace-parts';

const CHART_HEIGHT = 260;

interface MonthlyFlowChartProps {
  months: ReadonlyArray<{ month: string, newCount: number, closedCount: number }>,
  capacity: number,
}

/* eslint-disable lingui/no-unlocalized-strings -- tooltip markup, not copy */
const monthTooltip = (heading: string, rows: Array<{ label: string, value: string }>): string =>
  '<div class="txt-sub-content" style="padding:9px 11px; min-width:180px;">'
  + `<div style="font-weight:600; margin-bottom:5px;">${escapeHtml(heading)}</div>`
  + `${rows.map((row) => chartTooltipRow(row)).join('')}</div>`;
/* eslint-enable lingui/no-unlocalized-strings */

export const MonthlyFlowChart: FunctionComponent<MonthlyFlowChartProps> = ({ months, capacity }) => {
  const { effectiveTheme } = useTheme();
  const capacityLabel = formatRate(capacity);
  const options = buildMonthlyFlowChartOptions({
    mode: effectiveTheme,
    yFormatter: (value) => formatNumber(Math.round(value)),
    capacity,
    capacityLabel: i18n._({ id: 'Capacity {capacityLabel}', message: 'Capacity {capacityLabel}', values: { capacityLabel } }),
    customTooltip: ({ dataPointIndex }) => {
      const month = months[dataPointIndex];
      if (month === undefined) {
        return '';
      }
      const heading = formatDateWith(monthStartTimestamp(month.month), { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return monthTooltip(heading, [
        { label: t({ message: 'New', context: 'findings that arrived' }), value: formatNumber(month.newCount) },
        { label: t`Closed`, value: formatNumber(month.closedCount) },
        { label: t`Capacity`, value: capacityLabel },
      ]);
    },
  });
  return (
    <div role="img" aria-label={t`Findings new and closed per month over the last 12 months, against the closing capacity`}>
      <ApexChart
        type="bar"
        height={CHART_HEIGHT}
        width="100%"
        options={options}
        series={[
          { name: t({ message: 'New', context: 'findings that arrived' }), data: months.map((month) => ({ x: monthStartTimestamp(month.month), y: month.newCount })) },
          { name: t`Closed`, data: months.map((month) => ({ x: monthStartTimestamp(month.month), y: month.closedCount })) },
        ]}
      />
    </div>
  );
};
