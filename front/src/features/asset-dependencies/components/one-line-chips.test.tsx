/** @vitest-environment jsdom */
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
});
