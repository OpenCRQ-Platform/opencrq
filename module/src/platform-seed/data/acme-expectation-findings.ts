import type { ExpectationType } from '../../modules/supporting-assets/constants';
import {
  TECHNIQUE_T1003,
  TECHNIQUE_T1055,
  TECHNIQUE_T1055_012,
  TECHNIQUE_T1059,
  TECHNIQUE_T1078,
  TECHNIQUE_T1110,
  TECHNIQUE_T1190,
  TECHNIQUE_T1505,
} from '../../modules/mitre-attack/data/mitre-techniques';
import { SupportingAsset_CoreBanking } from './ids';

export interface AcmeExpectationFindingSpec {
  assetId: string,
  techniqueId: string,
  expectationType: ExpectationType,
  securityPlatformType: string,
  sourceScenarioId: string,
  sourceScenarioName: string,
  sourceSimulationId: string,
  sourceInjectId: string,
  createdDaysAgo: number,
  dismissalDaysAfterCreation?: number,
}

interface HostRun {
  techniqueId: string,
  scenarioName: string,
  expectationType: ExpectationType,
  securityPlatformType: string,
  held: boolean,
  createdDaysAgo: number,
}

/** Several families and scenarios per technique, so a TTP cell reads ratios above one and its detail one row per family. */
const HOST_RUNS: Array<HostRun> = [
  ...[
    { securityPlatformType: 'NDR', held: true, createdDaysAgo: 14 },
    { securityPlatformType: 'NDR', held: true, createdDaysAgo: 9 },
    { securityPlatformType: 'NDR', held: false, createdDaysAgo: 7 },
    { securityPlatformType: 'EDR', held: false, createdDaysAgo: 14 },
    { securityPlatformType: 'EDR', held: false, createdDaysAgo: 7 },
    { securityPlatformType: 'XDR', held: true, createdDaysAgo: 20 },
  ].map((run) => ({ ...run, techniqueId: TECHNIQUE_T1190, scenarioName: 'Web exploitation simulation', expectationType: 'prevention' as const })),
  ...[
    { securityPlatformType: 'SIEM', held: true, createdDaysAgo: 14 },
    { securityPlatformType: 'SIEM', held: true, createdDaysAgo: 9 },
    { securityPlatformType: 'SIEM', held: false, createdDaysAgo: 7 },
    { securityPlatformType: 'EDR', held: true, createdDaysAgo: 14 },
    { securityPlatformType: 'EDR', held: false, createdDaysAgo: 7 },
  ].map((run) => ({ ...run, techniqueId: TECHNIQUE_T1190, scenarioName: 'Web exploitation simulation', expectationType: 'detection' as const })),
  ...[
    { expectationType: 'prevention' as const, securityPlatformType: 'ISPM', held: true, createdDaysAgo: 10 },
    { expectationType: 'prevention' as const, securityPlatformType: 'ISPM', held: false, createdDaysAgo: 5 },
    { expectationType: 'detection' as const, securityPlatformType: 'SIEM', held: true, createdDaysAgo: 10 },
    { expectationType: 'detection' as const, securityPlatformType: 'SIEM', held: true, createdDaysAgo: 5 },
  ].map((run) => ({ ...run, techniqueId: TECHNIQUE_T1110, scenarioName: 'Password spraying simulation' })),
  { techniqueId: TECHNIQUE_T1505, scenarioName: 'Web shell simulation', expectationType: 'detection', securityPlatformType: 'EDR', held: false, createdDaysAgo: 6 },
  // A technique family the EDR covers: its row reads the whole family, its sub-technique's row its own test.
  { techniqueId: TECHNIQUE_T1055, scenarioName: 'Process injection simulation', expectationType: 'prevention', securityPlatformType: 'EDR', held: true, createdDaysAgo: 8 },
  { techniqueId: TECHNIQUE_T1055, scenarioName: 'Process injection simulation', expectationType: 'prevention', securityPlatformType: 'EDR', held: false, createdDaysAgo: 4 },
  { techniqueId: TECHNIQUE_T1055_012, scenarioName: 'Process hollowing simulation', expectationType: 'prevention', securityPlatformType: 'EDR', held: false, createdDaysAgo: 4 },
  { techniqueId: TECHNIQUE_T1055, scenarioName: 'Process injection simulation', expectationType: 'detection', securityPlatformType: 'EDR', held: true, createdDaysAgo: 8 },
];

const hostRunSpec = (run: HostRun, index: number): AcmeExpectationFindingSpec => {
  const key = `openaev-cbs-${String(index + 1).padStart(3, '0')}`;
  return {
    assetId: SupportingAsset_CoreBanking,
    techniqueId: run.techniqueId,
    expectationType: run.expectationType,
    securityPlatformType: run.securityPlatformType,
    sourceScenarioId: `scenario-${key}`,
    sourceScenarioName: run.scenarioName,
    sourceSimulationId: `simulation-${key}`,
    sourceInjectId: `inject-${key}`,
    createdDaysAgo: run.createdDaysAgo,
    ...(run.held ? { dismissalDaysAfterCreation: 1 } : {}),
  };
};

/**
 * Every result sits on Core Banking, Acme's one host in OpenAEV's inventory: a connector files a test
 * on the endpoint its agent ran on, and the per-host reading counts hosts alone.
 */
export const ACME_EXPECTATION_FINDING_SPECS: Array<AcmeExpectationFindingSpec> = [
  {
    assetId: SupportingAsset_CoreBanking,
    techniqueId: TECHNIQUE_T1078,
    expectationType: 'detection',
    securityPlatformType: 'SIEM',
    sourceScenarioId: 'scenario-openaev-001',
    sourceScenarioName: 'Credential theft simulation',
    sourceSimulationId: 'simulation-openaev-001',
    sourceInjectId: 'inject-openaev-001',
    createdDaysAgo: 21,
  },
  {
    assetId: SupportingAsset_CoreBanking,
    techniqueId: TECHNIQUE_T1003,
    expectationType: 'prevention',
    securityPlatformType: 'EDR',
    sourceScenarioId: 'scenario-openaev-002',
    sourceScenarioName: 'Credential dumping simulation',
    sourceSimulationId: 'simulation-openaev-002',
    sourceInjectId: 'inject-openaev-002',
    createdDaysAgo: 18,
    dismissalDaysAfterCreation: 4,
  },
  {
    assetId: SupportingAsset_CoreBanking,
    techniqueId: TECHNIQUE_T1059,
    expectationType: 'detection',
    securityPlatformType: 'NDR',
    sourceScenarioId: 'scenario-openaev-003',
    sourceScenarioName: 'Command execution simulation',
    sourceSimulationId: 'simulation-openaev-003',
    sourceInjectId: 'inject-openaev-003',
    createdDaysAgo: 12,
  },
  ...HOST_RUNS.map(hostRunSpec),
];
