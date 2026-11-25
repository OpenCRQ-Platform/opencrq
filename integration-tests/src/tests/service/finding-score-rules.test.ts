import type { EventOrigin } from '@app/module';
import { assetEvidenceHistory, assetEvidenceSources, DETECTION_CREDIT, findingScores, THREAT_FLOORS } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { findingScoreFixtures } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('Finding Score Service', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;

  const { attachCve, attachTechnique, breakdownOf, createAsset, createConnector, insertCve, insertSyncedVerdict, scoredForAsset } = findingScoreFixtures(services, db, () => ({ origin: adminOrigin, tenantId: adminTenantId, userId: adminUserId }));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  describe('the score itself', () => {
    it('should match the arithmetic done by hand on a flaw with two independent signals', async () => {
      // R = 1.0 (internet facing), T = max(0.05, 0.5, 0.9) lifted a third of the way:
      // 0.9 + 0.1/3 = 0.933333, so E = (1 + 0.933333) / 2 = 0.966667. The vector reaches T1190, on
      // which nothing is declared, so both sides let everything through, and I = 1.0 (very_high,
      // every impact metric high): trunc(100 x sqrt(0.966667 x 1)) = 98.
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'very_high' });
      const cveUuid = await insertCve('CVE-2026-0001', { epss: 0.5, kev: true });
      await attachCve(assetId, cveUuid);

      const findings = await scoredForAsset(assetId);

      expect(findings).toHaveLength(1);
      expect(findings[0].score).toBe(98);
      expect(findings[0].band).toBe('critical');
      expect(findings[0].factors.reachability.value).toBe(1);
      expect(findings[0].factors.threat.value).toBeCloseTo(0.933333, 5);
      expect(findings[0].exploitability).toBeCloseTo(0.966667, 5);
      expect(findings[0].factors.exploitationControls.weakestPath?.terms.declaredMu).toBe(0);
      expect(findings[0].factors.exploitationControls.value).toBe(1);
      expect(findings[0].factors.potentialImpact.value).toBe(1);
      expect(findings[0].impact).toBe(1);
    });

    it('should price the same flaw on a high asset at nine tenths of the potential impact the top band carries', async () => {
      // The flaw above, moved down one band: I = 0.9, so trunc(100 x sqrt(0.966667 x 0.9)) = 93.
      const assetId = await createAsset('Edge gateway (high)', { exposure: 'internet_facing', criticality: 'high' });
      const cveUuid = await insertCve('CVE-2026-0011', { epss: 0.5, kev: true });
      await attachCve(assetId, cveUuid);

      const findings = await scoredForAsset(assetId);

      expect(findings[0].factors.potentialImpact.value).toBeCloseTo(0.9, 10);
      expect(findings[0].score).toBe(93);
    });

    it('should score a silent flaw on an internal machine of unknown worth at the floors', async () => {
      // R = 0.4, T = 0.05 (base floor), so E = 0.225; I = 0.4 (unset, counted as low by default):
      // trunc(100 x sqrt(0.225 x 0.4)) = 30.
      const assetId = await createAsset('Internal box', { exposure: 'internal', criticality: 'unknown' });
      const cveUuid = await insertCve('CVE-2026-0002');
      await attachCve(assetId, cveUuid);

      const findings = await scoredForAsset(assetId);

      expect(findings[0].factors.potentialImpact.value).toBe(0.4);
      expect(findings[0].score).toBe(30);
      expect(findings[0].band).toBe('low');
      expect(findings[0].factors.threat.value).toBe(THREAT_FLOORS.base);
    });

    it('should read the CISA listing from its date, not from the kev flag a connector sets for an available exploit', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing' });
      const flagged = await insertCve('CVE-2026-0040', { kev: true, kevUpdatedAt: null });
      const listed = await insertCve('CVE-2026-0041', { kev: true, kevUpdatedAt: new Date('2026-01-01T00:00:00Z') });
      const dated = await insertCve('CVE-2026-0042', { kevUpdatedAt: new Date('2026-01-01T00:00:00Z') });
      const flaggedEvidence = await attachCve(assetId, flagged);
      const listedEvidence = await attachCve(assetId, listed);
      const datedEvidence = await attachCve(assetId, dated);

      const byEvidence = new Map((await scoredForAsset(assetId)).map((finding) => [finding.evidenceId, finding]));

      const families = (evidenceId: string) => byEvidence.get(evidenceId)?.factors.threat.terms.signals.map((signal) => signal.family);
      expect(families(flaggedEvidence)).not.toContain('known_exploited');
      expect(byEvidence.get(flaggedEvidence)?.factors.threat.value).toBe(THREAT_FLOORS.base);
      expect(families(listedEvidence)).toContain('known_exploited');
      expect(byEvidence.get(listedEvidence)?.factors.threat.value).toBe(0.9);
      expect(families(datedEvidence)).toContain('known_exploited');
    });

    it('should score a finding on an unclassified asset exactly as one on the band the tenant counts it as', async () => {
      const flaw = await insertCve('CVE-2026-0030', { kev: true });
      const unset = await createAsset('Unclassified host', { exposure: 'internet_facing' });
      await attachCve(unset, flaw);

      for (const band of ['medium', 'high', 'very_high'] as const) {
        const declared = await createAsset(`Host (${band})`, { exposure: 'internet_facing', criticality: band });
        await attachCve(declared, flaw);
        await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownCriticalityCountsAs: band });

        const [unsetFinding] = await scoredForAsset(unset);
        const [declaredFinding] = await scoredForAsset(declared);
        expect(unsetFinding.factors.potentialImpact).toEqual(declaredFinding.factors.potentialImpact);
        expect(unsetFinding.score).toBe(declaredFinding.score);
      }
    });

    it('should score a finding on an asset of unknown exposure exactly as one on the exposure the tenant counts it as', async () => {
      const flaw = await insertCve('CVE-2026-0031', { kev: true });
      const unknown = await createAsset('Unknown exposure host', { criticality: 'high' });
      await attachCve(unknown, flaw);

      for (const exposure of ['internal', 'internet_facing'] as const) {
        const declared = await createAsset(`Host (${exposure})`, { exposure, criticality: 'high' });
        await attachCve(declared, flaw);
        await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: exposure });

        const [unknownFinding] = await scoredForAsset(unknown);
        const [declaredFinding] = await scoredForAsset(declared);
        expect(unknownFinding.factors.reachability.value).toBe(declaredFinding.factors.reachability.value);
        expect(unknownFinding.factors.reachability.terms.exposureCountedAs).toBe(exposure);
        expect(unknownFinding.score).toBe(declaredFinding.score);
      }
    });

    it('should let the published vector narrow a flaw the base score cannot tell apart', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const remote = await insertCve('CVE-2026-0010', { kev: true }, undefined, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
      const awkward = await insertCve('CVE-2026-0011', { kev: true }, undefined, 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N');
      await attachCve(assetId, remote);
      await attachCve(assetId, awkward);

      const findings = await scoredForAsset(assetId);
      const byCve = new Map(findings.map((finding) => [finding.cveId, finding]));

      // Same signal, same asset, same band on CVSS: only the vector separates them.
      expect(byCve.get('CVE-2026-0010')?.score).toBeGreaterThan(byCve.get('CVE-2026-0011')?.score ?? 0);
      expect(byCve.get('CVE-2026-0011')?.factors.reachability.value)
        .toBeLessThan(byCve.get('CVE-2026-0010')?.factors.reachability.value ?? 0);
    });

    it('should report how long a finding has been open without folding it into the score', async () => {
      const assetId = await createAsset('Long open host', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0012'));
      await insertSyncedVerdict(evidenceId, 'dismissed', daysAgo(400));
      await insertSyncedVerdict(evidenceId, 'applicable', daysAgo(120));

      const findings = await scoredForAsset(assetId);

      // The latest entry into the state, not the earliest: it was dismissed and came back.
      const days = (Date.now() - (findings[0].currentStateSince?.getTime() ?? 0)) / DAY_MS;
      expect(Math.round(days)).toBe(120);
    });

    it('should open a finding at the test behind a late result, never before the row it follows', async () => {
      const assetId = await createAsset('Late result host', { exposure: 'internet_facing' });
      const reopenedLate = await attachCve(assetId, await insertCve('CVE-2026-0013'));
      const reopenedSoon = await attachCve(assetId, await insertCve('CVE-2026-0014'));
      const syncRow = (assetEvidenceId: string, state: 'applicable' | 'dismissed', learned: number, tested: number) => ({
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId, state, stateChangedAt: daysAgo(learned), observedAt: daysAgo(tested), origin: state === 'applicable' ? 'exposed' as const : 'not_exposed' as const,
      });
      await db.insert(assetEvidenceHistory).values([
        syncRow(reopenedLate, 'dismissed', 30, 30),
        syncRow(reopenedLate, 'applicable', 10, 60),
        syncRow(reopenedSoon, 'dismissed', 30, 30),
        syncRow(reopenedSoon, 'applicable', 10, 20),
      ]);

      const openFor = new Map((await scoredForAsset(assetId)).map((finding) => [
        finding.evidenceId,
        Math.round((Date.now() - (finding.currentStateSince?.getTime() ?? 0)) / DAY_MS),
      ]));

      expect(openFor.get(reopenedLate)).toBe(30);
      expect(openFor.get(reopenedSoon)).toBe(20);
    });

    it('should date a state the same way in the score and in the finding detail, a late closure included', async () => {
      const assetId = await createAsset('Late closure host', { exposure: 'internet_facing' });
      const reopenedLate = await attachCve(assetId, await insertCve('CVE-2026-0015'));
      const closedLate = await attachCve(assetId, await insertCve('CVE-2026-0016'));
      const now = Date.now();
      const at = (days: number) => new Date(now - days * DAY_MS);
      const syncRow = (assetEvidenceId: string, state: 'applicable' | 'dismissed', learned: number, tested: number) => ({
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId, state, stateChangedAt: at(learned), observedAt: at(tested), origin: state === 'applicable' ? 'exposed' as const : 'not_exposed' as const,
      });
      await db.insert(assetEvidenceHistory).values([
        syncRow(reopenedLate, 'dismissed', 30, 30),
        syncRow(reopenedLate, 'applicable', 10, 60),
        syncRow(closedLate, 'applicable', 40, 40),
        syncRow(closedLate, 'dismissed', 14, 17),
      ]);

      for (const [evidenceId, enteredDaysAgo] of [[reopenedLate, 30], [closedLate, 17]] as const) {
        const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
        const enteredAt = detail!.history.at(-1)!.enteredAt;

        expect(enteredAt).toEqual(at(enteredDaysAgo));
        expect((await breakdownOf(evidenceId))?.currentStateSince).toEqual(enteredAt);
      }
    });

    it('should keep the person who asked for the resync on the row, under the reset origin', async () => {
      const assetId = await createAsset('Audited host', { exposure: 'internet_facing' });
      const evidenceId = await attachTechnique(assetId, daysAgo(1), await createConnector());
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Accepted',
        changedByUserId: adminUserId,
      });

      await services.withOrigin(adminOrigin).supportingAssets.resetEvidenceState({
        evidenceId,
        changedByUserId: adminUserId,
      });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      const reset = detail?.history.at(-1);
      expect(reset?.origin).toBe('reset');
      // Stickiness keys off the origin, so naming the author costs the connector nothing and is
      // what keeps the trail readable.
      expect(reset?.changedByUserId).toBe(adminUserId);
    });

    it('should refuse to resync a finding no connector reports, which has nothing to hand back to', async () => {
      const assetId = await createAsset('Hand-attached host', { exposure: 'internet_facing' });
      const evidenceId = await attachTechnique(assetId, daysAgo(1));
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Accepted',
        changedByUserId: adminUserId,
      });

      await expect(services.withOrigin(adminOrigin).supportingAssets.resetEvidenceState({
        evidenceId,
        changedByUserId: adminUserId,
      })).rejects.toThrow();

      // The decision stands whole: a reset row would have dropped the type the person filed it under
      // in exchange for a handover no sync will ever come and honour.
      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      expect(detail?.history.at(-1)?.dismissalType).toBe('risk_accepted');
    });

    it('should refuse to resync a finding whose only source survived its connector\'s deletion', async () => {
      const assetId = await createAsset('Orphaned-source host', { exposure: 'internet_facing' });
      const evidenceId = await attachTechnique(assetId, daysAgo(1), await createConnector());
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Accepted',
        changedByUserId: adminUserId,
      });
      // Simulates what a connector deletion leaves behind (the FK is `onDelete: 'set null'`):
      // nothing deletes integration_settings today, so this is set directly.
      await db.update(assetEvidenceSources).set({ connectorId: null }).where(eq(assetEvidenceSources.assetEvidenceId, evidenceId));

      await expect(services.withOrigin(adminOrigin).supportingAssets.resetEvidenceState({
        evidenceId,
        changedByUserId: adminUserId,
      })).rejects.toThrow();

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      expect(detail?.history.at(-1)?.dismissalType).toBe('risk_accepted');
    });
  });

  describe('an aborted recompute', () => {
    it('should throw the abort reason and write no score', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'very_high' });
      await attachCve(assetId, await insertCve('CVE-2026-0001', { epss: 0.5, kev: true }));
      const controller = new AbortController();
      controller.abort('engine-shutdown');

      await expect(services.withOrigin(adminOrigin).findingScore.recomputeFindingScores({ signal: controller.signal }))
        .rejects.toBe('engine-shutdown');

      expect(await db.select({ id: findingScores.assetEvidenceId }).from(findingScores)
        .where(eq(findingScores.tenantId, adminTenantId))).toEqual([]);
    });

    it('should roll back every write when the abort comes at its last check before the commit', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'very_high' });
      await attachCve(assetId, await insertCve('CVE-2026-0001', { epss: 0.5, kev: true }));
      const storedScores = () => db.select({ id: findingScores.assetEvidenceId }).from(findingScores)
        .where(eq(findingScores.tenantId, adminTenantId));
      /** A signal aborted by its own `abortAtCheck`-th check, counting every check it is asked for. */
      const countingSignal = (abortAtCheck: number) => {
        const controller = new AbortController();
        const { signal } = controller;
        const check = signal.throwIfAborted.bind(signal);
        let checks = 0;
        signal.throwIfAborted = () => {
          checks += 1;
          if (checks === abortAtCheck) {
            controller.abort('engine-shutdown');
          }
          check();
        };
        return { signal, checks: () => checks };
      };
      const counted = countingSignal(Number.POSITIVE_INFINITY);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores({ signal: counted.signal });
      expect(await storedScores()).toHaveLength(1);
      await db.delete(findingScores).where(eq(findingScores.tenantId, adminTenantId));

      await expect(services.withOrigin(adminOrigin).findingScore.recomputeFindingScores({ signal: countingSignal(counted.checks()).signal }))
        .rejects.toBe('engine-shutdown');

      expect(await storedScores()).toEqual([]);
    });
  });

  describe('the technique mapping in the score', () => {
    /** Carried by the curated corpus, so the write path resolves it to exploitation techniques. */
    const insertLog4shell = async (): Promise<string> => insertCve(
      'CVE-2021-44228',
      { kev: true },
      undefined,
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
    );

    /** Written through the service, which is the path that resolves techniques. */
    const writeCveFinding = async (supportingAssetId: string, cveUuid: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id, supportingAssetId, cve: { rowId: cveUuid }, userId: adminUserId,
      });
      return id;
    };

    it('should read the exploitation controls on a flaw whose techniques are mapped', async () => {
      const assetId = await createAsset('Mapped host', { exposure: 'internet_facing', criticality: 'high' });
      await writeCveFinding(assetId, await insertLog4shell());

      const findings = await scoredForAsset(assetId);

      expect(findings[0].score).toBe(Math.trunc(100 * Math.sqrt(findings[0].exploitability * findings[0].impact)));
      // Nothing declared stands on the mapped techniques, so everything gets through.
      expect(findings[0].factors.exploitationControls.value).toBe(1);
      expect(findings[0].factors.impactControls.value).toBe(1);
    });

    /** A flaw with no vector is never scored, but its page still draws the evidence beside the missing figure. */
    const pendingBreakdownOf = async (evidenceId: string) => {
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const breakdown = await services.withOrigin(adminOrigin).findingScore.getFindingScoreBreakdown(evidenceId);
      if (breakdown === null || breakdown.score !== null) {
        throw new Error(`The recompute scored finding ${evidenceId}`);
      }
      return breakdown;
    };

    it('should leave a flaw that resolved to nothing pending its vector, with no mitigation listed', async () => {
      const assetId = await createAsset('Unmapped host', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await writeCveFinding(assetId, await insertCve('CVE-2024-6387', {}, undefined, null));

      const breakdown = await pendingBreakdownOf(evidenceId);

      expect(breakdown.pendingVector).toBe(true);
      expect(breakdown.columns.techniques).toEqual({ state: 'unresolved', rows: [] });
      expect(breakdown.columns.mitigations).toBeNull();
      expect(breakdown.columns.impactControls.mitigations).toBeNull();
    });

    it('should list every mapped technique with its provenance, exploitation first', async () => {
      const assetId = await createAsset('Mapped host', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await writeCveFinding(assetId, await insertLog4shell());

      const breakdown = await breakdownOf(evidenceId);

      const techniques = breakdown?.columns.techniques;
      expect(techniques?.state).toBe('resolved');
      expect(techniques?.rows.length ?? 0).toBeGreaterThan(0);
      expect(techniques?.rows.every((row) => row.externalId.startsWith('T') && row.name.length > 0)).toBe(true);
      const roles = techniques?.rows.map((row) => row.role) ?? [];
      const firstImpact = roles.findIndex((role) => role !== 'exploitation_technique');
      expect(firstImpact === -1 || roles.slice(firstImpact).every((role) => role !== 'exploitation_technique')).toBe(true);
      // The controls column explains the factor, so it draws for a mapped flaw as well.
      expect(breakdown?.columns.mitigations).not.toBeNull();
      expect(breakdown?.columns.validation).toBeNull();
    });

    it('should keep the mapping out of a finding inserted behind the write path', async () => {
      const assetId = await createAsset('Legacy host', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2021-44228', { kev: true }, undefined, null));

      const breakdown = await pendingBreakdownOf(evidenceId);

      expect(breakdown.columns.techniques).toBeNull();
    });
  });

  describe('the exploitation technique of a finding', () => {
    const NETWORK_NO_USER = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
    const NOT_CURATED = 'CVE-2099-0001';

    const writeOn = async (cveUuid: string, exposure: 'internet_facing' | 'internal' | 'unknown'): Promise<string> => {
      const assetId = await createAsset(`Host ${exposure}`, { exposure, criticality: 'high' });
      const evidenceId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId, supportingAssetId: assetId, cve: { rowId: cveUuid }, userId: adminUserId,
      });
      return evidenceId;
    };

    const exploitationOf = async (evidenceId: string) => {
      const breakdown = await breakdownOf(evidenceId);
      return (breakdown?.columns.techniques?.rows ?? []).filter((row) => row.group === 'exploitation');
    };

    it('should take the curated exploitation technique for a curated CVE, whatever the asset', async () => {
      const cveUuid = await insertCve('CVE-2021-44228', {}, undefined, NETWORK_NO_USER);
      const rows = await exploitationOf(await writeOn(cveUuid, 'internal'));
      expect(rows.map((row) => [row.externalId, row.lane])).toEqual([['T1190', 'curated']]);
    });

    it('should give T1190 to a network flaw needing nobody on an internet-facing asset', async () => {
      const rows = await exploitationOf(await writeOn(await insertCve(NOT_CURATED, {}, undefined, NETWORK_NO_USER), 'internet_facing'));
      expect(rows.map((row) => [row.externalId, row.lane])).toEqual([['T1190', 'topology']]);
    });

    it('should give T1210 to the same flaw on an internal asset', async () => {
      const rows = await exploitationOf(await writeOn(await insertCve(NOT_CURATED, {}, undefined, NETWORK_NO_USER), 'internal'));
      expect(rows.map((row) => row.externalId)).toEqual(['T1210']);
    });

    it.each([
      ['internal', 'T1210'],
      ['internet_facing', 'T1190'],
    ] as const)('should give the same flaw on an asset of unknown exposure counted as %s the technique of that exposure', async (counted, technique) => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: counted });
      const rows = await exploitationOf(await writeOn(await insertCve(NOT_CURATED, {}, undefined, NETWORK_NO_USER), 'unknown'));
      expect(rows.map((row) => row.externalId)).toEqual([technique]);
    });

    // NAC prevents T1210 and not T1190, ZTNA the reverse: reading both techniques on the unknown asset
    // would score it on the one left unprotected.
    it.each([
      ['internal', 'NAC'],
      ['internet_facing', 'ZTNA'],
    ] as const)('should score a flaw on an asset of unknown exposure counted as %s on that exposure\'s technique alone', async (counted, control) => {
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const declared = capabilities.find((capability) => capability.externalId === control);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(declared!.id, 'L3', 'L3', null);
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: counted });
      const cveUuid = await insertCve(NOT_CURATED, {}, undefined, NETWORK_NO_USER);
      const unknownId = await writeOn(cveUuid, 'unknown');
      const declaredId = await writeOn(cveUuid, counted);

      const unknown = await breakdownOf(unknownId);
      const onDeclared = await breakdownOf(declaredId);
      expect(onDeclared?.factors.exploitationControls.value).toBeLessThan(1);
      expect(unknown?.factors.exploitationControls).toEqual(onDeclared?.factors.exploitationControls);
      expect(unknown?.score).toBe(onDeclared?.score);
    });

    it('should give T1078.001 to a hard-coded credential', async () => {
      const cveUuid = await insertCve(NOT_CURATED, {}, undefined, NETWORK_NO_USER, ['CWE-798']);
      const rows = await exploitationOf(await writeOn(cveUuid, 'internet_facing'));
      expect(rows.map((row) => [row.externalId, row.justification]))
        .toEqual([['T1078.001', { kind: 'topology', reading: { kind: 'weakness', cwe: 'CWE-798' } }]]);
    });

    it('should score the finding on the technique the rule reads', async () => {
      const evidenceId = await writeOn(await insertCve(NOT_CURATED, {}, undefined, NETWORK_NO_USER), 'internal');
      const breakdown = await breakdownOf(evidenceId);
      expect(breakdown?.factors.exploitationControls.weakestPath).not.toBeNull();
      expect(breakdown?.columns.weakestPath).toEqual({ externalId: 'T1210', confidence: 'medium' });
    });
  });

  describe('the asset family rule on a finding\'s techniques', () => {
    /** One CVE row per tenant, so the same flaw reaching two families comes from one vulnerability. */
    const log4shell = async (): Promise<string> => insertCve(
      'CVE-2021-44228',
      { kev: true },
      undefined,
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
      ['CWE-917', 'CWE-502', 'CWE-20'],
    );

    const writeOn = async (
      cveUuid: string,
      category: 'host' | 'web_application' | 'generic_asset',
    ): Promise<string> => {
      const assetId = await createAsset(`Log4shell ${category}`, { exposure: 'internet_facing', criticality: 'high', category });
      const evidenceId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId, supportingAssetId: assetId, cve: { rowId: cveUuid }, userId: adminUserId,
      });
      return evidenceId;
    };

    const exploitationRows = async (evidenceId: string) => {
      const breakdown = await breakdownOf(evidenceId);
      const rows = (breakdown?.columns.techniques?.rows ?? []).filter((row) => row.role === 'exploitation_technique');
      return {
        breakdown,
        carried: rows.filter((row) => row.carriedByAssetFamily).map((row) => row.externalId),
        setAside: rows.filter((row) => !row.carriedByAssetFamily).map((row) => row.externalId),
      };
    };

    it('should narrow the same flaw down on a web application and leave it whole on a host', async () => {
      const cveUuid = await log4shell();
      const onHost = await exploitationRows(await writeOn(cveUuid, 'host'));
      const onWebApplication = await exploitationRows(await writeOn(cveUuid, 'web_application'));

      expect(onHost.setAside).toEqual([]);
      expect(onWebApplication.setAside.length).toBeGreaterThan(0);
      expect(onWebApplication.carried.length).toBeLessThan(onHost.carried.length);
      expect(onWebApplication.carried).toContain('T1190');
      expect(onWebApplication.carried.every((externalId) => onHost.carried.includes(externalId))).toBe(true);
    });

    it('should score the web application on what it carries and nothing else', async () => {
      const { breakdown, carried, setAside } = await exploitationRows(await writeOn(await log4shell(), 'web_application'));

      expect(breakdown?.factors.exploitationControls.weakestPath).not.toBeNull();
      expect(setAside.length).toBeGreaterThan(0);
      expect(carried).toContain(breakdown?.columns.weakestPath?.externalId);
      expect(breakdown?.columns.uncoveredTechniqueExternalIds.some((id) => setAside.includes(id))).toBe(false);
    });

    it('should leave the unclassified bucket carrying every resolved technique', async () => {
      const { setAside, carried } = await exploitationRows(await writeOn(await log4shell(), 'generic_asset'));

      expect(setAside).toEqual([]);
      expect(carried.length).toBeGreaterThan(0);
    });

    it('should read a finding the same way whatever else the estate asks the branch rule about', async () => {
      // The score asks about the whole scope's techniques at once and the columns about this
      // finding's alone, so the two answers agree only if neither request shapes the other's.
      const cveUuid = await log4shell();
      const evidenceId = await writeOn(cveUuid, 'web_application');
      const alone = await exploitationRows(evidenceId);

      await writeOn(cveUuid, 'host');
      const alongside = await exploitationRows(evidenceId);

      expect(alongside.carried).toEqual(alone.carried);
      expect(alongside.setAside).toEqual(alone.setAside);
      expect(alongside.breakdown?.factors.exploitationControls.value)
        .toBe(alone.breakdown?.factors.exploitationControls.value);
    });

    it('should keep every technique the weakness makes possible out of the exploitability', async () => {
      const { breakdown } = await exploitationRows(await writeOn(await log4shell(), 'web_application'));
      const weaknessIds = (breakdown?.columns.techniques?.rows ?? [])
        .filter((row) => row.group === 'weakness')
        .map((row) => row.mitreTechniqueId);
      const exploitationIds = breakdown?.factors.exploitationControls.paths.map((path) => path.techniqueId) ?? [];

      expect(weaknessIds.length).toBeGreaterThan(0);
      expect(weaknessIds.some((id) => exploitationIds.includes(id))).toBe(false);
    });

    it('should never set an impact technique aside by the asset family', async () => {
      const { breakdown } = await exploitationRows(await writeOn(await log4shell(), 'web_application'));
      const namedImpactRows = (breakdown?.columns.techniques?.rows ?? [])
        .filter((row) => row.group === 'primary_impact' || row.group === 'secondary_impact');
      const impactIds = breakdown?.factors.impactControls.paths.map((path) => path.techniqueId) ?? [];

      expect(namedImpactRows.length).toBeGreaterThan(0);
      expect(namedImpactRows.every((row) => impactIds.includes(row.mitreTechniqueId))).toBe(true);
    });

    it('should average only the impacts named for the vulnerability when it has some', async () => {
      const { breakdown } = await exploitationRows(await writeOn(await log4shell(), 'host'));
      const weaknessIds = (breakdown?.columns.techniques?.rows ?? [])
        .filter((row) => row.group === 'weakness')
        .map((row) => row.mitreTechniqueId);
      const impactPaths = breakdown?.factors.impactControls.paths ?? [];

      expect(weaknessIds.length).toBeGreaterThan(0);
      expect(impactPaths.some((path) => weaknessIds.includes(path.techniqueId))).toBe(false);
      expect(impactPaths.every((path) => path.terms.claimConfidence === 'high')).toBe(true);
      expect(breakdown?.factors.impactControls.aggregation).toBe('mean');
    });

    it('should average the techniques the weakness makes possible when no impact is named', async () => {
      const cveUuid = await insertCve(
        'CVE-2099-0002',
        {},
        undefined,
        'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
        ['CWE-917', 'CWE-502', 'CWE-20'],
      );
      const { breakdown } = await exploitationRows(await writeOn(cveUuid, 'host'));
      const weaknessIds = (breakdown?.columns.techniques?.rows ?? [])
        .filter((row) => row.group === 'weakness')
        .map((row) => row.mitreTechniqueId);
      const impactIds = breakdown?.factors.impactControls.paths.map((path) => path.techniqueId) ?? [];

      expect(weaknessIds.length).toBeGreaterThan(0);
      expect(weaknessIds.every((id) => impactIds.includes(id))).toBe(true);
    });
  });

  describe('the protection gate on mitigations', () => {
    /** WAF stands on web applications and AI targets, never on hosts, and it is the only control declared above L0 here. */
    const declareWaf = async (): Promise<void> => {
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const waf = capabilities.find((capability) => capability.externalId === 'WAF');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(waf!.id, 'L2', 'L3', null);
    };

    const writeCveFinding = async (supportingAssetId: string, cveUuid: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id, supportingAssetId, cve: { rowId: cveUuid }, userId: adminUserId,
      });
      return id;
    };

    /** Resolved by the curated corpus to T1190 as its only exploitation technique. */
    const insertLog4shell = async (): Promise<string> => insertCve('CVE-2021-44228', { kev: true });

    it('should credit a control only where it can stand, and spread it on an unclassified asset', async () => {
      await declareWaf();
      const onFamily = await createAsset('Storefront', { criticality: 'high', category: 'web_application' });
      const offFamily = await createAsset('Crown host', { criticality: 'high', category: 'host' });
      const unclassified = await createAsset('Mystery box', { criticality: 'high', category: 'generic_asset' });
      const log4shell = await insertLog4shell();
      await writeCveFinding(onFamily, log4shell);
      await writeCveFinding(offFamily, log4shell);
      await writeCveFinding(unclassified, log4shell);

      const residualOf = async (assetId: string): Promise<number> => {
        const [finding] = await scoredForAsset(assetId);
        return finding?.factors.exploitationControls.value ?? Number.NaN;
      };

      // Full credit on the family the WAF stands on, a third of it on the unclassified asset,
      // which reads the estate spread over three equally weighted assets, none off family.
      expect(await residualOf(onFamily)).toBeLessThan(await residualOf(unclassified));
      expect(await residualOf(unclassified)).toBeLessThan(1);
      expect(await residualOf(offFamily)).toBe(1);
    });

    it('should flag the controls the family gate keeps out rather than dropping them', async () => {
      await declareWaf();
      const onFamily = await createAsset('Storefront', { criticality: 'high', category: 'web_application' });
      const offFamily = await createAsset('Crown host', { criticality: 'high', category: 'host' });
      const log4shell = await insertLog4shell();
      const creditedId = await writeCveFinding(onFamily, log4shell);
      const gatedId = await writeCveFinding(offFamily, log4shell);

      const credited = await breakdownOf(creditedId);
      const gated = await breakdownOf(gatedId);

      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const wafId = capabilities.find((capability) => capability.externalId === 'WAF')!.id;
      const wafRow = (breakdown: typeof credited) =>
        breakdown?.columns.mitigations?.find((control) => control.capabilityId === wafId);
      expect(wafRow(credited)?.protectsAssetFamily).toBe(true);
      // The column carries the gated row and marks it, so a surface can state that the control
      // stands here and earns nothing; every panel that draws credit filters on that flag.
      expect(wafRow(gated)?.protectsAssetFamily).toBe(false);
    });

    /*
     * A PAM vault and bastion run on servers, and an attack signing in with an identity's default
     * account still runs into the credentials they rotate, so the gate credits PAM on a family it is
     * never installed on.
     */
    it('should credit a control that protects the family without running on it', async () => {
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const pam = capabilities.find((capability) => capability.externalId === 'PAM');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(pam!.id, 'L2', 'L3', null);
      const identityAsset = await createAsset('Domain admin', { exposure: 'internet_facing', criticality: 'high', category: 'identity' });
      // A hard-coded credential reaches T1078.001, which an identity carries.
      const evidenceId = await writeCveFinding(
        identityAsset,
        await insertCve('CVE-2099-0798', {}, undefined, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', ['CWE-798']),
      );

      const breakdown = await breakdownOf(evidenceId);

      expect(breakdown?.factors.exploitationControls.value).toBeLessThan(1);
      expect(breakdown?.columns.mitigations?.map((control) => control.capabilityId)).toContain(pam!.id);
    });

    it('should let a technique a control only detects through less, but never below what a detection takes off', async () => {
      // NDR detects T1190 without preventing it, and protects hosts.
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const ndr = capabilities.find((capability) => capability.externalId === 'NDR');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(ndr!.id, 'L3', 'L3', null);
      const host = await createAsset('Edge host', { criticality: 'high', category: 'host' });
      const evidenceId = await writeCveFinding(host, await insertLog4shell());

      const breakdown = await breakdownOf(evidenceId);
      const controls = breakdown?.factors.exploitationControls;

      expect(controls?.weakestPath?.terms.preventionLetThrough).toBe(1);
      expect(controls?.weakestPath?.terms.detectMu).toBeGreaterThan(0);
      expect(controls?.value).toBeLessThan(1);
      expect(controls?.value).toBeGreaterThanOrEqual(1 - DETECTION_CREDIT);
      expect(breakdown?.columns.exploitationTechniques[0]?.detectingCapabilityIds).toEqual([ndr!.id]);
      expect(breakdown?.resistance.exploitation?.detection.contributions.map((contribution) => contribution.capabilityId)).toEqual([ndr!.id]);
    });

    it('should credit a control on an impact technique from the whole estate, not the asset family', async () => {
      // SIEM and SOC protect every family, so declaring every control would leave no impact technique held off family alone.
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const pairs = await services.withOrigin(adminOrigin).controlCapabilities.getProtectedFamilies(capabilities.map((capability) => capability.id));
      const offWebApplication = capabilities.filter((capability) => !pairs
        .some((pair) => pair.capabilityId === capability.id && pair.categoryId === 'web_application'));
      for (const capability of offWebApplication) {
        await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(capability.id, 'L3', 'L3', null);
      }
      const storefront = await createAsset('Storefront', { criticality: 'high', category: 'web_application' });
      await createAsset('Crown host', { criticality: 'high', category: 'host' });
      const evidenceId = await writeCveFinding(storefront, await insertLog4shell());

      const breakdown = await breakdownOf(evidenceId);
      const impactControls = breakdown?.columns.impactControls.mitigations ?? [];
      const creditedIds = impactControls.filter((control) => control.scoredHere).map((control) => control.capabilityId);
      const protectedFamilies = await services.withOrigin(adminOrigin).controlCapabilities.getProtectedFamilies(creditedIds);
      const offFamily = creditedIds.filter((capabilityId) => !protectedFamilies
        .some((pair) => pair.capabilityId === capabilityId && pair.categoryId === 'web_application'));

      const letThroughOf = new Map(breakdown?.factors.impactControls.paths.map((path) => [path.techniqueId, path.value]));
      const heldOffFamily = (breakdown?.columns.impactControls.techniques ?? []).filter((technique) => {
        const credited = [...technique.preventingCapabilityIds, ...technique.detectingCapabilityIds];
        return credited.length > 0 && credited.every((id) => offFamily.includes(id));
      });

      expect(heldOffFamily.length).toBeGreaterThan(0);
      expect(heldOffFamily.every((technique) => (letThroughOf.get(technique.mitreTechniqueId) ?? 1) < 1)).toBe(true);
    });

    it('should let an impact technique a control only detects through less, but never below what a detection takes off', async () => {
      // SIEM, the only control declared, detects T1496, one of Log4Shell's curated impacts, without preventing it.
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const siem = capabilities.find((capability) => capability.externalId === 'SIEM');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(siem!.id, 'L3', 'L3', null);
      const storefront = await createAsset('Storefront', { criticality: 'high', category: 'web_application' });
      await createAsset('Crown host', { criticality: 'high', category: 'host' });
      const evidenceId = await writeCveFinding(storefront, await insertLog4shell());

      const breakdown = await breakdownOf(evidenceId);
      const resourceHijacking = breakdown?.columns.impactControls.techniques.find((technique) => technique.externalId === 'T1496');
      const path = breakdown?.factors.impactControls.paths.find((candidate) => candidate.techniqueId === resourceHijacking?.mitreTechniqueId);

      expect(resourceHijacking?.preventingCapabilityIds).toEqual([]);
      expect(resourceHijacking?.detectingCapabilityIds).toEqual([siem!.id]);
      expect(path?.terms.preventionLetThrough).toBe(1);
      expect(path?.terms.detectMu).toBeGreaterThan(0);
      expect(path?.value).toBeLessThan(1);
      expect(path?.value).toBeGreaterThanOrEqual(1 - DETECTION_CREDIT);
    });

    // EDR protects hosts alone, so it holds T1496 on the share of the estate the hosts weigh, and
    // an unknown host weighs what the tenant counts it as.
    it('should weigh an unknown asset in its family\'s share of the estate as the exposure the tenant counts it as', async () => {
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const edr = capabilities.find((capability) => capability.externalId === 'EDR');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(edr!.id, 'L3', 'L3', null);
      const storefront = await createAsset('Storefront', { exposure: 'internet_facing', criticality: 'high', category: 'web_application' });
      await createAsset('Crown host', { exposure: 'unknown', criticality: 'high', category: 'host' });
      const evidenceId = await writeCveFinding(storefront, await insertLog4shell());

      const resourceHijackingLetThrough = async (counted: 'internal' | 'internet_facing'): Promise<number | undefined> => {
        await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: counted });
        const breakdown = await breakdownOf(evidenceId);
        const resourceHijacking = breakdown.columns.impactControls.techniques.find((technique) => technique.externalId === 'T1496');
        return breakdown.factors.impactControls.paths.find((path) => path.techniqueId === resourceHijacking?.mitreTechniqueId)?.value;
      };

      const asInternal = await resourceHijackingLetThrough('internal');
      const asInternetFacing = await resourceHijackingLetThrough('internet_facing');

      expect(asInternal).toBeLessThan(1);
      expect(asInternetFacing).toBeLessThan(asInternal!);
    });
  });
});
