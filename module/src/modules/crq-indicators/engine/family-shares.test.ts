import { describe, expect, it } from 'vitest';
import { PROTECTION_BY_EXTERNAL_ID } from '../../controls/capability/data';
import { buildFamilyShares } from './family-shares';

const EDR = 'edr-capability-id';
const IDP = 'idp-capability-id';
const WAF = 'waf-capability-id';
const ITDR = 'itdr-capability-id';

describe('buildFamilyShares', () => {
  it('scales a control to the weighted share of the estate it protects', () => {
    // A quarter hosts, three quarters identities, by weighted volume rather than by head count.
    const shares = buildFamilyShares({
      pairs: [{ capabilityId: EDR, categoryId: 'host' }, { capabilityId: IDP, categoryId: 'identity' }],
      touchedCategoryIds: ['host', 'identity'],
      categoryWeights: { host: 25, identity: 75 },
    });

    expect(shares.get(EDR)).toBeCloseTo(0.25);
    expect(shares.get(IDP)).toBeCloseTo(0.75);
  });

  it('gives a control protecting every touched category its full weight', () => {
    const shares = buildFamilyShares({
      pairs: [{ capabilityId: EDR, categoryId: 'host' }, { capabilityId: EDR, categoryId: 'identity' }],
      touchedCategoryIds: ['host', 'identity'],
      categoryWeights: { host: 25, identity: 75 },
    });

    expect(shares.get(EDR)).toBe(1);
  });

  it('gives a control protecting no touched category a share of zero', () => {
    const shares = buildFamilyShares({
      pairs: [{ capabilityId: EDR, categoryId: 'host' }],
      touchedCategoryIds: ['identity', 'saas_application'],
      categoryWeights: { identity: 30, saas_application: 10 },
    });

    expect(shares.get(EDR)).toBe(0);
  });

  it('counts touched categories when none of them holds an inventoried asset', () => {
    // The estate is unknown, so the engine spreads over the touched categories rather than
    // reading a volume of zero as an absence of exposure.
    const shares = buildFamilyShares({
      pairs: [{ capabilityId: EDR, categoryId: 'host' }],
      touchedCategoryIds: ['host', 'identity', 'saas_application', 'cloud_resource'],
      categoryWeights: null,
    });

    expect(shares.get(EDR)).toBeCloseTo(0.25);
  });

  it('leaves a control at full weight when the scenario touches no category at all', () => {
    const shares = buildFamilyShares({
      pairs: [{ capabilityId: EDR, categoryId: 'host' }],
      touchedCategoryIds: [],
      categoryWeights: null,
    });

    expect(shares.get(EDR)).toBe(1);
  });

  /*
   * An identity threat detection sensor is installed on directory servers alone, yet the catalogue
   * reaches the identities those servers authenticate, so an identity-only slice does not bridle it.
   * Read against where the sensor is installed, the same slice would have zeroed it.
   */
  it('leaves an identity threat detection sensor whole on an identity-only slice, from the catalogue\'s own scoping', () => {
    const shares = buildFamilyShares({
      pairs: PROTECTION_BY_EXTERNAL_ID.ITDR.map((categoryId) => ({ capabilityId: ITDR, categoryId })),
      touchedCategoryIds: ['identity'],
      categoryWeights: { identity: 300 },
    });

    expect(shares.get(ITDR)).toBe(1);
  });

  it('zeroes a control the catalogue keeps off the touched slice entirely', () => {
    const shares = buildFamilyShares({
      pairs: PROTECTION_BY_EXTERNAL_ID.WAF.map((categoryId) => ({ capabilityId: WAF, categoryId })),
      touchedCategoryIds: ['identity'],
      categoryWeights: { identity: 300 },
    });

    expect(shares.get(WAF)).toBe(0);
  });
});
