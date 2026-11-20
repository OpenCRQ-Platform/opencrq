import type { FunctionComponent } from 'react';
import type { BandChartSeries } from '../exposure-band-utils';
import { ApexChart } from '../../../components/shared/apex-chart';
import { bandAxisWindow, buildForecastSegment } from '../exposure-band-utils';
import { buildTimelineChartOptions } from '../../../components/shared/chart-utils';
import { useTheme } from '../../../providers';

const DEFAULT_HEIGHT = 300;

/**
 * History fills this share of the width; the rest is held open for forecast. The reserve only has
 * to separate the projected point from the last real one and leave it margin from the right edge —
 * sized past that, it reads as a gap in the data rather than as room for a hypothetical.
 */
const HISTORY_FILL_RATIO = 0.85;

/** The measured line. Anything at or past this index is the appended forecast. */
const HISTORY_SERIES_COUNT = 1;

interface ExposureBandChartProps {
  series: BandChartSeries,
  yFormatter: (value: number) => string,
  seriesNames: { line: string, forecast: string },
  /**
   * Receives an index into `series.points`, which the measured line shares. The forecast series is
   * mapped back onto that array by this component, so the contract holds whether or not a
   * projection is showing.
   */
  renderTooltip: (dataPointIndex: number) => string,
  /** Projected total after the hovered move. Null hides the series entirely. */
  forecastMean: number | null,
  ariaLabel: string,
  height?: number,
}

export const ExposureBandChart: FunctionComponent<ExposureBandChartProps> = ({
  series, yFormatter, seriesNames, renderTooltip, forecastMean, ariaLabel, height,
}) => {
  // Resolved in the body, not as a destructuring default: the React Compiler cannot lower an
  // AssignmentPattern in a component's parameter object.
  const chartHeight = height ?? DEFAULT_HEIGHT;
  const { effectiveTheme } = useTheme();
  const window = bandAxisWindow(series.points, HISTORY_FILL_RATIO);
  const forecastSegment = forecastMean === null
    ? []
    : buildForecastSegment(series.points, window, forecastMean);
  const withForecast = forecastSegment.length > 0;

  const options = buildTimelineChartOptions({
    mode: effectiveTheme,
    yFormatter,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- date-fns pattern, not copy
    xLabelFormat: 'dd MMM',
    xMin: window?.min,
    xMax: window?.max,
    withForecast,
    forecastMarkerIndex: forecastSegment.length - 1,
    forecastZoneFrom: series.points.at(-1)?.x,
    /*
     * The forecast series carries two points on x values outside the history domain, so its
     * length does not match the measured line and ApexCharts falls back to a non-shared tooltip
     * keyed on whichever series was captured. When that is the forecast, `dataPointIndex` is 0 or
     * 1 in ITS array, which would read out the second day of the window as if it were the
     * projection. Anchor it to the last measured point instead, which is where the forecast
     * segment starts and the only history the projection is a statement about.
     */
    customTooltip: ({ dataPointIndex, seriesIndex }) => renderTooltip(
      seriesIndex >= HISTORY_SERIES_COUNT ? series.points.length - 1 : dataPointIndex,
    ),
  });

  return (
    <div role="img" aria-label={ariaLabel}>
      <ApexChart
        type="line"
        height={chartHeight}
        width="100%"
        options={options}
        series={[
          { name: seriesNames.line, type: 'line', data: series.line },
          ...(withForecast
            ? [{ name: seriesNames.forecast, type: 'line', data: forecastSegment }]
            : []),
        ]}
      />
    </div>
  );
};
