import { describe, expect, it } from 'vitest';
import { OPENAEV_PRODUCT_URL, OPENCTI_PRODUCT_URL, productSwitcherDestinations, XTM_HUB_URL } from './navbar-logo-utils';

describe('productSwitcherDestinations', () => {
  it('opens a connected platform at its own address', () => {
    const destinations = productSwitcherDestinations({ openctiUrl: 'https://opencti.example', openaevUrl: 'https://openaev.example/' });
    expect(destinations.opencti).toEqual({ href: 'https://opencti.example/', connected: true });
    expect(destinations.openaev).toEqual({ href: 'https://openaev.example/', connected: true });
  });

  it('falls back to the product page when the platform is not connected or its address is unusable', () => {
    const destinations = productSwitcherDestinations({ openctiUrl: null, openaevUrl: 'javascript:alert(1)' });
    expect(destinations.opencti).toEqual({ href: OPENCTI_PRODUCT_URL, connected: false });
    expect(destinations.openaev).toEqual({ href: OPENAEV_PRODUCT_URL, connected: false });
    expect(destinations.xtmHub).toEqual({ href: XTM_HUB_URL, connected: false });
  });
});
