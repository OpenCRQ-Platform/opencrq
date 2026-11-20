import { Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetCategory, StrengthRung } from '@app/module/client';
import { STRENGTH_RUNGS } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import type { FindingScoreBreakdown } from '../../finding-score';
import { ControlIdPill } from '../../../components/shared';
import { coverageLabel } from '../../controls/capability/ui/coverage-label';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { StrengthCells } from '../../finding-score';
import { ControlGapPane } from './control-gap-pane';
import { DossierCard } from './dossier-card';
import { TechniqueTestRow } from './technique-test-row';

type DeclaredControl = NonNullable<FindingScoreBreakdown['columns']['mitigations']>[number];
type TechniqueTest = FindingScoreBreakdown['columns']['techniqueTests'][number];

/** What stands hardest first. Ordinal rungs sort on their vocabulary index, never alphabetically. */
const byStrength = (a: DeclaredControl, b: DeclaredControl): number =>
  STRENGTH_RUNGS.indexOf(b.strengthRung) - STRENGTH_RUNGS.indexOf(a.strengthRung);

/** Three cells, so L0 to L3 maps onto none to all filled. */
const STRENGTH_FILLED: Record<StrengthRung, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

/** The same three cells for the four coverage buckets, so `L3` is the only one that fills them. */
const COVERAGE_FILLED: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

const LevelReading: FunctionComponent<{
  label: string,
  filled: number,
  value: string,
  struckDown: boolean,
}> = ({ label, filled, value, struckDown }) => (
  <span className="flex items-center gap-2">
    <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
      {label}
    </span>
    <StrengthCells filled={filled} struckDown={struckDown} large />
    <span className="font-content-compact text-content-compact text-default-secondary">{value}</span>
  </span>
);

/**
 * One control standing on this finding: what it is, how strongly it is declared, and what a run
 * said about each technique it stands on.
 *
 * A control the engine credits nothing is marked rather than left out: it does stand there, and
 * the tab must not assert that it holds the score up where the score says it does not.
 */
const ControlCard: FunctionComponent<{
  control: DeclaredControl,
  tests: Array<TechniqueTest>,
  tenantId: string,
}> = ({ control, tests, tenantId }) => {
  const standsOnIds = new Set(control.standsOn.map((entry) => entry.mitreTechniqueId));
  const standsOn = tests.filter((test) => standsOnIds.has(test.mitreTechniqueId));
  return (
    <Paper elevation={1} className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ControlIdPill externalId={control.externalId} />
        <Link
          to="/$tenantId/{-$organizationId}/controls/$controlId/overview"
          params={{ tenantId, controlId: control.capabilityId }}
          className="min-w-0 flex-1 font-content-base text-content-base text-primary underline-offset-4 hover:underline"
        >
          {control.name}
        </Link>
        {!control.scoredHere && (
          <span className="font-content-compact text-content-compact text-default-secondary">
            <Trans>Earns the score nothing here</Trans>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <LevelReading
          label={t`Strength`}
          filled={STRENGTH_FILLED[control.strengthRung]}
          value={strengthLabel(control.strengthRung)}
          struckDown={control.knockedDownHere}
        />
        <LevelReading
          label={t`Coverage`}
          filled={COVERAGE_FILLED[control.coverageBucket] ?? 0}
          value={coverageLabel(control.coverageBucket)}
          struckDown={control.knockedDownHere}
        />
      </div>
      {standsOn.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
            <Trans>Stands on</Trans>
          </span>
          <ul
            className="flex flex-col divide-y"
            style={{ borderColor: 'var(--fds-border-elevation-subtle-soft)' }}
          >
            {standsOn.map((test) => (
              <TechniqueTestRow key={test.mitreTechniqueId} test={test} />
            ))}
          </ul>
        </div>
      )}
    </Paper>
  );
};

interface FindingControlsCardProps {
  mitigations: FindingScoreBreakdown['columns']['mitigations'],
  techniqueTests: Array<TechniqueTest>,
  uncoveredTechniqueExternalIds: Array<string>,
  categoryId: AssetCategory,
  tenantId: string,
}

/**
 * The controls standing on this finding, one card each and ungrouped.
 *
 * A control's test record is written by expectation runs against techniques, and a vulnerability
 * scan runs no control, so on a CVE finding no control is ever tested on its own. What a run said
 * is therefore per technique, inside each card, and never a property of the control.
 */
export const FindingControlsCard: FunctionComponent<FindingControlsCardProps> = ({
  mitigations,
  techniqueTests,
  uncoveredTechniqueExternalIds,
  categoryId,
  tenantId,
}) => {
  // The service already narrows the catalogue to controls with an edge on the exploitation
  // techniques; what is left to drop is what does not defend this asset's family.
  const controls = (mitigations ?? []).filter((control) => control.protectsAssetFamily).sort(byStrength);
  const uncovered = new Set(uncoveredTechniqueExternalIds);
  const gaps = techniqueTests.filter((test) => uncovered.has(test.externalId));

  return (
    <div className="flex flex-col gap-5">
      {controls.length === 0 ? (
        <DossierCard label={t`Controls standing on this finding`}>
          <span className="font-content-base text-content-base text-default-secondary">
            <Trans>
              No control protecting this asset's family stands against the techniques this finding
              puts in reach.
            </Trans>
          </span>
        </DossierCard>
      ) : (
        controls.map((control) => (
          <ControlCard
            key={control.capabilityId}
            control={control}
            tests={techniqueTests}
            tenantId={tenantId}
          />
        ))
      )}
      {gaps.length > 0 && (
        <ControlGapPane techniques={gaps} tenantId={tenantId} categoryId={categoryId} />
      )}
    </div>
  );
};
