import type { EventOrigin } from '@app/module';
import { controlProvenPostureHistory, PROVEN_POSTURE_HISTORY_RETENTION_DAYS, RiskScopeNotFoundError } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('Proven posture history read', () => {
  let origin: EventOrigin;
  let tenantId: string;
  let userId: string;
  let capabilityId: string;
  let organizationId: string;

  const insertLine = async (line: {
    days: number,
    held: number,
    function?: 'prevent' | 'detect',
    organizationId?: string | null,
    tenantId?: string,
  }) => {
    await db.insert(controlProvenPostureHistory).values({
      id: uuidv7(),
      tenantId: line.tenantId ?? tenantId,
      capabilityId,
      organizationId: line.organizationId ?? null,
      function: line.function ?? 'prevent',
      credited: 10,
      tested: 4,
      held: line.held,
      changedAt: daysAgo(line.days),
    });
  };

  const read = async (scope?: string | null) =>
    services.withOrigin(origin).controlValidation.getProvenPostureHistory(capabilityId, scope);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    origin = setup.origin;
    tenantId = setup.tenantId;
    userId = setup.userId;
    const capabilities = await services.withOrigin(origin).controlCapabilities.getControlCapabilities();
    capabilityId = capabilities.find((capability) => capability.externalId === 'EDR')!.id;
    organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
  });

  it('serves both functions of the tenant level, oldest first, every count declared', async () => {
    await insertLine({ days: 20, held: 2 });
    await insertLine({ days: 10, held: 3, function: 'detect' });

    expect(await read()).toEqual([
      { function: 'prevent', at: expect.any(Date), credited: 10, tested: 4, held: 2 },
      { function: 'detect', at: expect.any(Date), credited: 10, tested: 4, held: 3 },
    ]);
  });

  it('keeps a scope and the tenant level apart', async () => {
    await insertLine({ days: 20, held: 1 });
    await insertLine({ days: 10, held: 4, organizationId });

    expect((await read()).map((line) => line.held)).toEqual([1]);
    expect((await read(organizationId)).map((line) => line.held)).toEqual([4]);
  });

  it('keeps the line each function had in force at the retention cut-off, and none older', async () => {
    await insertLine({ days: PROVEN_POSTURE_HISTORY_RETENTION_DAYS + 30, held: 0 });
    await insertLine({ days: PROVEN_POSTURE_HISTORY_RETENTION_DAYS + 20, held: 1 });
    await insertLine({ days: PROVEN_POSTURE_HISTORY_RETENTION_DAYS + 10, held: 2, function: 'detect' });
    await insertLine({ days: 5, held: 3 });

    const lines = await read();

    expect(lines.map((line) => [line.function, line.held])).toEqual([['prevent', 1], ['detect', 2], ['prevent', 3]]);
  });

  it('never serves another tenant\'s lines', async () => {
    const otherTenantId = await createTenant(services, userId);
    await insertLine({ days: 10, held: 4, tenantId: otherTenantId });

    expect(await read()).toEqual([]);
  });

  it('refuses a risk scope that does not exist', async () => {
    await expect(read(uuidv7())).rejects.toThrow(RiskScopeNotFoundError);
  });
});
