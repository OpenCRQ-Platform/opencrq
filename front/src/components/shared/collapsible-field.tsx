import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@filigran/ui';
import type { FunctionComponent, ReactNode } from 'react';
import { EmptyValue } from '../ui/empty-value';

interface CollapsibleFieldProps {
  title: ReactNode,
  value: string | null,
  className?: string,
}

/**
 * A `CardField` whose value stays hidden behind a trigger, collapsed by default — for a field long
 * or sensitive enough that showing it plainly would unbalance a card of short scalar fields (e.g.
 * an AI target's system prompt).
 */
export const CollapsibleField: FunctionComponent<CollapsibleFieldProps> = ({ title, value, className }) => (
  <div className={className}>
    <Accordion type="single" collapsible>
      <AccordionItem value="field" className="border-none">
        <AccordionTrigger className="px-0 hover:no-underline!">
          <p className="text-muted-foreground txt-sub-content">{title}</p>
        </AccordionTrigger>
        <AccordionContent className="px-0">
          <p className="whitespace-pre-wrap">{value ?? <EmptyValue />}</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>
);
