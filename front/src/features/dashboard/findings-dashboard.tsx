import type { FunctionComponent } from 'react';
import { SlickEstateWidget } from './widgets/slick-estate-widget';
import { SlickExposedAssetsWidget } from './widgets/slick-exposed-assets-widget';
import { SlickLeverageWidget } from './widgets/slick-leverage-widget';
import { SlickTechniqueWidget } from './widgets/slick-technique-widget';
import { SlickTriageWidget } from './widgets/slick-triage-widget';
import { RemediationPaceWidget } from './widgets/remediation-pace-widget';

interface FindingsDashboardProps {
  organizationId?: string,
}

/**
 * Findings and assets, read as a queue rather than as a scoreboard.
 *
 * Reading order is a working session, top-down: are we keeping up (remediation pace), what is in
 * front of us (the queue), what is cheapest to clear (patch leverage), where it is piling up (per
 * asset), how much of the estate it reaches (coverage), and what it lets an attacker do (ATT&CK).
 * the last being the hand-off to the risk dashboard.
 *
 * There is no counters strip. Every figure it carried (active, critical, KEV, impacted assets)
 * was a raw total with no denominator and no next step; the ones worth keeping now appear where
 * they mean something, against the population they came from.

 */
export const FindingsDashboard: FunctionComponent<FindingsDashboardProps> = ({ organizationId }) => (
  <div className="flex flex-col gap-5">
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <RemediationPaceWidget organizationId={organizationId} />
      </div>
      <div className="lg:col-span-4">
        <SlickTriageWidget organizationId={organizationId} />
      </div>
    </div>

    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="lg:col-span-6">
        <SlickLeverageWidget organizationId={organizationId} />
      </div>
      <div className="lg:col-span-6">
        <SlickExposedAssetsWidget organizationId={organizationId} />
      </div>
    </div>

    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="lg:col-span-6">
        <SlickEstateWidget organizationId={organizationId} />
      </div>
      <div className="lg:col-span-6">
        <SlickTechniqueWidget organizationId={organizationId} />
      </div>
    </div>
  </div>
);
