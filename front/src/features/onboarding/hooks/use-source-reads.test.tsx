/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { useTenantThreats } from './use-source-reads';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const Probe: FunctionComponent = () => {
  const total = useTenantThreats();
  return <p>{total === undefined ? 'loading' : `${total} threats`}</p>;
};

describe('useTenantThreats', () => {
  it('gives the whole count of the tenant, not a source\'s', async () => {
    const { calls } = renderWithTrpc(<Probe />, { answers: { 'threats.list': { items: [], total: 2, page: 1, limit: 1, pending: 0 } } });

    expect(await screen.findByText('2 threats')).toBeTruthy();
    expect(calls).toContainEqual(expect.objectContaining({ path: 'threats.list', input: { page: 1, limit: 1 } }));
  });
});
