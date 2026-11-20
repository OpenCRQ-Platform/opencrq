/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenCtiLink } from './opencti-link';

afterEach(() => {
  cleanup();
});

describe('OpenCtiLink', () => {
  it('renders nothing when href is null', () => {
    const { container } = render(<OpenCtiLink href={null} label="Open in OpenCTI" />);

    expect(container.innerHTML).toBe('');
  });

  it('renders an anchor with the safe target/rel combination and the visible label', () => {
    render(<OpenCtiLink href="https://opencti.example.com/dashboard/id/abc" label="Open in OpenCTI" />);

    const link = screen.getByRole('link', { name: 'Open in OpenCTI' });
    expect(link.getAttribute('href')).toBe('https://opencti.example.com/dashboard/id/abc');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('exposes the label through aria-label in the icon-only variant, with no visible text', () => {
    render(<OpenCtiLink href="https://opencti.example.com/dashboard/id/abc" label="Open this relationship in OpenCTI" iconOnly />);

    const link = screen.getByRole('link', { name: 'Open this relationship in OpenCTI' });
    expect(link.getAttribute('aria-label')).toBe('Open this relationship in OpenCTI');
    expect(link.textContent).toBe('');
  });
});
