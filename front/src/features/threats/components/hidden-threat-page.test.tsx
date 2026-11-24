/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FAILED, NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { HiddenThreatPage } from './hidden-threat-page';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#threats">{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const access = (threats: 'not_linked' | 'no_account' | 'unavailable' | null) => ({
  'xtm.readerAccess': { threats, counterparts: { opencti: null, openaev: null } },
});

describe('HiddenThreatPage', () => {
  it('says the threat is hidden from the reader, and leads back to the threats', async () => {
    renderWithTrpc(<HiddenThreatPage />, { answers: access(null) });

    expect(await screen.findByRole('heading', { level: 1, name: 'This threat is hidden from you' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all threats' })).toBeTruthy();
  });

  it('says nothing of the cause until the reader\'s access is known, nor when it cannot be known', async () => {
    renderWithTrpc(<HiddenThreatPage />, { answers: { 'xtm.readerAccess': NEVER } });
    expect(await screen.findByRole('heading', { level: 1, name: 'This threat is hidden from you' })).toBeTruthy();
    expect(screen.queryByText('OpenCTI does not let you read this threat.')).toBeNull();
    cleanup();

    renderWithTrpc(<HiddenThreatPage />, { answers: { 'xtm.readerAccess': FAILED } });
    expect(await screen.findByRole('heading', { level: 1, name: 'This threat is hidden from you' })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('OpenCTI does not let you read this threat.')).toBeNull();
  });

  it('says OpenCTI\'s own rights hide it when OpenCRQ knows what the reader may read there', async () => {
    renderWithTrpc(<HiddenThreatPage />, { answers: access(null) });

    expect(await screen.findByText('OpenCTI does not let you read this threat.')).toBeTruthy();
    expect(screen.getByText(/ask an OpenCTI administrator for access/)).toBeTruthy();
  });

  it('says why OpenCRQ could not tell what the reader may read, by the category, in place of that line', async () => {
    renderWithTrpc(<HiddenThreatPage />, { answers: access('no_account') });

    expect(await screen.findByText('Some threats are hidden because you have no OpenCTI account.')).toBeTruthy();
    expect(screen.queryByText('OpenCTI does not let you read this threat.')).toBeNull();
  });
});
