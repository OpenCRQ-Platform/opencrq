/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { FeatureFlagged } from './feature-flagged';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

/** Renders the gated content against a bootstrap payload carrying `featureFlags`, or one that never arrives. */
const renderGated = async (featureFlags: Array<string> | undefined) => {
  const { queryClient } = renderWithTrpc(<FeatureFlagged flag="enterprise-edition-status">gated content</FeatureFlagged>, {
    answers: { authStatus: featureFlags === undefined ? NEVER : { initialized: true, featureFlags } },
  });
  if (featureFlags !== undefined) {
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  }
};

describe('FeatureFlagged', () => {
  it('should render nothing when the flag is off', async () => {
    await renderGated([]);

    expect(screen.queryByText('gated content')).toBeNull();
  });

  it('should render nothing while the bootstrap payload is unavailable', async () => {
    await renderGated(undefined);

    expect(screen.queryByText('gated content')).toBeNull();
  });

  it('should render the children when the flag is on', async () => {
    await renderGated(['enterprise-edition-status']);

    expect(await screen.findByText('gated content')).toBeTruthy();
  });

  it('should render the children behind the wildcard', async () => {
    await renderGated(['*']);

    expect(await screen.findByText('gated content')).toBeTruthy();
  });
});
