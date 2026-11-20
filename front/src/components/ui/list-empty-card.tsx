import { Card, CardDescription, CardHeader, CardTitle } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';

interface ListEmptyCardProps {
  title: ReactNode,
  body: ReactNode,
  actions: ReactNode,
}

/**
 * The card a list shows when it holds nothing at all. A search or a filter that matched nothing is
 * not that case: it shows `ListNoResults`, under the toolbar the reader loosens it with.
 */
export const ListEmptyCard: FunctionComponent<ListEmptyCardProps> = ({ title, body, actions }) => (
  <Card>
    <CardHeader>
      <CardTitle as="h2">{title}</CardTitle>
    </CardHeader>
    {/* `clamp={0}`: the card's default cuts the body at three lines, and here the body is the point. */}
    <CardDescription clamp={0} className="max-w-[58ch]">{body}</CardDescription>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </Card>
);
