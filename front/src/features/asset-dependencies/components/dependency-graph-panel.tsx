import { Button, Chip, IconButton, Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { SupportToPrimaryLinkRole } from '@app/module/client';
import { postureBandForScore, postureSeverityBand, resolveSeverityBand, wholePercent } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Eye, Info, Pencil, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type {
  DependencyGraphEdge,
  DependencyGraphModel,
  DependencyGraphNode,
  DependencyGraphPayloadAsset,
  DrawnEdge,
  GraphGrammar,
} from '../dependency-graph-utils';
import {
  criticalityRingProperty,
  drawnEdgeBetween,
  findingPills,
  INTERNET_NODE_ID,
  isStoredLinkKind,
  nodeNeighbours,
} from '../dependency-graph-utils';
import { LINK_INK, TINT_ALPHA } from '../../../components/shared/column-graph-paint';
import { TooltipHintProvider } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { useTheme } from '../../../providers/theme-provider';
import { useTenant } from '../../../providers/tenant-provider';
import {
  EMPTY_VALUE,
  formatDate,
  getAssetCategoryLabel,
  getAssetCriticalityLabel,
  getAssetExposureLabel,
} from '../../../utils';
import { ExplanationDialogButton, ScoreGaugeMark, severityBandLabel } from '../../finding-score';
import { CrqPostureExplanation } from '../../supporting-assets/components/crq-posture-explanation';
import { assetRelationGroupLabel, assetRelationSourceLabel } from '../../supporting-assets/asset-relation-labels';
import { usePrimaryAssetScope } from '../hooks/use-primary-asset-scope';
import { getLinkRoleLabel } from '../link-role-labels';
import { findingCountLabel, postureScoreLabel } from './asset-findings-labels';
import { CriticalityBandPill } from './criticality-band-pill';
import { DependencyGraphNodeBadge } from './dependency-graph-node-badge';

/** Past this many names a neighbour line stops listing and counts the rest. */
const MAX_NAMED_NEIGHBOURS = 3;
/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const SECTION_RULE = '1px solid var(--fds-border-elevation-subtle-soft)';

interface DependencyGraphPanelProps {
  node: DependencyGraphNode,
  model: DependencyGraphModel,
  /** Read for the internet node alone, which stands for every asset reachable from the internet. */
  exposedAssetCount: number,
  edges: Array<DrawnEdge>,
  /** False on the page of the asset itself, where a link to it would lead nowhere. */
  opensItsPage: boolean,
  onSelectEdge: (edgeId: string) => void,
  onEditLink: (link: DependencyGraphEdge) => void,
  onClose: () => void,
  impactExplanation?: (assetId: string) => ReactNode,
  grammar?: GraphGrammar,
}

const formatObservation = (value: string | null): string => (value === null ? EMPTY_VALUE : formatDate(value));

/** An aggregate node has no name of its own: it is the count of the assets it stands for. */
const neighbourName = (node: DependencyGraphNode): string => (node.kind === 'aggregate'
  ? plural(node.hiddenProviderCount, { one: '# asset', other: '# assets' })
  : node.label);

/** How many assets a neighbour stands for: an aggregate node is all the assets it folds. */
const assetWeight = (node: DependencyGraphNode): number =>
  (node.kind === 'aggregate' ? node.hiddenProviderCount : 1);

/** The roles travel in the trigger's name too, since a tooltip opens on hover and focus alone. */
const LinkRolesHint: FunctionComponent<{ name: string, roles: ReadonlyArray<SupportToPrimaryLinkRole> }> = ({ name, roles }) => {
  const listed = roles.map(getLinkRoleLabel).join(', ');
  return (
    <TooltipHintProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t`Roles of the link with ${name}: ${listed}`}
            className="ml-1 inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-[var(--fds-radius-sm)] border-0 bg-transparent p-0 text-default-secondary hover:text-default-primary"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{t`Roles: ${listed}`}</TooltipContent>
      </Tooltip>
    </TooltipHintProvider>
  );
};

/** The rest is counted in assets, not in nodes, so a folded aggregate past the cut keeps its size. */
const NeighbourList: FunctionComponent<{
  title: string,
  node: DependencyGraphNode,
  neighbours: Array<DependencyGraphNode>,
  model: DependencyGraphModel,
  edges: Array<DrawnEdge>,
  onSelectEdge: (edgeId: string) => void,
  onEditLink: (link: DependencyGraphEdge) => void,
}> = ({ title, node, neighbours, model, edges, onSelectEdge, onEditLink }) => {
  const rest = neighbours.slice(MAX_NAMED_NEIGHBOURS).reduce((sum, neighbour) => sum + assetWeight(neighbour), 0);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2 txt-sub-content text-default-secondary">
        <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: LINK_INK }} />
        {title}
      </span>
      <ul aria-label={title} className="m-0 flex list-none flex-col p-0">
        {neighbours.slice(0, MAX_NAMED_NEIGHBOURS).map((neighbour) => {
          const edge = drawnEdgeBetween(edges, node.id, neighbour.id);
          const name = neighbourName(neighbour);
          // Only a link to a primary asset has roles, and the card is the primary's or its supporting asset's.
          const primaryLink = model.links.find((link) => link.roles !== null
            && ((link.source === neighbour.id && link.target === node.id) || (link.source === node.id && link.target === neighbour.id)));
          return (
            <li key={neighbour.id} className="flex min-h-7 items-center txt-sub-content text-default-primary">
              <span aria-hidden className="mx-2 size-1 shrink-0 rounded-full bg-[color:var(--fds-text-default-secondary)]" />
              <span title={name} className="min-w-0 truncate font-medium">{name}</span>
              {primaryLink !== undefined && primaryLink.roles !== null && <LinkRolesHint name={name} roles={primaryLink.roles} />}
              <span className="flex-1" />
              {primaryLink !== undefined && (
                <IconButton
                  priority="tertiary"
                  className="shrink-0"
                  aria-label={t`Edit the link with ${name}`}
                  icon={<Pencil className="size-3.5" aria-hidden />}
                  onClick={() => onEditLink(primaryLink)}
                />
              )}
              {edge !== undefined && (
                <IconButton
                  priority="tertiary"
                  className="shrink-0"
                  aria-label={t`Show the link with ${name} in the graph`}
                  icon={<Eye className="size-3.5" aria-hidden />}
                  onClick={() => onSelectEdge(edge.id)}
                />
              )}
            </li>
          );
        })}
        {rest > 0 && (
          <li className="flex min-h-7 items-center pl-5 txt-sub-content text-default-secondary">
            {plural(rest, { one: 'and # more', other: 'and # more' })}
          </li>
        )}
      </ul>
    </div>
  );
};

interface RelationGroup {
  title: string,
  rows: Array<{ link: DependencyGraphEdge, other: DependencyGraphNode }>,
}

const relationGroups = (node: DependencyGraphNode, model: DependencyGraphModel): Array<RelationGroup> => {
  const byId = new Map(model.nodes.map((candidate) => [candidate.id, candidate]));
  const groups = new Map<string, RelationGroup>();
  for (const link of model.links) {
    const direction = link.source === node.id ? 'outgoing' : link.target === node.id ? 'incoming' : null;
    const other = byId.get(direction === 'outgoing' ? link.target : link.source);
    if (direction === null || other === undefined || link.kind === 'depends_on' || !isStoredLinkKind(link.kind)) {
      continue;
    }
    const key = `${link.kind}:${direction}`;
    const group = groups.get(key) ?? { title: assetRelationGroupLabel(link.kind, direction), rows: [] };
    group.rows.push({ link, other });
    groups.set(key, group);
  }
  return [...groups.values()];
};

const RelationList: FunctionComponent<{
  group: RelationGroup,
  edges: Array<DrawnEdge>,
  node: DependencyGraphNode,
  onSelectEdge: (edgeId: string) => void,
}> = ({ group, edges, node, onSelectEdge }) => (
  <div className="flex flex-col gap-1.5">
    <span className="txt-sub-content text-default-secondary">{group.title}</span>
    <ul aria-label={group.title} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {group.rows.map(({ link, other }) => {
        const name = other.label;
        const source = (link.relation?.sources ?? []).map(assetRelationSourceLabel).join(', ');
        const lastSeen = link.relation === undefined ? EMPTY_VALUE : formatDate(link.relation.lastReportedAt);
        const edge = drawnEdgeBetween(edges, node.id, other.id);
        const otherAsset = other.asset;
        return (
          <li
            key={link.id}
            className="flex items-center gap-2 rounded-[var(--fds-radius-sm)] px-2.5 py-2"
            style={{ border: SECTION_RULE }}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span title={name} className="truncate txt-sub-content font-medium text-default-primary">{name}</span>
              <span className="txt-sub-content text-default-secondary"><Trans>{source}, last seen {lastSeen}</Trans></span>
            </span>
            {otherAsset !== null && (
              <CriticalityBandPill criticality={otherAsset.criticality} lifted={otherAsset.criticalityLift !== undefined && otherAsset.criticalityLift !== null} />
            )}
            {edge !== undefined && (
              <IconButton
                priority="tertiary"
                className="shrink-0"
                aria-label={t`Show the link with ${name} in the graph`}
                icon={<Eye className="size-3.5" aria-hidden />}
                onClick={() => onSelectEdge(edge.id)}
              />
            )}
          </li>
        );
      })}
    </ul>
  </div>
);

/** The explanation reads the whole posture, which the graph payload does not carry. */
const PostureExplanationBody: FunctionComponent<{ tenantId: string, assetId: string }> = ({ tenantId, assetId }) => {
  const trpc = useTRPC();
  const { data: posture } = useQuery(trpc.findingScore.getAssetPosture.queryOptions({ supportingAssetId: assetId }));
  if (posture === undefined) {
    return <Spinner size="md" />;
  }
  return posture === null
    ? <p className="m-0 txt-sub-content text-default-secondary"><Trans>OpenCRQ Posture: no applicable finding to measure</Trans></p>
    : <CrqPostureExplanation tenantId={tenantId} posture={posture} />;
};

const PanelGauge: FunctionComponent<{ mark: ReactNode, caption: string, explanation?: ReactNode }> = ({ mark, caption, explanation }) => (
  <div className="flex min-w-0 items-center gap-1.5">
    {mark}
    {/* A half-panel column cannot hold a two-line caption beside its "i", so the "i" floats one line high:
        it narrows the first line only and the longest word keeps the second. */}
    <span className="block min-w-0 flex-1 break-words txt-sub-content text-default-secondary">
      {explanation !== undefined && <span className="float-right ml-1 inline-flex h-[1lh] items-center">{explanation}</span>}
      {caption}
    </span>
  </div>
);

const PostureGauge: FunctionComponent<{ tenantId: string, asset: DependencyGraphPayloadAsset }> = ({ tenantId, asset }) => {
  const caption = t`OpenCRQ Posture`;
  const score = asset.postureScore;
  if (score === null) {
    return (
      <PanelGauge
        caption={caption}
        mark={(
          <span
            className="flex h-8 w-10 shrink-0 items-center justify-center text-default-secondary"
            title={t`OpenCRQ Posture: no applicable finding to measure`}
          >
            <EmptyValue />
          </span>
        )}
      />
    );
  }
  return (
    <PanelGauge
      caption={caption}
      mark={<ScoreGaugeMark score={score} band={postureSeverityBand(postureBandForScore(score))} label={postureScoreLabel(score)} />}
      explanation={(
        <ExplanationDialogButton triggerLabel={t`How the OpenCRQ Posture is computed`} title={caption}>
          <PostureExplanationBody tenantId={tenantId} assetId={asset.id} />
        </ExplanationDialogButton>
      )}
    />
  );
};

const ImpactGauge: FunctionComponent<{ impact: number, explanation: ReactNode }> = ({ impact, explanation }) => {
  const pct = wholePercent(impact);
  const band = resolveSeverityBand(pct);
  const bandWord = severityBandLabel(band);
  return (
    <PanelGauge
      caption={t`Impact if compromised`}
      mark={<ScoreGaugeMark score={pct} band={band} label={t`Impact if compromised: ${pct}% of the scenario's loss, ${bandWord}`} />}
      explanation={explanation}
    />
  );
};

const PropertyRow: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 txt-sub-content">
    <dt className="text-default-secondary">{label}</dt>
    <dd className="m-0 min-w-0 text-right break-words text-default-primary">{children}</dd>
  </div>
);

export const DependencyGraphPanel: FunctionComponent<DependencyGraphPanelProps> = ({
  node,
  model,
  exposedAssetCount,
  edges,
  opensItsPage,
  onSelectEdge,
  onEditLink,
  onClose,
  impactExplanation,
  grammar,
}) => {
  const { tenantId } = useTenant();
  const primaryScope = usePrimaryAssetScope(node.kind === 'primary' && opensItsPage ? node.id : undefined);
  const { effectiveTheme } = useTheme();
  const { asset } = node;

  const ring = `var(${criticalityRingProperty(asset?.criticality ?? 'unknown')})`;
  const tintPercent = TINT_ALPHA[effectiveTheme] * 100;
  const typeLabel = node.kind === 'primary'
    ? t`Primary asset`
    : asset === null ? t`Not inventoried` : getAssetCategoryLabel(asset.categoryId);

  const findings = asset === null ? [] : findingPills(asset);
  const { providers, dependents } = nodeNeighbours(model, node.id);
  const assetProviders = providers.filter((provider) => provider.id !== INTERNET_NODE_ID);
  const relations = grammar === 'access_relations' ? relationGroups(node, model) : [];

  return (
    <aside
      aria-label={t`Selected asset`}
      className="absolute right-4 top-4 z-10 flex max-h-[calc(100%-2rem)] w-[300px] flex-col overflow-y-auto rounded-md border border-elevation-subtle-soft bg-[var(--fds-bg-elevation-default-layer-1)] shadow-lg"
    >
      <div className="flex items-start gap-2.5 p-3.5">
        <DependencyGraphNodeBadge node={node} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block break-words txt-category text-default-primary">
            {asset === null ? node.label : <AssetName name={asset.name} derivedName={asset.derivedName} />}
          </span>
          <span className="block txt-sub-content text-default-secondary">{typeLabel}</span>
        </span>
        <IconButton
          priority="tertiary"
          aria-label={t`Close the panel`}
          icon={<X className="size-4" aria-hidden />}
          onClick={onClose}
        />
      </div>

      {node.kind === 'primary' && (
        <>
          {assetProviders.length > 0 && (
            <div className="flex flex-col gap-2.5 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
              <NeighbourList
                title={t`Supported by`}
                node={node}
                neighbours={assetProviders}
                model={model}
                edges={edges}
                onSelectEdge={onSelectEdge}
                onEditLink={onEditLink}
              />
            </div>
          )}
          {opensItsPage && primaryScope !== undefined && (
            <div className="px-3.5 pb-3.5 pt-1">
              <Button asChild priority="primary" className="w-full">
                <Link
                  to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId"
                  params={{ tenantId, organizationId: primaryScope, primaryAssetId: node.id }}
                >
                  <Trans>Open the asset</Trans>
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          )}
        </>
      )}

      {node.kind !== 'primary' && asset === null && (
        <div className="flex flex-col gap-3 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
          <p className="m-0 txt-sub-content text-default-secondary">
            <Trans>
              Internet is not an inventoried asset. Every asset declared as internet-facing is drawn
              as depending on it, so the whole exposed surface of the chain reads at once.
            </Trans>
          </p>
          <dl className="m-0 flex flex-col gap-2">
            <PropertyRow label={t`Exposed assets`}>
              {plural(exposedAssetCount, { one: '# asset', other: '# assets' })}
            </PropertyRow>
          </dl>
        </div>
      )}

      {asset !== null && (
        <>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
            {node.impact !== undefined && (
              <div className="min-w-0 pr-2.5" style={{ borderRight: SECTION_RULE }}>
                <ImpactGauge impact={node.impact} explanation={impactExplanation?.(node.id)} />
              </div>
            )}
            <div className={node.impact === undefined ? 'min-w-0' : 'min-w-0 pl-2.5'}>
              <PostureGauge tenantId={tenantId} asset={asset} />
            </div>
          </div>

          <dl className="m-0 flex flex-col gap-2 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
            <PropertyRow label={t`Findings`}>
              {findings.length === 0 ? EMPTY_VALUE : (
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  {findings.map((pill) => (
                    <Chip key={pill.band} severity={pill.band} label={findingCountLabel(pill)} />
                  ))}
                </span>
              )}
            </PropertyRow>
            <PropertyRow label={t`Criticality`}>
              {grammar === 'access_relations' ? (
                <CriticalityBandPill criticality={asset.criticality} lifted={asset.criticalityLift !== undefined && asset.criticalityLift !== null} />
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full border-2"
                    style={{ borderColor: ring, backgroundColor: `color-mix(in srgb, ${ring} ${tintPercent}%, transparent)` }}
                  />
                  {getAssetCriticalityLabel(asset.criticality)}
                </span>
              )}
            </PropertyRow>
            <PropertyRow label={t`Exposure`}>{getAssetExposureLabel(asset.exposure)}</PropertyRow>
            <PropertyRow label={t`Owner`}>{asset.ownerName ?? EMPTY_VALUE}</PropertyRow>
            <PropertyRow label={t`First observation`}>{formatObservation(asset.firstSeenAt)}</PropertyRow>
            <PropertyRow label={t`Last observation`}>{formatObservation(asset.lastSeenAt)}</PropertyRow>
          </dl>

          {relations.length > 0 && (
            <div className="flex flex-col gap-3 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
              {relations.map((group) => (
                <RelationList key={group.title} group={group} edges={edges} node={node} onSelectEdge={onSelectEdge} />
              ))}
            </div>
          )}

          {grammar !== 'access_relations' && (assetProviders.length > 0 || dependents.length > 0) && (
            <div className="flex flex-col gap-2.5 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
              {assetProviders.length > 0 && (
                <NeighbourList
                  title={t`Supported by`}
                  node={node}
                  neighbours={assetProviders}
                  model={model}
                  edges={edges}
                  onSelectEdge={onSelectEdge}
                  onEditLink={onEditLink}
                />
              )}
              {dependents.length > 0 && (
                <NeighbourList
                  title={t`Supporting`}
                  node={node}
                  neighbours={dependents}
                  model={model}
                  edges={edges}
                  onSelectEdge={onSelectEdge}
                  onEditLink={onEditLink}
                />
              )}
            </div>
          )}

          {opensItsPage && (
            <div className="px-3.5 pb-3.5 pt-1">
              <Button asChild priority="primary" className="w-full">
                <Link
                  to="/$tenantId/{-$organizationId}/assets/$supportingAssetId"
                  params={{ tenantId, supportingAssetId: asset.id }}
                >
                  <Trans>Open the asset</Trans>
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </aside>
  );
};
