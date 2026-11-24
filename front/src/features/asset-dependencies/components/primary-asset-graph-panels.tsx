import { SECURITY_NEED_CRITERIA } from '@app/module/client';
import { Button, IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ChevronRight, X } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { PrimaryGraphEdge, PrimaryGraphLink, PrimaryGraphModel, PrimaryGraphNode } from '../primary-asset-graph-utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTenant } from '../../../providers/tenant-provider';
import { securityCriterionLabel } from '../../primary-assets/primary-asset-fields-labels';
import { SecurityNeedChip } from '../../primary-assets/components/security-need-chip';
import { getLinkStrengthLabel } from '../link-strength-labels';
import { resourceTypeLabel } from './primary-asset-graph';

/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const SECTION_RULE = '1px solid var(--fds-border-elevation-subtle-soft)';

const Panel: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <aside
    aria-label={label}
    className="absolute right-4 top-4 z-10 flex max-h-[calc(100%-2rem)] w-[320px] flex-col overflow-y-auto rounded-md border border-elevation-subtle-soft bg-[var(--fds-bg-elevation-default-layer-1)] shadow-lg"
  >
    {children}
  </aside>
);

const CloseButton: FunctionComponent<{ onClose: () => void }> = ({ onClose }) => (
  <IconButton
    priority="tertiary"
    className="shrink-0"
    aria-label={t`Close the panel`}
    icon={<X className="size-4" aria-hidden />}
    onClick={onClose}
  />
);

const PropertyRow: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <div className="flex min-h-7 items-center justify-between gap-3 txt-sub-content">
    <dt className="text-default-secondary">{label}</dt>
    <dd className="m-0 min-w-0 text-right break-words text-default-primary">{children}</dd>
  </div>
);

const linkFacts = (link: PrimaryGraphLink): string => {
  const strength = getLinkStrengthLabel(link.strength);
  const resource = resourceTypeLabel(link);
  return t`${strength}, runs through ${resource}`;
};

interface NeighbourListProps {
  title: string,
  entries: Array<{ link: PrimaryGraphLink, other: PrimaryGraphNode }>,
  onSelectNode: (id: string) => void,
}

const NeighbourList: FunctionComponent<NeighbourListProps> = ({ title, entries, onSelectNode }) => (
  <div className="flex flex-col gap-1.5 px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
    <span className="txt-category text-default-primary">{title}</span>
    {entries.length === 0
      ? <span className="txt-sub-content text-default-secondary"><Trans>None</Trans></span>
      : (
        <ul aria-label={title} className="m-0 flex list-none flex-col gap-1.5 p-0">
          {entries.map(({ link, other }) => (
            <li key={link.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start rounded-[var(--fds-radius-sm)] border-0 bg-transparent px-2 py-1.5 text-left hover:bg-hover"
                onClick={() => onSelectNode(other.id)}
              >
                <span className="txt-sub-content font-medium text-default-primary">{other.asset.name}</span>
                <span className="txt-sub-content text-default-secondary">{linkFacts(link)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
  </div>
);

interface PrimaryAssetGraphNodePanelProps {
  node: PrimaryGraphNode,
  model: PrimaryGraphModel,
  organizationId: string,
  onSelectNode: (id: string) => void,
  onClose: () => void,
}

export const PrimaryAssetGraphNodePanel: FunctionComponent<PrimaryAssetGraphNodePanelProps> = ({
  node,
  model,
  organizationId,
  onSelectNode,
  onClose,
}) => {
  const { tenantId } = useTenant();
  const nodesById = new Map(model.nodes.map((candidate) => [candidate.id, candidate]));
  const links = model.edges.flatMap((edge) => edge.links);
  const neighbours = (own: 'dependentAssetId' | 'providerAssetId', other: 'dependentAssetId' | 'providerAssetId') => links
    .filter((link) => link[own] === node.id)
    .flatMap((link) => {
      const otherNode = nodesById.get(link[other]);
      return otherNode === undefined ? [] : [{ link, other: otherNode }];
    });
  const { asset } = node;

  return (
    <Panel label={t`Selected primary asset`}>
      <div className="flex items-start gap-2 p-3.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="txt-sub-content text-default-secondary"><Trans>Primary asset</Trans></span>
          <span className="break-words txt-subtitle text-default-primary">{asset.name}</span>
        </span>
        <CloseButton onClose={onClose} />
      </div>
      <dl className="m-0 flex flex-col px-3.5 pb-3">
        <PropertyRow label={t`Business function`}>{asset.businessFunction ?? <EmptyValue />}</PropertyRow>
        <PropertyRow label={t`Overall level`}>
          {node.overallLevel === null ? <EmptyValue /> : <SecurityNeedChip level={node.overallLevel} />}
        </PropertyRow>
      </dl>
      <div className="flex flex-col px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
        <span className="txt-category text-default-primary"><Trans>Security needs</Trans></span>
        <dl className="m-0 flex flex-col">
          {SECURITY_NEED_CRITERIA.map((criterion) => {
            const level = asset[criterion];
            return (
              <PropertyRow key={criterion} label={securityCriterionLabel(criterion)}>
                {level === null ? <EmptyValue /> : <SecurityNeedChip level={level} />}
              </PropertyRow>
            );
          })}
        </dl>
      </div>
      <NeighbourList title={t`Depends on`} entries={neighbours('dependentAssetId', 'providerAssetId')} onSelectNode={onSelectNode} />
      <NeighbourList title={t`Supports`} entries={neighbours('providerAssetId', 'dependentAssetId')} onSelectNode={onSelectNode} />
      <div className="px-3.5 py-3" style={{ borderTop: SECTION_RULE }}>
        <Button asChild priority="primary" className="w-full">
          <Link
            to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId"
            params={{ tenantId, organizationId, primaryAssetId: asset.id }}
          >
            <Trans>Open the asset</Trans>
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </Panel>
  );
};

interface PrimaryAssetGraphEdgePanelProps {
  edge: PrimaryGraphEdge,
  model: PrimaryGraphModel,
  onSelectNode: (id: string) => void,
  onClose: () => void,
}

export const PrimaryAssetGraphEdgePanel: FunctionComponent<PrimaryAssetGraphEdgePanelProps> = ({ edge, model, onSelectNode, onClose }) => {
  const nameOf = (id: string): string => model.nodes.find((node) => node.id === id)?.asset.name ?? '';
  const end = (id: string) => (
    <button
      type="button"
      className="w-fit border-0 bg-transparent p-0 text-left txt-category text-default-primary hover:underline"
      onClick={() => onSelectNode(id)}
    >
      {nameOf(id)}
    </button>
  );
  return (
    <Panel label={t`Selected dependency`}>
      <div className="flex items-start gap-2 px-3.5 pt-3.5">
        <span className="min-w-0 flex-1 txt-sub-content text-default-secondary">
          <Trans>Dependency between primary assets</Trans>
        </span>
        <CloseButton onClose={onClose} />
      </div>
      {edge.links.map((link) => (
        <div key={link.id} className="flex flex-col gap-1 px-3.5 py-3">
          {end(link.dependentAssetId)}
          <span className="txt-sub-content text-default-secondary"><Trans>depends on</Trans></span>
          {end(link.providerAssetId)}
          <dl className="m-0 mt-2 flex flex-col">
            <PropertyRow label={t({ message: 'Strength', context: 'of a dependency' })}>{getLinkStrengthLabel(link.strength)}</PropertyRow>
            <PropertyRow label={t`Runs through`}>{link.dependencyResourceTypeName ?? <EmptyValue />}</PropertyRow>
          </dl>
        </div>
      ))}
    </Panel>
  );
};
