import ReactApexChart from 'react-apexcharts';

/**
 * `react-apexcharts` ships CommonJS, so depending on how the bundler resolves it the import is
 * either the component itself or a namespace object carrying it on `default`. Unwrapping it here
 * once keeps that build detail out of every chart component. It had already been copied into
 * four of them, which is four places to fix if the package ever ships ESM.
 */
const chartModule = ReactApexChart as typeof ReactApexChart & { default?: typeof ReactApexChart };

export const ApexChart = chartModule.default ?? chartModule;
