import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getConnectorIconBySource } from './connectors-list';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('getConnectorIconBySource', () => {
  it('gives Drata OpenCRQ\'s icon rather than a logo of its own', () => {
    expect(getConnectorIconBySource('drata')).toBe('/img/icon-opencrq.svg');
  });

  it('knows no icon for an unknown source', () => {
    expect(getConnectorIconBySource('unknown')).toBeNull();
  });
});
