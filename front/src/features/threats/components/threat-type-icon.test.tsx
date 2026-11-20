/** @vitest-environment jsdom */
import type { ThreatEntityType } from '@app/module/client';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreatTypeIcon } from './threat-type-icon';

afterEach(() => {
  cleanup();
});

const renderIcon = (entityType: ThreatEntityType, size?: number): SVGElement => {
  const { container } = render(<ThreatTypeIcon entityType={entityType} size={size} />);
  const svg = container.querySelector('svg');
  if (svg === null) {
    throw new Error('no icon rendered');
  }
  return svg;
};

describe('ThreatTypeIcon', () => {
  it.each([
    ['intrusion-set', 'lucide-diamond'],
    ['threat-actor', 'lucide-users'],
    ['campaign', 'lucide-chess-knight'],
  ] as const)('draws %s with the %s glyph', (entityType, glyphClass) => {
    expect(renderIcon(entityType).classList.contains(glyphClass)).toBe(true);
  });

  it('draws every type in the threats entity colour', () => {
    for (const entityType of ['intrusion-set', 'threat-actor', 'campaign'] as const) {
      expect(renderIcon(entityType).classList.contains('text-entities-all-threats')).toBe(true);
      cleanup();
    }
  });

  it('is 16px by default and takes the size it is given', () => {
    expect(renderIcon('campaign').getAttribute('width')).toBe('16');
    cleanup();
    expect(renderIcon('campaign', 24).getAttribute('width')).toBe('24');
  });

  it('is hidden from assistive technology', () => {
    expect(renderIcon('threat-actor').getAttribute('aria-hidden')).toBe('true');
  });
});
