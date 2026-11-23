/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { useThreatCount, useThreatsHidden } from './use-source-reads';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const Probe: FunctionComponent = () => {
  const total = useThreatCount();
  const hidden = useThreatsHidden();
  return <p>{total === undefined ? 'loading' : `${total} threats, hidden: ${String(hidden)}`}</p>;
};

const page = (readerScopeUnresolved: boolean) => ({ items: [], total: 2, page: 1, limit: 1, pending: 0, readerScopeUnresolved });

describe('useThreatsHidden', () => {
  it('says threats may be hidden when OpenCTI left the reader scope unresolved', async () => {
    renderWithTrpc(<Probe />, { answers: { 'threats.list': page(true) } });

    expect(await screen.findByText('2 threats, hidden: true')).toBeTruthy();
  });

  it('says nothing is hidden once the reader scope is known', async () => {
    renderWithTrpc(<Probe />, { answers: { 'threats.list': page(false) } });

    expect(await screen.findByText('2 threats, hidden: false')).toBeTruthy();
  });

  it('reads the tenant count the step already asks for, with no request of its own', async () => {
    const { calls } = renderWithTrpc(<Probe />, { answers: { 'threats.list': page(true) } });

    await screen.findByText('2 threats, hidden: true');
    expect(calls.filter((call) => call.path === 'threats.list')).toHaveLength(1);
  });
});
