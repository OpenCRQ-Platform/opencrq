/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditionCardState } from './edition-cards-test-harness';
import { renderEditionCard, XTM_ONE_URL } from './edition-cards-test-harness';
import { XtmOneCard } from './xtm-one-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderCard = (state: EditionCardState = {}) => renderEditionCard(XtmOneCard, state);

describe('XtmOneCard', () => {
  it('should show XTM One as connected, with a way into it rather than its URL', async () => {
    renderCard({ registration: 'ok' });

    expect(await screen.findByText('Connected')).toBeDefined();
    expect(screen.getByRole('link', { name: /Open XTM One/ }).getAttribute('href')).toBe(XTM_ONE_URL);
    expect(screen.queryByText(XTM_ONE_URL)).toBeNull();
  });

  it('should not claim a connection no registration has answered yet', async () => {
    renderCard({ registration: 'pending' });

    expect(await screen.findByText('Checking')).toBeDefined();
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('should say since when XTM One is unreachable, and where', async () => {
    renderCard({ registration: 'unreachable', failingSince: '2026-09-30T10:27:00.000Z' });

    expect(await screen.findByText('Unreachable')).toBeDefined();
    expect(screen.getByText(/^Unreachable since .*2026.*\(.*\)\.$/)).toBeDefined();
    expect(screen.getByText(XTM_ONE_URL)).toBeDefined();
    expect(screen.queryByRole('link', { name: /Open XTM One/ })).toBeNull();
  });

  it('should name the registration token and a proxy as the likely causes of a refusal', async () => {
    renderCard({ registration: 'refused', failingSince: '2026-09-30T10:27:00.000Z' });

    expect(await screen.findByText('Registration refused')).toBeDefined();
    expect(screen.getByText(/^Registration refused since /)).toBeDefined();
    expect(screen.getByText(/^Check that XTM_ONE__TOKEN matches PLATFORM_REGISTRATION_TOKEN/)).toBeDefined();
  });

  it('should name what to check for an unreadable answer even without a date', async () => {
    renderCard({ registration: 'unreadable', failingSince: null });

    expect(await screen.findByText('The registration answer cannot be read.')).toBeDefined();
    expect(screen.getByText(/^Check that XTM_ONE__URL points to XTM One/)).toBeDefined();
  });

  it('should say when XTM One last answered', async () => {
    renderCard({ registration: 'ok', lastAnsweredAt: '2026-11-06T09:00:00.000Z' });

    expect(await screen.findByText(/^Last answer: .*2026.*\(.*\)\.$/)).toBeDefined();
  });

  it('should say XTM One has not answered yet', async () => {
    renderCard({ registration: 'pending' });

    expect(await screen.findByText('No answer from XTM One yet.')).toBeDefined();
  });

  it('should offer a platform administrator to check with XTM One now', async () => {
    renderCard({ registration: 'ok', canManagePlatform: true });

    expect(await screen.findByRole('button', { name: 'Check now' })).toBeDefined();
  });

  it('should not offer the check to a user who does not administer the platform', async () => {
    renderCard({ registration: 'ok' });

    await screen.findByText('Connected');
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('should give the reason of a refused check while the heartbeat still reports a connection', async () => {
    const answered = '2026-11-06T09:00:00.000Z';
    renderCard({
      registration: 'ok',
      lastAnsweredAt: answered,
      canManagePlatform: true,
      check: { registration: 'refused', failingSince: '2026-11-06T09:02:00.000Z', lastAnsweredAt: answered },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));

    expect(await screen.findByText('Registration refused')).toBeDefined();
    expect(await screen.findByText(/^Check that XTM_ONE__TOKEN matches PLATFORM_REGISTRATION_TOKEN/)).toBeDefined();
  });

  it('should render nothing when no XTM One is configured', async () => {
    const { container } = renderCard({ xtmOneConfigured: false });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe('');
  });
});
