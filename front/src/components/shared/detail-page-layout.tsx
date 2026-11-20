import type { FunctionComponent, ReactNode } from 'react';

interface DetailPageLayoutProps {
  title: string,
  titleLeading?: ReactNode,
  actions?: ReactNode,
  children: ReactNode,
}

export const DetailPageLayout: FunctionComponent<DetailPageLayoutProps> = ({ title, titleLeading, actions, children }) => (
  <div className="flex flex-col gap-6">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {titleLeading}
        <h1 className="min-w-0 truncate">{title}</h1>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
    {children}
  </div>
);
