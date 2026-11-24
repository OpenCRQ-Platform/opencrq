/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FAILED, NEVER, renderWithTrpc } from '../../providers/trpc-test-harness';
import { useReaderAccess } from './use-reader-access';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const Probe: FunctionComponent = () => {
  const { threats, counterparts } = useReaderAccess();
  return <p>{`threats: ${threats ?? 'none'}, OpenCTI: ${counterparts.opencti ?? 'none'}, OpenAEV: ${counterparts.openaev ?? 'none'}`}</p>;
};

describe('useReaderAccess', () => {
  it('gives the issue of the threats and of each product', async () => {
    renderWithTrpc(<Probe />, {
      answers: { 'xtm.readerAccess': { threats: 'not_linked', counterparts: { opencti: 'no_account', openaev: 'unavailable' } } },
    });

    expect(await screen.findByText('threats: not_linked, OpenCTI: no_account, OpenAEV: unavailable')).toBeTruthy();
  });

  it('gives no issue while the answer is on its way', () => {
    renderWithTrpc(<Probe />, { answers: { 'xtm.readerAccess': NEVER } });

    expect(screen.getByText('threats: none, OpenCTI: none, OpenAEV: none')).toBeTruthy();
  });

  it('gives no issue when XTM One cannot be asked, rather than a notice that may be wrong', async () => {
    const { calls } = renderWithTrpc(<Probe />, { answers: { 'xtm.readerAccess': FAILED } });

    await screen.findByText('threats: none, OpenCTI: none, OpenAEV: none');
    expect(calls.filter(({ path }) => path === 'xtm.readerAccess')).toHaveLength(1);
  });
});
