import { Checkbox, Chip, ChipWidthsProvider } from '@filigran/design-system';
import type { SupportToPrimaryLinkRole } from '@app/module/client';
import { inheritedCriteriaOfRoles, SUPPORT_TO_PRIMARY_LINK_ROLES } from '@app/module/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { LinkListStore, LinkListValue } from '../link-list-store';
import type { LinkState, PageLinkSummary, PendingLinkKind } from '../manage-dependencies-utils';
import type { AssetNameParts } from '../../../utils/asset-name-utils';
import { AssetName } from '../../../components/shared/asset-name';
import { MultiSelectField } from '../../../components/shared/select-field';
import { assetNameText } from '../../../utils/asset-name-utils';
import { getLinkRoleLabel } from '../link-role-labels';
import { applyRoleSelection, pageLinkSummary } from '../manage-dependencies-utils';
import { InheritedCriteriaTiles } from './link-role-display';

const isLinkRole = (value: string): value is SupportToPrimaryLinkRole =>
  (SUPPORT_TO_PRIMARY_LINK_ROLES as ReadonlyArray<string>).includes(value);

/** The width the roles field is drawn for: one chip, then "+N", plus the cell's own padding. */
export const LINK_ROLES_COLUMN_SIZE = 256;
/** Four 24px tiles and their gaps, plus the cell's padding. */
export const LINK_CRITERIA_COLUMN_SIZE = 124;

/** Wraps onto two lines, so the column is as narrow as its tiles rather than as its title. */
export const InheritedCriteriaHeader: FunctionComponent = () => <span className="whitespace-normal">{t`Inherited criteria`}</span>;

export const LinkCheckbox: FunctionComponent<{ name: string, linked: boolean, onToggle: () => void }> = ({ name, linked, onToggle }) => (
  <Checkbox
    checked={linked}
    aria-label={i18n._({ id: 'Link {name}', message: 'Link {name}', values: { name } })}
    onClick={(event) => event.stopPropagation()}
    onCheckedChange={onToggle}
  />
);

/** The header checkbox: the state of the rows on screen, and a click links them all, or unlinks them all once they all are. */
export const PageCheckbox: FunctionComponent<{ summary: PageLinkSummary, onChange: (linked: boolean) => void }> = ({ summary, onChange }) => {
  const all = summary === 'all';
  return (
    <Checkbox
      checked={all ? true : (summary === 'some' ? 'indeterminate' : false)}
      disabled={summary === 'empty'}
      aria-label={all ? t`Unlink every asset on this page` : t`Link every asset on this page`}
      onCheckedChange={() => onChange(!all)}
    />
  );
};

export const LinkStatusChip: FunctionComponent<{ pending: PendingLinkKind | null }> = ({ pending }) => {
  switch (pending) {
    case 'add': return <Chip severity="low" label={t({ message: 'New', context: 'a dependency about to be created' })} />;
    case 'remove': return <Chip severity="critical" label={t({ message: 'Removed', context: 'a dependency about to be deleted' })} />;
    case 'edit': return <Chip severity="medium" label={t({ message: 'Edited', context: 'a dependency whose roles changed' })} />;
    case null: return null;
  }
};

const roleOptions = () => SUPPORT_TO_PRIMARY_LINK_ROLES.map((role) => ({ value: role, label: getLinkRoleLabel(role) }));

/** Above a roles list: measures the role chips once for every row, rather than once in each row's field. */
export const LinkRoleChipWidths: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <ChipWidthsProvider labels={roleOptions().map((option) => option.label)}>{children}</ChipWidthsProvider>
);

/** The roles of a row, in a field held to one line. They are the link: an empty field is an unlinked row. */
export const LinkRolesCell: FunctionComponent<{
  name: string,
  state: LinkState,
  onChange: (roles: Array<SupportToPrimaryLinkRole>) => void,
}> = ({ name, state, onChange }) => {
  const roles = state.roles ?? [];
  return (
    <div className="w-60" onClick={(event) => event.stopPropagation()}>
      <MultiSelectField
        hideLabel
        label={i18n._({ id: 'Roles for {name}', message: 'Roles for {name}', values: { name } })}
        placeholder={t({ message: 'Not linked', context: 'an empty roles field: the asset has no link yet' })}
        options={roleOptions()}
        value={[...roles]}
        onChange={(next) => onChange(applyRoleSelection(roles, next.filter(isLinkRole)))}
        maxVisibleChips={1}
        clearable={false}
      />
    </div>
  );
};

/**
 * The store a list's cells read. TanStack renders a column's `cell` as a component, so the columns
 * stay the same across renders and the changing state reaches the cells from here: a column rebuilt
 * on each change would remount its cells and close a roles list mid-selection.
 */
export const LinkListContext = createContext<LinkListStore | null>(null);

const useLinkListStore = () => {
  const store = useContext(LinkListContext);
  if (!store) {
    throw new Error('A link list cell must be rendered inside LinkListContext');
  }
  return store;
};

const useRowLinkState = (id: string) => {
  const store = useLinkListStore();
  return useSyncExternalStore(store.subscribe, () => store.rowState(id));
};

const checkboxList = (value: LinkListValue) => {
  if (value.kind !== 'checkbox') {
    throw new Error('A checkbox cell belongs to a list whose links carry no roles');
  }
  return value;
};

const rolesList = (value: LinkListValue) => {
  if (value.kind !== 'roles') {
    throw new Error('A roles cell belongs to a list whose links carry roles');
  }
  return value;
};

export const LinkListHeaderCheckbox: FunctionComponent = () => {
  const store = useLinkListStore();
  const summary = useSyncExternalStore(store.subscribe, () => pageLinkSummary(checkboxList(store.current()).pageStates));
  return <PageCheckbox summary={summary} onChange={(linked) => checkboxList(store.current()).setPageLinked(linked)} />;
};

export const LinkListCheckbox: FunctionComponent<{ id: string, name: string }> = ({ id, name }) => {
  const store = useLinkListStore();
  const { linked } = useRowLinkState(id);
  return <LinkCheckbox name={name} linked={linked} onToggle={() => checkboxList(store.current()).toggle(id)} />;
};

export const LinkListRoles: FunctionComponent<{ id: string, name: string }> = ({ id, name }) => {
  const store = useLinkListStore();
  const state = useRowLinkState(id);
  return (
    <LinkRolesCell
      name={name}
      state={state}
      onChange={(roles) => rolesList(store.current()).setRoles(id, roles)}
    />
  );
};

export const LinkListCriteria: FunctionComponent<{ id: string }> = ({ id }) => {
  const { linked, roles } = useRowLinkState(id);
  return linked && roles !== null ? <InheritedCriteriaTiles criteria={inheritedCriteriaOfRoles([...roles])} /> : null;
};

/** The asset's name with the row's pending status beside it, which a column of its own would push out of a narrow drawer. */
export const LinkListName: FunctionComponent<AssetNameParts & { id: string }> = ({ id, name, derivedName }) => {
  const { pending } = useRowLinkState(id);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-medium" title={assetNameText({ name, derivedName }, t`Unnamed asset`)}>
        <AssetName name={name} derivedName={derivedName} />
      </span>
      <span className="shrink-0"><LinkStatusChip pending={pending} /></span>
    </span>
  );
};
