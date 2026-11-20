import type { CsfFunction } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import { Paper } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { useId, useState } from 'react';
import type { CsfFunctionSpend, CsfLine } from '../budget-review-csf-utils';
import { MetricInfo } from '../../../components/shared';
import { cn } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { formatDollar } from '../../../utils/format-currency';
import { CSF_FUNCTION_COLORS, csfFunctionSpend, csfWheel } from '../budget-review-csf-utils';
import { lineNatureLabel } from '../ui/review-chips';

export const csfFunctionLabel = (csfFunction: CsfFunction): string => {
  switch (csfFunction) {
    case 'GV': return t`Govern`;
    case 'ID': return t`Identify`;
    case 'PR': return t`Protect`;
    case 'DE': return t`Detect`;
    case 'RS': return t`Respond`;
    case 'RC': return t`Recover`;
  }
};

/** The square the wheel's geometry is drawn in, whatever size it is shown at. */
const WHEEL_VIEWBOX = 416;
/** Font sizes as shown on screen, scaled into the viewBox so the wheel's size leaves them readable. */
const WHEEL_TEXT = { label: 11, caption: 11, amount: 18, lines: 12 };
/** The dark text NIST sets on its wheel's light colours, whatever the theme. */
const WHEEL_INK = '#0b1220';
const EMPTY_FILL_OPACITY = 0.2;
const RUN_OPACITY = 0.45;
const DIMMED_FILTER = ['saturate(0.25)', 'brightness(0.7)'].join(' ');
const DIMMED_OPACITY = 0.3;

const natureOpacity = (nature: CsfLine['nature']): number => (nature === 'run' ? RUN_OPACITY : 1);

const lineShare = (lineCount: number, share: number): string => (lineCount === 0
  ? t`No line`
  : plural(lineCount, { one: `# line, ${share} %`, other: `# lines, ${share} %` }));

const Swatch: FunctionComponent<{ opacity: number, label: string }> = ({ opacity, label }) => (
  <span className="inline-flex items-center gap-1.5 txt-sub-content text-default-secondary">
    <span aria-hidden="true" className="inline-block size-2.5 rounded-[2px] bg-current" style={{ opacity }} />
    {label}
  </span>
);

interface GaugeRowProps {
  entry: CsfFunctionSpend,
  total: number,
  active: boolean,
  dimmed: boolean,
  onEnter: () => void,
  onLeave: () => void,
  onToggle: () => void,
}

const GaugeRow: FunctionComponent<GaugeRowProps> = ({ entry, total, active, dimmed, onEnter, onLeave, onToggle }) => {
  const lineCount = entry.lines.length;
  const color = CSF_FUNCTION_COLORS[entry.csfFunction];
  const width = (amount: number) => (total > 0 ? `${(amount / total) * 100}%` : '0%');
  return (
    <li
      className={cn('flex flex-col gap-2 rounded-[var(--fds-radius-sm)] px-2.5 py-1.5 transition-opacity', active && 'bg-[var(--fds-bg-elevation-default-layer-0-transparency-70)]')}
      style={{ opacity: dimmed ? DIMMED_OPACITY : 1 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        onFocus={onEnter}
        onBlur={onLeave}
        className={cn('grid w-full grid-cols-[6rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-left', lineCount === 0 && 'text-default-secondary')}
      >
        <span className="flex items-center gap-2 txt-body2 font-medium">
          <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
          {csfFunctionLabel(entry.csfFunction)}
        </span>
        <span className="flex h-2 overflow-hidden rounded-[2px] bg-[var(--fds-bg-elevation-default-layer-0-transparency-70)]">
          <span className="h-full" style={{ width: width(entry.build), backgroundColor: color }} />
          <span className="h-full" style={{ width: width(entry.run), backgroundColor: color, opacity: RUN_OPACITY }} />
        </span>
        <span className="text-right txt-body2 font-medium">{entry.touched > 0 ? formatDollar(entry.touched) : EMPTY_VALUE}</span>
      </button>
      {active && lineCount > 0 && (
        <ul className="flex flex-col gap-1.5">
          {entry.lines.map((line) => {
            const others = line.csfFunctions.filter((other) => other !== entry.csfFunction).map(csfFunctionLabel).join(', ');
            return (
              <li key={line.id} className="flex flex-wrap items-center gap-x-1.5 txt-sub-content text-default-secondary">
                <span aria-hidden="true" className="inline-block size-2 rounded-[2px]" style={{ backgroundColor: color, opacity: natureOpacity(line.nature) }} />
                <span className="text-default-primary">{line.name}</span>
                <span>{formatDollar(line.amountSpent)}</span>
                {others.length > 0 && <span>{t`also ${others}`}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
};

interface CsfWheelProps {
  lines: ReadonlyArray<CsfLine>,
  /** On screen, in pixels. */
  size: number,
}

/**
 * The CSF wheel as NIST draws it and, beside it, one gauge per function, linked both ways: pointing
 * at a wedge or a gauge lights the other, puts the function's spend in the wheel's centre and lists
 * the lines touching it, a click keeps that reading. Every amount is a line's whole spend, since a
 * line is never split between the functions it touches.
 */
const CsfWheel: FunctionComponent<CsfWheelProps> = ({ lines, size }) => {
  const pathId = useId().replace(/[^\w-]/g, '');
  const [hovered, setHovered] = useState<CsfFunction | null>(null);
  const [pinned, setPinned] = useState<CsfFunction | null>(null);
  const active = hovered ?? pinned;
  const spend = csfFunctionSpend(lines);
  const spendOf = new Map(spend.map((entry) => [entry.csfFunction, entry]));
  const total = lines.reduce((sum, line) => sum + line.amountSpent, 0);
  const scale = WHEEL_VIEWBOX / size;
  const fontSize = (shown: number) => shown * scale;
  const wheel = csfWheel(WHEEL_VIEWBOX, fontSize(WHEEL_TEXT.label));
  const centre = WHEEL_VIEWBOX / 2;
  const dimmed = (csfFunction: CsfFunction) => active !== null && active !== csfFunction;
  const toggle = (csfFunction: CsfFunction) => setPinned((current) => (current === csfFunction ? null : csfFunction));
  const pointerProps = (csfFunction: CsfFunction) => ({
    className: 'cursor-pointer transition-[filter]',
    style: { filter: dimmed(csfFunction) ? DIMMED_FILTER : undefined },
    onMouseEnter: () => setHovered(csfFunction),
    onMouseLeave: () => setHovered(null),
    onClick: () => toggle(csfFunction),
  });
  const label = (csfFunction: CsfFunction, labelPathId: string) => {
    const spent = spendOf.get(csfFunction)!.touched > 0;
    return (
      <text
        className={cn('txt-body2 font-semibold tracking-wider', !spent && 'fill-current text-default-secondary')}
        style={{ fontSize: fontSize(WHEEL_TEXT.label) }}
        fill={spent ? WHEEL_INK : undefined}
      >
        <textPath href={`#${labelPathId}`} startOffset="50%" textAnchor="middle">
          {csfFunctionLabel(csfFunction).toLocaleUpperCase()}
        </textPath>
      </text>
    );
  };
  const fillProps = (csfFunction: CsfFunction) => ({
    fill: CSF_FUNCTION_COLORS[csfFunction],
    fillOpacity: spendOf.get(csfFunction)!.touched > 0 ? 1 : EMPTY_FILL_OPACITY,
  });
  const centreEntry = active === null ? null : spendOf.get(active)!;
  const centreAmount = centreEntry === null ? total : centreEntry.touched;
  const centreLines = centreEntry === null ? lines.length : centreEntry.lines.length;
  const centreShare = total > 0 ? Math.round((centreAmount / total) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${WHEEL_VIEWBOX} ${WHEEL_VIEWBOX}`}
        role="img"
        aria-label={t`NIST CSF wheel of the spend by function`}
        className="shrink-0"
      >
        <defs>
          {wheel.wedges.map((wedge) => <path key={wedge.csfFunction} id={`${pathId}-${wedge.csfFunction}`} d={wedge.labelPath} fill="none" />)}
          <path id={`${pathId}-GV`} d={wheel.governLabelPath} fill="none" />
        </defs>
        {wheel.wedges.map((wedge) => (
          <g key={wedge.csfFunction} {...pointerProps(wedge.csfFunction)}>
            <path d={active === wedge.csfFunction ? wedge.raisedPath : wedge.path} {...fillProps(wedge.csfFunction)} />
            {label(wedge.csfFunction, `${pathId}-${wedge.csfFunction}`)}
          </g>
        ))}
        <g {...pointerProps('GV')}>
          <path d={wheel.governPath} fillRule="evenodd" {...fillProps('GV')} />
          {label('GV', `${pathId}-GV`)}
        </g>
        <g className="pointer-events-none" textAnchor="middle">
          <text
            x={centre}
            y={centre - fontSize(14)}
            className="txt-sub-content fill-current font-semibold uppercase tracking-wider text-default-secondary"
            style={{ fontSize: fontSize(WHEEL_TEXT.caption) }}
          >
            {centreEntry === null ? t`Spent` : csfFunctionLabel(centreEntry.csfFunction)}
          </text>
          <text x={centre} y={centre + fontSize(6)} className="txt-subtitle2 fill-current font-semibold text-default-primary" style={{ fontSize: fontSize(WHEEL_TEXT.amount) }}>
            {centreAmount > 0 ? formatDollar(centreAmount) : EMPTY_VALUE}
          </text>
          <text x={centre} y={centre + fontSize(22)} className="txt-sub-content fill-current text-default-secondary" style={{ fontSize: fontSize(WHEEL_TEXT.lines) }}>
            {centreEntry === null ? plural(centreLines, { one: '# line', other: '# lines' }) : lineShare(centreLines, centreShare)}
          </text>
        </g>
      </svg>
      <ul className="flex w-full flex-col gap-0.5">
        {spend.map((entry) => (
          <GaugeRow
            key={entry.csfFunction}
            entry={entry}
            total={total}
            active={active === entry.csfFunction}
            dimmed={dimmed(entry.csfFunction)}
            onEnter={() => setHovered(entry.csfFunction)}
            onLeave={() => setHovered(null)}
            onToggle={() => toggle(entry.csfFunction)}
          />
        ))}
      </ul>
    </div>
  );
};

const CSF_WHEEL_SIZE = 240;

export const BudgetReviewCsfPanel: FunctionComponent<{ lines: ReadonlyArray<CsfLine> }> = ({ lines }) => (
  <Paper elevation={2} padding={16} className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="inline-flex items-center gap-1.5 txt-body2 font-medium">
        {t`Spend by NIST CSF function`}
        <MetricInfo
          title={t`Spend by NIST CSF function`}
          what={t`What the budget lines touching each NIST CSF function spent over the period.`}
          how={t`A line takes every function its controls map to in the CSF 2.0 crosswalk, and counts its whole spend in each.`}
          caveat={t`A line touching several functions counts in each, so the amounts do not add up to the review's spend.`}
        />
      </span>
      <span className="inline-flex gap-4">
        <Swatch opacity={natureOpacity('build')} label={lineNatureLabel('build')} />
        <Swatch opacity={natureOpacity('run')} label={lineNatureLabel('run')} />
      </span>
    </div>
    <CsfWheel lines={lines} size={CSF_WHEEL_SIZE} />
  </Paper>
);
