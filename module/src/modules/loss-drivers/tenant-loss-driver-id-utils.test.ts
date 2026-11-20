import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { deriveSeedId } from '../../seed-ids';
import { LOSS_DRIVERS } from './data/loss-drivers-data';
import { LossDriver_ForensicsIncidentManagement, LossDriver_SystemDataRestoration } from './data/loss-drivers-ids';
import { deriveTenantLossDriverId, resolveCatalogueLossDriverId } from './tenant-loss-driver-id-utils';

describe('deriveTenantLossDriverId', () => {
  it('matches the id the seeder mints for the same tenant and catalogue driver', () => {
    const tenantId = uuidv7();
    expect(deriveTenantLossDriverId(tenantId, LossDriver_ForensicsIncidentManagement))
      .toBe(deriveSeedId(tenantId, LossDriver_ForensicsIncidentManagement));
  });

  it('is deterministic across calls', () => {
    const tenantId = uuidv7();
    const first = deriveTenantLossDriverId(tenantId, LossDriver_SystemDataRestoration);
    const second = deriveTenantLossDriverId(tenantId, LossDriver_SystemDataRestoration);
    expect(first).toBe(second);
  });

  it('differs per tenant for the same catalogue driver', () => {
    const first = deriveTenantLossDriverId(uuidv7(), LossDriver_ForensicsIncidentManagement);
    const second = deriveTenantLossDriverId(uuidv7(), LossDriver_ForensicsIncidentManagement);
    expect(first).not.toBe(second);
  });
});

describe('resolveCatalogueLossDriverId', () => {
  it('inverts deriveTenantLossDriverId for every catalog driver', () => {
    const tenantId = uuidv7();
    for (const driver of LOSS_DRIVERS) {
      const tenantRowId = deriveTenantLossDriverId(tenantId, driver.id);
      expect(resolveCatalogueLossDriverId(tenantId, tenantRowId)).toBe(driver.id);
    }
  });

  it('returns undefined for an id that is not a derived row of this tenant', () => {
    expect(resolveCatalogueLossDriverId(uuidv7(), uuidv7())).toBeUndefined();
  });
});
