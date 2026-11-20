import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';

/**
 * One counted, collapsible group of connectors. The design system ships no accordion at the pinned
 * version, so the header is a plain button carrying the chevron and the count.
 */
export const ConnectorSectionHeader: FunctionComponent<{
  title: string,
  icon: ReactNode,
  count: number,
  children: ReactNode,
}> = ({ title, icon, count, children }) => {
  const [isOpen, setIsOpen] = useState(true);
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-[var(--fds-radius-sm)] bg-elevation-highlight text-[var(--fds-color-filigran-brand-primary)]"
        >
          {icon}
        </span>
        <span className="font-title-xs text-title-xs">{title}</span>
        <span className="font-content-compact text-content-compact rounded-[var(--fds-radius-sm)] bg-elevation-highlight px-2 py-0.5 tabular-nums text-default-secondary">
          {count}
        </span>
        <Chevron className="size-4 text-default-secondary" aria-hidden="true" />
      </button>
      {isOpen && children}
    </section>
  );
};
