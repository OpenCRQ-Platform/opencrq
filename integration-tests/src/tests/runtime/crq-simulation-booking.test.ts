import type { CrqRunProfile, EventOrigin } from '@app/module';
import { FULL_RUN_PROFILE, PRICE_RUN_PROFILE } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The queue reaches the logger through the backend config, which the shared setup stubs out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const { enqueueRequestedCrqSimulation, enqueueCrqSimulationForEstimatesChange, enqueueCrqSimulationForPostureChange } = await import('@app/back/src/features/crq-indicators/crq-simulation-queue');

const KIND = 'crq-simulation';
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const services = createTestServices(db);

const levers = (...controlIds: Array<string>): CrqRunProfile => ({ techniques: false, cves: false, levers: controlIds, plans: [] });
const plans = (...planIds: Array<string>): CrqRunProfile => ({ techniques: false, cves: false, levers: [], plans: planIds });

describe('booking a CRQ simulation with a profile', () => {
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;
  let riskScenarioId: string;

  const book = (profile?: CrqRunProfile) => enqueueRequestedCrqSimulation(services.withOrigin(adminOrigin), adminOrigin, riskScenarioId, profile);
  const bookings = async () => await services.withOrigin(adminOrigin).jobs.listJobs({ tenantId, kind: KIND });
  const expectBooked = async (profile: CrqRunProfile) => {
    const [booking, ...others] = await bookings();
    expect(others).toEqual([]);
    expect(booking.payload).toMatchObject({ profile });
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminOrigin = setup.origin;
    riskScenarioId = uuidv7();
  });

  it.each([
    ['a scope posture save', () => enqueueCrqSimulationForPostureChange(services.withOrigin(adminOrigin), adminOrigin, tenantId, riskScenarioId)],
    ['a loss-estimate recompute', () => enqueueCrqSimulationForEstimatesChange(services.withOrigin(adminOrigin), adminOrigin, tenantId, riskScenarioId)],
    ['a run asked from a screen', () => book()],
  ])('books a full run from %s', async (_, trigger) => {
    await trigger();

    await expectBooked(FULL_RUN_PROFILE);
  });

  it('folds a cheaper profile into a pending full run', async () => {
    await book();
    await book(PRICE_RUN_PROFILE);
    await book(levers('control-a'));

    await expectBooked(FULL_RUN_PROFILE);
  });

  it('runs the full run asked while a cheaper profile is pending', async () => {
    await book(PRICE_RUN_PROFILE);
    await book();

    await expectBooked(FULL_RUN_PROFILE);
  });

  it('makes a pending partial run compute a second partial profile too', async () => {
    await book(levers('control-b'));
    await book(plans('plan-a'));
    await book(levers('control-a'));

    await expectBooked({ techniques: false, cves: false, levers: ['control-a', 'control-b'], plans: ['plan-a'] });
  });

  it('keeps who asked first on the booking', async () => {
    await book(PRICE_RUN_PROFILE);
    await enqueueCrqSimulationForPostureChange(services.withOrigin(adminOrigin), adminOrigin, tenantId, riskScenarioId);

    expect((await bookings())[0].payload).toEqual({ riskScenarioId, userId: adminOrigin.userId, profile: FULL_RUN_PROFILE });
  });

  it('loses no ask when a cancelled run frees its key before its follow-up is booked', async () => {
    await book(levers('control-a'));
    const system = services.withOrigin(SYSTEM_ORIGIN).jobs;
    const claimed = await system.claimNext('worker-1', [KIND], 30_000);
    await book();
    await system.recordCancelled(claimed!.id, 'worker-1', true);
    await book(levers('control-b'));

    await system.answerAbsorbedAsk(claimed!.id);

    const active = (await bookings()).filter((booking) => booking.status === 'queued' || booking.status === 'running');
    expect(active).toHaveLength(1);
    expect(active[0].payload).toMatchObject({ profile: FULL_RUN_PROFILE });
  });

  it('loses no ask folded into a running run: the run booked after it computes both', async () => {
    await book(PRICE_RUN_PROFILE);
    const system = services.withOrigin(SYSTEM_ORIGIN).jobs;
    const claimed = await system.claimNext('worker-1', [KIND], 30_000);
    await book(levers('control-a'));

    const { bookedJobId } = await system.recordSuccess(claimed!.id, 'worker-1');

    expect(bookedJobId).toBeDefined();
    const successor = await system.getJob(bookedJobId!);
    expect(successor!.payload).toMatchObject({ profile: levers('control-a') });
  });
});
