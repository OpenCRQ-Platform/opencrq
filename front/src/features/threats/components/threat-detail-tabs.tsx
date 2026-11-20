import type { ThreatEntityType } from '@app/module/client';
import { Trans } from '@lingui/react/macro';
import { Shield } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { ThreatOrigin } from './threat-origin';
import type { LastObservedViaThreat } from './last-observed-via';
import { matchedTechniques } from './threat-hero-utils';
import { ThreatTechniquesView } from './threat-techniques-view';

interface ThreatAnalysis {
  id: string,
  stixId: string,
  entityType: ThreatEntityType,
  name: string,
  description: string | null,
  mitreGroupId: string | null,
  confidence: number | null,
  stixCreated: string | null,
  firstSeen: string | null,
  lastSeen: string | null,
  primaryMotivation: string | null,
  resourceLevel: string | null,
  sophistication: string | null,
  objective: string | null,
}

interface ThreatReference {
  id: string,
  name: string,
  entityType: ThreatEntityType,
}

// The relationship's id on the tenant's own OpenCTI, null unless the actor came through the
// connector: nothing else guarantees the id resolves there.
interface Linkable {
  openctiStixRelationId: string | null,
}

interface ThreatLocation extends Linkable {
  id: string,
  stixId: string,
  name: string,
  country: string | null,
  countryId: string | null,
  countryIsoAlpha2: string | null,
  matchesOrganization: boolean,
}

interface ThreatSector extends Linkable {
  id: string,
  stixId: string,
  name: string,
  sectorId: string | null,
  matchesOrganization: boolean,
}

interface ThreatCve extends Linkable {
  id: string,
  stixId: string,
  cveId: string,
}

interface ThreatTactic {
  id: string,
  externalId: string,
  name: string,
}

interface ThreatTechnique extends Linkable {
  id: string,
  stixId: string,
  name: string,
  mitreExternalId: string,
  citedExternalIds: Array<string>,
  mitreTechniqueId: string | null,
  mitreTechniqueUrl: string | null,
  tactics: Array<ThreatTactic>,
}

interface StatedValue {
  value: string,
}

export interface ThreatAnalysisDetailData {
  analysis: ThreatAnalysis,
  attributedTo: Array<ThreatReference>,
  attributedFrom: Array<ThreatReference>,
  threatActorTypes: Array<string>,
  roles: Array<string>,
  origin: ThreatOrigin,
  activity: {
    activityScore: number | null,
    lastObservedAt: Date | string | null,
    lastObservedVia: LastObservedViaThreat | null,
  },
  locations: Array<ThreatLocation>,
  sectors: Array<ThreatSector>,
  cves: Array<ThreatCve>,
  techniques: Array<ThreatTechnique>,
  declaredIntent: {
    primaryMotivations: Array<StatedValue>,
    secondaryMotivations: Array<StatedValue>,
    goals: Array<StatedValue>,
  },
}

interface TabProps {
  detail: ThreatAnalysisDetailData,
}

export const EmptyRow: FunctionComponent<{ children: string }> = ({ children }) => (
  <p className="txt-sub-content text-muted-foreground">{children}</p>
);

const NoRecognizedTechniques: FunctionComponent = () => (
  <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
    <Shield className="h-12 w-12 text-muted-foreground" />
    <div className="text-center">
      <p className="txt-subtitle2">
        <Trans>No ATT&CK techniques recognized</Trans>
      </p>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>None of the techniques used by this threat matched the MITRE ATT&CK catalog.</Trans>
      </p>
    </div>
  </div>
);

export const ThreatTtpsTab: FunctionComponent<TabProps> = ({ detail }) => {
  const techniques = matchedTechniques(detail.techniques).map((technique) => ({
    id: technique.mitreTechniqueId,
    externalId: technique.mitreExternalId,
    name: technique.name,
    citedExternalIds: technique.citedExternalIds,
    tactics: technique.tactics,
    openctiStixRelationId: technique.openctiStixRelationId,
  }));

  return techniques.length === 0 ? <NoRecognizedTechniques /> : <ThreatTechniquesView threatId={detail.analysis.id} techniques={techniques} />;
};
