import type { FunctionComponent, ReactNode } from 'react';

/** A system-produced identifier standing on its own: technique ids, weakness ids. */
export const MonoChip: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <span className="rounded-[var(--fds-radius-sm)] border border-current px-1.5 py-0.5 font-content-code text-content-code text-default-secondary">
    {children}
  </span>
);
