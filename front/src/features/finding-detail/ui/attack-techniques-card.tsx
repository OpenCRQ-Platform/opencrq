import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import type { AssetCategory, SupportingAssetExposure } from '@app/module/client';
import { Columns3, List } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import type { HighlightedTechnique } from '../../../components/shared';
import type { AttackCoverage, AttackGroupRows } from '../attack-groups-utils';
import type { FindingScoreBreakdown } from '../../finding-score';
import { InfoTooltip, TtpMatrixView } from '../../../components/shared';
import { HighlightFilterToggle } from '../../../components/ui/highlight-filter-toggle';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { attackGroupLabel } from '../../finding-score';
import { getAssetCategoryLabel } from '../../../utils';
import { usePersistedView } from '../../../hooks/utils/use-persisted-view';
import { useTRPC } from '../../../lib';
import { ATTACK_GROUP_ACCENT, attackRowKey, coverageMarker, groupAttackRows, matrixTechniques, tacticNamesByTechnique } from '../attack-groups-utils';
import { DossierCard } from './dossier-card';
import { AttackTechniquesTable } from './attack-techniques-table';

type TechniqueClaims = NonNullable<FindingScoreBreakdown['columns']['techniques']>;

const VIEWS = ['matrix', 'list'] as const;
type TtpView = typeof VIEWS[number];

export const AttackGroupSwatch: FunctionComponent<{ group: AttackGroupRows['group'] }> = ({ group }) => (
  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ background: ATTACK_GROUP_ACCENT[group] }} />
);

interface AttackTechniquesCardProps {
  techniques: TechniqueClaims | null,
  /** The family of a finding's asset. A unique finding spans several and passes its `coverage` instead. */
  categoryId?: AssetCategory,
  /** The exposure a finding's asset declares. */
  exposure?: SupportingAssetExposure,
  coverage?: AttackCoverage,
}

const assetShareLabel = (assetCount: number, totalAssetCount: number): string =>
  (assetCount >= totalAssetCount ? t`All` : t`${assetCount} of ${totalAssetCount}`);

const setAsideOnFamilyLabel = (categoryLabel: string): string => t`Set aside on ${categoryLabel} assets`;

const UnresolvedMessage: FunctionComponent<{ coverage: AttackCoverage | undefined, setAside: boolean, categoryLabel: string }> = ({
  coverage,
  setAside,
  categoryLabel,
}) => {
  if (coverage !== undefined && coverage.totalAssetCount === 0) {
    return <Trans>No asset carries an applicable finding of this vulnerability in this scope.</Trans>;
  }
  if (!setAside) {
    return <Trans>No mapping source resolves this vulnerability to techniques.</Trans>;
  }
  return coverage === undefined
    ? <Trans>This vulnerability resolves to techniques, none of which runs on {categoryLabel} assets.</Trans>
    : <Trans>This vulnerability resolves to techniques, none of which runs on the families of these assets.</Trans>;
};

/**
 * A vulnerability resolves to its techniques from the flaw alone, so the ways in arrive carrying
 * every asset family at once. The ones this asset's family cannot carry are shown apart rather
 * than dropped: they are the steps of an attack that continues on another asset.
 */
export const AttackTechniquesCard: FunctionComponent<AttackTechniquesCardProps> = ({ techniques, categoryId, exposure, coverage }) => {
  const trpc = useTRPC();
  const { view, setView } = usePersistedView<TtpView>('finding-ttps', 'matrix', VIEWS);
  // The matrix opens folded onto this finding: the estate-wide view is one click away, but the
  // question the tab answers is which techniques this flaw brings.
  const [highlightedOnly, setHighlightedOnly] = useState(true);
  const [setAsideShown, setSetAsideShown] = useState(false);
  const { data: matrix } = useQuery(trpc.mitreAttack.getMatrix.queryOptions());
  const grouped = groupAttackRows(techniques?.rows ?? []);
  const setAside = grouped.flatMap((entry) => entry.setAside);
  const setAsideCount = setAside.length;
  const shownCount = grouped.reduce((total, entry) => total + entry.rows.length, 0);
  const categoryLabel = categoryId === undefined ? '' : getAssetCategoryLabel(categoryId);
  const isResolved = techniques !== null && techniques.state === 'resolved' && shownCount > 0;
  const tactics = matrix === undefined ? new Map<string, Array<string>>() : tacticNamesByTechnique(matrix);
  const tableKey = coverage === undefined ? 'finding-attack' : 'unique-finding-attack';

  const viewItems: Array<IconButtonGroupItem<TtpView>> = [
    { value: 'matrix', icon: <Columns3 className="h-4 w-4" />, tooltip: t`Matrix view` },
    { value: 'list', icon: <List className="h-4 w-4" />, tooltip: t`List view` },
  ];

  const totalAssetCount = coverage?.totalAssetCount ?? 0;
  const groupHeading = t`Group`;
  const assetsHeading = t`Assets`;
  const setAsideLabel = coverage === undefined ? setAsideOnFamilyLabel(categoryLabel) : t`Set aside on the families of these assets`;
  const highlighted: Array<HighlightedTechnique> = matrixTechniques(grouped).map((technique) => {
    const held = coverage?.byRow.get(attackRowKey(technique.row));
    return {
      id: technique.mitreTechniqueId,
      color: 'red',
      accent: technique.setAside ? undefined : ATTACK_GROUP_ACCENT[technique.group],
      outlined: technique.setAside,
      marker: coverageMarker(held, totalAssetCount),
      categoryLabel: [
        ...technique.groups.map((group) => `${groupHeading}: ${attackGroupLabel(group)}`),
        ...(technique.setAside ? [setAsideLabel] : []),
        ...(held === undefined ? [] : [`${assetsHeading}: ${assetShareLabel(held.assetCount, totalAssetCount)}`]),
      ].join(' · '),
    };
  });

  return (
    <DossierCard
      label={t`ATT&CK techniques`}
      headerAction={isResolved ? (
        <div className="flex items-center gap-2">
          <InfoTooltip label={t`What the groups are`}>
            <span>
              {coverage === undefined
                ? <Trans>Exploitation, primary impact and secondary impact follow each other in the attack: documented by analysts for this CVE, or, for the exploitation, read from where the flaw is reached on this asset.</Trans>
                : <Trans>Exploitation, primary impact and secondary impact follow each other in the attack: documented by analysts for this CVE, or, for the exploitation, read from where the flaw is reached on each asset, so a technique may hold on part of the assets only.</Trans>}
            </span>
            <span>
              <Trans>Made possible by the weakness: what any flaw of this weakness class allows once exploited, with no place of its own in the attack. The score counts it with the impacts.</Trans>
            </span>
            <span>
              <Trans>A technique states what the flaw allows, never that anyone did it here.</Trans>
            </span>
          </InfoTooltip>
          {view === 'matrix' && (
            <HighlightFilterToggle
              active={highlightedOnly}
              onToggle={() => setHighlightedOnly(!highlightedOnly)}
            />
          )}
          <IconButtonGroup items={viewItems} value={view} onChange={setView} />
        </div>
      ) : null}
    >
      {!isResolved ? (
        <div className="flex flex-wrap items-center gap-2">
          <Chip severity="neutral" label={setAside.length > 0 ? t`Not a vector here` : t`Unresolved`} />
          <span className="font-content-base text-content-base text-default-secondary">
            <UnresolvedMessage coverage={coverage} setAside={setAside.length > 0} categoryLabel={categoryLabel} />
          </span>
        </div>
      ) : view === 'matrix' ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 font-content-compact text-content-compact text-default-secondary">
            {grouped.map(({ group }) => (
              <li key={group} className="inline-flex items-center gap-1.5">
                <AttackGroupSwatch group={group} />
                {attackGroupLabel(group)}
              </li>
            ))}
            {setAside.length > 0 && (
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-[2px] border border-dashed border-current" />
                {coverage === undefined
                  ? <Trans>Set aside on {categoryLabel} assets</Trans>
                  : <Trans>Set aside on the families of these assets</Trans>}
              </li>
            )}
          </ul>
          <TtpMatrixView
            highlightedTechniques={highlighted}
            filterHighlightedOnly={highlightedOnly}
            expandHighlightedSubTechniques
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(({ group, rows }) => (
            <section key={group} className="flex flex-col" aria-label={attackGroupLabel(group)}>
              <div className="flex items-center gap-2.5 border-b pb-2" style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}>
                <AttackGroupSwatch group={group} />
                <span className="font-content-base text-content-base font-medium">{attackGroupLabel(group)}</span>
                <span className="font-content-compact text-content-compact text-default-secondary">{rows.length}</span>
              </div>
              {rows.length === 0 ? (
                <span className="py-3 font-content-compact text-content-compact text-default-secondary">
                  <Trans>None known for this vulnerability.</Trans>
                </span>
              ) : (
                <AttackTechniquesTable rows={rows} tactics={tactics} storageKey={`${tableKey}-${group}`} exposure={exposure} coverage={coverage} />
              )}
            </section>
          ))}
        </div>
      )}
      {setAside.length > 0 && (!isResolved || view === 'list') && (
        <div className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}>
          <button
            type="button"
            aria-expanded={setAsideShown}
            className="self-start font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary underline-offset-4 hover:underline"
            onClick={() => setSetAsideShown(!setAsideShown)}
          >
            {coverage === undefined
              ? (
                <Plural
                  value={setAsideCount}
                  one={`# set aside: not a vector on ${categoryLabel} assets`}
                  other={`# set aside: not a vector on ${categoryLabel} assets`}
                />
              )
              : (
                <Plural
                  value={setAsideCount}
                  one="# set aside: not a vector on the families of these assets"
                  other="# set aside: not a vector on the families of these assets"
                />
              )}
          </button>
          {setAsideShown && <AttackTechniquesTable rows={setAside} tactics={tactics} storageKey={`${tableKey}-set-aside`} exposure={exposure} coverage={coverage} />}
        </div>
      )}
    </DossierCard>
  );
};
