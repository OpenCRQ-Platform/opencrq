/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { HiddenThreatsAlert, HiddenThreatsHint, HiddenThreatsNotice } from './hidden-threats-notice';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>;

describe('HiddenThreatsNotice', () => {
  it('tells an OpenCTI that is not linked to ask an administrator to link it', () => {
    render(<HiddenThreatsNotice issue="not_linked" />, { wrapper });

    expect(screen.getByText('Some threats are hidden until OpenCTI is linked.')).toBeTruthy();
    expect(screen.getByText(/Ask an administrator to link OpenCTI to XTM One/)).toBeTruthy();
  });

  it('tells a member with no OpenCTI account to ask for one with the same email', () => {
    render(<HiddenThreatsNotice issue="no_account" />, { wrapper });

    expect(screen.getByText('Some threats are hidden because you have no OpenCTI account.')).toBeTruthy();
    expect(screen.getByText(/Ask an OpenCTI administrator to create an account with the same email/)).toBeTruthy();
  });

  it('says an outage is temporary and asks nobody to act unless it lasts', () => {
    render(<HiddenThreatsNotice issue="unavailable" />, { wrapper });

    expect(screen.getByText('Some threats are hidden for now.')).toBeTruthy();
    expect(screen.getByText(/They come back once the answer does/)).toBeTruthy();
  });
});

const access = (threats: 'not_linked' | 'no_account' | 'unavailable' | null) => ({
  'xtm.readerAccess': { threats, counterparts: { opencti: null, openaev: null } },
});

describe('HiddenThreatsAlert', () => {
  it('shows the notice of the reader\'s issue on a screen that lists threats', async () => {
    renderWithTrpc(<HiddenThreatsAlert />, { answers: access('no_account') });

    expect(await screen.findByText('Some threats are hidden because you have no OpenCTI account.')).toBeTruthy();
  });

  it('shows nothing while the reader misses no threat', async () => {
    const { container } = renderWithTrpc(<HiddenThreatsAlert />, { answers: access(null) });

    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('HiddenThreatsHint', () => {
  it('sits beside a figure as a button named by the issue, so a smaller number is not read as a fact', async () => {
    renderWithTrpc(<p>12 <HiddenThreatsHint /></p>, { answers: access('unavailable') });

    expect(await screen.findByRole('button', { name: 'Some threats are hidden for now.' })).toBeTruthy();
  });

  it('shows its explanation when pressed, so a touch reader, who cannot hover, can read it', async () => {
    renderWithTrpc(<p>12 <HiddenThreatsHint /></p>, { answers: access('no_account') });

    await userEvent.click(await screen.findByRole('button', { name: 'Some threats are hidden because you have no OpenCTI account.' }));

    expect((await screen.findAllByText(/Ask an OpenCTI administrator to create an account/)).length).toBeGreaterThan(0);
  });

  it('shows nothing while the reader misses no threat', async () => {
    renderWithTrpc(<p>12 <HiddenThreatsHint /></p>, { answers: access(null) });

    await screen.findByText(/12/);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
