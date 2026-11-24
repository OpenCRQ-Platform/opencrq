import type { PrimaryToPrimaryLinkStrength, SecurityNeedLevel } from '@app/module/client';
import { PRIMARY_TO_PRIMARY_LINK_STRENGTHS, SECURITY_NEED_LEVELS } from '@app/module/client';
import { Paper, Spinner } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { DependencyGraphSelection } from '../dependency-graph-utils';
import type { PrimaryGraphAsset } from '../primary-asset-graph-utils';
import { LINK_INK } from '../../../components/shared/column-graph-paint';
import { FilterPill, FilterPillItem } from '../../../components/ui/filter-pill';
import { useTRPC } from '../../../lib';
import { cn, resolveOptionFilter } from '../../../utils';
import { getLinkStrengthLabel } from '../link-strength-labels';
import { buildPrimaryAssetGraph, linksOfKeptAssets, strengthCounts } from '../primary-asset-graph-utils';
import { ANY_RESOURCE_TYPE, filterLinksByResourceType, resourceTypeOptions } from '../primary-to-primary-links-utils';
import { overallLevelColorProperty, overallLevelLabel, PrimaryAssetGraph, STRENGTH_INK_ALPHA } from './primary-asset-graph';
import { PrimaryAssetGraphEdgePanel, PrimaryAssetGraphNodePanel } from './primary-asset-graph-panels';

/** The least the graph is given: the card grows to end with the first screen. */
const GRAPH_HEIGHT = 460;
const PAGE_BOTTOM_GAP = 24;
/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const SUBTLE_BORDER = '1px solid var(--fds-border-elevation-subtle-soft)';
 
const UNKNOWN_INK = 'var(--fds-color-feedback-neutral-primary)';
const LEGEND_LEVELS: Array<SecurityNeedLevel | null> = [...[...SECURITY_NEED_LEVELS].reverse(), null];

interface PrimaryAssetGraphCardProps {
  organizationId: string,
  /** Every primary asset of the risk scope, `undefined` while they load. */
  assets: ReadonlyArray<PrimaryGraphAsset> | undefined,
  keptIds: ReadonlySet<string>,
  hiddenStrengths: ReadonlyArray<PrimaryToPrimaryLinkStrength>,
  onHiddenStrengthsChange: (hiddenStrengths: Array<PrimaryToPrimaryLinkStrength>) => void,
  resourceType: string,
  onResourceTypeChange: (resourceType: string) => void,
}

const StrengthSample: FunctionComponent<{ strength: PrimaryToPrimaryLinkStrength }> = ({ strength }) => (
  <svg aria-hidden width="20" height="8" className="shrink-0">
    <line
      x1="0"
      y1="4"
      x2="20"
      y2="4"
      strokeWidth="1.6"
      strokeDasharray={strength === 'unknown' ? '5 4' : undefined}
      opacity={STRENGTH_INK_ALPHA[strength]}
      style={{ stroke: strength === 'unknown' ? UNKNOWN_INK : LINK_INK }}
    />
  </svg>
);

interface StrengthChipProps {
  strength: PrimaryToPrimaryLinkStrength,
  count: number,
  shown: boolean,
  onToggle: () => void,
}

/** Legend and filter at once: each chip draws its strength's line and counts the links it shows or hides. */
const StrengthChip: FunctionComponent<StrengthChipProps> = ({ strength, count, shown, onToggle }) => (
  <button
    type="button"
    aria-pressed={shown}
    onClick={onToggle}
    className={cn(
      'flex h-7 items-center gap-2 rounded-full border px-3 txt-sub-content',
      shown ? 'border-primary bg-primary/20 text-default-primary' : 'border-elevation-subtle-soft text-default-secondary hover:bg-hover',
    )}
  >
    <StrengthSample strength={strength} />
    <span className={shown ? undefined : 'line-through'}>{getLinkStrengthLabel(strength)}</span>
    <span className="tabular-nums text-default-secondary">{count}</span>
  </button>
);

export const PrimaryAssetGraphCard: FunctionComponent<PrimaryAssetGraphCardProps> = ({
  organizationId,
  assets,
  keptIds,
  hiddenStrengths,
  onHiddenStrengthsChange,
  resourceType: resourceTypeFilter,
  onResourceTypeChange,
}) => {
  const trpc = useTRPC();
  const [selection, setSelection] = useState<DependencyGraphSelection | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const { data: links } = useQuery(trpc.assetDependencies.getPrimaryToPrimaryLinksOfOrganization.queryOptions({ organizationId }));

  // The overlay covers the page, so the key that leaves every other overlay has to leave this one.
  useEffect(() => {
    if (!isFullScreen) {
      return;
    }
    const leave = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [isFullScreen]);

  const isLoaded = links !== undefined && assets !== undefined;
  const graphAreaRef = useRef<HTMLDivElement>(null);
  const [graphHeight, setGraphHeight] = useState(GRAPH_HEIGHT);
  // Measured rather than summed, since the filter row wraps. The resize this causes measures again,
  // to the same value, so it settles.
  useEffect(() => {
    const area = graphAreaRef.current;
    const card = area?.parentElement;
    if (!isLoaded || isFullScreen || area === null || card === null || card === undefined) {
      return;
    }
    const fit = (): void => {
      const areaBox = area.getBoundingClientRect();
      const below = card.getBoundingClientRect().bottom - areaBox.bottom;
      const top = areaBox.top + window.scrollY;
      setGraphHeight(Math.max(GRAPH_HEIGHT, Math.floor(window.innerHeight - top - below - PAGE_BOTTOM_GAP)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [isLoaded, isFullScreen]);

  const keptLinks = linksOfKeptAssets(links ?? [], keptIds);
  const options = links === undefined ? undefined : resourceTypeOptions(keptLinks);
  const resourceType = resolveOptionFilter(resourceTypeFilter, options?.map((option) => option.value), ANY_RESOURCE_TYPE);
  const counts = strengthCounts(filterLinksByResourceType(keptLinks, resourceType));
  const hidden = new Set(hiddenStrengths);
  const model = buildPrimaryAssetGraph(assets ?? [], links ?? [], { keptIds, hiddenStrengths: hidden, resourceType });

  const keptCount = model.nodes.filter((node) => !node.outsideFilters).length;
  const neighbourCount = model.nodes.length - keptCount;
  const linkCount = model.edges.reduce((total, edge) => total + edge.links.length, 0);

  const selectedNode = selection?.kind === 'node' ? model.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? model.edges.find((edge) => edge.id === selection.id) : undefined;
  const selectNode = (id: string): void => setSelection({ kind: 'node', id });

  const toggleStrength = (strength: PrimaryToPrimaryLinkStrength): void => onHiddenStrengthsChange(hidden.has(strength)
    ? hiddenStrengths.filter((candidate) => candidate !== strength)
    : PRIMARY_TO_PRIMARY_LINK_STRENGTHS.filter((candidate) => candidate === strength || hidden.has(candidate)));

  const counterParts = [
    plural(keptCount, { one: '# primary asset linked', other: '# primary assets linked' }),
    ...(neighbourCount > 0 ? [plural(neighbourCount, { one: '# neighbour outside the filters', other: '# neighbours outside the filters' })] : []),
    plural(linkCount, { one: '# link', other: '# links' }),
    ...(model.unlinkedCount > 0 ? [plural(model.unlinkedCount, { one: '# without any link, not drawn', other: '# without any link, not drawn' })] : []),
  ];

  const noType = t`No type`;
  const pickedName = options?.find((option) => option.value === resourceType)?.name ?? null;

  const filterRow = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" style={{ borderBottom: SUBTLE_BORDER }}>
      <span className="txt-sub-content text-default-secondary">{t({ message: 'Strength', context: 'of a dependency' })}</span>
      <div role="group" aria-label={t`Show the dependencies of each strength`} className="flex flex-wrap items-center gap-2">
        {PRIMARY_TO_PRIMARY_LINK_STRENGTHS.map((strength) => (
          <StrengthChip
            key={strength}
            strength={strength}
            count={counts[strength]}
            shown={!hidden.has(strength)}
            onToggle={() => toggleStrength(strength)}
          />
        ))}
      </div>
      <FilterPill
        label={t`Runs through`}
        valueLabel={resourceType === ANY_RESOURCE_TYPE ? undefined : (pickedName ?? noType)}
      >
        <FilterPillItem selected={resourceType === ANY_RESOURCE_TYPE} onSelect={() => onResourceTypeChange(ANY_RESOURCE_TYPE)}>
          <Trans>All resource types</Trans>
        </FilterPillItem>
        {(options ?? []).map((option) => (
          <FilterPillItem key={option.value} selected={resourceType === option.value} onSelect={() => onResourceTypeChange(option.value)}>
            {option.name ?? noType}
          </FilterPillItem>
        ))}
      </FilterPill>
      <span className="flex-1" />
      {isLoaded && (
        <span className="flex flex-wrap gap-x-2 txt-sub-content text-default-secondary">
          {counterParts.map((part, index) => (
            <span key={part} className="flex gap-x-2">
              {index > 0 && <span aria-hidden>·</span>}
              {part}
            </span>
          ))}
        </span>
      )}
    </div>
  );

  const legend = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 text-content-caption text-default-secondary" style={{ borderTop: SUBTLE_BORDER }}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-default-primary"><Trans>Overall level</Trans></span>
        {LEGEND_LEVELS.map((level) => (
          <span key={level ?? 'none'} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: `var(${overallLevelColorProperty(level)})` }} />
            {overallLevelLabel(level)}
          </span>
        ))}
      </span>
      <span><Trans>The arrow points at the dependent, the way an outage travels.</Trans></span>
      {neighbourCount > 0 && <span><Trans>Faded: directly linked, outside the filters.</Trans></span>}
    </div>
  );

  const body = (() => {
    if (!isLoaded) {
      return (
        <div className="flex items-center justify-center" style={{ minHeight: GRAPH_HEIGHT }}>
          <Spinner />
        </div>
      );
    }
    if (model.nodes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center" style={{ minHeight: GRAPH_HEIGHT }}>
          <p className="text-default-secondary">
            {links.length === 0
              ? <Trans>No dependency is declared between the primary assets of this risk scope.</Trans>
              : <Trans>No dependency between primary assets matches the filters.</Trans>}
          </p>
        </div>
      );
    }
    return (
      <div ref={graphAreaRef} className="relative flex min-h-0 flex-1 flex-col">
        <PrimaryAssetGraph
          model={model}
          selection={selection}
          onSelect={setSelection}
          fitSignal={fitSignal}
          isFullScreen={isFullScreen}
          onToggleFullScreen={() => {
            setIsFullScreen((current) => !current);
            setFitSignal((signal) => signal + 1);
          }}
          height={isFullScreen ? undefined : graphHeight}
        />
        {selectedNode !== undefined && (
          <PrimaryAssetGraphNodePanel
            node={selectedNode}
            model={model}
            organizationId={organizationId}
            onSelectNode={selectNode}
            onClose={() => setSelection(null)}
          />
        )}
        {selectedEdge !== undefined && (
          <PrimaryAssetGraphEdgePanel
            edge={selectedEdge}
            model={model}
            onSelectNode={selectNode}
            onClose={() => setSelection(null)}
          />
        )}
      </div>
    );
  })();

  return (
    <Paper className={`flex flex-col overflow-hidden p-0 ${isFullScreen ? 'fixed inset-0 z-50' : ''}`}>
      {filterRow}
      {body}
      {isLoaded && model.nodes.length > 0 && legend}
    </Paper>
  );
};
