/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages as frenchMessages } from '../../../locales/fr/messages.po';
import { ResourceLevelGauge, resourceLevelLabel } from './resource-level-gauge';

const filledBars = (gauge: Element): number => gauge.querySelectorAll('rect[data-filled="true"]').length;

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('resourceLevelLabel', () => {
  it.each([
    ['individual', 'Individual', 'Individuel'],
    ['club', 'Club', 'Club'],
    ['contest', 'Contest', 'Concours'],
    ['team', 'Team', 'Équipe'],
    ['organization', 'Organization', 'Organisation'],
    ['government', 'Government', 'Gouvernement'],
  ])('words %s as "%s" in English and "%s" in French', (value, english, french) => {
    expect(resourceLevelLabel(value)).toBe(english);

    i18n.load('fr', frenchMessages);
    i18n.activate('fr');

    expect(resourceLevelLabel(value)).toBe(french);
  });

  it('prints a value outside the six built-ins as stored', () => {
    expect(resourceLevelLabel('nation-state')).toBe('nation-state');
  });
});

describe('ResourceLevelGauge', () => {
  it.each([
    ['individual', 1],
    ['club', 2],
    ['contest', 3],
    ['team', 4],
    ['organization', 5],
    ['government', 6],
  ])('fills as many of the six bars as %s ranks (%i)', (value, rank) => {
    render(<ResourceLevelGauge value={value} />);

    const gauge = screen.getByRole('img', { name: resourceLevelLabel(value) });
    expect(gauge.querySelectorAll('rect')).toHaveLength(6);
    expect(filledBars(gauge)).toBe(rank);
  });

  it('draws rising bars', () => {
    render(<ResourceLevelGauge value="team" />);

    const heights = [...screen.getByRole('img').querySelectorAll('rect')].map((bar) => Number(bar.getAttribute('height')));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(6);
  });

  it('names the gauge with the French label in French', () => {
    i18n.load('fr', frenchMessages);
    i18n.activate('fr');

    render(<ResourceLevelGauge value="government" />);

    expect(screen.getByRole('img', { name: 'Gouvernement' })).toBeTruthy();
  });

  it('is hidden from assistive technology when decorative', () => {
    const { container } = render(<ResourceLevelGauge value="team" decorative />);

    expect(screen.queryByRole('img')).toBeNull();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('aria-label')).toBe(false);
  });

  it('draws nothing for a value outside the six built-ins or no value', () => {
    const { container } = render(<ResourceLevelGauge value="nation-state" />);
    expect(container.innerHTML).toBe('');
    cleanup();

    const { container: empty } = render(<ResourceLevelGauge value={null} />);
    expect(empty.innerHTML).toBe('');
  });
});
