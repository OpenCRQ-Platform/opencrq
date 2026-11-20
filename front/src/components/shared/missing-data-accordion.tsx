import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@filigran/ui';
import type { FunctionComponent, ReactNode } from 'react';
import { WarningDot } from './warning-dot';

/**
 * Shared styling for the row's call-to-action so every caller's link looks the same.
 * The link itself is built by the caller: TanStack's router types route paths and their
 * params together, and only the caller knows which params it can supply.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
export const MISSING_DATA_ACTION_CLASS = 'txt-sub-content shrink-0 rounded-sm px-1 py-0.5 uppercase text-primary hover:bg-primary/5';

export interface MissingDataRow {
  key: string,
  label: string,
  /** Kept short: the row truncates rather than wrapping. */
  description: string,
  action?: ReactNode,
}

interface MissingDataAccordionProps {
  title: ReactNode,
  items: Array<MissingDataRow>,
}

/**
 * "Something is missing, here is where to fix it" panel: an amber-railed card listing each
 * gap with a link to the page that closes it. Extracted from the risk-scenario
 * configuration accordion so the dashboards can state why a widget is empty in the same
 * language as the scenario pages.
 */
export const MissingDataAccordion: FunctionComponent<MissingDataAccordionProps> = ({ title, items }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-l-sm border-l-2 border-l-orange bg-card">
      <Accordion type="single" collapsible defaultValue="missing-data">
        <AccordionItem value="missing-data" className="border-none">
          <AccordionTrigger className="min-h-12 px-4 hover:no-underline!">
            <span className="txt-subtitle2 text-orange">{title}</span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pt-2 pb-4">
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.key} className="flex min-w-0 items-center gap-2 txt-sub-content">
                  <WarningDot />
                  <span className="txt-h3 shrink-0">{item.label}:</span>
                  <span className="txt-table truncate">{item.description}</span>
                  {item.action}
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
