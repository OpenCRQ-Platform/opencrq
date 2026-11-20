import type {
  AssessmentEventType,
  CapabilityFunction,
  CoverageBucket,
  StrengthRung,
  TechniqueOverrideKind,
} from '../../modules/controls/capability/constants';
import {
  controlCapabilityAssessmentEvents,
  controlCapabilityAssessments,
  controlCapabilityScopeOverrides,
  controlCapabilityTechniqueOverrides,
} from '../../modules/controls/capability/schema';
import { controlCapabilitiesData } from '../../modules/controls/capability/data/capabilities.generated';
import { TECHNIQUE_T1557, TECHNIQUE_T1621 } from '../../modules/mitre-attack/data/mitre-techniques';
import { EDR_LAST_WEEK_DAYS_AGO, previousBuildLanding, RUNNING_PERIOD_MOVES, withinRunningPeriod } from '../data/budget-review-story';
import {
  capabilityAssessmentEventId,
  capabilityAssessmentId,
  capabilityScopeOverrideEventId,
  capabilityScopeOverrideId,
  capabilityTechniqueOverrideId,
  Organization_AcmeCorp,
  Tenant_Acme,
  User_Admin,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

interface AssessmentSpec {
  externalId: string,
  strength: StrengthRung,
  coverage: CoverageBucket,
  initial?: {
    strength: StrengthRung,
    coverage: CoverageBucket,
  },
  /**
   * The posture held until a change inside the last week, so the run history's default comparison
   * of the last seven days lists it.
   */
  lastWeek?: {
    strength: StrengthRung,
    coverage: CoverageBucket,
    daysAgo: number,
  },
  /** Undeployed until the previous fiscal year's build project, which the closed budget review funds. */
  deployedLastYear?: true,
}

const ACME_ASSESSMENT_SPECS: Array<AssessmentSpec> = [
  {
    externalId: 'EDR',
    strength: 'L2',
    coverage: 'L2',
    initial: { strength: 'L1', coverage: 'L1' },
    lastWeek: { strength: 'L3', coverage: 'L2', daysAgo: EDR_LAST_WEEK_DAYS_AGO },
  },
  { externalId: 'SIEM', strength: 'L2', coverage: 'L1', initial: { strength: 'L1', coverage: 'L1' } },
  { externalId: 'IDP', strength: 'L3', coverage: 'L2', initial: { strength: 'L2', coverage: 'L2' } },
  { externalId: 'PAM', strength: 'L1', coverage: 'L1' },
  { externalId: 'NGFW', strength: 'L2', coverage: 'L2' },
  {
    externalId: 'WAF',
    strength: 'L2',
    coverage: 'L2',
    initial: { strength: 'L1', coverage: 'L1' },
    lastWeek: { strength: 'L2', coverage: 'L1', daysAgo: 3 },
  },
  { externalId: 'IPS', strength: 'L1', coverage: 'L1', deployedLastYear: true },
  { externalId: 'DLP', strength: 'L1', coverage: 'L1', deployedLastYear: true },
  { externalId: 'KMS', strength: 'L2', coverage: 'L3' },
  { externalId: 'NDR', strength: 'L1', coverage: 'L1' },
  { externalId: 'SEG', strength: 'L2', coverage: 'L2' },
  { externalId: 'SWG', strength: 'L1', coverage: 'L1' },
  { externalId: 'DECEP', strength: 'L0', coverage: 'L0' },
  { externalId: 'SAT', strength: 'L2', coverage: 'L2' },
];

interface TechniqueOverrideSpec {
  externalId: string,
  techniqueId: string,
  kind: TechniqueOverrideKind,
  function: CapabilityFunction,
}

// One deliberate departure from the catalogue on each side, so both override states are
// visible in a manual walkthrough: ACME disputes that its identity platform prevents MFA request
// flooding, and claims it prevents the adversary-in-the-middle the catalogue leaves out.
const ACME_TECHNIQUE_OVERRIDE_SPECS: Array<TechniqueOverrideSpec> = [
  { externalId: 'IDP', techniqueId: TECHNIQUE_T1621, kind: 'removed', function: 'prevent' },
  { externalId: 'IDP', techniqueId: TECHNIQUE_T1557, kind: 'added', function: 'prevent' },
];

interface ScopeOverrideSpec {
  externalId: string,
  strength: StrengthRung | null,
  coverage: CoverageBucket | null,
}

// One risk scope declaring over the tenant, part-way through the running period, so a budget review of
// that scope reads a move the tenant's own history does not hold.
const ACME_CORP_SCOPE_OVERRIDE_SPECS: Array<ScopeOverrideSpec> = [
  { externalId: 'PAM', strength: 'L2', coverage: null },
];

// Over two years back, so the previous fiscal year the closed budget review covers opens on a logged posture.
const INITIAL_ASSESSMENT_DAYS_AGO = 760;

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

const changeType = (
  from: { strength: StrengthRung, coverage: CoverageBucket },
  to: { strength: StrengthRung, coverage: CoverageBucket },
): AssessmentEventType => {
  if (from.strength !== to.strength && from.coverage !== to.coverage) {
    return 'assessment_change';
  }
  return from.strength === to.strength ? 'coverage_change' : 'strength_change';
};

registerPlatformSeed('capability-assessments', async ({ db, now }) => {
  const capabilityIdByExternalId = new Map(controlCapabilitiesData.map((c) => [c.externalId, c.id]));

  const assessmentRows: Array<typeof controlCapabilityAssessments.$inferInsert> = [];
  const eventRows: Array<typeof controlCapabilityAssessmentEvents.$inferInsert> = [];

  ACME_ASSESSMENT_SPECS.forEach((spec, index) => {
    const capabilityId = capabilityIdByExternalId.get(spec.externalId);
    if (!capabilityId) {
      throw new Error(`[platform-seed] Control capability "${spec.externalId}" not found in the catalogue`);
    }

    assessmentRows.push({
      id: capabilityAssessmentId(index),
      capabilityId,
      tenantId: Tenant_Acme,
      strengthRung: spec.strength,
      coverageBucket: spec.coverage,
    });

    const undeployed = { strength: 'L0' as const, coverage: 'L0' as const };
    const initial = spec.initial ?? (spec.deployedLastYear ? undeployed : { strength: spec.strength, coverage: spec.coverage });
    eventRows.push({
      id: capabilityAssessmentEventId(index, 0),
      capabilityId,
      tenantId: Tenant_Acme,
      userId: User_Admin,
      type: 'assessment_set',
      oldStrength: null,
      newStrength: initial.strength,
      oldCoverage: null,
      newCoverage: initial.coverage,
      createdAt: daysAgo(now, INITIAL_ASSESSMENT_DAYS_AGO),
    });

    const upgraded = spec.lastWeek ?? { strength: spec.strength, coverage: spec.coverage };
    if (spec.initial) {
      eventRows.push({
        id: capabilityAssessmentEventId(index, 1),
        capabilityId,
        tenantId: Tenant_Acme,
        userId: User_Admin,
        type: changeType(spec.initial, upgraded),
        oldStrength: spec.initial.strength,
        newStrength: upgraded.strength,
        oldCoverage: spec.initial.coverage,
        newCoverage: upgraded.coverage,
        createdAt: withinRunningPeriod(now, spec.externalId === 'EDR' ? RUNNING_PERIOD_MOVES.edr : RUNNING_PERIOD_MOVES.controls),
      });
    }

    if (spec.lastWeek) {
      eventRows.push({
        id: capabilityAssessmentEventId(index, 2),
        capabilityId,
        tenantId: Tenant_Acme,
        userId: User_Admin,
        type: changeType(spec.lastWeek, spec),
        oldStrength: spec.lastWeek.strength,
        newStrength: spec.strength,
        oldCoverage: spec.lastWeek.coverage,
        newCoverage: spec.coverage,
        createdAt: daysAgo(now, spec.lastWeek.daysAgo),
      });
    }

    if (spec.deployedLastYear) {
      eventRows.push({
        id: capabilityAssessmentEventId(index, 1),
        capabilityId,
        tenantId: Tenant_Acme,
        userId: User_Admin,
        type: changeType(undeployed, spec),
        oldStrength: undeployed.strength,
        newStrength: spec.strength,
        oldCoverage: undeployed.coverage,
        newCoverage: spec.coverage,
        createdAt: previousBuildLanding(now),
      });
    }
  });

  await db.insert(controlCapabilityAssessments).values(assessmentRows);
  await db.insert(controlCapabilityAssessmentEvents).values(eventRows);

  const overrideRows: Array<typeof controlCapabilityTechniqueOverrides.$inferInsert> =
    ACME_TECHNIQUE_OVERRIDE_SPECS.map((spec, index) => {
      const capabilityId = capabilityIdByExternalId.get(spec.externalId);
      if (!capabilityId) {
        throw new Error(`[platform-seed] Control capability "${spec.externalId}" not found in the catalogue`);
      }
      return {
        id: capabilityTechniqueOverrideId(index),
        tenantId: Tenant_Acme,
        capabilityId,
        mitreTechniqueId: spec.techniqueId,
        kind: spec.kind,
        function: spec.function,
      };
    });

  await db.insert(controlCapabilityTechniqueOverrides).values(overrideRows);

  const declaredAt = withinRunningPeriod(now, RUNNING_PERIOD_MOVES.scopePam);
  for (const [index, spec] of ACME_CORP_SCOPE_OVERRIDE_SPECS.entries()) {
    const capabilityId = capabilityIdByExternalId.get(spec.externalId);
    if (!capabilityId) {
      throw new Error(`[platform-seed] Control capability "${spec.externalId}" not found in the catalogue`);
    }
    await db.insert(controlCapabilityScopeOverrides).values({
      id: capabilityScopeOverrideId(index),
      organizationId: Organization_AcmeCorp,
      capabilityId,
      strengthRung: spec.strength,
      coverageBucket: spec.coverage,
      comment: 'The payment platform runs its own privileged access vault.',
      updatedAt: declaredAt,
    });
    await db.insert(controlCapabilityAssessmentEvents).values({
      id: capabilityScopeOverrideEventId(index),
      capabilityId,
      tenantId: Tenant_Acme,
      organizationId: Organization_AcmeCorp,
      userId: User_Admin,
      type: 'assessment_set',
      oldStrength: null,
      newStrength: spec.strength,
      oldCoverage: null,
      newCoverage: spec.coverage,
      createdAt: declaredAt,
    });
  }
});
