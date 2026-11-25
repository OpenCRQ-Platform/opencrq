import { Button, Paper, Spinner, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetRelationKind, PrimaryToPrimaryLinkStrength } from '@app/module/client';
import {
  ASSET_CRITICALITY_VALUES,
  DEPENDENCY_GRAPH_MAX_DEPTH,
  POSTURE_BANDS,
  postureSeverityBand,
  PRIMARY_TO_PRIMARY_LINK_STRENGTHS,
  SEVERITY_BANDS,
  UNKNOWN_LINK_ROLE,
} from '@app/module/client';
import { ArrowRightLeft, ArrowUp, Crown, MoveRight, Rss, Shield } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AssetDomain, DependencyGraphEdge, DependencyGraphModel, DependencyGraphSelection, GraphGrammar } from '../dependency-graph-utils';
import type { EditedSupportToPrimaryLink } from './support-to-primary-link-edit-sheet';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useTRPC } from '../../../lib';
import { severityBandFillColor, severityBandLabel } from '../../finding-score';
import { postureBandLabel } from '../../supporting-assets/components/posture-band-word';
import { assetRelationLegendLabel } from '../../supporting-assets/asset-relation-labels';
import { getAssetCriticalityLabel } from '../../../utils';
import { formatNumber } from '../../../utils/format-number';
import {
  assetDomainColor,
  criticalityRingProperty,
  drawnEdges,
  isMutualEdge,
  isStoredLinkKind,
  presentDomains,
  PRIMARY_LINK_COLOR_PROPERTY,
  PRIMARY_LINK_STRENGTH_ALPHA,
  UNKNOWN_STRENGTH_COLOR_PROPERTY,
} from '../dependency-graph-utils';
import { getLinkStrengthLabel } from '../link-strength-labels';
import { LINK_INK, MARKED_HALO_INK, TINT_ALPHA } from '../../../components/shared/column-graph-paint';
import { useTheme } from '../../../providers/theme-provider';
import { DependencyGraph } from './dependency-graph';
import { DependencyGraphCounters } from './dependency-graph-counters';
import { DependencyGraphLinkCard } from './dependency-graph-link-card';
import { DependencyGraphPanel } from './dependency-graph-panel';
import { SupportToPrimaryLinkEditSheet } from './support-to-primary-link-edit-sheet';

/** The least the graph is given: the card grows to end with the first screen. */
const GRAPH_HEIGHT = 460;
const PAGE_BOTTOM_GAP = 24;
/** Every depth, since an aggregate node raises it one level at a time and the select has to show it. */
const DEPTH_OPTIONS = Array.from({ length: DEPENDENCY_GRAPH_MAX_DEPTH }, (_, index) => index + 1);
const FINDING_PILL_BANDS = ['critical', 'high'] as const;
/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const SUBTLE_BORDER = '1px solid var(--fds-border-elevation-subtle-soft)';
/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const CURRENT_ASSET_HALO_SHADOW = `0 0 0 2px var(--fds-bg-elevation-default-layer-1), 0 0 0 4px ${MARKED_HALO_INK}`;

interface DependencyGraphDepthSelectProps {
  depth: number,
  onDepthChange: (depth: number) => void,
}

interface DependencyGraphCardProps extends DependencyGraphDepthSelectProps {
  /** `null` while the graph loads: a failed query is the caller's to render, or it spins for ever. */
  model: DependencyGraphModel | null,
  /** Shown when the model holds no link, or no node at all with `drawsUnlinkedNodes`. */
  emptyState: ReactNode,
  /** Draws the nodes of a model that holds no link yet, rather than the empty state. */
  drawsUnlinkedNodes?: boolean,
  /** The asset whose page holds the graph. */
  currentAssetId?: string,
  /** Haloes that asset and names the halo in the legend, for a graph it does not root. */
  marksCurrentAsset?: boolean,
  hidesCounters?: boolean,
  /** The "i" of an asset's impact and of a link's share of the attack, on the Targets graph alone. */
  impactExplanations?: {
    asset: (assetId: string) => ReactNode,
    link: (link: DependencyGraphEdge) => ReactNode,
  },
  /** The access relations draw each asset's criticality band, which the dependencies leave to the panel. */
  grammar?: GraphGrammar,
}

interface DependencyGraphLegendProps {
  domains: Array<AssetDomain>,
  hasImpact: boolean,
  hasUndeclaredLink: boolean,
  hasMutualLink: boolean,
  hasMarkedAsset: boolean,
  hasPrimaryLink: boolean,
  /** Null on the dependency graph, whose links all read "supports". */
  relationKinds: Array<AssetRelationKind> | null,
  hasLift: boolean,
}

export const DependencyGraphDepthSelect: FunctionComponent<DependencyGraphDepthSelectProps> = ({ depth, onDepthChange }) => (
  <Select value={String(depth)} onValueChange={(value) => onDepthChange(Number(value))}>
    <SelectTrigger className="w-[180px]" aria-label={t`Graph depth`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {DEPTH_OPTIONS.map((option) => (
        <SelectItem key={option} value={String(option)}>
          {plural(option, { one: '# level', other: '# levels' })}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const LegendCluster: FunctionComponent<{ title: string, children: ReactNode }> = ({ title, children }) => (
  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-content-caption text-default-secondary">
    <span className="text-default-primary">{title}</span>
    {children}
  </span>
);

const LegendRule: FunctionComponent<{ color: string, dashed?: boolean }> = ({ color, dashed }) => (
  <span
    aria-hidden
    className={`h-0 w-4 border-t-2 ${dashed === true ? 'border-dashed' : ''}`}
    style={{ borderColor: color }}
  />
);

const StrengthSample: FunctionComponent<{ strength: PrimaryToPrimaryLinkStrength }> = ({ strength }) => (
  <svg aria-hidden width="16" height="4" viewBox="0 0 16 4">
    <line
      x1="0"
      y1="2"
      x2="16"
      y2="2"
      strokeWidth="3"
      strokeDasharray={strength === 'unknown' ? '5 4' : undefined}
      opacity={PRIMARY_LINK_STRENGTH_ALPHA[strength]}
      style={{ stroke: `var(${strength === 'unknown' ? UNKNOWN_STRENGTH_COLOR_PROPERTY : PRIMARY_LINK_COLOR_PROPERTY})` }}
    />
  </svg>
);

const assetDomainLabel = (domain: AssetDomain): string => {
  switch (domain) {
    case 'endpoint': return t`Endpoint`;
    case 'cloud': return t`Cloud`;
    case 'web_application': return t`Web application`;
    case 'network': return t`Network`;
    case 'identity': return t`Identity`;
    case 'artificial_intelligence': return t`Artificial intelligence`;
    case 'security_platform': return t`Security platform`;
    case 'to_classify': return t`To classify`;
  }
};

const DependencyGraphLegend: FunctionComponent<DependencyGraphLegendProps> = ({
  domains,
  hasImpact,
  hasUndeclaredLink,
  hasMutualLink,
  hasMarkedAsset,
  hasPrimaryLink,
  relationKinds,
  hasLift,
}) => {
  const { effectiveTheme } = useTheme();
  const tintPercent = TINT_ALPHA[effectiveTheme] * 100;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2" style={{ borderTop: SUBTLE_BORDER }}>
      {domains.length > 0 && (
        <LegendCluster title={t`Domains`}>
          {domains.map((domain) => (
            <span key={domain} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 rounded-full border-2"
                style={{ borderColor: assetDomainColor(domain), backgroundColor: `color-mix(in srgb, ${assetDomainColor(domain)} ${tintPercent}%, transparent)` }}
              />
              {assetDomainLabel(domain)}
            </span>
          ))}
        </LegendCluster>
      )}

      {relationKinds !== null && (
        <LegendCluster title={t`Criticality`}>
          {[...ASSET_CRITICALITY_VALUES].reverse().map((band) => (
            <span key={band} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `var(${criticalityRingProperty(band)})` }} />
              {getAssetCriticalityLabel(band)}
            </span>
          ))}
          {hasLift && (
            <span className="flex items-center gap-1.5">
              <ArrowUp className="size-3 text-default-primary" strokeWidth={3} aria-hidden />
              <Trans>given by the assigned user</Trans>
            </span>
          )}
        </LegendCluster>
      )}

      {hasImpact && (
        <LegendCluster title={t`Impact if compromised`}>
          {SEVERITY_BANDS.map((band) => (
            <span key={band} className="flex items-center gap-1.5">
              <Crown className="size-[13px]" strokeWidth={2.25} style={{ color: severityBandFillColor(band) }} aria-hidden />
              {severityBandLabel(band)}
            </span>
          ))}
        </LegendCluster>
      )}

      <LegendCluster title={t`OpenCRQ Posture`}>
        {POSTURE_BANDS.map((band) => (
          <span key={band} className="flex items-center gap-1.5">
            <Shield className="size-[13px]" strokeWidth={2.25} style={{ color: severityBandFillColor(postureSeverityBand(band)) }} aria-hidden />
            {postureBandLabel(band)}
          </span>
        ))}
      </LegendCluster>

      <span className="flex items-center gap-1.5 text-content-caption text-default-secondary">
        <Rss className="size-[13px] text-[color:var(--fds-icon-default)]" strokeWidth={2.25} aria-hidden />
        <Trans>Internet-facing</Trans>
      </span>

      <LegendCluster title={t`Findings`}>
        {FINDING_PILL_BANDS.map((band) => (
          <span key={band} className="flex items-center gap-1.5">
            <Text
              as="span"
              variant="content-caption"
              aria-hidden
              className="inline-flex h-3.5 min-w-4 items-center justify-center rounded-full px-1 font-bold text-[color:var(--fds-text-negative-primary)]"
              style={{ backgroundColor: severityBandFillColor(band) }}
            >
              {band === 'critical' ? 1 : 3}
            </Text>
            {severityBandLabel(band)}
          </span>
        ))}
      </LegendCluster>

      <LegendCluster title={t`Links`}>
        {relationKinds === null ? (
          <span className="flex items-center gap-2">
            <MoveRight className="size-3.5" style={{ color: LINK_INK }} aria-hidden />
            <Trans>supports</Trans>
          </span>
        ) : relationKinds.map((kind) => (
          <span key={kind} className="flex items-center gap-2">
            <MoveRight className="size-3.5" style={{ color: LINK_INK }} aria-hidden />
            {assetRelationLegendLabel(kind)}
          </span>
        ))}
        {hasMutualLink && (
          <span className="flex items-center gap-2">
            <ArrowRightLeft className="size-3.5" aria-hidden />
            <Trans>support each other</Trans>
          </span>
        )}
        {hasUndeclaredLink && (
          <span className="flex items-center gap-2">
            <LegendRule color="var(--fds-text-default-secondary)" dashed />
            <Trans>not declared</Trans>
          </span>
        )}
      </LegendCluster>

      {hasPrimaryLink && (
        <LegendCluster title={t`Between primary assets`}>
          {PRIMARY_TO_PRIMARY_LINK_STRENGTHS.map((strength) => (
            <span key={strength} className="flex items-center gap-1.5">
              <StrengthSample strength={strength} />
              {getLinkStrengthLabel(strength)}
            </span>
          ))}
        </LegendCluster>
      )}

      {hasMarkedAsset && (
        <span className="flex items-center gap-2 text-content-caption text-default-secondary">
          <span
            aria-hidden
            className="mx-1 size-2.5 rounded-full border-2"
            style={{ borderColor: `var(${criticalityRingProperty('unknown')})`, boxShadow: CURRENT_ASSET_HALO_SHADOW }}
          />
          <Trans>this asset</Trans>
        </span>
      )}

      <span className="ml-auto text-content-caption text-default-secondary">
        <Trans>Ctrl or Cmd and the wheel zoom the graph</Trans>
      </span>
    </div>
  );
};

/** Holds the loaded card's footprint, so the page does not jump when the graph arrives. */
const DependencyGraphPlaceholder: FunctionComponent<{ isFullScreen: boolean, height: number, grammar: GraphGrammar }> = ({ isFullScreen, height, grammar }) => (
  <>
    <div className="flex items-center gap-2 px-4 py-2.5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-20" />
    </div>
    <div
      className={`flex flex-col items-center justify-center gap-3 ${isFullScreen ? 'min-h-0 flex-1' : ''}`}
      style={isFullScreen ? undefined : { height }}
    >
      <Spinner size="xl" />
      <span className="text-default-secondary txt-sub-content">
        {grammar === 'access_relations' ? <Trans>Loading the access relations</Trans> : <Trans>Loading the dependency graph</Trans>}
      </span>
    </div>
    <div className="flex items-center gap-6 px-4 py-2.5" style={{ borderTop: SUBTLE_BORDER }}>
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-4 w-40" />
    </div>
  </>
);

/** The model has to keep its identity across renders: the graph hands it to a simulation that owns its nodes. */
export const DependencyGraphCard: FunctionComponent<DependencyGraphCardProps> = ({
  model,
  depth,
  onDepthChange,
  emptyState,
  drawsUnlinkedNodes,
  currentAssetId,
  marksCurrentAsset,
  hidesCounters,
  impactExplanations,
  grammar,
}) => {
  const trpc = useTRPC();
  const [selection, setSelection] = useState<DependencyGraphSelection | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [editedLink, setEditedLink] = useState<EditedSupportToPrimaryLink | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DependencyGraphEdge | null>(null);

  const deleteSupportToPrimaryLinks = useMutation(trpc.assetDependencies.deleteSupportToPrimaryLinks.mutationOptions({
    meta: { successMessage: msg`Dependency deleted successfully.` },
  }));
  const deleteSupportToSupportLinks = useMutation(trpc.assetDependencies.deleteSupportToSupportLinks.mutationOptions({
    meta: { successMessage: msg`Dependency deleted successfully.` },
  }));

  // The overlay covers the page, so the key that leaves every other overlay has to leave this one.
  // A dialog opened over it takes the key first and marks it handled, which leaves full screen alone.
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

  const graphAreaRef = useRef<HTMLDivElement>(null);
  const [graphHeight, setGraphHeight] = useState(GRAPH_HEIGHT);
  const isLoaded = model !== null;
  // Measured rather than summed, since the counters wrap and the depth notice comes and goes. The
  // resize this causes measures again, to the same value, so it settles.
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

  const selectedId = selection?.kind === 'node' ? selection.id : null;
  const selectedNode = model?.nodes.find((node) => node.id === selectedId) ?? null;
  const edges = model === null ? [] : drawnEdges(model);
  const selectedEdge = selection?.kind === 'edge' ? edges.find((edge) => edge.id === selection.id) : undefined;
  const exposedAssetCount = model?.links.filter((link) => link.kind === 'internet_exposure').length ?? 0;
  const hasUnknownRole = model?.links.some((link) => link.roles?.includes(UNKNOWN_LINK_ROLE) === true) ?? false;

  const selectNode = (id: string | null): void => setSelection(id === null ? null : { kind: 'node', id });
  const selectEdge = (id: string): void => setSelection({ kind: 'edge', id });

  const labelOf = (id: string): string => model?.nodes.find((node) => node.id === id)?.label ?? '';
  const editLink = (link: DependencyGraphEdge): void => {
    if (link.roles !== null) {
      setEditedLink({
        id: link.id,
        roles: link.roles,
        supportingAssetName: labelOf(link.target),
        primaryAssetName: labelOf(link.source),
      });
    }
  };

  const confirmDelete = (): void => {
    const link = pendingDelete;
    setPendingDelete(null);
    if (link === null) {
      return;
    }
    if (link.roles === null) {
      deleteSupportToSupportLinks.mutate([link.id]);
    } else {
      deleteSupportToPrimaryLinks.mutate([link.id]);
    }
    setSelection(null);
  };
  const assetCount = model?.nodes.filter((node) => node.kind === 'asset').length ?? 0;
  const hiddenCount = model?.hiddenAssetCount ?? 0;
  const totalAssetCount = assetCount + hiddenCount;
  const shownCount = formatNumber(assetCount);
  const reachedCount = formatNumber(totalAssetCount);
  const canExpand = depth < DEPENDENCY_GRAPH_MAX_DEPTH;
  // An asset holding more providers than the graph draws keeps them folded at any depth.
  const foldsByWidth = model?.nodes.some((node) => node.kind === 'aggregate' && node.foldedBy === 'width') ?? false;
  const isEmpty = model !== null && (drawsUnlinkedNodes === true ? model.nodes.length === 0 : model.links.length === 0);

  const relationKinds = model === null || grammar !== 'access_relations'
    ? null
    : [...new Set(model.links.flatMap((link) => (isStoredLinkKind(link.kind) && link.kind !== 'depends_on' ? [link.kind] : [])))];

  const graphCard = model === null ? <DependencyGraphPlaceholder isFullScreen={isFullScreen} height={graphHeight} grammar={grammar ?? 'dependencies'} /> : (
    <>
      {hidesCounters !== true && (
        <DependencyGraphCounters
          model={model}
          assetCount={assetCount}
          selectedId={selectedId}
          onSelect={selectNode}
          countsAlone={grammar === 'access_relations'}
        />
      )}
      <div ref={graphAreaRef} className="relative flex min-h-0 flex-1 flex-col">
        <DependencyGraph
          model={model}
          selection={selection}
          onSelect={setSelection}
          onExpand={() => onDepthChange(Math.min(depth + 1, DEPENDENCY_GRAPH_MAX_DEPTH))}
          canExpand={canExpand}
          fitSignal={fitSignal}
          isFullScreen={isFullScreen}
          onToggleFullScreen={() => {
            setIsFullScreen((current) => !current);
            setFitSignal((signal) => signal + 1);
          }}
          height={isFullScreen ? undefined : graphHeight}
          markedNodeId={marksCurrentAsset === true ? currentAssetId : undefined}
          grammar={grammar}
        />
        {selectedNode !== null && (
          <DependencyGraphPanel
            node={selectedNode}
            opensItsPage={selectedNode.id !== currentAssetId}
            model={model}
            exposedAssetCount={exposedAssetCount}
            edges={edges}
            onSelectEdge={selectEdge}
            onEditLink={editLink}
            onClose={() => setSelection(null)}
            impactExplanation={impactExplanations?.asset}
            grammar={grammar}
          />
        )}
        {selectedEdge !== undefined && (
          <DependencyGraphLinkCard
            edge={selectedEdge}
            model={model}
            onClose={() => setSelection(null)}
            onEdit={editLink}
            onDelete={setPendingDelete}
            shareExplanation={impactExplanations?.link}
          />
        )}
      </div>
      {hiddenCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2" style={{ borderTop: SUBTLE_BORDER }}>
          <span className="text-default-secondary txt-sub-content">
            {foldsByWidth
              ? <Trans>{shownCount} of {reachedCount} assets shown, too many to draw them all.</Trans>
              : <Trans>{shownCount} of {reachedCount} assets shown, the depth cuts the rest.</Trans>}
          </span>
          {canExpand && !foldsByWidth && (
            <Button priority="secondary" onClick={() => onDepthChange(DEPENDENCY_GRAPH_MAX_DEPTH)}>
              <Trans>See the whole chain</Trans>
            </Button>
          )}
        </div>
      )}
      <DependencyGraphLegend
        domains={presentDomains(model)}
        hasImpact={model.nodes.some((node) => node.impact !== undefined)}
        hasUndeclaredLink={exposedAssetCount > 0 || hasUnknownRole}
        hasMutualLink={edges.some(isMutualEdge)}
        hasMarkedAsset={marksCurrentAsset === true && currentAssetId !== undefined}
        hasPrimaryLink={model.links.some((link) => link.kind === 'primary_dependency')}
        relationKinds={relationKinds}
        hasLift={model.nodes.some((node) => node.asset?.criticalityLift !== undefined && node.asset.criticalityLift !== null)}
      />
    </>
  );

  return (
    <Paper className={`flex flex-col overflow-hidden p-0 ${isFullScreen ? 'fixed inset-0 z-50' : ''}`}>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-4 p-10" style={{ minHeight: GRAPH_HEIGHT }}>
          {emptyState}
        </div>
      ) : graphCard}
      <SupportToPrimaryLinkEditSheet link={editedLink} onClose={() => setEditedLink(null)} />
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        onConfirm={confirmDelete}
        title={<Trans>Delete dependency</Trans>}
        description={<Trans>Are you sure you want to delete this dependency? This action cannot be undone.</Trans>}
      />
    </Paper>
  );
};
