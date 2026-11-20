/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionCard } from './section-card';

afterEach(() => {
  cleanup();
});

const card = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('.card-under-test')!;

describe('SectionCard', () => {
  it('captions the card from above with a small label by default, no heading', () => {
    const { container } = render(
      <SectionCard title="Details" cardClassName="card-under-test" headerAction={<button type="button">Edit</button>}>
        <p>Body</p>
      </SectionCard>,
    );

    const label = screen.getByText('Details');
    expect(label.tagName).toBe('P');
    expect(label.className).toContain('txt-sub-content');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(card(container).contains(label)).toBe(false);
    expect(card(container).contains(screen.getByText('Body'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('titles a section from above with a level 2 heading, its adornment beside and outside it', () => {
    const { container } = render(
      <SectionCard title="What was funded" titleVariant="heading" titleAdornment={<span>3 lines</span>} cardClassName="card-under-test">
        <p>Body</p>
      </SectionCard>,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'What was funded' });
    expect(card(container).contains(heading)).toBe(false);
    expect(heading.contains(screen.getByText('3 lines'))).toBe(false);
  });

  it('sets the section title within the card', () => {
    const { container } = render(
      <SectionCard title="Identity" titleVariant="inside" cardClassName="card-under-test">
        <p>Body</p>
      </SectionCard>,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Identity' });
    expect(card(container).contains(heading)).toBe(true);
    expect(card(container).contains(screen.getByText('Body'))).toBe(true);
  });

  it('names a clickable card after its title, whatever the variant', () => {
    for (const titleVariant of ['label', 'inside'] as const) {
      const onClick = vi.fn();
      render(
        titleVariant === 'label'
          ? <SectionCard title="Scenarios" onClick={onClick}><p>Body</p></SectionCard>
          : <SectionCard title="Scenarios" titleVariant={titleVariant} onClick={onClick}><p>Body</p></SectionCard>,
      );

      const target = screen.getByRole('button', { name: 'Scenarios' });
      expect(target.getAttribute('aria-labelledby')).toBe(screen.getByText('Scenarios').id);
      fireEvent.keyDown(target, { key: 'Enter' });
      expect(onClick).toHaveBeenCalledOnce();
      cleanup();
    }
  });
});
