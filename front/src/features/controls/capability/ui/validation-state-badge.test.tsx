/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ValidationStateBadge } from './validation-state-badge';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('ValidationStateBadge', () => {
  it('speaks detection in the words the simulation product uses', () => {
    render(<ValidationStateBadge capabilityFunction="detect" successRate={1} />);
    render(<ValidationStateBadge capabilityFunction="detect" successRate={0.6} />);

    expect(screen.getByText('Detected')).toBeDefined();
    expect(screen.getByText('Not detected, 60% success rate')).toBeDefined();
  });

  it('speaks prevention in its own words', () => {
    render(<ValidationStateBadge capabilityFunction="prevent" successRate={1} />);
    render(<ValidationStateBadge capabilityFunction="prevent" successRate={0.5} />);

    expect(screen.getByText('Prevented')).toBeDefined();
    expect(screen.getByText('Not prevented, 50% success rate')).toBeDefined();
  });

  it('keeps the positive verdict under the threshold and lets the rate explain the tone', () => {
    render(<ValidationStateBadge capabilityFunction="detect" successRate={0.91} />);

    expect(screen.getByText('Detected, 91% success rate')).toBeDefined();
  });

  it('leaves the rate out where the verdict word already says everything', () => {
    render(<ValidationStateBadge capabilityFunction="detect" successRate={0} />);

    expect(screen.getByText('Not detected')).toBeDefined();
  });

  it('names an expectation nothing has tested', () => {
    render(<ValidationStateBadge capabilityFunction="detect" successRate={null} />);

    expect(screen.getByText('Never tested')).toBeDefined();
  });
});
