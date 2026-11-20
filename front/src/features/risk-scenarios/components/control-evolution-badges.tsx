import type { FunctionComponent } from 'react';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { ArrowRight } from 'lucide-react';
import type { CoverageBucket, CrqControlWhatIfDimension, StrengthRung } from '@app/module/client';
import { StrengthBadge } from '../../controls/capability/ui/strength-badge';
import { CoverageBadge } from '../../controls/capability/ui/coverage-badge';

interface ControlEvolutionBadgesProps {
  dimension: CrqControlWhatIfDimension,
  currentStrength: StrengthRung,
  upgradedStrength: StrengthRung,
  currentCoverage: CoverageBucket,
  upgradedCoverage: CoverageBucket,
}

/**
 * Renders a single isolated what-if suggestion:
 * - `strength` / `coverage`: the one axis it steps, as `current -> upgraded`;
 * - `deploy`: the undeployed anchor state (`Not deployed`) stepped to the target state, where no
 *   single axis alone yields any gain, so the row never reads as two independent axis changes.
 */
export const ControlEvolutionBadges: FunctionComponent<ControlEvolutionBadgesProps> = ({
  dimension,
  currentStrength,
  upgradedStrength,
  currentCoverage,
  upgradedCoverage,
}) => {
  if (dimension === 'deploy') {
    return (
      <div className="flex items-center gap-x-2">
        <Chip label={t`Not deployed`} />
        <ArrowRight className="text-muted-foreground h-3 w-3" />
        <StrengthBadge value={upgradedStrength} />
        <CoverageBadge value={upgradedCoverage} />
      </div>
    );
  }

  if (dimension === 'coverage') {
    return (
      <div className="flex items-center gap-x-2">
        <CoverageBadge value={currentCoverage} />
        <ArrowRight className="text-muted-foreground h-3 w-3" />
        <CoverageBadge value={upgradedCoverage} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-x-2">
      <StrengthBadge value={currentStrength} />
      <ArrowRight className="text-muted-foreground h-3 w-3" />
      <StrengthBadge value={upgradedStrength} />
    </div>
  );
};
