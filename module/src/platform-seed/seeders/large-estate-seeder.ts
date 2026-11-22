/**
 * A tenant of several hundred thousand assets, so the scope, its pickers, the estate map and the
 * engine are measured on a real park before they ship. Off unless `platform_seed.large_estate` is
 * enabled, and registered last so the seeders that walk what they wrote, the finding lifelines
 * above all, never see these rows.
 *
 * Shape, from a Microsoft Defender tenant measured in September 2026: 313 consolidated assets
 * carrying 169 232 findings over 13 160 distinct CVEs, on a park of mostly workstations with a
 * long tail of servers, identities and cloud resources. Its composition and dependency chains are
 * reproduced in `CATEGORY_LADDER` and the three levels below a site, its findings' skew in
 * `SHARE_WITHOUT_FINDINGS`, `FINDINGS_LADDER` and `CVE_HEAD_EXPONENT`.
 *
 * Its 540 findings per asset are not, and that gap is the one that matters. A finding is one
 * (asset, CVE) pair, so the catalogue's sixty CVEs cap what an asset can carry and the volume
 * comes from the config's counts instead. The engine pays its fan-out to techniques and its
 * `prepareCollapse` per distinct CVE and per distinct technique rather than per finding, so a run
 * priced here walks a fraction of a real tenant's route set: its reading is a floor on the
 * engine's cost, never an estimate of it.
 *
 * Left out, and therefore unsayable from a measure taken here: one tenant only, so nothing
 * exercises the cost of a neighbour's estate; a uniform site, segment and host tree where a real
 * park's chains are ragged; and no lifeline rows, so the daily metric series stays as short as the
 * ordinary seed leaves it.
 *
 * The score projection is written here rather than left to the recompute job that owns it in
 * production: scoring hundreds of thousands of findings in the worker takes far longer than a boot,
 * and a Findings page with no projection has nothing to page over, which is what is being measured.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AssetCategory, AssetCriticality, EvidenceState, SupportingAssetExposure } from '../../modules/supporting-assets/schema';
import type { SeedContext } from '../platform-seed-registry';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from '../../modules/attack-outcomes/data';
import {
  BusinessValueCategory_DataEntrustedByOthers,
  BusinessValueCategory_OperationsAndServices,
  BusinessValueCategory_PersonalData,
  BusinessValueCategory_ServicesUnderCommitments,
} from '../../modules/business-value-categories/data';
import { composeParts } from '../../modules/finding-score/engine';
import { deriveAssetName } from '../../modules/supporting-assets/derived-name';
import { UNEVALUATED_LET_THROUGH } from '../../modules/finding-score/constants';
import { createPrng, deriveSeed } from '../../modules/crq-indicators/engine/prng';
import { cve } from '../../modules/cve/schema';
import { cveTechniqueMapping } from '../../modules/technique-mapping/schema';
import { deriveSeedId } from '../../seed-ids';
import { declaredEstate } from '../../modules/declared-estate/schema';
import { financialProfiles } from '../../modules/financial-profiles/schema';
import { findingScores } from '../../modules/finding-score/schema';
import {
  LossDriver_CrisisCommunications,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_LostMarginFromDowntime,
  LossDriver_RegulatoryFines,
} from '../../modules/loss-drivers/data';
import { organizationAssets, organizations } from '../../modules/organizations/schema';
import { primaryAssetBusinessValueCategories } from '../../modules/business-value-categories/schema';
import { primaryAssets } from '../../modules/primary-assets/schema';
import { resolveSeverityBand } from '../../modules/finding-score/bands';
import { riskScenarioBusinessValueCategories, riskScenarioPrimaryAssets, riskScenarios } from '../../modules/risk-scenarios/schema';
import { scenarioLossEstimates } from '../../modules/scenario-loss-estimates/schema';
import { supportToPrimaryLinks, supportToSupportLinks } from '../../modules/asset-dependencies/schema';
import { assetEnumerations, assetEvidence, assetEvidenceHistory, assetEvidenceSources, assetEvidenceVerdicts, supportingAssetMachineProperties, supportingAssets, supportingAssetSources } from '../../modules/supporting-assets/schema';
import { countryCatalogId } from '../../modules/countries/data';
import { sectorCatalogId } from '../../modules/sectors/data';
import { acmeCorpDeclaredEstate } from '../data/declared-estate';
import { acmeCorpFinancialProfile } from '../data/financial-profiles';
import {
  FinancialProfile_AcmeRetailNetwork,
  IntegrationSetting_AcmeMicrosoftGraph,
  largeEstateAssetId,
  largeEstateAssetSourceId,
  largeEstateDependencyId,
  largeEstateFindingHistoryId,
  largeEstateFindingId,
  largeEstateFindingSourceId,
  largeEstateLossEstimateId,
  largeEstatePrimaryAssetId,
  largeEstatePrimaryLinkId,
  largeEstateScenarioId,
  Organization_AcmeRetailNetwork,
  Tenant_Acme,
  User_Admin,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';
import { deriveAcmeQuestionnaireEstimates } from './scenario-loss-estimates-seeder';

/**
 * Postgres binds at most 65 535 parameters in one statement and Drizzle sends one per column of
 * every row, so every batch below is sized from the width of the rows it actually carries.
 */
const PARAMETER_CEILING = 65_535;

/** The findings pass flushes on this count too, despite the name. */
const ASSETS_PER_FLUSH = 2_000;

/** Sized on the measured park's subnets. */
const ASSETS_PER_SITE = 1_000;

/** Between a site and its hosts: the middle level of every chain, so a walk has something to walk. */
const SEGMENTS_PER_SITE = 20;

const SHARE_WITHOUT_FINDINGS = 0.4;

const SHARE_DISMISSED = 0.08;

/** The share of assets the connector has not reported today, so a reader windowing on recency has a tail to find. */
const SHARE_SILENT = 0.12;

/**
 * How sharply the CVE draw favours the head of the catalogue. A real park's findings pile onto a
 * handful of vulnerabilities, and the fan-out the engine walks from a finding to its techniques is
 * paid per distinct CVE, so a uniform draw would price a park nobody has.
 */
const CVE_HEAD_EXPONENT = 3;

/** Weighted draws, each `[value, share]`, the shares summing to one. */
type Ladder<T> = ReadonlyArray<readonly [T, number]>;

const CATEGORY_LADDER: Ladder<AssetCategory> = [
  ['host', 0.55],
  ['mobile_device', 0.15],
  ['identity', 0.1],
  ['container_workload', 0.06],
  ['cloud_resource', 0.05],
  ['network_device', 0.04],
  ['web_application', 0.02],
  ['saas_application', 0.02],
  ['iot_ot_device', 0.01],
];

const EXPOSURE_LADDER: Ladder<SupportingAssetExposure> = [
  ['internal', 0.85],
  ['unknown', 0.08],
  ['internet_facing', 0.07],
];

const CRITICALITY_LADDER: Ladder<AssetCriticality> = [
  ['unknown', 0.55],
  ['low', 0.2],
  ['medium', 0.18],
  ['high', 0.05],
  ['very_high', 0.02],
];

const FINDINGS_LADDER: Ladder<number> = [
  [1, 0.45],
  [2, 0.2],
  [3, 0.12],
  [5, 0.1],
  [8, 0.07],
  [14, 0.04],
  [24, 0.02],
];

/**
 * The categories whose observations carry a `supportingAssetMachineProperties` row. An identity
 * or an application has no hostname to report, and the table's foreign key is what the identity
 * matcher reads.
 */
const MACHINE_CATEGORIES: ReadonlySet<AssetCategory> = new Set<AssetCategory>([
  'host', 'container_workload', 'cloud_resource', 'mobile_device', 'network_device', 'iot_ot_device',
]);

/**
 * What a network or IoT device reports as `[vendor, model]`. Picked from the position rather than
 * the generator: one more draw would shift every later value of the seeded estate.
 */
const HARDWARE_BY_CATEGORY: Partial<Record<AssetCategory, ReadonlyArray<readonly [vendor: string, model: string]>>> = {
  network_device: [
    ['Cisco Meraki', 'MS220-48'],
    ['Ubiquiti', 'USW-Pro-48-PoE'],
    ['Fortinet', 'FortiGate 100F'],
    ['HPE Aruba Networking', 'CX 6300M'],
    ['Cisco', 'Catalyst 9300-48P'],
  ],
  iot_ot_device: [
    ['Axis Communications', 'P3265-LVE'],
    ['Hanwha Vision', 'XNP-6320H'],
    ['Apple', 'AppleTV14,1 (J255AP)'],
    ['Siemens', 'SIMATIC S7-1500'],
    ['Zebra Technologies', 'ZT411'],
  ],
};

const hardwareOf = (categoryId: AssetCategory, index: number): readonly [vendor: string, model: string] | null => {
  const catalogue = HARDWARE_BY_CATEGORY[categoryId];
  return catalogue && index % 4 !== 3 ? catalogue[index % catalogue.length] : null;
};

/**
 * A device reported with an address and no name, as Defender reports one it only saw on the network.
 * Every eighth device with hardware is one too, so both forms of the derived name are seeded.
 */
const isNameless = (index: number, hardware: unknown): boolean => index % 100 === 0 || (hardware !== null && index % 8 === 0);

const addressesOf = (index: number, positionInSite: number) => ({
  ip: `10.${Math.floor(index / ASSETS_PER_SITE) % 250}.${Math.floor(positionInSite / 250)}.${(positionInSite % 250) + 1}`,
  mac: `02${index.toString(16).padStart(10, '0')}`,
});

const NAME_PREFIX_BY_CATEGORY: Record<AssetCategory, string> = {
  host: 'SRV',
  container_workload: 'POD',
  cloud_resource: 'CLD',
  web_application: 'WEB',
  network_device: 'NET',
  mobile_device: 'WKS',
  iot_ot_device: 'IOT',
  identity: 'IDP',
  saas_application: 'SAAS',
  ai_target: 'AI',
  source_code: 'SRC',
  security_platform: 'SEC',
  generic_asset: 'GEN',
};

/**
 * The notify triggers fire once per row, and a million of them would put a million messages on the
 * `data_changed` queue for a seed nobody is watching. User triggers only: the foreign keys keep
 * checking every row this seeder writes. Nothing rings for these rows, so no job waiting on a
 * table's doorbell wakes for them and the estate is picked up by the daily passes alone.
 */
const BULK_TABLES = [
  'supporting_assets',
  'supporting_asset_sources',
  'supporting_asset_machine_properties',
  'asset_evidence',
  'asset_evidence_sources',
  'asset_evidence_history',
  'asset_evidence_verdicts',
  'finding_scores',
  'support_to_support_links',
  'support_to_primary_links',
  'organization_assets',
] as const;

/** Each hangs on mapped supporting assets of its own. */
const PRIMARY_ASSET_SPECS = [
  {
    name: 'Branch Banking Service',
    description: 'Counter and ATM service of the retail network: the branches a customer walks into.',
    resources: [BusinessValueCategory_ServicesUnderCommitments, BusinessValueCategory_OperationsAndServices],
  },
  {
    name: 'Retail Customer Records',
    description: 'Account records, statements and mandates held for the customers of the retail network.',
    resources: [BusinessValueCategory_PersonalData, BusinessValueCategory_DataEntrustedByOthers],
  },
  {
    name: 'Card Acceptance Chain',
    description: 'Terminals, acquiring links and settlement files of the network\'s card acceptance.',
    resources: [BusinessValueCategory_ServicesUnderCommitments, BusinessValueCategory_PersonalData],
  },
];

const drawFrom = <T>(ladder: Ladder<T>, roll: number): T => {
  let cursor = 0;
  for (const [value, share] of ladder) {
    cursor += share;
    if (roll < cursor) {
      return value;
    }
  }
  return ladder[ladder.length - 1][0];
};

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

/**
 * When the connector last reported an asset, drawn per asset rather than per finding because a
 * connector reports a device's whole set in one pass. A column holding one value for the entire
 * park hands every reader that sorts or windows on recency a selectivity no tenant has.
 */
const assetLastSeenAt = (now: Date, prng: () => number): Date => {
  const silentForDays = prng() < SHARE_SILENT ? 2 + Math.floor(prng() * 28) : 0;
  const minutesIntoTheDay = Math.floor(prng() * 1_440);
  return new Date(now.getTime() - silentForDays * 86_400_000 - minutesIntoTheDay * 60_000);
};

const greatestCommonDivisor = (left: number, right: number): number => (right === 0 ? left : greatestCommonDivisor(right, left % right));

/** A stride coprime with `total`, so `step * stride % total` walks the whole range exactly once. */
const coprimeStride = (total: number): number => {
  for (let stride = Math.max(2, Math.floor(total * 0.618)); stride < total; stride++) {
    if (greatestCommonDivisor(stride, total) === 1) {
      return stride;
    }
  }
  return 1;
};

/** Which assets the closed scope maps: every k-th, so the mapping is as scattered as a connector's. */
const mappedAssetIndexes = (assetCount: number, mappedCount: number): Array<number> => {
  const mapped = Math.min(mappedCount, assetCount);
  const stride = Math.max(1, Math.floor(assetCount / Math.max(1, mapped)));
  return Array.from({ length: mapped }, (_, position) => position * stride);
};

/**
 * How many findings each asset carries, summing to exactly `total`.
 *
 * The ladder draws the shape and the correction below makes the sum exact: a budget measured
 * against "about 600 000 findings" is a budget nobody can reproduce.
 */
const planFindingsPerAsset = (assetCount: number, total: number, cveCount: number): Int16Array => {
  const counts = new Int16Array(assetCount);
  const prng = createPrng(deriveSeed(Organization_AcmeRetailNetwork, 'large-estate-findings'));
  let planned = 0;
  for (let index = 0; index < assetCount; index++) {
    if (prng() < SHARE_WITHOUT_FINDINGS) {
      continue;
    }
    const count = Math.min(drawFrom(FINDINGS_LADDER, prng()), cveCount);
    counts[index] = count;
    planned += count;
  }

  // One finding at a time over the assets that already carry some, so the correction spreads the
  // difference across the ladder rather than piling it onto a few assets. The walk is strided
  // because the pass that reaches the total stops partway through it: in index order the whole
  // residual would land on the low indices, and a site is a contiguous run of them.
  const walk = coprimeStride(assetCount);
  while (planned !== total) {
    const before = planned;
    for (let step = 0; step < assetCount && planned !== total; step++) {
      const index = (step * walk) % assetCount;
      if (planned < total && counts[index] > 0 && counts[index] < cveCount) {
        counts[index] += 1;
        planned += 1;
      } else if (planned > total && counts[index] > 0) {
        counts[index] -= 1;
        planned -= 1;
      }
    }
    if (planned === before) {
      throw new Error(`[large-estate] ${assetCount} assets over ${cveCount} CVEs cannot carry ${total} findings`);
    }
  }
  return counts;
};

const insertInBatches = async <T extends object>(
  rows: Array<T>,
  write: (batch: Array<T>) => Promise<unknown>,
): Promise<void> => {
  if (rows.length === 0) {
    return;
  }
  const perBatch = Math.max(1, Math.floor(PARAMETER_CEILING / Object.keys(rows[0]).length));
  for (let start = 0; start < rows.length; start += perBatch) {
    await write(rows.slice(start, start + perBatch));
  }
};

/**
 * Writes the park and returns, per asset index, how many days ago it was first seen: the findings
 * pass needs it to keep a finding inside the life of the asset it hangs on.
 */
const seedAssets = async (
  { db }: SeedContext,
  { assetCount, now }: { assetCount: number, now: Date },
): Promise<Int16Array> => {
  const prng = createPrng(deriveSeed(Organization_AcmeRetailNetwork, 'large-estate-assets'));
  const firstSeenDaysAgo = new Int16Array(assetCount);
  let batch: Array<typeof supportingAssets.$inferInsert> = [];
  let sources: Array<typeof supportingAssetSources.$inferInsert> = [];
  let machines: Array<typeof supportingAssetMachineProperties.$inferInsert> = [];
  let links: Array<typeof supportToSupportLinks.$inferInsert> = [];

  const flush = async () => {
    await insertInBatches(batch, (rows) => db.insert(supportingAssets).values(rows));
    batch = [];
    await insertInBatches(sources, (rows) => db.insert(supportingAssetSources).values(rows));
    sources = [];
    await insertInBatches(machines, (rows) => db.insert(supportingAssetMachineProperties).values(rows));
    machines = [];
    // Links go in behind their own assets: both ends have to exist before the foreign keys are checked.
    await insertInBatches(links, (rows) => db.insert(supportToSupportLinks).values(rows));
    links = [];
  };

  for (let index = 0; index < assetCount; index++) {
    const categoryId = drawFrom(CATEGORY_LADDER, prng());
    const site = Math.floor(index / ASSETS_PER_SITE);
    const positionInSite = index % ASSETS_PER_SITE;
    const isMachine = MACHINE_CATEGORIES.has(categoryId);
    const hardware = isMachine ? hardwareOf(categoryId, index) : null;
    const nameless = isMachine && isNameless(index, hardware);
    const generatedName = `${NAME_PREFIX_BY_CATEGORY[categoryId]}-${String(site).padStart(4, '0')}-${String(positionInSite).padStart(4, '0')}`;
    const name = nameless ? null : generatedName;
    const exposure = drawFrom(EXPOSURE_LADDER, prng());
    const criticality = drawFrom(CRITICALITY_LADDER, prng());
    firstSeenDaysAgo[index] = 30 + Math.floor(prng() * 300);
    const firstSeenAt = daysAgo(now, firstSeenDaysAgo[index]);
    const lastSeenAt = assetLastSeenAt(now, prng);

    // Rows go in directly, past the reprojection that fills `derived_name` in production, so the
    // column is filled here from the one rule rather than left empty.
    const address = nameless ? addressesOf(index, positionInSite) : null;
    const machine = isMachine
      ? {
        hostname: nameless ? null : `${generatedName.toLowerCase()}.retail.acme-bank.example`,
        ipAddresses: address ? [address.ip] : [],
        macAddresses: address ? [address.mac] : [],
        vendor: hardware?.[0] ?? null,
        model: hardware?.[1] ?? null,
      }
      : null;
    const derivedName = machine === null
      ? null
      : deriveAssetName({
        family: 'machine',
        seenIp: null,
        hardwareUuid: null,
        directoryDeviceId: null,
        cloudVmId: null,
        cloudResourceId: null,
        cloudProvider: null,
        cloudNativeType: null,
        cloudRegion: null,
        platform: null,
        arch: null,
        operatingSystem: null,
        osVersion: null,
        isEol: null,
        agentExternalReference: null,
        agentExecutorType: null,
        ...machine,
      });

    batch.push({
      id: largeEstateAssetId(index),
      tenantId: Tenant_Acme,
      name,
      derivedName,
      description: null,
      ownerId: null,
      exposure,
      categoryId,
      criticality,
      firstSeenAt,
      lastSeenAt,
    });

    // One reporting connector on every asset, so the source facet and the per-row observation
    // subquery are answered from a table the size of the park rather than from an empty one.
    sources.push({
      id: largeEstateAssetSourceId(index),
      supportingAssetId: largeEstateAssetId(index),
      tenantId: Tenant_Acme,
      connectorId: IntegrationSetting_AcmeMicrosoftGraph,
      sourceAssetId: `defender-large-estate-${index}`,
      reportedName: name,
      reportedCategoryId: categoryId,
      reportedExposure: exposure,
      reportedCriticality: criticality,
      firstSeenAt,
      lastSeenAt,
    });

    if (machine !== null) {
      // One row per observation, on that observation's own id: the pair is written and read
      // together, and the migration reuses the id rather than generating a second one.
      machines.push({
        id: largeEstateAssetSourceId(index),
        supportingAssetSourceId: largeEstateAssetSourceId(index),
        tenantId: Tenant_Acme,
        ...machine,
      });
    }

    if (positionInSite > 0) {
      const providerPosition = positionInSite <= SEGMENTS_PER_SITE ? 0 : 1 + (positionInSite % SEGMENTS_PER_SITE);
      const providerIndex = site * ASSETS_PER_SITE + providerPosition;
      if (providerIndex < assetCount) {
        links.push({
          id: largeEstateDependencyId(index),
          tenantId: Tenant_Acme,
          providerAssetId: largeEstateAssetId(providerIndex),
          dependentAssetId: largeEstateAssetId(index),
        });
      }
    }

    if (batch.length === ASSETS_PER_FLUSH) {
      await flush();
    }
  }

  await flush();
  return firstSeenDaysAgo;
};

/**
 * One stored exploitation claim per CVE the profile draws on, or nothing when it has none. The
 * engine names a `weakestTechniqueId` only from the exploitation side, so an impact or weakness
 * row named there is a projection no recompute would produce. A CVE the topology rule alone
 * answers stays unnamed: that rule reads the asset, and the first recompute names it.
 */
const resolveWeakestTechniques = async (
  { db, services }: SeedContext,
  cveRowIds: Array<string>,
): Promise<Map<string, string>> => {
  await services.withOrigin({ type: 'system' }).techniqueMapping.resolveTechniquesForCves(cveRowIds);
  const mappings = await db
    .select({ cveId: cveTechniqueMapping.cveId, mitreTechniqueId: cveTechniqueMapping.mitreTechniqueId })
    .from(cveTechniqueMapping)
    .where(and(
      eq(cveTechniqueMapping.tenantId, Tenant_Acme),
      inArray(cveTechniqueMapping.cveId, cveRowIds),
      eq(cveTechniqueMapping.role, 'exploitation_technique'),
      ne(cveTechniqueMapping.lane, 'structural'),
    ))
    .orderBy(cveTechniqueMapping.cveId, cveTechniqueMapping.mitreTechniqueId);
  const byCveId = new Map<string, string>();
  for (const mapping of mappings) {
    if (!byCveId.has(mapping.cveId)) {
      byCveId.set(mapping.cveId, mapping.mitreTechniqueId);
    }
  }
  return byCveId;
};

const seedFindings = async (
  ctx: SeedContext,
  { assetCount, findingCount, now, firstSeenDaysAgo }:
  { assetCount: number, findingCount: number, now: Date, firstSeenDaysAgo: Int16Array },
): Promise<void> => {
  const { db } = ctx;
  const cveRows = await db
    .select({ id: cve.id })
    .from(cve)
    .where(eq(cve.tenantId, Tenant_Acme))
    .orderBy(cve.id);
  if (cveRows.length === 0) {
    throw new Error('[large-estate] no CVE to hang a finding on: the cves seeder must run first');
  }
  if (findingCount === 0) {
    return;
  }

  const techniqueByCveId = await resolveWeakestTechniques(ctx, cveRows.map((row) => row.id));
  const counts = planFindingsPerAsset(assetCount, findingCount, cveRows.length);
  // Scattered rather than sequential: a connector fills that table over months, and a seeder
  // writing in order would hand every reader index locality no production tenant has.
  const stride = coprimeStride(findingCount);
  const prng = createPrng(deriveSeed(Organization_AcmeRetailNetwork, 'large-estate-scores'));
  let evidence: Array<typeof assetEvidence.$inferInsert> = [];
  let evidenceSources: Array<typeof assetEvidenceSources.$inferInsert> = [];
  let history: Array<typeof assetEvidenceHistory.$inferInsert> = [];
  let verdicts: Array<typeof assetEvidenceVerdicts.$inferInsert> = [];
  let enumerations: Array<typeof assetEnumerations.$inferInsert> = [];
  let scores: Array<typeof findingScores.$inferInsert> = [];
  let written = 0;

  const flush = async () => {
    await insertInBatches(evidence, (rows) => db.insert(assetEvidence).values(rows));
    evidence = [];
    await insertInBatches(evidenceSources, (rows) => db.insert(assetEvidenceSources).values(rows));
    evidenceSources = [];
    await insertInBatches(history, (rows) => db.insert(assetEvidenceHistory).values(rows));
    history = [];
    await insertInBatches(verdicts, (rows) => db.insert(assetEvidenceVerdicts).values(rows));
    verdicts = [];
    await insertInBatches(enumerations, (rows) => db.insert(assetEnumerations).values(rows));
    enumerations = [];
    await insertInBatches(scores, (rows) => db.insert(findingScores).values(rows));
    scores = [];
  };

  for (let assetIndex = 0; assetIndex < assetCount; assetIndex++) {
    const drawn = new Set<number>();
    const assetLastSeen = assetLastSeenAt(now, prng);
    // The scanner's last walk of the asset: what it left out then reads as no longer reported.
    if (counts[assetIndex] > 0) {
      enumerations.push({
        tenantId: Tenant_Acme,
        connectorId: IntegrationSetting_AcmeMicrosoftGraph,
        supportingAssetId: largeEstateAssetId(assetIndex),
        scope: '',
        lastReportedAt: assetLastSeen,
      });
    }
    for (let position = 0; position < counts[assetIndex]; position++) {
      // The same pair twice is one finding, and the unique index says so: a collision walks to the
      // next CVE rather than dropping the finding the plan counted on.
      let cveIndex = Math.min(cveRows.length - 1, Math.floor(cveRows.length * prng() ** CVE_HEAD_EXPONENT));
      while (drawn.has(cveIndex)) {
        cveIndex = (cveIndex + 1) % cveRows.length;
      }
      drawn.add(cveIndex);
      const cveId = cveRows[cveIndex].id;

      const findingIndex = (written * stride) % findingCount;
      written += 1;
      const evidenceId = largeEstateFindingId(findingIndex);
      // Three orderings a flat draw breaks, closed by the three bounds below: a finding predating
      // the asset it hangs on, a dismissal predating the finding it closes, and a sighting
      // predating the finding it reports.
      const ageInDays = 1 + Math.floor(prng() * Math.min(240, firstSeenDaysAgo[assetIndex]));
      const createdAt = daysAgo(now, ageInDays);
      const drawnDismissed = prng() < SHARE_DISMISSED;
      const drawnDismissedAt = drawnDismissed ? daysAgo(now, 1 + Math.floor(prng() * Math.min(30, ageInDays))) : createdAt;
      // Only a walk of its asset retires a finding, so one created after the asset's last walk stays open.
      const dismissed = drawnDismissed && createdAt.getTime() < assetLastSeen.getTime() - 60_000;
      // Learned at a walk, so never after the asset's last one, and after the opening row: readers
      // break a tie between the two on the id, which carries no order.
      const currentStateSince = dismissed
        ? new Date(Math.max(createdAt.getTime() + 1, Math.min(drawnDismissedAt.getTime(), assetLastSeen.getTime())))
        : createdAt;
      const currentState: EvidenceState = dismissed ? 'dismissed' : 'applicable';
      // A dismissed finding stopped being reported when it was dismissed, before the walk that left it out.
      const lastReportedAt = dismissed
        ? new Date(Math.min(currentStateSince.getTime(), assetLastSeen.getTime() - 60_000))
        : new Date(Math.max(assetLastSeen.getTime(), createdAt.getTime()));

      evidence.push({
        id: evidenceId,
        supportingAssetId: largeEstateAssetId(assetIndex),
        tenantId: Tenant_Acme,
        cveId,
        userId: null,
        evaluatedAt: lastReportedAt,
        createdAt,
        updatedAt: currentStateSince,
        // The triggers are off for this bulk write, so the stored state and verdict are written with the row.
        currentState,
        currentStateChangedAt: currentStateSince,
        currentStateSince,
        latestVerdictExposed: true,
        latestVerdictObservedAt: createdAt,
      });

      evidenceSources.push({
        id: largeEstateFindingSourceId(findingIndex),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        connectorId: IntegrationSetting_AcmeMicrosoftGraph,
        sourceFindingId: `defender-large-estate-finding-${findingIndex}`,
        isExposed: true,
        firstSeenAt: createdAt,
        lastSeenAt: lastReportedAt,
        lastReportedAt,
        evaluatedAt: lastReportedAt,
      });

      // The sync writes a finding's opening row when it first reports it.
      history.push({
        id: largeEstateFindingHistoryId(findingIndex, 0),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        stateChangedAt: createdAt,
        state: 'applicable',
        reason: null,
        changedByUserId: null,
        origin: 'exposed',
        observedAt: createdAt,
      });
      verdicts.push({
        id: largeEstateFindingHistoryId(findingIndex, 0),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        connectorId: IntegrationSetting_AcmeMicrosoftGraph,
        sourceFindingId: `defender-large-estate-finding-${findingIndex}`,
        isExposed: true,
        observedAt: createdAt,
        recordedAt: createdAt,
      });

      if (dismissed) {
        history.push({
          id: largeEstateFindingHistoryId(findingIndex, 1),
          tenantId: Tenant_Acme,
          assetEvidenceId: evidenceId,
          stateChangedAt: currentStateSince,
          state: 'dismissed',
          reason: 'No longer reported by the vulnerability scanner.',
          changedByUserId: null,
          origin: 'no_longer_reported',
          observedAt: currentStateSince,
        });
      }

      const reachability = 0.2 + prng() * 0.8;
      const threat = prng();
      const exploitationRoll = prng();
      const potentialImpact = 0.2 + prng() * 0.8;
      const weakestTechniqueId = techniqueByCveId.get(cveId) ?? null;
      const exploitationLetThrough = weakestTechniqueId === null ? UNEVALUATED_LET_THROUGH : exploitationRoll;
      const impactLetThrough = UNEVALUATED_LET_THROUGH;
      // The engine's own composition, called rather than copied, so the seeded band and the one the
      // recompute writes over it cannot drift apart.
      const { exploitability, impact, score } = composeParts(
        ((reachability + threat) / 2) * exploitationLetThrough,
        potentialImpact * impactLetThrough,
      );
      scores.push({
        assetEvidenceId: evidenceId,
        tenantId: Tenant_Acme,
        score,
        band: resolveSeverityBand(score),
        exploitability,
        impact,
        potentialImpact,
        exploitationLetThrough,
        impactLetThrough,
        reachability,
        threat,
        weakestTechniqueId,
        scoreChangedAt: currentStateSince,
      });
    }
    if (evidence.length >= ASSETS_PER_FLUSH) {
      await flush();
    }
  }
  await flush();
};

const seedScopeAndScenarios = async (
  { db }: SeedContext,
  { assetCount, mappedCount, now }: { assetCount: number, mappedCount: number, now: Date },
): Promise<void> => {
  await db.insert(organizations).values([{
    id: Organization_AcmeRetailNetwork,
    tenantId: Tenant_Acme,
    name: 'Acme Retail Network',
    description: 'Branch and retail estate of the bank, measured over its own machines rather than the group library.',
    legalEntityName: 'Acme Retail Network SA',
    sectorId: deriveSeedId(Tenant_Acme, sectorCatalogId('Finance')),
    countryId: deriveSeedId(Tenant_Acme, countryCatalogId('USA')),
    revenueBand: '1b_10b',
    employeeCount: 9_000,
    domain: 'retail.acme-bank.example',
    reactionTimeMin: 0.5,
    reactionTimeLikely: 8,
    reactionTimeMax: 48,
    estateMode: 'closed',
    estateChangedAt: now,
  }]);

  await db.insert(financialProfiles).values([{
    ...acmeCorpFinancialProfile,
    id: FinancialProfile_AcmeRetailNetwork,
    organizationId: Organization_AcmeRetailNetwork,
    updatedAt: now,
  }]);
  await db.insert(declaredEstate).values(acmeCorpDeclaredEstate
    .filter((answer) => answer.kind === 'workstations' || answer.kind === 'servers')
    .map((answer) => ({ ...answer, tenantId: Tenant_Acme, organizationId: Organization_AcmeRetailNetwork, setAt: now })));

  const mappedIndexes = mappedAssetIndexes(assetCount, mappedCount);
  await insertInBatches(
    mappedIndexes.map((assetIndex) => ({
      organizationId: Organization_AcmeRetailNetwork,
      supportingAssetId: largeEstateAssetId(assetIndex),
      tenantId: Tenant_Acme,
    })),
    (batch) => db.insert(organizationAssets).values(batch),
  );

  /** Business resources, attack outcomes and loss drivers come from closed catalogs, one row per tenant. */
  const forAcme = (catalogId: string) => deriveSeedId(Tenant_Acme, catalogId);

  await db.insert(primaryAssets).values(PRIMARY_ASSET_SPECS.map((spec, index) => ({
    id: largeEstatePrimaryAssetId(index),
    tenantId: Tenant_Acme,
    organizationId: Organization_AcmeRetailNetwork,
    name: spec.name,
    description: spec.description,
    ownerId: User_Admin,
  })));
  await db.insert(primaryAssetBusinessValueCategories).values(PRIMARY_ASSET_SPECS.flatMap((spec, index) =>
    spec.resources.map((resource) => ({
      primaryAssetId: largeEstatePrimaryAssetId(index),
      businessValueCategoryId: forAcme(resource),
    }))));

  // Drawn from the mapped assets and never past their number: a degenerate size, which the boot
  // seed accepts, would otherwise hang a link on an asset the profile never wrote.
  const supportPerPrimaryAsset = Math.max(1, Math.min(20, Math.floor(mappedIndexes.length / PRIMARY_ASSET_SPECS.length)));
  await insertInBatches(
    PRIMARY_ASSET_SPECS.flatMap((_, primaryIndex) =>
      Array.from({ length: supportPerPrimaryAsset }, (__, position) => primaryIndex * supportPerPrimaryAsset + position)
        .filter((linkIndex) => linkIndex < mappedIndexes.length)
        .map((linkIndex) => ({
          id: largeEstatePrimaryLinkId(linkIndex),
          tenantId: Tenant_Acme,
          supportingAssetId: largeEstateAssetId(mappedIndexes[linkIndex]),
          primaryAssetId: largeEstatePrimaryAssetId(primaryIndex),
        }))),
    (batch) => db.insert(supportToPrimaryLinks).values(batch),
  );

  // Three scenarios aim at a primary asset and inherit its resources, three aim straight at
  // resources of their own: the two shapes the estate map and the engine have to walk.
  const scenarioSpecs = [
    {
      name: 'Ransomware on the Branch Banking Service',
      description: 'A ransomware affiliate encrypts the branch servers of the retail network, closing counters across the country.',
      attackOutcome: AttackOutcome_Ransomware,
      primaryAssetIndex: 0,
      resources: [],
    },
    {
      name: 'Data Breach on Retail Customer Records',
      description: 'An access broker resells a foothold in the retail record store, exposing the accounts held for branch customers.',
      attackOutcome: AttackOutcome_DataBreachResale,
      primaryAssetIndex: 1,
      resources: [],
    },
    {
      name: 'Card Data Theft on the Acceptance Chain',
      description: 'Cardholder data is exfiltrated from the acceptance chain of the retail network and held for extortion.',
      attackOutcome: AttackOutcome_DataTheftExtortion,
      primaryAssetIndex: 2,
      resources: [],
    },
    {
      name: 'Service Disruption on the Branch Network',
      description: 'The retail network loses its branch connectivity for several days, with no primary asset named.',
      attackOutcome: AttackOutcome_ServiceDisruption,
      primaryAssetIndex: null,
      resources: [BusinessValueCategory_ServicesUnderCommitments, BusinessValueCategory_OperationsAndServices],
    },
    {
      name: 'Data Breach on the Branch Document Store',
      description: 'Mandates and identity documents held in the branches are exfiltrated from a shared store.',
      attackOutcome: AttackOutcome_DataBreachResale,
      primaryAssetIndex: null,
      resources: [BusinessValueCategory_PersonalData, BusinessValueCategory_DataEntrustedByOthers],
    },
    {
      name: 'Ransomware on the Branch Workstations',
      description: 'Workstations across the branches are encrypted in one wave, without touching the central systems.',
      attackOutcome: AttackOutcome_Ransomware,
      primaryAssetIndex: null,
      resources: [BusinessValueCategory_OperationsAndServices],
    },
  ];

  await db.insert(riskScenarios).values(scenarioSpecs.map((spec, index) => ({
    id: largeEstateScenarioId(index),
    tenantId: Tenant_Acme,
    organizationId: Organization_AcmeRetailNetwork,
    name: spec.name,
    description: spec.description,
    attackOutcomeId: forAcme(spec.attackOutcome),
    tefMode: 'auto' as const,
  })));

  await db.insert(riskScenarioPrimaryAssets).values(scenarioSpecs.flatMap((spec, index) =>
    (spec.primaryAssetIndex === null
      ? []
      : [{ riskScenarioId: largeEstateScenarioId(index), primaryAssetId: largeEstatePrimaryAssetId(spec.primaryAssetIndex) }])));

  await db.insert(riskScenarioBusinessValueCategories).values(scenarioSpecs.flatMap((spec, index) => {
    const resources = spec.primaryAssetIndex === null
      ? spec.resources
      : PRIMARY_ASSET_SPECS[spec.primaryAssetIndex].resources;
    return resources.map((resource) => ({
      riskScenarioId: largeEstateScenarioId(index),
      businessValueCategoryId: forAcme(resource),
    }));
  }));

  // Two drivers per scenario, so none of the six prices at zero and the run measured against the
  // budget is a run that produced a figure.
  const estimateDrivers = [LossDriver_ForensicsIncidentManagement, LossDriver_CrisisCommunications];
  const disruptionDrivers = [LossDriver_LostMarginFromDowntime, LossDriver_RegulatoryFines];
  await db.insert(scenarioLossEstimates).values(scenarioSpecs.flatMap((spec, index) => {
    const drivers = spec.attackOutcome === AttackOutcome_ServiceDisruption || spec.attackOutcome === AttackOutcome_Ransomware
      ? disruptionDrivers
      : estimateDrivers;
    return drivers.map((catalogId, position) => ({
      id: largeEstateLossEstimateId(index * 10 + position),
      riskScenarioId: largeEstateScenarioId(index),
      lossDriverId: forAcme(catalogId),
      minValue: 120_000,
      likelyValue: 450_000,
      maxValue: 1_800_000,
      updatedAt: now,
    }));
  }));
};

registerPlatformSeed('large-estate', async (ctx) => {
  const options = ctx.largeEstate;
  if (options === null) {
    return;
  }
  const mappable = Math.min(options.assets, options.mappedAssets);
  if (mappable < PRIMARY_ASSET_SPECS.length) {
    throw new Error(`[large-estate] the profile's ${PRIMARY_ASSET_SPECS.length} primary assets each need a mapped supporting asset to hang on, and this configuration maps ${mappable}: raise platform_seed.large_estate.mapped_assets (and assets) to at least ${PRIMARY_ASSET_SPECS.length}.`);
  }

  const { db, now } = ctx;
  for (const table of BULK_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${table} DISABLE TRIGGER USER`));
  }
  const firstSeenDaysAgo = await seedAssets(ctx, { assetCount: options.assets, now });
  await seedScopeAndScenarios(ctx, { assetCount: options.assets, mappedCount: options.mappedAssets, now });
  await seedFindings(ctx, { assetCount: options.assets, findingCount: options.findings, now, firstSeenDaysAgo });
  // The seed runs in one transaction, so a failure restores the triggers by rolling back. Re-enabling
  // them on the way out of an error would run inside the aborted transaction and mask it.
  for (const table of BULK_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER USER`));
  }
  // This scope's financial profile is written after `scenario-loss-estimates` derived the others.
  await deriveAcmeQuestionnaireEstimates(ctx.services);
});
