import type { FunctionComponent, ReactNode } from 'react';
import { PAGE_SCROLL_RESTORATION_ID } from '../../../lib/page-scroll-reset';
import { Breadcrumb } from './breadcrumb';

type PageProps = {
  children: ReactNode,
};

export const Page: FunctionComponent<PageProps> = ({ children }) => (
  <main data-scroll-restoration-id={PAGE_SCROLL_RESTORATION_ID} className="p-6 flex-1 w-full overflow-auto flex flex-col">
    <Breadcrumb />
    {children}
  </main>
);
