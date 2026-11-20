import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import { Calculator } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';

interface ThreatQuantifyActionProps {
  /** The threat's best matching attack outcome, the one its risk scenario should quantify. */
  attackOutcomeId: string,
  outcomeName: string,
}

/**
 * The cross-module action a threat page offers: "Quantify risk" opens the risk scenario wizard with
 * the threat's best matching outcome prefilled, so a threat seen in OpenCTI or simulated in OpenAEV
 * becomes a quantified scenario in two clicks. Shown only when an outcome matches.
 */
export const ThreatQuantifyAction: FunctionComponent<ThreatQuantifyActionProps> = ({ attackOutcomeId, outcomeName }) => (
  <TooltipHintProvider>
    <TooltipHint hint={t`Create a risk scenario for ${outcomeName}`}>
      <Button asChild priority="secondary">
        <Link
          from="/$tenantId/{-$organizationId}"
          to="/$tenantId/{-$organizationId}/risk-scenarios/create"
          search={{ attackOutcomeId }}
        >
          <Calculator className="h-4 w-4 shrink-0" aria-hidden />
          {t`Quantify risk`}
        </Link>
      </Button>
    </TooltipHint>
  </TooltipHintProvider>
);
