import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { listRowStatusLabel } from './maturity-labels';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('listRowStatusLabel', () => {
  it('reads the status a row displays, so the Status column sorts on what it shows', () => {
    const labels = [
      listRowStatusLabel({ source: 'opencrq', assessment: { status: 'published' } }),
      listRowStatusLabel({ source: 'drata' }),
      listRowStatusLabel({ source: 'opencrq', assessment: { status: 'draft' } }),
    ];

    expect(labels).toEqual(['Published', 'Synced', 'Draft']);
    expect([...labels].sort()).toEqual(['Draft', 'Published', 'Synced']);
  });
});
