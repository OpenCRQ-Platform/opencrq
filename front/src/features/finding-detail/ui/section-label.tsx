import type { FunctionComponent } from 'react';

/** The uppercase eyebrow opening every section of the finding dossier. */
export const SectionLabel: FunctionComponent<{ children: string }> = ({ children }) => (
  <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
    {children}
  </span>
);
