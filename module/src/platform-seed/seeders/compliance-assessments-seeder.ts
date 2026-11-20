import type { SeedContext } from '../platform-seed-registry';
import { BUNDLED_CATALOGS, NIST_CSF_2_0_KEY } from '../../modules/compliance-assessments/data/compliance-frameworks-seed';
import { complianceAssessmentAnswers, complianceAssessments } from '../../modules/compliance-assessments/schema';
import { createPrng, deriveSeed } from '../../modules/crq-indicators/engine/prng';
import {
  complianceAnswerId,
  ComplianceAssessment_CsfQ2,
  ComplianceAssessment_CsfQ4,
  Tenant_Acme,
  User_Alice,
  User_Bob,
  User_Charlie,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

const DAY_MS = 86_400_000;
const OWNERS = [User_Alice, User_Bob, User_Charlie];

/** Skewed towards L1 to L3, as a self-assessment of an organisation mid-way usually reads. */
const LEVEL_WEIGHTS = [0.08, 0.22, 0.3, 0.25, 0.11, 0.04];

const drawLevel = (prng: () => number): number => {
  let draw = prng();
  for (const [level, weight] of LEVEL_WEIGHTS.entries()) {
    draw -= weight;
    if (draw < 0) {
      return level;
    }
  }
  return LEVEL_WEIGHTS.length - 1;
};

interface AssessmentSpec {
  readonly id: string,
  readonly name: string,
  readonly published: boolean,
  readonly createdDaysAgo: number,
  /** Share of the requirements answered, the not applicable included. */
  readonly answeredShare: number,
  readonly createdById: string,
}

const SPECS: ReadonlyArray<AssessmentSpec> = [
  { id: ComplianceAssessment_CsfQ2, name: 'NIST CSF 2.0 · T2 2026', published: true, createdDaysAgo: 120, answeredShare: 1, createdById: User_Alice },
  { id: ComplianceAssessment_CsfQ4, name: 'NIST CSF 2.0 · T4 2026', published: false, createdDaysAgo: 2, answeredShare: 0.36, createdById: User_Bob },
];

registerPlatformSeed('compliance-assessments', async ({ db, now }: SeedContext) => {
  const catalog = BUNDLED_CATALOGS.find(({ framework }) => framework.key === NIST_CSF_2_0_KEY);
  if (!catalog) {
    throw new Error('[platform-seed] the NIST CSF 2.0 catalogue is not bundled');
  }
  const requirements = catalog.nodes.filter((node) => node.isRequirement);

  for (const [specIndex, spec] of SPECS.entries()) {
    const prng = createPrng(deriveSeed(spec.id, 'platform-seed-compliance-assessment'));
    const createdAt = new Date(now.getTime() - spec.createdDaysAgo * DAY_MS);
    const publishedAt = spec.published ? new Date(now.getTime() - (spec.createdDaysAgo - 30) * DAY_MS) : null;

    await db.insert(complianceAssessments).values({
      id: spec.id,
      tenantId: Tenant_Acme,
      frameworkId: catalog.framework.id,
      name: spec.name,
      status: spec.published ? 'published' : 'draft',
      createdById: spec.createdById,
      publishedAt,
      publishedById: spec.published ? User_Alice : null,
      createdAt,
      updatedAt: publishedAt ?? new Date(now.getTime() - DAY_MS),
    });

    const answered = requirements.filter(() => prng() < spec.answeredShare);
    await db.insert(complianceAssessmentAnswers).values(answered.map((requirement, index) => {
      const notApplicable = prng() < 0.04;
      return {
        id: complianceAnswerId(specIndex, index),
        tenantId: Tenant_Acme,
        assessmentId: spec.id,
        requirementId: requirement.id,
        ownerId: OWNERS[Math.floor(prng() * OWNERS.length)] ?? null,
        dueDate: new Date(createdAt.getTime() + (30 + Math.floor(prng() * 60)) * DAY_MS).toISOString().slice(0, 10),
        level: notApplicable ? null : drawLevel(prng),
        notApplicable,
        updatedById: spec.createdById,
        updatedAt: publishedAt ?? new Date(now.getTime() - DAY_MS),
      };
    }));
  }
});
