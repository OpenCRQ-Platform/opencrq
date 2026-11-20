import { Text, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { deriveLikelihood, deriveMagnitude } from '@app/module/client';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PositionedTopRisksNode, TopRisksFlow, TopRisksNode } from '../top-risks-flow-utils';
import { TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { formatDollar, formatFractionAsPercent } from '../../../utils';
import {
  describeTopRisksNode,
  LABEL_LINE_HEIGHT,
  layoutTopRisks,
  outcomeColor,
  TOP_RISKS_BASE_GEOMETRY,
  topRisksGeometryForWidth,
} from '../top-risks-flow-utils';

const NODE_COLOR = 'var(--fds-text-default-secondary)';
const RESIDUAL_COLOR = 'var(--fds-color-feedback-neutral-tertiary)';
const LABEL_GAP = 8;
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS text-shadow, not copy
const HALO = '0 0 4px var(--fds-bg-elevation-default), 0 0 2px var(--fds-bg-elevation-default), 0 0 1px var(--fds-bg-elevation-default)';

export const topRisksNodeLabel = (node: TopRisksNode): string => {
  switch (node.residualKind) {
    case 'no-primary-asset': return t`No primary asset`;
    case 'asset-tail': return plural(node.foldedCount, { one: '# other primary asset', other: '# other primary assets' });
    case 'scenario-tail': return plural(node.foldedCount, { one: '# other scenario', other: '# other scenarios' });
    case 'unallocated-category': return t`Unallocated`;
    case null: return node.label;
  }
};

const formatShare = (value: number, of: number): string => formatFractionAsPercent(of > 0 ? value / of : 0, 0);

interface TooltipRow {
  key: string,
  label: string,
  value: string,
}

const tooltipRows = (flow: TopRisksFlow, node: TopRisksNode): Array<TooltipRow> => {
  const rows: Array<TooltipRow> = [{ key: 'share', label: t`Share of the annual loss exposure`, value: formatShare(node.value, flow.total) }];
  const detail = describeTopRisksNode(flow, node);
  switch (detail.kind) {
    case 'asset':
      rows.push({ key: 'scenarios', label: t`Scenarios`, value: String(detail.scenarioCount) });
      if (detail.sharedValue > 0) {
        rows.push({ key: 'shared', label: t`Held through an equal split`, value: formatDollar(detail.sharedValue) });
      }
      break;
    case 'scenario': {
      const likelihood = deriveLikelihood(detail.lefMean);
      const magnitude = deriveMagnitude(node.value, detail.lefMean);
      rows.push({ key: 'outcome', label: t`Attack outcome`, value: detail.outcomeName });
      rows.push({
        key: 'assets',
        label: detail.primaryAssetNames.length > 1 ? t`Primary assets, in equal parts` : t`Primary asset`,
        value: detail.primaryAssetNames.length > 0 ? detail.primaryAssetNames.join(', ') : t`None`,
      });
      if (detail.aleP10 !== null && detail.aleP90 !== null) {
        const low = formatDollar(detail.aleP10);
        const high = formatDollar(detail.aleP90);
        rows.push({ key: 'band', label: t`P10 to P90 band`, value: i18n._({ id: '{low} to {high}', message: '{low} to {high}', values: { low, high } }) });
      }
      if (likelihood !== null) {
        rows.push({ key: 'likelihood', label: t`Likelihood`, value: formatFractionAsPercent(likelihood, 0) });
      }
      if (magnitude !== null) {
        rows.push({ key: 'magnitude', label: t`Loss magnitude`, value: formatDollar(magnitude) });
      }
      break;
    }
    case 'scenario-tail':
      rows.push({ key: 'scenarios', label: t`Scenarios`, value: String(detail.scenarioCount) });
      break;
    case 'outcome':
      rows.push({ key: 'scenarios', label: t`Scenarios`, value: String(detail.scenarioCount) });
      if (detail.mainCategory !== null) {
        rows.push({
          key: 'main',
          label: t`Main loss category`,
          value: `${topRisksNodeLabel(detail.mainCategory.node)} · ${formatShare(detail.mainCategory.share, 1)}`,
        });
      }
      break;
    case 'category':
      if (detail.mainOutcome !== null) {
        rows.push({
          key: 'main',
          label: t`Main attack outcome`,
          value: `${topRisksNodeLabel(detail.mainOutcome.node)} · ${formatShare(detail.mainOutcome.share, 1)}`,
        });
      }
      break;
  }
  return rows;
};

interface TopRisksSankeyProps {
  flow: TopRisksFlow,
  renderName: (node: TopRisksNode, name: string) => ReactNode,
}

export const TopRisksSankey: FunctionComponent<TopRisksSankeyProps> = ({ flow, renderName }) => {
  const [focused, setFocused] = useState<string | null>(null);
  const drawingRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    // The scroller around the drawing is measured, since the drawing's own width follows from it.
    const container = drawingRef.current?.parentElement ?? null;
    if (container === null) {
      return;
    }
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      setAvailable(container.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const geometry = topRisksGeometryForWidth(available);
  const layout = layoutTopRisks(flow, geometry, focused);
  const { lit } = layout;

  const outcomeColors = new Map(flow.nodes
    .filter((node) => node.column === 'outcome')
    .map((node) => [node.id, outcomeColor(node.label)]));
  const nodeColor = (node: TopRisksNode): string => {
    if (node.column === 'outcome') {
      return outcomeColors.get(node.id) ?? NODE_COLOR;
    }
    return node.residualKind === null ? NODE_COLOR : RESIDUAL_COLOR;
  };

  const columnTitles = [t`Primary asset`, t`Risk scenario`, t`Attack outcome`, t`Loss category`];

  const labelBox = (node: PositionedTopRisksNode, columnIndex: number) => {
    const width = geometry.labelWidths[columnIndex];
    const left = columnIndex === 0 ? node.x - LABEL_GAP - width : node.x + geometry.bar + LABEL_GAP;
    const height = node.labelLines * LABEL_LINE_HEIGHT;
    return { left, width, height, top: geometry.head + node.labelCenter - height / 2 };
  };

  return (
    <TooltipHintProvider>
      <div className="scrollbar-discreet overflow-x-auto overflow-y-hidden">
        <div
          ref={drawingRef}
          className="relative"
          style={{ width: geometry.width, minWidth: TOP_RISKS_BASE_GEOMETRY.width, height: geometry.head + geometry.height }}
          onMouseLeave={() => setFocused(null)}
        >
          {columnTitles.map((title, index) => (
            <span
              key={title}
              className="absolute top-0 font-content-caption text-content-caption uppercase tracking-[0.2px] text-default-secondary"
              style={index === 0
                ? { left: 0, width: geometry.columnX[0] + geometry.bar, textAlign: 'right' }
                : { left: geometry.columnX[index] }}
            >
              {title}
            </span>
          ))}

          <svg
            width={geometry.width}
            height={geometry.height}
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            aria-hidden="true"
            className="absolute left-0"
            style={{ top: geometry.head }}
          >
            {layout.ribbons.map((ribbon) => (
              <path
                key={ribbon.key}
                d={ribbon.path}
                fill={outcomeColors.get(ribbon.outcome) ?? NODE_COLOR}
                fillOpacity={lit === null ? 0.35 : 0.14}
              />
            ))}
            {layout.ribbons.map((ribbon) => ribbon.focusPath !== null && (
              <path key={`focus:${ribbon.key}`} d={ribbon.focusPath} fill={outcomeColors.get(ribbon.outcome) ?? NODE_COLOR} fillOpacity={0.8} />
            ))}
          </svg>

          {layout.nodes.map((node) => {
            const columnIndex = ['asset', 'scenario', 'outcome', 'category'].indexOf(node.column);
            const box = labelBox(node, columnIndex);
            const on = lit === null || lit.has(node.id);
            const name = topRisksNodeLabel(node);
            const valueText = node.column === 'category'
              ? formatDollar(node.value)
              : `${formatDollar(node.value)} · ${formatShare(node.value, flow.total)}`;
            const color = nodeColor(node);
            const inner = columnIndex === 1 || columnIndex === 2;
            const hitLeft = Math.min(box.left, node.x);
            const hitRight = Math.max(box.left + box.width, node.x + geometry.bar);
            const hitTop = Math.min(box.top, geometry.head + node.y);
            const hitBottom = Math.max(box.top + box.height, geometry.head + node.y + node.height);
            const rows = focused === node.id ? tooltipRows(flow, node) : [];
            const rendered = renderName(node, name);
            return (
              <Tooltip key={node.id} open={focused === node.id}>
                <TooltipTrigger asChild>
                  {/* Crowding can push a label away from its bar, so this box crosses other bars: only the bar and the label take the pointer. */}
                  <div
                    className="pointer-events-none absolute"
                    style={{ left: hitLeft, top: hitTop, width: hitRight - hitLeft, height: hitBottom - hitTop }}
                    onMouseEnter={() => setFocused(node.id)}
                    onFocus={() => setFocused(node.id)}
                    onBlur={() => setFocused(null)}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-auto absolute rounded-[2px] transition-opacity"
                      style={{
                        left: node.x - hitLeft,
                        top: geometry.head + node.y - hitTop,
                        width: geometry.bar,
                        height: Math.max(node.height, 1),
                        background: color,
                        opacity: on ? 1 : 0.3,
                      }}
                    />
                    <span
                      tabIndex={typeof rendered === 'string' ? 0 : undefined}
                      className="pointer-events-auto absolute flex items-center rounded-[2px] font-content-compact text-content-compact leading-[14px] transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      style={{
                        left: box.left - hitLeft,
                        top: box.top - hitTop,
                        width: box.width,
                        height: box.height,
                        justifyContent: columnIndex === 0 ? 'flex-end' : 'flex-start',
                        textAlign: columnIndex === 0 ? 'right' : 'left',
                        textShadow: inner ? HALO : undefined,
                        opacity: on ? 1 : 0.4,
                      }}
                    >
                      <span className={node.labelLines === 2 ? 'line-clamp-2' : 'line-clamp-1'}>
                        <span className={node.residualKind === null ? 'text-default-primary' : 'text-default-secondary'}>
                          {rendered}
                        </span>
                        <span className="whitespace-nowrap tabular-nums text-default-secondary"> · {valueText}</span>
                      </span>
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align={columnIndex === 0 ? 'end' : 'start'}
                  className="flex w-[260px] max-w-[260px] flex-col gap-1.5 p-[10px_12px]"
                >
                  <span className="flex items-center gap-2 font-content-base-medium text-content-base-medium">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
                    {name}
                  </span>
                  <Text as="span" variant="title-md" className="tabular-nums">{formatDollar(node.value)}</Text>
                  {rows.map((row) => (
                    <span key={row.key} className="grid grid-cols-[auto_auto] justify-between gap-x-3">
                      <span className="text-default-secondary">{row.label}</span>
                      <span className="text-right tabular-nums">{row.value}</span>
                    </span>
                  ))}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipHintProvider>
  );
};
