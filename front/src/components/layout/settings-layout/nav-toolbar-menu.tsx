import { Link } from '@tanstack/react-router';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@filigran/ui';
import type { ComponentProps, FunctionComponent, ReactElement, ReactNode } from 'react';
import { cn } from '../../../utils';

export interface MenuEntry {
  linkOption?: ComponentProps<typeof Link>,
  linkClassName?: string,
  label: string,
  icon?: ReactElement,
  /** Shown after the label as "Label (N)", as the OpenAEV and OpenCTI rails do. */
  number?: number,
  /** Rendered at the end of the row (e.g. an edition chip). */
  chip?: ReactElement,
  children?: Array<MenuEntry>,
  matchRoute?: () => boolean,
}

/**
 * One row of the rail, drawn as the OpenAEV `RightMenu` row: 14px regular neutral text, a 16px icon at
 * half opacity in the secondary ink (full opacity and the primary ink when selected), the hover wash of
 * the layer the rail sits on (layer 1), and a selected row tinted with the brand primary and its 2px
 * accent bar.
 */
const RAIL_ROW_CLASSES = cn(
  'flex min-h-9 w-full items-center gap-2 px-4 py-1.5 text-left text-sm font-normal',
  'text-default-primary transition-colors hover:bg-[var(--fds-bg-elevation-hover-layer-1)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ring-focus',
);

const RAIL_ROW_ACTIVE_CLASSES = cn(
  'bg-filigran-brand-primary-transparency-10 hover:bg-filigran-brand-primary-transparency-10',
  'shadow-[inset_2px_0px] shadow-primary',
);

const RailIcon: FunctionComponent<{ icon?: ReactElement, active?: boolean }> = ({ icon, active }) => {
  if (!icon) {
    return null;
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center [&_svg]:size-4',
        active ? 'text-default-primary opacity-100' : 'text-default-secondary opacity-50',
      )}
    >
      {icon}
    </span>
  );
};

const RailLabel: FunctionComponent<{ entry: MenuEntry }> = ({ entry }) => (
  <span className="min-w-0 flex-1 truncate" title={entry.label}>
    {entry.number === undefined ? entry.label : `${entry.label} (${entry.number})`}
  </span>
);

// The icon emphasis follows the router's own active state, handed to the render function, so the
// selected row's icon is drawn at full opacity whatever the CSS variant support of the build.
const MenuLink: FunctionComponent<{ entry: MenuEntry }> = ({ entry }) => (
  <Link
    activeOptions={{ exact: false }}
    activeProps={{ className: RAIL_ROW_ACTIVE_CLASSES }}
    className={cn(RAIL_ROW_CLASSES, entry.linkClassName)}
    {...entry.linkOption}
  >
    {({ isActive }: { isActive: boolean }) => (
      <>
        <RailIcon icon={entry.icon} active={isActive} />
        <RailLabel entry={entry} />
        {entry.chip}
      </>
    )}
  </Link>
);

const MenuGroup: FunctionComponent<{ entry: MenuEntry }> = ({ entry }) => {
  const isActive = entry.matchRoute?.() ?? false;

  return (
    <Accordion type="single" collapsible defaultValue={isActive ? entry.label : undefined}>
      <AccordionItem value={entry.label} className="border-none">
        <AccordionTrigger className={cn(RAIL_ROW_CLASSES, 'justify-between rounded-none hover:no-underline [&>svg]:size-4 [&>svg]:text-default-secondary')}>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <RailIcon icon={entry.icon} active={isActive} />
            <RailLabel entry={entry} />
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-0">
          <div className="flex flex-col">
            {entry.children?.map((child, idx) => (
              <MenuLink key={child.linkOption?.href ?? `${idx}-${child.label}`} entry={{ ...child, linkClassName: cn('pl-12', child.linkClassName) }} />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

/**
 * The settings right rail, aligned with the OpenAEV `RightMenu` and the OpenCTI right menus: a 200px
 * rail under the header (its page reserves the gutter with `mr-[200px]`), one elevation layer above the page with a subtle left border, an optional
 * header slot (the scope switch) above the entries.
 */
export const NavToolbarMenu: FunctionComponent<{ entries: Array<MenuEntry>, header?: ReactNode }> = ({ entries, header }) => (
  <aside
    className="fixed top-[var(--fds-header-height,68px)] right-0 z-10 h-[calc(100vh-var(--fds-header-height,68px))] w-[200px] overflow-y-auto border-l border-elevation-subtle-soft bg-[var(--fds-bg-elevation-default-layer-1)]"
  >
    {header}
    <nav className="flex flex-col py-1">
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
