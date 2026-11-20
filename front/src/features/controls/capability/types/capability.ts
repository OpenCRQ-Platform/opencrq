import type {
  AssessmentAxis,
  AssessmentEventType,
  AssessmentMode,
  AssetCategory,
  CapabilityFunction,
  ControlDomain,
  CoverageBasis,
  CoverageBucket,
  EffectiveEdgeSource,
  EffectiveEdgeState,
  PostureSource,
  StrengthRung,
} from '@app/module/client';

export type CapabilityAssessment = {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  strengthMode: AssessmentMode,
  coverageMode: AssessmentMode,
  coverageBasis: CoverageBasis,
  comment: string | null,
}

export type CapabilityAssessedBy = {
  userId: string,
  name: string | null,
}

export type Capability = {
  id: string,
  externalId: string,
  name: string,
  description: string,
  domain: ControlDomain,
  position: number,
  assessment: CapabilityAssessment | null,
  lastAssessedAt: string | Date | null,
  lastAssessedBy: CapabilityAssessedBy | null,
  lastAssessedConnector: string | null,
}

export type PostureSources = {
  strengthSource: PostureSource,
  coverageSource: PostureSource,
}

export type ListedCapability = Capability & PostureSources

/** The tenant pair is null when the tenant never assessed the control. */
export type ResolvedPosture = PostureSources & {
  capabilityId: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  comment: string | null,
  tenantStrengthRung: StrengthRung | null,
  tenantCoverageBucket: CoverageBucket | null,
  scopeDeclaredAt: string | Date | null,
}

export type CapabilityRung = {
  rung: string,
  label: string,
}

// An ATT&CK tactic the covered technique belongs to. `order` is the canonical kill-chain position.
export type CapabilityEdgeTactic = {
  externalId: string,
  name: string,
  order: number,
}

// One line of the control's effective coverage: a catalogue recommendation, a technique the
// tenant added, or a recommendation the tenant removed (kept visible, flagged).
export type CapabilityEdge = {
  techniqueId: string,
  techniqueExternalId: string,
  techniqueName: string,
  function: CapabilityFunction,
  source: EffectiveEdgeSource,
  state: EffectiveEdgeState,
  tactics: Array<CapabilityEdgeTactic>,
}

// One control naming a technique, read from the technique's side. `inheritedFrom` is the parent
// technique carrying the edge, which is the grain the engine scores for a sub-technique.
export type TechniqueCapability = {
  id: string,
  externalId: string,
  name: string,
  function: CapabilityFunction,
  source: EffectiveEdgeSource,
  state: EffectiveEdgeState,
  assessment: CapabilityAssessment | null,
  inheritedFrom: { id: string, externalId: string, name: string } | null,
}

export type SecurityPlatformFamily = {
  id: string,
  name: string,
  platformTypeKey: string,
}

export type CapabilityCrosswalk = {
  framework: string,
  externalId: string,
}

export type CapabilityRiskScenario = {
  id: string,
  name: string,
  organizationId: string,
  organizationName: string,
  sharedTtpCount: number,
  mixturePending: boolean,
}

/** What fed a derived axis: `drata`, or a framework key with its title. */
export type CapabilityAssessmentSource = {
  axis: AssessmentAxis,
  source: string,
  frameworkTitle: string | null,
}

export type CapabilityDetail = Capability & {
  lastDerivedAt: string | Date | null,
  lastDerivedBy: CapabilityAssessedBy | null,
  assessmentSources: Array<CapabilityAssessmentSource>,
  rungs: Array<CapabilityRung>,
  edges: Array<CapabilityEdge>,
  crosswalk: Array<CapabilityCrosswalk>,
  securityPlatformFamilies: Array<SecurityPlatformFamily>,
  protectedFamilies: Array<AssetCategory>,
}

export type CapabilityEvent = {
  id: string,
  capabilityId: string,
  tenantId: string,
  /** The level the line speaks for; null is the tenant declaration. */
  organizationId: string | null,
  userId: string | null,
  connector: string | null,
  type: AssessmentEventType,
  oldStrength: StrengthRung | null,
  newStrength: StrengthRung | null,
  oldCoverage: CoverageBucket | null,
  newCoverage: CoverageBucket | null,
  /** The mode the event switched that axis to; null when it left the axis's mode alone. */
  strengthMode: AssessmentMode | null,
  coverageMode: AssessmentMode | null,
  comment: string | null,
  createdAt: string | Date,
  userName: string | null,
  sources: Array<CapabilityEventSource>,
}

/** The assessment name is the one it had when the event was recorded. */
export type CapabilityEventSource = CapabilityAssessmentSource & {
  complianceAssessmentId: string | null,
  complianceAssessmentName: string | null,
}
