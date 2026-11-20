import type { EventOrigin } from '@app/module';
import {
  AttackOutcome_Ransomware,
  BudgetReviewClosedError,
  budgetReviewClosedFigures,
  budgetReviewClosedPostures,
  BudgetReviewInvalidInputError,
  BudgetReviewNotClosedError,
  BudgetReviewNotFoundError,
  BudgetReviewNotPricedError,
  budgetReviews,
  BusinessValueCategory_PersonalData,
  controlCapabilityAssessmentEvents,
  crqBudgetReviewResults,
  crqIndicatorRuns,
  deriveSeedId,
  LossDriver_LostMarginFromDowntime,
  reviewFigureSlots,
} from '@app/module';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const THIS_YEAR = new Date().getUTCFullYear();
const LAST_YEAR = THIS_YEAR - 1;
const THIS_YEAR_START = `${THIS_YEAR}-01-01`;
const LAST_YEAR_START = `${LAST_YEAR}-01-01`;

describe('Budget Reviews Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let capabilityIds: Array<string>;

  const scoped = () => services.withOrigin(adminOrigin);

  const createOrganization = async (origin: EventOrigin, name: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id, name }]);
    return id;
  };

  const createReview = (values: Partial<{ periodStart: string, name: string }> = {}) =>
    scoped().budgetReviews.createBudgetReview({ organizationId, name: values.name ?? 'Exercice', periodStart: values.periodStart ?? THIS_YEAR_START });

  const versionOf = async (reviewId: string) => (await scoped().budgetReviews.getBudgetReview(reviewId))!.version;

  /** Every posture line of one control, the tenant's or one scope's, moved to the date given. */
  const dateEvents = async (capabilityId: string, createdAt: Date, scope?: string) => {
    await db.update(controlCapabilityAssessmentEvents)
      .set({ createdAt })
      .where(and(
        eq(controlCapabilityAssessmentEvents.capabilityId, capabilityId),
        scope === undefined ? isNull(controlCapabilityAssessmentEvents.organizationId) : eq(controlCapabilityAssessmentEvents.organizationId, scope),
      ));
  };

  const postureOf = async (reviewId: string, capabilityId: string) =>
    (await scoped().budgetReviews.getBudgetReviewControlPostures(reviewId))!.controls.find((control) => control.capabilityId === capabilityId);

  let pricingScenarioId: string | undefined;

  const createReadyScenario = async (): Promise<string> => {
    const primaryAssetId = uuidv7();
    await scoped().primaryAssets.createPrimaryAsset({
      id: primaryAssetId,
      organizationId,
      name: 'Customer records',
      description: null,
      ownerId: null,
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_PersonalData)],
    });
    const id = uuidv7();
    await scoped().riskScenarios.createRiskScenario({
      id, organizationId, name: 'Data theft', description: null, attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware), primaryAssetIds: [primaryAssetId],
    });
    await scoped().riskScenarios.setTefMode(id, 'manual');
    await scoped().crqIndicators.upsertTefInput({ riskScenarioId: id, min: 0.5, likely: 1.5, max: 4 });
    await scoped().scenarioLossEstimates.upsertScenarioLossEstimates(id, [
      { lossDriverId: deriveSeedId(tenantId, LossDriver_LostMarginFromDowntime), action: 'set', minValue: 100_000, likelyValue: 600_000, maxValue: 3_000_000 },
    ], { maxUpdatedAt: null, rowCount: 0 });
    return id;
  };

  /** Every figure of the review priced at its current version, as a run of the scope's one ready scenario would store it. */
  const priceReview = async (reviewId: string) => {
    pricingScenarioId ??= await createReadyScenario();
    const runId = uuidv7();
    await db.insert(crqIndicatorRuns).values({
      id: runId,
      riskScenarioId: pricingScenarioId,
      iterations: 1,
      vulnerabilityP5: 0,
      vulnerabilityP50: 0,
      vulnerabilityP95: 0,
      techniqueCount: 0,
      coveredTechniqueCount: 0,
    });
    const review = (await scoped().budgetReviews.getBudgetReview(reviewId))!;
    await db.insert(crqBudgetReviewResults).values(reviewFigureSlots(review.lines).map(({ basket, lineId }) => ({
      id: uuidv7(),
      runId,
      reviewId,
      reviewVersion: review.version,
      basket,
      lineId,
      aleReductionMean: 1000,
      aleReductionP10: 600,
      aleReductionP90: 1800,
    })));
  };

  const priceAndClose = async (reviewId: string) => {
    await priceReview(reviewId);
    await scoped().budgetReviews.closeBudgetReview(reviewId);
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    pricingScenarioId = undefined;
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    organizationId = await createOrganization(adminOrigin, 'Payment platform');
    capabilityIds = (await scoped().controlCapabilities.getControlCapabilities()).slice(0, 4).map((capability) => capability.id);
  });

  describe('CRUD', () => {
    it('should create an open review at version 1, with no line', async () => {
      const id = await scoped().budgetReviews.createBudgetReview({
        organizationId, name: 'Exercice', periodStart: THIS_YEAR_START, ownerId: adminUserId, context: 'For the management review',
      });

      const review = await scoped().budgetReviews.getBudgetReview(id);
      expect(review).toMatchObject({
        name: 'Exercice', periodStart: THIS_YEAR_START, periodEnd: `${THIS_YEAR}-12-31`, status: 'open', version: 1, ownerId: adminUserId,
        context: 'For the management review', organization: { id: organizationId, name: 'Payment platform' },
      });
      expect(review!.lines).toEqual([]);
    });

    it('should end a period starting in April on 31 March of the next year', async () => {
      const id = await createReview({ periodStart: `${LAST_YEAR}-04-01` });

      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ periodStart: `${LAST_YEAR}-04-01`, periodEnd: `${THIS_YEAR}-03-31` });
    });

    it('should refuse a period starting in a month that has not started yet, or on a day other than the first', async () => {
      await expect(createReview({ periodStart: `${THIS_YEAR + 1}-01-01` })).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      await expect(createReview({ periodStart: `${LAST_YEAR}-04-15` })).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
    });

    it('should refuse a risk scope that does not exist', async () => {
      await expect(scoped().budgetReviews.createBudgetReview({ organizationId: uuidv7(), name: 'Exercice', periodStart: THIS_YEAR_START }))
        .rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
    });

    it('should refuse an owner who is not a member of the tenant, on creation and on update', async () => {
      const outsider = (await createUser(db)).userId;
      const id = await createReview();

      await expect(scoped().budgetReviews.createBudgetReview({ organizationId, name: 'Exercice', periodStart: THIS_YEAR_START, ownerId: outsider }))
        .rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      await expect(scoped().budgetReviews.updateBudgetReview(id, { ownerId: outsider })).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ ownerId: null });
    });

    it('should list only the reviews of the named risk scope, with their spend', async () => {
      const otherScope = await createOrganization(adminOrigin, 'Retail');
      const id = await createReview();
      await scoped().budgetReviews.createBudgetReview({ organizationId: otherScope, name: 'Other', periodStart: THIS_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1000, capabilityIds: [] });

      const listed = await scoped().budgetReviews.getBudgetReviews(organizationId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        id, lineCount: 1, spent: 1000, aleReductionMean: null, aleReductionP10: null, aleReductionP90: null, state: 'not-priced', pricedAt: null,
        build: { spent: 0, aleReductionMean: null, aleReductionP10: null, aleReductionP90: null, returnPercent: null, state: 'not-priced' },
      });
      expect(await scoped().budgetReviews.getBudgetReviews()).toHaveLength(2);
    });

    it('should update a review and delete it', async () => {
      const id = await createReview();
      await scoped().budgetReviews.updateBudgetReview(id, { name: 'Renamed' });
      expect((await scoped().budgetReviews.getBudgetReview(id))!.name).toBe('Renamed');

      await scoped().budgetReviews.deleteBudgetReviews([id]);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toBeUndefined();
    });

    it('should move an open review\'s period and bump the version, and only when the period changes', async () => {
      const id = await createReview({ periodStart: THIS_YEAR_START });

      await scoped().budgetReviews.updateBudgetReview(id, { periodStart: THIS_YEAR_START, name: 'Renamed' });
      expect(await versionOf(id)).toBe(1);

      await scoped().budgetReviews.updateBudgetReview(id, { periodStart: `${LAST_YEAR}-04-01` });
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({
        name: 'Renamed', periodStart: `${LAST_YEAR}-04-01`, periodEnd: `${THIS_YEAR}-03-31`, version: 2,
      });
    });

    it('should refuse a period that does not start on the first day of a past or the current month', async () => {
      const id = await createReview();

      await expect(scoped().budgetReviews.updateBudgetReview(id, { periodStart: `${THIS_YEAR + 1}-01-01` })).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      await expect(scoped().budgetReviews.updateBudgetReview(id, { periodStart: `${LAST_YEAR}-04-15` })).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ periodStart: THIS_YEAR_START, version: 1 });
    });
  });

  describe('lines', () => {
    it('should create a line with its controls and bump the version', async () => {
      const id = await createReview();
      const lineId = await scoped().budgetReviews.createBudgetReviewLine(id, {
        name: 'Identity project', nature: 'build', amountSpent: 200_000, capabilityIds: capabilityIds.slice(0, 2),
      });

      const review = await scoped().budgetReviews.getBudgetReview(id);
      expect(review!.version).toBe(2);
      expect(review!.lines).toHaveLength(1);
      expect(review!.lines[0]).toMatchObject({ id: lineId, name: 'Identity project', nature: 'build', amountSpent: 200_000 });
      expect([...review!.lines[0].capabilityIds].sort()).toEqual(capabilityIds.slice(0, 2).sort());
    });

    it('should bump the version when the controls or the nature move, and only then', async () => {
      const id = await createReview();
      const lineId = await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Line', nature: 'run', amountSpent: 10, capabilityIds: [capabilityIds[0]] });
      expect(await versionOf(id)).toBe(2);

      await scoped().budgetReviews.updateBudgetReviewLine(lineId, { name: 'Renamed', amountSpent: 20 });
      expect(await versionOf(id)).toBe(2);
      await scoped().budgetReviews.updateBudgetReviewLine(lineId, { capabilityIds: [capabilityIds[0]] });
      expect(await versionOf(id)).toBe(2);

      await scoped().budgetReviews.updateBudgetReviewLine(lineId, { capabilityIds: [capabilityIds[0], capabilityIds[1]] });
      expect(await versionOf(id)).toBe(3);
      await scoped().budgetReviews.updateBudgetReviewLine(lineId, { nature: 'build' });
      expect(await versionOf(id)).toBe(4);
      await scoped().budgetReviews.deleteBudgetReviewLines([lineId]);
      expect(await versionOf(id)).toBe(5);
      expect((await scoped().budgetReviews.getBudgetReview(id))!.lines).toEqual([]);
    });

    it('should refuse a control already in another build line, and allow it in a run line', async () => {
      const id = await createReview();
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Project A', nature: 'build', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      await expect(scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Project B', nature: 'build', amountSpent: 1, capabilityIds: [capabilityIds[0]] }))
        .rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      await expect(scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] }))
        .resolves.toBeTypeOf('string');
    });

    it('should refuse turning a line into a build line over a control another build line holds', async () => {
      const id = await createReview();
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Project', nature: 'build', amountSpent: 1, capabilityIds: [capabilityIds[0]] });
      const runLine = await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      await expect(scoped().budgetReviews.updateBudgetReviewLine(runLine, { nature: 'build' })).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      expect(await versionOf(id)).toBe(3);
    });

    it('should keep a build line\'s amortization years without moving the version, and drop them on a run line', async () => {
      const id = await createReview();
      const buildLine = await scoped().budgetReviews.createBudgetReviewLine(id, {
        name: 'Identity project', nature: 'build', amountSpent: 120_000, amortizationYears: 3, capabilityIds: [capabilityIds[0]],
      });
      const runLine = await scoped().budgetReviews.createBudgetReviewLine(id, {
        name: 'Licences', nature: 'run', amountSpent: 30_000, amortizationYears: 4, capabilityIds: [capabilityIds[1]],
      });
      const lineOf = async (lineId: string) => (await scoped().budgetReviews.getBudgetReview(id))!.lines.find((line) => line.id === lineId)!;

      expect((await lineOf(buildLine)).amortizationYears).toBe(3);
      expect((await lineOf(runLine)).amortizationYears).toBeNull();
      const figures = (await scoped().budgetReviews.getBudgetReviewFigures(id))!.figures;
      expect(figures.find((figure) => figure.basket === 'build')).toMatchObject({ spent: 120_000, annualSpent: 40_000 });
      expect(figures.find((figure) => figure.basket === 'ensemble')).toMatchObject({ spent: 150_000, annualSpent: 70_000 });

      await scoped().budgetReviews.updateBudgetReviewLine(buildLine, { amortizationYears: 5 });
      expect((await lineOf(buildLine)).amortizationYears).toBe(5);
      expect(await versionOf(id)).toBe(3);

      await scoped().budgetReviews.updateBudgetReviewLine(buildLine, { nature: 'run' });
      expect((await lineOf(buildLine)).amortizationYears).toBeNull();
    });

    it('should list every NIST CSF function the controls of a line map to', async () => {
      const capabilities = await scoped().controlCapabilities.getControlCapabilities();
      const idOf = (externalId: string) => capabilities.find((capability) => capability.externalId === externalId)!.id;
      const id = await createReview();
      await scoped().budgetReviews.createBudgetReviewLine(id, {
        name: 'SOC', nature: 'run', amountSpent: 1, capabilityIds: [idOf('SIEM'), idOf('EDR')],
      });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Empty', nature: 'run', amountSpent: 1, capabilityIds: [] });

      const lines = (await scoped().budgetReviews.getBudgetReview(id))!.lines;
      expect(lines.find((line) => line.name === 'SOC')!.csfFunctions).toEqual(['ID', 'PR', 'DE', 'RS']);
      expect(lines.find((line) => line.name === 'Empty')!.csfFunctions).toEqual([]);
    });

    it('should refuse a control that does not exist and create no line', async () => {
      const id = await createReview();
      await expect(scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Line', nature: 'run', amountSpent: 1, capabilityIds: [uuidv7()] }))
        .rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      expect((await scoped().budgetReviews.getBudgetReview(id))!.lines).toEqual([]);
    });
  });

  describe('closing', () => {
    it('should store the figures and the postures, then refuse every change', async () => {
      const id = await createReview();
      const lineId = await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 50, capabilityIds: [capabilityIds[0]] });

      await priceAndClose(id);

      const review = await scoped().budgetReviews.getBudgetReview(id);
      expect(review).toMatchObject({ status: 'closed' });
      expect(review!.closedAt).not.toBeNull();
      const figures = await scoped().budgetReviews.getBudgetReviewFigures(id);
      expect(figures!.status).toBe('closed');
      expect(figures!.figures.map((figure) => figure.basket).sort()).toEqual(['build', 'ensemble', 'line', 'run']);
      expect((await postureOf(id, capabilityIds[0]))).toMatchObject({ start: { strengthRung: 'L0' }, end: { strengthRung: 'L0' } });

      await expect(scoped().budgetReviews.updateBudgetReviewLine(lineId, { capabilityIds: [] })).rejects.toBeInstanceOf(BudgetReviewClosedError);
      await expect(scoped().budgetReviews.createBudgetReviewLine(id, { name: 'More', nature: 'run', amountSpent: 1, capabilityIds: [] })).rejects.toBeInstanceOf(BudgetReviewClosedError);
      await expect(scoped().budgetReviews.deleteBudgetReviewLines([lineId])).rejects.toBeInstanceOf(BudgetReviewClosedError);
      await expect(scoped().budgetReviews.updateBudgetReview(id, { name: 'Renamed' })).rejects.toBeInstanceOf(BudgetReviewClosedError);
      await expect(scoped().budgetReviews.updateBudgetReview(id, { periodStart: LAST_YEAR_START })).rejects.toBeInstanceOf(BudgetReviewClosedError);
      await expect(scoped().budgetReviews.closeBudgetReview(id)).rejects.toBeInstanceOf(BudgetReviewClosedError);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ periodStart: THIS_YEAR_START });
    });

    it('should refuse closing a review without any budget line, and store nothing', async () => {
      const id = await createReview();

      await expect(scoped().budgetReviews.closeBudgetReview(id)).rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ status: 'open', closedAt: null });
      expect(await db.select().from(budgetReviewClosedFigures)).toEqual([]);
    });

    it('should refuse closing a review whose figures were never priced, and store nothing', async () => {
      const id = await createReview();
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      await expect(scoped().budgetReviews.closeBudgetReview(id)).rejects.toBeInstanceOf(BudgetReviewNotPricedError);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ status: 'open', closedAt: null });
      expect(await db.select().from(budgetReviewClosedFigures)).toEqual([]);
      expect(await db.select().from(budgetReviewClosedPostures)).toEqual([]);
    });

    it('should refuse closing a review a line edit expired since it was priced, and close it once priced again', async () => {
      const id = await createReview();
      const lineId = await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });
      await priceReview(id);
      await scoped().budgetReviews.updateBudgetReviewLine(lineId, { capabilityIds: [capabilityIds[1]] });

      await expect(scoped().budgetReviews.closeBudgetReview(id)).rejects.toBeInstanceOf(BudgetReviewNotPricedError);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ status: 'open', closedAt: null });
      expect(await db.select().from(budgetReviewClosedFigures)).toEqual([]);

      await priceAndClose(id);
      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ status: 'closed' });
    });

    it('should keep saying when the posture history starts once the review is closed', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L1', 'L1', null);
      const id = await createReview({ periodStart: THIS_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });
      const open = (await scoped().budgetReviews.getBudgetReviewControlPostures(id))!;
      expect(open.logStartsAt).not.toBeNull();

      await priceAndClose(id);

      const closed = (await scoped().budgetReviews.getBudgetReviewControlPostures(id))!;
      expect(closed).toMatchObject({ logStartsAt: open.logStartsAt, logCoversPeriodStart: false });
    });

    it('should say a closed review has no posture history when the log is empty', async () => {
      const id = await createReview({ periodStart: LAST_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      await priceAndClose(id);

      expect(await scoped().budgetReviews.getBudgetReviewControlPostures(id)).toMatchObject({ logStartsAt: null, logCoversPeriodStart: false });
    });

    it('should say a closed review\'s posture history covers its period start when the log begins before it', async () => {
      const loggedAt = new Date(Date.UTC(LAST_YEAR - 1, 5, 1));
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L2', 'L2', null);
      await dateEvents(capabilityIds[0], loggedAt);
      const id = await createReview({ periodStart: LAST_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      await priceAndClose(id);

      const closed = (await scoped().budgetReviews.getBudgetReviewControlPostures(id))!;
      expect(closed).toMatchObject({ logStartsAt: loggedAt, logCoversPeriodStart: true });
      expect(closed.controls.find((control) => control.capabilityId === capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L2', coverageBucket: 'L2' },
        end: { strengthRung: 'L2', coverageBucket: 'L2' },
      });
    });

    it('should leave a closed review out of what a run prices', async () => {
      const open = await createReview({ name: 'Open' });
      const closed = await createReview({ name: 'Closed' });
      await scoped().budgetReviews.createBudgetReviewLine(closed, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [] });
      await priceAndClose(closed);

      const pricing = await scoped().budgetReviews.getBudgetReviewPricing(organizationId);
      expect(new Set(pricing.figures.map((figure) => figure.reviewId))).toEqual(new Set([open]));
    });
  });

  describe('reopening', () => {
    it('should drop what the closing stored, open the review again and bump its version', async () => {
      const id = await createReview();
      const lineId = await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 50, capabilityIds: [capabilityIds[0]] });
      await priceAndClose(id);
      expect(await db.select().from(budgetReviewClosedFigures).where(eq(budgetReviewClosedFigures.reviewId, id))).not.toEqual([]);
      expect(await db.select().from(budgetReviewClosedPostures).where(eq(budgetReviewClosedPostures.reviewId, id))).not.toEqual([]);

      await scoped().budgetReviews.reopenBudgetReview(id);

      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ status: 'open', closedAt: null, version: 3 });
      expect(await db.select().from(budgetReviewClosedFigures).where(eq(budgetReviewClosedFigures.reviewId, id))).toEqual([]);
      expect(await db.select().from(budgetReviewClosedPostures).where(eq(budgetReviewClosedPostures.reviewId, id))).toEqual([]);
      const figures = await scoped().budgetReviews.getBudgetReviewFigures(id);
      expect(figures).toMatchObject({ status: 'open', closedAt: null });
      expect(figures!.figures.every((figure) => figure.state === 'expired')).toBe(true);
      await expect(scoped().budgetReviews.updateBudgetReviewLine(lineId, { name: 'Renamed' })).resolves.toBeUndefined();
    });

    it('should close a reopened review again and store fresh figures and postures', async () => {
      const id = await createReview();
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 50, capabilityIds: [capabilityIds[0]] });
      await priceAndClose(id);
      const firstFigures = await db.select().from(budgetReviewClosedFigures).where(eq(budgetReviewClosedFigures.reviewId, id));
      const firstPostures = await db.select().from(budgetReviewClosedPostures).where(eq(budgetReviewClosedPostures.reviewId, id));
      await scoped().budgetReviews.reopenBudgetReview(id);
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L2', 'L2', null);

      await priceAndClose(id);

      expect(await scoped().budgetReviews.getBudgetReview(id)).toMatchObject({ status: 'closed', version: 3 });
      const secondFigures = await db.select().from(budgetReviewClosedFigures).where(eq(budgetReviewClosedFigures.reviewId, id));
      const secondPostures = await db.select().from(budgetReviewClosedPostures).where(eq(budgetReviewClosedPostures.reviewId, id));
      expect(secondFigures).toHaveLength(firstFigures.length);
      expect(secondPostures).toHaveLength(firstPostures.length);
      const firstIds = new Set([...firstFigures, ...firstPostures].map((row) => row.id));
      expect([...secondFigures, ...secondPostures].some((row) => firstIds.has(row.id))).toBe(false);
      expect(await postureOf(id, capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L0', coverageBucket: 'L0' },
        end: { strengthRung: 'L2', coverageBucket: 'L2' },
      });
    });

    it('should refuse reopening a review that is open, or that does not exist', async () => {
      const id = await createReview();

      await expect(scoped().budgetReviews.reopenBudgetReview(id)).rejects.toBeInstanceOf(BudgetReviewNotClosedError);
      await expect(scoped().budgetReviews.reopenBudgetReview(uuidv7())).rejects.toBeInstanceOf(BudgetReviewNotFoundError);
      expect(await versionOf(id)).toBe(1);
    });
  });

  describe('posture at a date', () => {
    it('should read a control whose posture never changed the same at the start and end of its period', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L2', 'L2', null);
      await dateEvents(capabilityIds[0], new Date(Date.UTC(LAST_YEAR - 1, 5, 1)));
      const id = await createReview({ periodStart: LAST_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      expect(await postureOf(id, capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L2', coverageBucket: 'L2' },
        end: { strengthRung: 'L2', coverageBucket: 'L2' },
        moved: false,
      });
      expect((await scoped().budgetReviews.getBudgetReviewControlPostures(id))!.logCoversPeriodStart).toBe(true);
    });

    it('should read a move of the period from the line logged during it, and list it as moved', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L1', 'L1', null);
      await dateEvents(capabilityIds[0], new Date(Date.UTC(LAST_YEAR - 1, 5, 1)));
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L2', 'L2', null);
      await db.update(controlCapabilityAssessmentEvents)
        .set({ createdAt: new Date(Date.UTC(LAST_YEAR, 5, 1)) })
        .where(and(eq(controlCapabilityAssessmentEvents.capabilityId, capabilityIds[0]), eq(controlCapabilityAssessmentEvents.newStrength, 'L2')));
      const id = await createReview({ periodStart: LAST_YEAR_START });

      expect(await postureOf(id, capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L1', coverageBucket: 'L1' },
        end: { strengthRung: 'L2', coverageBucket: 'L2' },
        moved: true,
        buildLine: null,
      });
    });

    it('should read a move logged before the first month of a fiscal year as its start posture', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L1', 'L1', null);
      await dateEvents(capabilityIds[0], new Date(Date.UTC(LAST_YEAR - 1, 5, 1)));
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L2', 'L2', null);
      await db.update(controlCapabilityAssessmentEvents)
        .set({ createdAt: new Date(Date.UTC(LAST_YEAR, 1, 1)) })
        .where(and(eq(controlCapabilityAssessmentEvents.capabilityId, capabilityIds[0]), eq(controlCapabilityAssessmentEvents.newStrength, 'L2')));
      const id = await createReview({ periodStart: `${LAST_YEAR}-04-01` });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      expect(await postureOf(id, capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L2', coverageBucket: 'L2' },
        end: { strengthRung: 'L2', coverageBucket: 'L2' },
        moved: false,
      });
    });

    it('should read a past period as it ended, whatever moved after it', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L1', 'L1', null);
      await dateEvents(capabilityIds[0], new Date(Date.UTC(LAST_YEAR - 1, 5, 1)));
      const id = await createReview({ periodStart: LAST_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L3', 'L3', null);

      expect(await postureOf(id, capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L1', coverageBucket: 'L1' },
        end: { strengthRung: 'L1', coverageBucket: 'L1' },
        moved: false,
      });
    });

    it('should list a control neither moved nor funded only when named, at its period start rather than its current posture', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L1', 'L1', null);
      await dateEvents(capabilityIds[0], new Date(Date.UTC(LAST_YEAR - 1, 5, 1)));
      const id = await createReview({ periodStart: LAST_YEAR_START });
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L3', 'L3', null);

      expect(await postureOf(id, capabilityIds[0])).toBeUndefined();
      const named = await scoped().budgetReviews.getBudgetReviewControlPostures(id, [capabilityIds[0]]);
      expect(named!.controls.find((control) => control.capabilityId === capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L1', coverageBucket: 'L1' },
        moved: false,
        runLines: [],
      });
    });

    it('should let a scope override inherit the tenant on the axis it leaves unset, and say when the log starts after the start of the period', async () => {
      await scoped().controlCapabilities.upsertAssessment(capabilityIds[0], 'L1', 'L1', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, capabilityIds[0], { strengthRung: 'L3', coverageBucket: null, comment: null });
      const id = await createReview({ periodStart: THIS_YEAR_START });
      await scoped().budgetReviews.createBudgetReviewLine(id, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });

      const postures = await scoped().budgetReviews.getBudgetReviewControlPostures(id);
      // Both levels were declared this year, so the period's start predates the log and reads as nothing declared.
      expect(postures!.logCoversPeriodStart).toBe(false);
      expect(postures!.controls.find((control) => control.capabilityId === capabilityIds[0])).toMatchObject({
        start: { strengthRung: 'L0', coverageBucket: 'L0' },
        end: { strengthRung: 'L3', coverageBucket: 'L1' },
        moved: true,
        runLines: [expect.objectContaining({ name: 'Licences' })],
      });
    });
  });

  describe('tenant isolation', () => {
    let otherOrigin: EventOrigin;
    let reviewId: string;
    let lineId: string;

    beforeEach(async () => {
      reviewId = await createReview();
      lineId = await scoped().budgetReviews.createBudgetReviewLine(reviewId, { name: 'Licences', nature: 'run', amountSpent: 1, capabilityIds: [capabilityIds[0]] });
      const otherTenantId = await createTenant(services, adminUserId);
      otherOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      expect(otherTenantId).not.toBe(tenantId);
    });

    const other = () => services.withOrigin(otherOrigin);

    it('should not list or read the reviews of another tenant', async () => {
      expect(await other().budgetReviews.getBudgetReviews()).toEqual([]);
      expect(await other().budgetReviews.getBudgetReview(reviewId)).toBeUndefined();
      expect(await other().budgetReviews.getBudgetReviewFigures(reviewId)).toBeUndefined();
      expect(await other().budgetReviews.getBudgetReviewControlPostures(reviewId)).toBeUndefined();
      expect(await other().budgetReviews.getBudgetReviewSimulationScope(reviewId)).toBeUndefined();
    });

    it('should not create a review in a risk scope of another tenant', async () => {
      await expect(other().budgetReviews.createBudgetReview({ organizationId, name: 'Intruder', periodStart: THIS_YEAR_START }))
        .rejects.toBeInstanceOf(BudgetReviewInvalidInputError);
    });

    it('should refuse an update, a line or a closing on a review of another tenant', async () => {
      await priceReview(reviewId);
      await expect(other().budgetReviews.updateBudgetReview(reviewId, { name: 'Taken' })).rejects.toThrow();
      await expect(other().budgetReviews.createBudgetReviewLine(reviewId, { name: 'Taken', nature: 'run', amountSpent: 1, capabilityIds: [] })).rejects.toThrow();
      await expect(other().budgetReviews.updateBudgetReviewLine(lineId, { name: 'Taken' })).rejects.toThrow();
      await expect(other().budgetReviews.closeBudgetReview(reviewId)).rejects.toThrow();
      const review = await scoped().budgetReviews.getBudgetReview(reviewId);
      expect(review).toMatchObject({ name: 'Exercice', status: 'open', version: 2 });
      expect(review!.lines[0].name).toBe('Licences');
    });

    it('should refuse reopening a closed review of another tenant, and keep what its closing stored', async () => {
      await priceAndClose(reviewId);

      await expect(other().budgetReviews.reopenBudgetReview(reviewId)).rejects.toBeInstanceOf(BudgetReviewNotFoundError);
      expect(await scoped().budgetReviews.getBudgetReview(reviewId)).toMatchObject({ status: 'closed', version: 2 });
      expect(await db.select().from(budgetReviewClosedFigures).where(eq(budgetReviewClosedFigures.reviewId, reviewId))).not.toEqual([]);
      expect(await db.select().from(budgetReviewClosedPostures).where(eq(budgetReviewClosedPostures.reviewId, reviewId))).not.toEqual([]);
    });

    it('should not delete a review or a line of another tenant', async () => {
      await other().budgetReviews.deleteBudgetReviewLines([lineId]);
      await other().budgetReviews.deleteBudgetReviews([reviewId]);
      const review = await scoped().budgetReviews.getBudgetReview(reviewId);
      expect(review!.lines).toHaveLength(1);
    });

    it('should price nothing of another tenant\'s reviews', async () => {
      expect((await other().budgetReviews.getBudgetReviewPricing(organizationId)).figures).toEqual([]);
      expect(await db.select().from(budgetReviews)).toHaveLength(1);
    });
  });
});
