import type { AssetCriticality, CrqRunProfile, EventOrigin, ParsedThreatInput } from '@app/module';
import { AttackOutcome_Ransomware, BusinessValueCategory_PersonalData, controlCapabilities, cve, deriveSeedId, LossDriver_ForensicsIncidentManagement, LossDriver_LostMarginFromDowntime, organizations, originUserId, PRICE_RUN_PROFILE, supportingAssets } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { TestServices } from '../setup/test-context';
import { db } from '../setup/db';
import { recomputeAttackOutcomeMixtures } from './attack-outcome-mixtures';
import { DESCRIPTION_BY_OUTCOME, MALWARE_BY_OUTCOME, RANSOMWARE_DESCRIPTION } from './threat-analyses-fixtures';

export const buildActor = (
  slug: string,
  name: string,
  techniqueExternalIds: ReadonlyArray<string>,
  cveExternalIds: ReadonlyArray<string> = [],
  description: string = RANSOMWARE_DESCRIPTION,
  malware: ParsedThreatInput['malware'] = [],
): ParsedThreatInput => ({
  threat: {
    stixId: `intrusion-set--${slug}`,
    entityType: 'intrusion-set',
    name,
    // The outcome counter selects a threat from what its record says it does: the description must
    // name the activity of the scenario's outcome for the actor to weigh on it.
    description,
    mitreGroupId: null,
    confidence: null,
    stixCreated: null,
    firstSeen: null,
    lastSeen: null,
    primaryMotivation: null,
    resourceLevel: null,
    sophistication: null,
    objective: null,
    labels: [slug === 'volt' ? 'state-sponsored' : 'ransomware'],
  },
  malware,
  aliases: [],
  secondaryMotivations: [],
  goals: [],
  threatActorTypes: [],
  roles: [],
  attributions: [],
  locations: [],
  sectors: [],
  cves: cveExternalIds.map((cveId, index) => ({
    stixId: `vulnerability--${slug}-${index}`,
    stixRelationId: `relationship--${slug}-cve-${index}`,
    cveId,
    producerStixId: 'identity--test-producer',
    producerName: 'Test Producer',
    isInferred: false,
    relCreated: new Date(),
    relStartTime: null,
    relStopTime: null,
    relModified: null,
    relConfidence: 80,
  })),
  techniques: techniqueExternalIds.map((mitreExternalId, index) => ({
    stixId: `attack-pattern--${slug}-${index}`,
    stixRelationId: `relationship--${slug}-${index}`,
    name: `Technique ${mitreExternalId}`,
    mitreExternalId,
    producerStixId: 'identity--test-producer',
    producerName: 'Test Producer',
    isInferred: false,
    relCreated: new Date(),
    relStartTime: null,
    relStopTime: null,
    relModified: null,
    relConfidence: 80,
  })),
});

export interface AttackRunScenario {
  organizationId: string,
  primaryAssetId: string,
  riskScenarioId: string,
  attackOutcomeId: string,
  /** Asset ids by the name the estate gave them: `Web server 1`. */
  assetIdByName: ReadonlyMap<string, string>,
  /** Finding ids by `<cveId>@<asset name>`, for the findings the `cves` option attached. */
  findingIdByKey: ReadonlyMap<string, string>,
}

/** Assets added to the default estate, named `<name> <index>` from 1. */
export interface AttackRunScenarioAssets {
  name: string,
  categoryId: 'host' | 'network_device' | 'identity',
  subcategoryId?: 'user_account',
  exposure: 'internet_facing' | 'internal' | 'unknown',
  criticality: AssetCriticality,
  count: number,
}

/** A CVE with the assets carrying it; the recompute then writes its entry openings. */
export interface AttackRunScenarioCve {
  cveId: string,
  vector: string,
  epss: number,
  /** Listed by CISA: stamps `kevUpdatedAt`. */
  kev?: boolean,
  /** Asset names of the estate, `Web server 1`. */
  onAssets: ReadonlyArray<string>,
}

export const LOG4SHELL: Omit<AttackRunScenarioCve, 'onAssets'> = {
  cveId: 'CVE-2021-44228',
  vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
  epss: 0.976,
  kev: true,
};

export const MINOR_FLAW: Omit<AttackRunScenarioCve, 'onAssets'> = {
  cveId: 'CVE-2099-0001',
  vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
  epss: 0.05,
};

/**
 * Two internet-facing servers, one carrying a CISA-listed flaw and the other a minor one. The
 * default estate exposes nothing, so a run on it prices the unknown flaw floor alone: a test that
 * needs a run to spread across worlds starts from this one.
 */
export const EXPOSED_ESTATE: Pick<AttackRunScenarioOptions, 'assets' | 'cves'> = {
  assets: [{ name: 'Web server', categoryId: 'host', exposure: 'internet_facing', criticality: 'medium', count: 2 }],
  cves: [
    { ...LOG4SHELL, onAssets: ['Web server 1'] },
    { ...MINOR_FLAW, onAssets: ['Web server 2'] },
  ],
};

/** A flaw the run leaves unpriced for lack of a signal; a CISA listing later gives it one. */
export const LATER_LISTED_FLAW: Omit<AttackRunScenarioCve, 'onAssets'> = { ...MINOR_FLAW, cveId: 'CVE-2099-0002' };

/** CISA-listed, on an asset whose exposure nobody declared: the run prices it only if the tenant counts `unknown` as internet-facing. */
export const UNKNOWN_EXPOSURE_FLAW: Omit<AttackRunScenarioCve, 'onAssets'> = { ...LOG4SHELL, cveId: 'CVE-2099-0003' };

/** CISA-listed, on an internal asset and on an internet-facing one whose finding a test dismisses. */
export const DISMISSED_FLAW: Omit<AttackRunScenarioCve, 'onAssets'> = { ...LOG4SHELL, cveId: 'CVE-2099-0004' };

/** {@link EXPOSED_ESTATE} plus the assets and flaws that put each branch of the pricing condition to the test. */
export const PRICING_CONDITION_ESTATE: Pick<AttackRunScenarioOptions, 'assets' | 'cves'> = {
  assets: [
    ...EXPOSED_ESTATE.assets!,
    { name: 'Unknown server', categoryId: 'host', exposure: 'unknown', criticality: 'medium', count: 1 },
  ],
  cves: [
    ...EXPOSED_ESTATE.cves!,
    { ...LATER_LISTED_FLAW, onAssets: ['Web server 2'] },
    { ...UNKNOWN_EXPOSURE_FLAW, onAssets: ['Unknown server 1'] },
    { ...DISMISSED_FLAW, onAssets: ['Web server 2', 'Crown jewel 1'] },
  ],
};

export interface AttackRunScenarioOptions {
  /** Declare the manual TEF triplet. With the loss drivers, the run carries a price. */
  tef?: boolean,
  /** Declare the two loss drivers, so the run carries a loss magnitude. */
  losses?: boolean,
  /** Declare half the catalogue at L2 / L2; a naked estate otherwise. */
  posture?: boolean,
  /** Assets added to the estate, which has nothing exposed by default. */
  assets?: ReadonlyArray<AttackRunScenarioAssets>,
  /**
   * CVEs attached as findings to assets of the estate, with the finding scores recomputed once they
   * are written: that is what fills `entry_openings`. A later change to a finding or to a tenant
   * setting needs {@link recomputeFindingScores} again.
   */
  cves?: ReadonlyArray<AttackRunScenarioCve>,
  /** CVE ids the two admitted actors cite, whether or not any asset carries them. */
  actorCves?: ReadonlyArray<string>,
  /** The catalogue id of the scenario's attack outcome. Ransomware when absent. */
  attackOutcome?: string,
  /** Techniques no admitted actor documents, whatever the outcome's curated set holds. */
  actorTechniquesOmitted?: ReadonlyArray<string>,
}

/**
 * A ransomware scenario the attack run engine can run end to end: an uneven estate across three
 * families, two admitted actors whose observed repertoires span the whole walk, an organisation
 * with a declared reaction time, and, by default, a price.
 *
 * The estate is deliberately uneven, a handful of crown jewels against a wide low-criticality
 * fleet, because that is where a mistake in the group weighting surfaces.
 */
export const seedAttackRunScenario = async (
  services: TestServices,
  adminOrigin: EventOrigin,
  tenantId: string,
  options: AttackRunScenarioOptions = {},
): Promise<AttackRunScenario> => {
  const scoped = services.withOrigin(adminOrigin);
  const organizationId = uuidv7();
  await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Acme Industries' }]);
  // The reaction time has no write path of its own yet, so the fixture declares it the way a
  // connector eventually will.
  await db.update(organizations)
    .set({ reactionTimeMin: 1, reactionTimeLikely: 12, reactionTimeMax: 72 })
    .where(eq(organizations.id, organizationId));

  const primaryAssetId = uuidv7();
  await scoped.primaryAssets.createPrimaryAsset({
    id: primaryAssetId,
    organizationId,
    name: 'Customer records',
    description: null,
    ownerId: null,
    businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_PersonalData)],
  });

  const attackOutcomeId = deriveSeedId(tenantId, options.attackOutcome ?? AttackOutcome_Ransomware);
  const riskScenarioId = uuidv7();
  await scoped.riskScenarios.createRiskScenario({
    id: riskScenarioId,
    organizationId,
    name: 'Ransomware on the customer estate',
    description: null,
    attackOutcomeId,
    primaryAssetIds: [primaryAssetId],
  });
  // The column on its own, not `crqIndicators.setTefMode`, which hands the auto estimate over on
  // the way out: this fixture states its own frequency below, or none at all for `tef: false`.
  await scoped.riskScenarios.setTefMode(riskScenarioId, 'manual');

  const estate: Array<AttackRunScenarioAssets> = [
    { name: 'Crown jewel', categoryId: 'host', exposure: 'internal', criticality: 'high', count: 4 },
    { name: 'Workstation', categoryId: 'host', exposure: 'internal', criticality: 'low', count: 40 },
    { name: 'Edge switch', categoryId: 'network_device', exposure: 'internal', criticality: 'medium', count: 6 },
    { name: 'Service account', categoryId: 'identity', exposure: 'unknown', criticality: 'medium', count: 12 },
    { name: 'Employee', categoryId: 'identity', subcategoryId: 'user_account', exposure: 'unknown', criticality: 'low', count: 40 },
    ...(options.assets ?? []),
  ];
  const crownJewelIds: Array<string> = [];
  const assetIdByName = new Map<string, string>();
  for (const { name, categoryId, subcategoryId, exposure, criticality, count } of estate) {
    for (let index = 0; index < count; index += 1) {
      const id = uuidv7();
      const assetName = `${name} ${index + 1}`;
      await db.insert(supportingAssets).values({
        id,
        tenantId,
        name: assetName,
        exposure,
        categoryId,
        subcategoryId,
        criticality,
      });
      assetIdByName.set(assetName, id);
      if (name === 'Crown jewel') {
        crownJewelIds.push(id);
      }
    }
  }
  for (const supportingAssetId of crownJewelIds) {
    await scoped.assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId, primaryAssetId }]);
  }

  // Before the actors exist the stored mixture is empty and the outcome answers its curated set.
  await recomputeAttackOutcomeMixtures(services, tenantId);
  const outcome = await scoped.attackOutcomes.getMitreTechniquesForOutcome(attackOutcomeId, { organizationId, tenantId });
  // The engine reads the actors' whole observed repertoires, not the outcome's curated set: the
  // outcome fixes the terminal tactic and the walk decides what plays where, so the repertoire
  // has to span the walk for any obstacle before the objective to be playable.
  const curated = outcome.techniques.filter((technique) => !technique.revoked).map((technique) => technique.externalId);
  const walked = [
    'T1566', 'T1190', 'T1078',
    'T1059', 'T1047',
    'T1547', 'T1136',
    'T1068', 'T1548',
    'T1027', 'T1070',
    'T1562', 'T1553',
    'T1003', 'T1110',
    'T1018', 'T1082',
    'T1021', 'T1570',
    'T1071', 'T1105',
  ];
  const outcomeId = options.attackOutcome ?? AttackOutcome_Ransomware;
  const description = DESCRIPTION_BY_OUTCOME[outcomeId] ?? RANSOMWARE_DESCRIPTION;
  const malware = MALWARE_BY_OUTCOME[outcomeId];
  const repertoire = [...new Set([...walked, ...curated])].filter((externalId) => !options.actorTechniquesOmitted?.includes(externalId));
  await scoped.threatAnalyses.ingestBundle([
    buildActor('lockbit', 'Ransomware crew', repertoire, options.actorCves, description, malware),
    buildActor('volt', 'State actor', repertoire.filter((_, index) => index % 2 === 0), options.actorCves, description, malware),
  ], tenantId, 'stix-import');
  await recomputeAttackOutcomeMixtures(services, tenantId);

  if (options.posture !== false) {
    const capabilities = await db.select({ id: controlCapabilities.id }).from(controlCapabilities);
    for (const capability of capabilities.filter((_, index) => index % 2 === 0)) {
      await scoped.controlCapabilities.upsertAssessment(capability.id, 'L2', 'L2', 'Scenario posture');
    }
  }

  if (options.tef !== false) {
    await scoped.crqIndicators.upsertTefInput({ riskScenarioId, min: 0.5, likely: 1.5, max: 4 });
  }
  if (options.losses !== false) {
    await scoped.scenarioLossEstimates.upsertScenarioLossEstimates(riskScenarioId, [
      { lossDriverId: deriveSeedId(tenantId, LossDriver_ForensicsIncidentManagement), action: 'set', minValue: 50_000, likelyValue: 200_000, maxValue: 800_000 },
      { lossDriverId: deriveSeedId(tenantId, LossDriver_LostMarginFromDowntime), action: 'set', minValue: 100_000, likelyValue: 600_000, maxValue: 3_000_000 },
    ], { maxUpdatedAt: null, rowCount: 0 });
  }

  const findingIdByKey = new Map<string, string>();
  const userId = originUserId(adminOrigin);
  for (const attached of options.cves ?? []) {
    // An actor citing the CVE has already ingested a bare row for it.
    const [{ id: cveRowId }] = await db.insert(cve).values({
      id: uuidv7(),
      tenantId,
      cveId: attached.cveId,
      epss: attached.epss,
      kev: attached.kev ?? null,
      kevUpdatedAt: attached.kev === true ? new Date() : null,
      cvssVector: attached.vector,
    }).onConflictDoUpdate({
      target: [cve.tenantId, cve.cveId],
      set: {
        epss: attached.epss,
        kev: attached.kev ?? null,
        kevUpdatedAt: attached.kev === true ? new Date() : null,
        cvssVector: attached.vector,
      },
    }).returning({ id: cve.id });
    for (const assetName of attached.onAssets) {
      const supportingAssetId = assetIdByName.get(assetName);
      if (supportingAssetId === undefined) {
        throw new Error(`the scenario has no asset named ${assetName}`);
      }
      const evidenceId = uuidv7();
      await scoped.supportingAssets.createEvidence({ id: evidenceId, supportingAssetId, cveId: cveRowId, userId });
      findingIdByKey.set(`${attached.cveId}@${assetName}`, evidenceId);
    }
  }
  if (options.cves !== undefined) {
    await recomputeFindingScores(services, adminOrigin);
  }

  return { organizationId, primaryAssetId, riskScenarioId, attackOutcomeId, assetIdByName, findingIdByKey };
};

/** Rewrites the finding scores and the entry openings after a change to a finding or to the tenant's settings. */
export const recomputeFindingScores = async (services: TestServices, origin: EventOrigin) => {
  await services.withOrigin(origin).findingScore.recomputeFindingScores();
};

/**
 * The attack run engine on a scenario, with the two non-run answers ruled out. The engine answers
 * null when its abort signal fires, which no test passes, and a skip when the scope holds nothing
 * to price, which a test asserting a figure never wants silently.
 */
export const runAttackRun = async (
  services: TestServices,
  origin: EventOrigin,
  riskScenarioId: string,
  tenantId: string,
  profile?: CrqRunProfile,
) => {
  const result = await services.withOrigin(origin).crqIndicators.runAttackRunEngine(riskScenarioId, tenantId, undefined, profile);
  if (result === null) {
    throw new Error('the attack run engine reported an abandoned run without an abort signal');
  }
  if ('skipped' in result) {
    throw new Error(`the attack run engine priced nothing: ${result.skipped}`);
  }
  return result;
};

/**
 * A scenario over {@link PRICING_CONDITION_ESTATE} whose CVE values come from a full run that a price
 * run then outdates, after which `LATER_LISTED_FLAW` gets listed by CISA and an actor of the mixture
 * cites `MINOR_FLAW`. The actor lands after the last recompute, so the stored openings keep the
 * base threat of that flaw.
 */
export const seedOutdatedCveRun = async (services: TestServices, origin: EventOrigin, tenantId: string) => {
  const seeded = await seedAttackRunScenario(services, origin, tenantId, PRICING_CONDITION_ESTATE);
  const scoped = services.withOrigin(origin);
  await scoped.supportingAssets.dismissEvidence({
    evidenceId: seeded.findingIdByKey.get(`${DISMISSED_FLAW.cveId}@Web server 2`)!,
    dismissalType: 'risk_accepted',
    reasonCode: 'wont_fix',
    reason: 'Accepted',
    changedByUserId: originUserId(origin),
  });
  await recomputeFindingScores(services, origin);
  await runAttackRun(services, origin, seeded.riskScenarioId, tenantId);
  await runAttackRun(services, origin, seeded.riskScenarioId, tenantId, PRICE_RUN_PROFILE);
  await db.update(cve)
    .set({ kev: true, kevUpdatedAt: new Date() })
    .where(and(eq(cve.tenantId, tenantId), eq(cve.cveId, LATER_LISTED_FLAW.cveId)));
  await recomputeFindingScores(services, origin);
  await scoped.threatAnalyses.ingestBundle([buildActor('late', 'Late crew', ['T1190', 'T1486'], [MINOR_FLAW.cveId])], tenantId, 'stix-import');
  await recomputeAttackOutcomeMixtures(services, tenantId);
  return seeded;
};
