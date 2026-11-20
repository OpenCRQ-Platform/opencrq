import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@filigran/design-system';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@filigran/ui';
import type { ComponentProps, FunctionComponent, ReactElement, ReactNode } from 'react';
import { cn } from '../../../utils';

export interface MenuEntry {
  linkOption?: ComponentProps<typeof Link>,
  linkClassName?: string,
  label: string,
  icon?: ReactElement,
  children?: Array<MenuEntry>,
  matchRoute?: () => boolean,
}

const MenuLink: FunctionComponent<{ entry: MenuEntry }> = ({ entry }) => (
  <Link
    activeOptions={{ exact: false }}
    activeProps={{
      className: 'bg-primary/10 shadow-[inset_2px_0px] shadow-primary',
    }}
    className={cn(
      buttonVariants({ priority: 'tertiary', size: 'sm' }),
      'w-full justify-start rounded-none px-4',
      entry.linkClassName,
    )}
    {...entry.linkOption}
  >
    {entry.icon && (
      <span className="mr-2 flex items-center justify-center">
        {entry.icon}
      </span>
    )}
    <span className="truncate">{entry.label}</span>
  </Link>
);

const MenuGroup: FunctionComponent<{ entry: MenuEntry }> = ({ entry }) => {
  const isActive = entry.matchRoute?.() ?? false;

  return (
    <Accordion type="single" collapsible defaultValue={isActive ? entry.label : undefined}>
      <AccordionItem value={entry.label} className="border-none">
        <AccordionTrigger
          className={cn(
            buttonVariants({ priority: 'tertiary', size: 'sm' }),
            'w-full justify-between rounded-none px-4 hover:no-underline',
            isActive && 'text-primary',
          )}
        >
          <span className="flex items-center gap-2">
            {entry.icon && (
              <span className="flex items-center justify-center">
                {entry.icon}
              </span>
            )}
            <span className="truncate">{entry.label}</span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-0">
          <div className="flex flex-col">
            {entry.children?.map((child, idx) => (
              <MenuLink key={idx} entry={{ ...child, linkClassName: 'pl-8', linkOption: { ...child.linkOption } }} />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export const NavToolbarMenu: FunctionComponent<{ entries: Array<MenuEntry>, header?: ReactNode }> = ({ entries, header }) => (
  <aside className="fixed top-[var(--fds-header-height,68px)] right-0 w-[200px] h-[calc(100vh-var(--fds-header-height,68px))] border-l bg-background overflow-y-auto z-10">
    {header}
    <nav className="flex flex-col py-2">
      {entries.map((entry, idx) => {
        // A stale `href`-only Link keeps navigating to whatever it first mounted with: useLinkProps
        // only re-derives its target from `to`/`search`/`params`/`hash`, never from a raw `href`. Keying
        // by the href forces a remount, hence a fresh target, whenever an entry's destination changes.
        const key = entry.linkOption?.href ?? `${idx}-${entry.label}`;
        return entry.children
          ? <MenuGroup key={key} entry={entry} />
          : <MenuLink key={key} entry={entry} />;
      })}
    </nav>
  </aside>
);
