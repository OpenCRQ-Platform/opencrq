import type { AssetCriticality, DrizzleDB, EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceSources, cve, TECHNIQUE_T1003 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import type { TestServices } from '../setup/test-context';
import { insertSyncedVerdict } from './evidence-rows';

/** Access, impact and complexity all at 1: the reading that holds no factor of the score back. */
export const MAXIMAL_CVSS_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

interface FindingScoreAdmin {
  origin: EventOrigin,
  tenantId: string,
  userId: string,
}

/** `admin` is read on every call, since the suite's `beforeEach` replaces the tenant before each test. */
export const findingScoreFixtures = (services: TestServices, db: DrizzleDB, admin: () => FindingScoreAdmin) => {
  const createAsset = async (
    name: string,
    options: {
      exposure?: 'internet_facing' | 'internal' | 'unknown',
      criticality?: AssetCriticality,
      category?: 'host' | 'web_application' | 'identity' | 'generic_asset',
    } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(admin().origin).supportingAssets.createSupportingAsset({
      id,
      name,
      description: null,
      ownerId: null,
      exposure: options.exposure ?? 'unknown',
      categoryId: options.category ?? 'host',
      criticality: options.criticality ?? 'unknown',
    });
    return id;
  };

  /** A CVE with no vector is left unscored, so one is given unless the test names its own, or `null`. */
  const insertCve = async (
    cveTextId: string,
    signals: { epss?: number, kev?: boolean, kevUpdatedAt?: Date | null } = {},
    tenantId?: string,
    cvssVector: string | null = MAXIMAL_CVSS_VECTOR,
    cwe?: Array<string>,
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{
      id,
      tenantId: tenantId ?? admin().tenantId,
      cveId: cveTextId,
      epss: signals.epss ?? null,
      kev: signals.kev ?? null,
      kevUpdatedAt: signals.kevUpdatedAt === undefined ? (signals.kev ? new Date() : null) : signals.kevUpdatedAt,
      cvssVector,
      cwe: cwe ?? null,
    }]);
    return id;
  };

  const attachCve = async (supportingAssetId: string, cveUuid: string, tenantId?: string): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: tenantId ?? admin().tenantId,
      cveId: cveUuid,
      userId: admin().userId,
      // Off the clock the tests date state changes with, never the database's: a finding with no
      // history stands in its state since its creation, and a state change dated before it is ignored.
      createdAt: new Date(),
    }]);
    return id;
  };

  const attachTechnique = async (
    supportingAssetId: string,
    evaluatedAt: Date,
    connectorId?: string,
    options: { mitreTechniqueId?: string, expectationType?: 'prevention' | 'detection', securityPlatformType?: string, tenantId?: string } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: options.tenantId ?? admin().tenantId,
      mitreTechniqueId: options.mitreTechniqueId ?? TECHNIQUE_T1003,
      expectationType: options.expectationType ?? 'prevention',
      securityPlatformType: options.securityPlatformType ?? null,
      evaluatedAt,
      // On the tests' clock, as in attachCve.
      createdAt: new Date(),
    }]);
    if (connectorId) {
      await db.insert(assetEvidenceSources).values([{
        id: uuidv7(),
        tenantId: options.tenantId ?? admin().tenantId,
        assetEvidenceId: id,
        connectorId,
        sourceFindingId: `finding-${id}`,
        evaluatedAt,
      }]);
    }
    return id;
  };

  /** A resync hands control back to a connector, so the finding has to have one to hand it to. */
  const createConnector = async (): Promise<string> => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(admin().origin).serviceAccounts.createServiceAccount({
      id: serviceAccountId, name: 'Test Connector Bot',
    });
    await services.withOrigin(admin().origin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    return (await services.withOrigin(admin().origin).integrationSettings.getConnectorId('openaev'))!;
  };

  const listEstate = async (origin: EventOrigin) =>
    services.withOrigin(origin).findingScore.listScoredFindings({
      page: 1,
      limit: 50,
      state: 'applicable',
      source: null,
      mappedToOrganizationId: null,
      sortBy: 'score',
      sortDesc: true,
    });

  const listAsset = (
    supportingAssetId: string,
    overrides: Partial<Parameters<ReturnType<typeof services.withOrigin>['findingScore']['listAssetFindings']>[0]> = {},
    origin: EventOrigin = admin().origin,
  ) => services.withOrigin(origin).findingScore.listAssetFindings({
    supportingAssetId,
    page: 1,
    limit: 50,
    state: null,
    mitreTechniqueExternalId: null,
    expectationType: null,
    search: null,
    sortBy: 'name',
    sortDesc: false,
    ...overrides,
  });

  /**
   * The asset's scored findings, best first, each with the factors its detail panel prints. A surface
   * prints the figures the recompute stored, so each read here runs one first.
   */
  const scoredForAsset = async (supportingAssetId: string, origin: EventOrigin = admin().origin) => {
    const read = services.withOrigin(origin).findingScore;
    await read.recomputeFindingScores();
    const { items } = await listAsset(supportingAssetId, { state: 'applicable', sortBy: 'score', sortDesc: true }, origin);
    const details = await Promise.all(items.map((row) => read.getFindingScoreBreakdown(row.evidenceId)));
    return details.flatMap((detail) => (detail === null || detail.score === null ? [] : [detail]));
  };

  const breakdownOf = async (evidenceId: string) => {
    await services.withOrigin(admin().origin).findingScore.recomputeFindingScores();
    const breakdown = await services.withOrigin(admin().origin).findingScore.getFindingScoreBreakdown(evidenceId);
    if (breakdown === null || breakdown.score === null) {
      throw new Error(`The recompute left finding ${evidenceId} unscored`);
    }
    return breakdown;
  };

  return { attachCve, attachTechnique, breakdownOf, createAsset, createConnector, insertCve, insertSyncedVerdict, listAsset, listEstate, scoredForAsset };
};
