/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipHintProvider } from '../../../components/shared';
import { OneLineChips } from './one-line-chips';

const renderChips = (labels: Array<string>) => render(
  <TooltipHintProvider>
    <OneLineChips items={labels.map((label) => ({ key: label, label }))} />
  </TooltipHintProvider>,
);

describe('OneLineChips', () => {
  afterEach(cleanup);

  it('should render nothing for no chip', () => {
    const { container } = renderChips([]);
    expect(container.textContent).toBe('');
  });

  it('should render a single chip alone, with no +n or count chip', () => {
    const { container } = renderChips(['Host']);
    expect(screen.getByText('Host')).toBeTruthy();
    expect(container.querySelector('[data-chips]')).toBeNull();
  });

  it('should render the first chip and a +n chip, and the count alone for a narrow cell', () => {
    const { container } = renderChips(['Host', 'Storage', 'Process']);
    const firstAndRest = container.querySelector('[data-chips="first-and-rest"]');
    const count = container.querySelector('[data-chips="count"]');
    expect(firstAndRest?.textContent).toContain('Host');
    expect(firstAndRest?.textContent).toContain('+2');
    expect(firstAndRest?.querySelector('[aria-label="Storage, Process"]')).not.toBeNull();
    expect(count?.textContent).toBe('3');
    expect(count?.querySelector('[aria-label="Host, Storage, Process"]')).not.toBeNull();
  });

  // jsdom evaluates no container query, so the guard is on the classes the cascade sees: a display
  // utility `fds.css` ships unlayered (`hidden`, `flex`, ...) would beat the layered `@min-[96px]:`
  // variant and pin one variant at every width (UX round on #149, B1).
  it('should toggle the two variants with display classes fds.css does not override', () => {
    const { container } = renderChips(['Host', 'Storage', 'Process']);
    const fdsCss = readFileSync(resolve(process.cwd(), 'src/styles/fds.css'), 'utf8');
    const variants = [
      [container.querySelector('[data-chips="first-and-rest"]'), ['[display:none]', '@min-[96px]:[display:flex]']],
      [container.querySelector('[data-chips="count"]'), ['[display:flex]', '@min-[96px]:[display:none]']],
    ] as const;
    for (const [element, display] of variants) {
      const classes = Array.from(element?.classList ?? []);
      for (const name of display) {
        expect(classes).toContain(name);
      }
      for (const name of classes) {
        expect(['hidden', 'flex', 'block', 'grid', 'inline-flex', 'inline-block', 'contents']).not.toContain(name);
      }
    }
    expect(fdsCss).not.toContain('.\\[display\\:');
  });
});
