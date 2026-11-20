/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ThreatDescription } from './threat-description';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  // jsdom has no layout: the clamp only measures overflow, which this test does not need.
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

// MITRE's own text for Rocke, as the dataset carries it.
const MARKDOWN = '[Rocke](https://attack.mitre.org/groups/G0106) is an alleged Chinese-speaking adversary whose primary objective appeared to be cryptojacking.(Citation: Talos Rocke August 2018)';

describe('ThreatDescription', () => {
  it('should draw the markdown of a Default Threats description, citations included', () => {
    const { container } = render(<ThreatDescription description={MARKDOWN} kind="default-threats" />);

    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://attack.mitre.org/groups/G0106');
    expect(container.querySelector('sup')?.getAttribute('title')).toBe('Talos Rocke August 2018');
    expect(container.textContent).not.toContain('](');
    expect(container.textContent).not.toContain('(Citation:');
  });

  it.each(['connector', 'stix-import'] as const)('should leave the description of a %s threat as plain text', (kind) => {
    const { container } = render(<ThreatDescription description={MARKDOWN} kind={kind} />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain(MARKDOWN);
  });
});
