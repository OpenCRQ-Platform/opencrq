import { Button, IconButton } from '@filigran/design-system';
import { inheritedCriteriaOfRoles } from '@app/module/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { DependencyGraphEdge, DependencyGraphModel, DependencyGraphNode, DrawnEdge } from '../dependency-graph-utils';
import { edgeLift, formatWholePercent, isMutualEdge, isStoredLinkKind } from '../dependency-graph-utils';
import { LINK_INK } from '../../../components/shared/column-graph-paint';
import { usePrimaryAssetScope } from '../hooks/use-primary-asset-scope';
import { getLinkRoleLabel } from '../link-role-labels';
import { AssetName } from '../../../components/shared/asset-name';
import { useTenant } from '../../../providers/tenant-provider';
import { EMPTY_VALUE, formatDate, getAssetCategoryLabel } from '../../../utils';
import { assetRelationKindLabel, assetRelationSourceLabel } from '../../supporting-assets/asset-relation-labels';
import { liftReading } from '../../supporting-assets/asset-resolution-copy';
import { CriticalityBandPill } from './criticality-band-pill';
import { DependencyGraphNodeBadge } from './dependency-graph-node-badge';
import { InheritedCriteriaLegend, InheritedCriteriaTiles } from './link-role-display';

/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const SECTION_RULE = '1px solid var(--fds-border-elevation-subtle-soft)';

interface DependencyGraphLinkCardProps {
  edge: DrawnEdge,
  model: DependencyGraphModel,
  onClose: () => void,
  onEdit: (link: DependencyGraphEdge) => void,
  onDelete: (link: DependencyGraphEdge) => void,
  shareExplanation?: (link: DependencyGraphEdge) => ReactNode,
}

const LinkEnd: FunctionComponent<{ node: DependencyGraphNode }> = ({ node }) => {
  const { tenantId } = useTenant();
  const primaryScope = usePrimaryAssetScope(node.kind === 'primary' ? node.id : undefined);
  const typeLabel = node.kind === 'primary'
    ? t`Primary asset`
    : node.asset === null ? '' : getAssetCategoryLabel(node.asset.categoryId);
  const className = 'flex min-w-0 items-center gap-2.5 text-default-primary no-underline hover:underline';
  const body = (
    <>
      <DependencyGraphNodeBadge node={node} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="break-words txt-category">
          {node.asset === null ? node.label : <AssetName name={node.asset.name} derivedName={node.asset.derivedName} />}
        </span>
        <span className="txt-sub-content text-default-secondary">{typeLabel}</span>
      </span>
    </>
  );
  if (node.kind === 'primary' && primaryScope === undefined) {
    return <span className={className}>{body}</span>;
  }
  return node.kind === 'primary' ? (
    <Link
      to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId"
      params={{ tenantId, organizationId: primaryScope, primaryAssetId: node.id }}
      className={className}
    >
      {body}
    </Link>
  ) : (
    <Link
      to="/$tenantId/{-$organizationId}/assets/$supportingAssetId"
      params={{ tenantId, supportingAssetId: node.id }}
      className={className}
    >
      {body}
    </Link>
  );
};

/** Points down, at the end the edge's head points at on the canvas. */
const Connector: FunctionComponent<{ children?: ReactNode }> = ({ children }) => (
  <span className="flex min-h-9 items-center gap-3 pl-2">
    <svg aria-hidden width="10" height="36" viewBox="0 0 10 36" className="shrink-0">
      <line x1="5" y1="1" x2="5" y2="28" strokeWidth="2" style={{ stroke: LINK_INK }} />
      <path d="M1,27 L5,34 L9,27 z" style={{ fill: LINK_INK }} />
    </svg>
    {children !== undefined && <span className="txt-body2 font-medium text-default-primary">{children}</span>}
  </span>
);

const PropertyRow: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 txt-sub-content">
    <dt className="text-default-secondary">{label}</dt>
    <dd className="m-0 min-w-0 text-right break-words text-default-primary">{children}</dd>
  </div>
);

interface RelationSectionProps {
  link: DependencyGraphEdge,
  byId: Map<string, DependencyGraphNode>,
  closeButton: ReactNode,
}

/** A relation is its connector's to reconcile, so the card offers no action on it. */
const RelationSection: FunctionComponent<RelationSectionProps> = ({ link, byId, closeButton }) => {
  const holder = byId.get(link.target);
  const other = byId.get(link.source);
  if (holder === undefined || other === undefined || link.relation === undefined || link.kind === 'depends_on' || !isStoredLinkKind(link.kind)) {
    return null;
  }
  const lift = edgeLift(byId, link);
  const sources = link.relation.sources.map(assetRelationSourceLabel).join(', ');
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5">
        <span className="txt-category text-default-primary">{assetRelationKindLabel(link.kind)}</span>
        {closeButton}
      </div>
      <div className="flex flex-col gap-1 px-3.5 pb-3.5 pt-2">
        <LinkEnd node={holder} />
        <Connector />
        <LinkEnd node={other} />
      </div>

      {lift !== null && other.asset !== null && (
        <div
          className="mx-3.5 mb-3 flex flex-col gap-1.5 rounded-[var(--fds-radius-sm)] p-2.5"
          style={{ backgroundColor: 'color-mix(in srgb, var(--fds-color-feedback-neutral-secondary) 12%, transparent)' }}
        >
          <span className="flex items-center justify-between gap-2 txt-sub-content">
            <span className="text-default-secondary">{t`Criticality given`}</span>
            <CriticalityBandPill criticality={lift} lifted />
          </span>
          <span className="txt-sub-content text-default-primary">
            {liftReading({ criticality: lift, fromAsset: other.asset })}
          </span>
        </div>
      )}

      <dl className="m-0 flex flex-col gap-2 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
        <PropertyRow label={t`Source`}>{sources === '' ? EMPTY_VALUE : sources}</PropertyRow>
        <PropertyRow label={t`First observation`}>{formatDate(link.relation.firstSeenAt)}</PropertyRow>
        <PropertyRow label={t`Last observation`}>{formatDate(link.relation.lastReportedAt)}</PropertyRow>
      </dl>
    </>
  );
};

interface LinkSectionProps {
  link: DependencyGraphEdge,
  byId: Map<string, DependencyGraphNode>,
  /** Named after its two ends, since a mutual dependency puts two of these in one card. */
  namesItsDelete: boolean,
  onEdit: (link: DependencyGraphEdge) => void,
  onDelete: (link: DependencyGraphEdge) => void,
  closeButton: ReactNode,
  shareExplanation?: (link: DependencyGraphEdge) => ReactNode,
}

/** Read top to bottom as a sentence: the supporting end, the verb, then the supported end. */
const LinkSection: FunctionComponent<LinkSectionProps> = ({ link, byId, namesItsDelete, onEdit, onDelete, closeButton, shareExplanation }) => {
  const supported = byId.get(link.source);
  const supporting = byId.get(link.target);
  if (supported === undefined || supporting === undefined) {
    return null;
  }
  const { roles } = link;
  const from = supporting.label;
  const to = supported.label;
  const deleteButton = (
    <Button
      priority="secondary"
      className="flex-1"
      aria-label={namesItsDelete ? t`Delete the link: ${from} supports ${to}` : undefined}
      onClick={() => onDelete(link)}
    >
      {t`Delete`}
    </Button>
  );

  return (
    <>
      <div className="flex items-start gap-2.5 p-3.5">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <LinkEnd node={supporting} />
          <Connector><Trans>supports</Trans></Connector>
          <LinkEnd node={supported} />
        </span>
        {closeButton}
      </div>

      {roles !== null && (
        <dl className="m-0 flex flex-col gap-2.5 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
          <div className="flex items-center justify-between gap-3 txt-sub-content">
            <dt className="text-default-secondary">{t`Roles`}</dt>
            <dd className="m-0 min-w-0 text-right break-words text-default-primary">{roles.map(getLinkRoleLabel).join(', ')}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 txt-sub-content text-default-secondary">
              {t`Inherited criteria`}
              <InheritedCriteriaLegend />
            </dt>
            <dd className="m-0"><InheritedCriteriaTiles criteria={inheritedCriteriaOfRoles(roles)} /></dd>
          </div>
          {link.attackShare !== undefined && (
            <div className="flex items-center justify-between gap-3 txt-sub-content">
              <dt className="flex items-center gap-1.5 text-default-secondary">
                {t`Share of the attack transmitted`}
                {shareExplanation?.(link)}
              </dt>
              <dd className="m-0 font-medium tabular-nums text-default-primary">
                {formatWholePercent(link.attackShare.share, i18n.locale || 'en')}
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex gap-2 px-3.5 pb-3.5">
        {roles !== null && (
          <Button priority="primary" className="flex-1" onClick={() => onEdit(link)}>{t`Edit`}</Button>
        )}
        {deleteButton}
      </div>
    </>
  );
};

export const DependencyGraphLinkCard: FunctionComponent<DependencyGraphLinkCardProps> = ({
  edge,
  model,
  onClose,
  onEdit,
  onDelete,
  shareExplanation,
}) => {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const mutual = isMutualEdge(edge);
  const closeButton = (
    <IconButton
      priority="tertiary"
      aria-label={t`Close the panel`}
      icon={<X className="size-4" aria-hidden />}
      onClick={onClose}
    />
  );

  return (
    <aside
      aria-label={mutual ? t`Selected links` : t`Selected link`}
      className="absolute right-4 top-4 z-10 flex max-h-[calc(100%-2rem)] w-[300px] flex-col overflow-y-auto rounded-md border border-elevation-subtle-soft bg-[var(--fds-bg-elevation-default-layer-1)] shadow-lg"
    >
      {edge.links.map((link, index) => (
        <div key={link.id} className="flex flex-col" style={index > 0 ? { borderTop: SECTION_RULE } : undefined}>
          {link.relation === undefined ? (
            <LinkSection
              link={link}
              byId={byId}
              namesItsDelete={mutual}
              onEdit={onEdit}
              onDelete={onDelete}
              closeButton={index === 0 ? closeButton : null}
              shareExplanation={shareExplanation}
            />
          ) : (
            <RelationSection link={link} byId={byId} closeButton={index === 0 ? closeButton : null} />
          )}
        </div>
      ))}
    </aside>
  );
};
