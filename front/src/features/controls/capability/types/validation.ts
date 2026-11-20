import type { CapabilityFunction, ValidationState } from '@app/module/client';

/** One control x technique x function cell that carries at least one scenario vote. */
export type ValidationCell = {
  techniqueId: string,
  techniqueExternalId: string,
  function: CapabilityFunction,
  state: ValidationState,
  validatedVotes: number,
  totalVotes: number,
  /** Dates cross the wire as ISO strings: no tRPC transformer is configured. */
  latestProofAt: string | Date | null,
}

export type ValidationSummary = {
  validatedTechniques: number,
  contradictedTechniques: number,
  testedTechniques: number,
  /** Dates cross the wire as ISO strings: no tRPC transformer is configured. */
  latestProofAt: string | Date | null,
}

/** One (technique cell, scenario, platform family, function) group of simulation results, its assets counted. */
export type ValidationEvidenceLine = {
  techniqueId: string,
  techniqueExternalId: string,
  function: CapabilityFunction,
  scenarioId: string | null,
  scenarioName: string | null,
  simulationId: string | null,
  /** The raw integration key of the family, not a label: the readable name is resolved by the caller. */
  securityPlatformType: string,
  verdict: Exclude<ValidationState, 'never_tested'>,
  evaluatedAt: string | Date,
  assetCounts: { validated: number, contradicted: number },
}

export type {
  ControlTechniqueTestReading,
  CoveredTechniqueTestReading,
  TechniqueControlTestReading,
  TechniqueDeclaration,
  TechniqueTestOutcome,
  TechniqueTestReading,
  UncoveredTechniqueTestReading,
} from '@app/module/client';
