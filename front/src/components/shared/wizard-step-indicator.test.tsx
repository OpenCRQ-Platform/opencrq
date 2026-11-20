/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WizardStepIndicator } from './wizard-step-indicator';

const STEPS = ['one', 'two', 'three'].map((key) => ({ key, label: () => key }));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

/** A checked step shows a check icon where an unchecked one shows its number. */
const checkedLabels = (container: HTMLElement) => STEPS
  .filter((step) => {
    const label = Array.from(container.querySelectorAll('span')).find((span) => span.textContent === step.label());
    return label?.previousElementSibling?.querySelector('svg') !== null;
  })
  .map((step) => step.key);

describe('WizardStepIndicator', () => {
  it('checks the steps before the current one when no completed keys are given', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={2} />);

    expect(checkedLabels(container)).toEqual(['one', 'two']);
  });

  it('numbers the current step and the ones after it when no completed keys are given', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={1} />);

    expect(container.textContent).toContain('2two');
    expect(container.textContent).toContain('3three');
    expect(container.textContent).not.toContain('1one');
  });

  it('checks only the listed steps, wherever the current step is', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={2} completedStepKeys={['two']} />);

    expect(checkedLabels(container)).toEqual(['two']);
  });

  it('checks no step for an empty list of completed keys', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={2} completedStepKeys={[]} />);

    expect(checkedLabels(container)).toEqual([]);
  });

  it('renders no link and no ring when neither prop is given', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={1} />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[class*="animate-spin"]')).toBeNull();
    expect(screen.queryByText('Syncing')).toBeNull();
  });

  it('wraps the circle and the label of every step in the link the caller renders', () => {
    render(
      <WizardStepIndicator
        steps={STEPS}
        currentStep={1}
        renderStepLink={(step, { children, ...props }) => <a href={`#${step.key}`} {...props}>{children}</a>}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#one', '#two', '#three']);
    expect(links[2]?.textContent).toBe('3three');
  });

  it('marks only the current step with aria-current', () => {
    render(
      <WizardStepIndicator
        steps={STEPS}
        currentStep={1}
        renderStepLink={(step, { children, ...props }) => <a href={`#${step.key}`} {...props}>{children}</a>}
      />,
    );

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });

  it('draws a ring and a hidden label around the listed syncing steps only', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={0} syncingStepKeys={['two']} />);

    expect(container.querySelectorAll('[class*="animate-spin"]')).toHaveLength(1);
    expect(screen.getAllByText('Syncing')).toHaveLength(1);
    const ring = container.querySelector('[class*="animate-spin"]');
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(ring?.closest('div')?.nextElementSibling?.textContent).toBe('two');
  });

  it('keeps the ring from spinning when the reader asks for reduced motion', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={0} syncingStepKeys={['one']} />);

    expect(container.querySelector('[class*="animate-spin"]')?.className).toContain('motion-safe:animate-spin');
  });

  describe('with stepProgress', () => {
    const progress = { two: { fraction: 0.25, label: 'Started, 5 of 20' } };
    const ringOf = (container: HTMLElement) => container.querySelector('svg[aria-hidden="true"]:not(.lucide)');

    it('keeps the number of a started step and draws a static ring filled to its fraction', () => {
      const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={0} stepProgress={progress} />);

      expect(container.textContent).toContain('2two');
      expect(container.querySelectorAll('svg.lucide-check')).toHaveLength(0);
      expect(ringOf(container)?.querySelector('[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe('25 100');
      expect(container.querySelector('[class*="animate-spin"]')).toBeNull();
    });

    it('gives the started step an accessible label after its name', () => {
      render(<WizardStepIndicator steps={STEPS} currentStep={0} stepProgress={progress} />);

      expect(screen.getByText('Started, 5 of 20').className).toContain('sr-only');
    });

    it('draws no ring on a step the caller did not list', () => {
      const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={0} stepProgress={{}} />);

      expect(ringOf(container)).toBeNull();
    });

    it('checks a done step and draws no ring on it, whatever its progress', () => {
      const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={0} completedStepKeys={['two']} stepProgress={progress} />);

      expect(container.querySelectorAll('svg.lucide-check')).toHaveLength(1);
      expect(ringOf(container)).toBeNull();
      expect(screen.queryByText('Started, 5 of 20')).toBeNull();
    });

    it('lets the syncing ring win over the progress ring', () => {
      const { container } = render(<WizardStepIndicator steps={STEPS} currentStep={0} syncingStepKeys={['two']} stepProgress={progress} />);

      expect(container.querySelectorAll('[class*="animate-spin"]')).toHaveLength(1);
      expect(ringOf(container)).toBeNull();
      expect(screen.queryByText('Started, 5 of 20')).toBeNull();
    });
  });
});
