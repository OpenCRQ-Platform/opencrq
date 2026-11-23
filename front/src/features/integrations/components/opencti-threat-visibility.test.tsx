/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FAILED, NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { OpenctiThreatVisibilityBanner, OpenctiThreatVisibilityField } from './opencti-threat-visibility';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const BANNER = 'Marked threats are hidden from members';

const answers = (threatVisibility: 'per_member' | 'service_account' | null, link: unknown) => ({
  'opencti.getSettings': threatVisibility === null ? null : { threatVisibility },
  'opencti.getReaderLink': link,
});

describe('OpenctiThreatVisibilityBanner', () => {
  it('should tell the operator marked threats are hidden while members are read per member from an unlinked OpenCTI', async () => {
    renderWithTrpc(<OpenctiThreatVisibilityBanner />, { answers: answers('per_member', { link: 'not_linked' }) });

    expect(await screen.findByText(BANNER)).toBeTruthy();
  });

  it('should also count a tenant with nothing saved as per member', async () => {
    renderWithTrpc(<OpenctiThreatVisibilityBanner />, { answers: answers(null, { link: 'not_linked' }) });

    expect(await screen.findByText(BANNER)).toBeTruthy();
  });

  it('should say nothing once the service account is chosen, or while the link is linked, unknown or unanswered', async () => {
    for (const [visibility, link] of [
      ['service_account', { link: 'not_linked' }],
      ['per_member', { link: 'linked' }],
      ['per_member', { link: 'unknown' }],
      ['per_member', FAILED],
      ['per_member', NEVER],
    ] as const) {
      const { container, unmount } = renderWithTrpc(<OpenctiThreatVisibilityBanner />, { answers: answers(visibility, link) });
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(container.textContent).not.toContain(BANNER);
      unmount();
    }
  });
});

describe('OpenctiThreatVisibilityField', () => {
  it('should name the choice and mark the per-member one unavailable from an unlinked OpenCTI', async () => {
    renderWithTrpc(<OpenctiThreatVisibilityField />, { answers: answers('per_member', { link: 'not_linked' }) });

    expect(await screen.findByText('Unavailable')).toBeTruthy();
    expect(screen.getByText('By each member\'s rights in OpenCTI')).toBeTruthy();
  });

  it('should name the service account choice without a mark', async () => {
    renderWithTrpc(<OpenctiThreatVisibilityField />, { answers: answers('service_account', { link: 'not_linked' }) });

    expect(await screen.findByText('As the service account')).toBeTruthy();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });
});
