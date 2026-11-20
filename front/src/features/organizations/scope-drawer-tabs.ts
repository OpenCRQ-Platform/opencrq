/**
 * The scope drawer's tab vocabulary, deliberately outside the feature barrel: a route's own
 * options are evaluated as its module loads, and reaching these through the barrel puts them in
 * their own temporal dead zone at that point.
 */
export const SCOPE_DRAWER_TABS = ['identity', 'questionnaire', 'declared-estate', 'estate'] as const;
export type ScopeDrawerTab = (typeof SCOPE_DRAWER_TABS)[number];

export type ScopeDrawerAction = 'edit' | 'manage-assets' | 'answer-questionnaire' | 'declare-estate';

const TAB_BY_ACTION: Record<ScopeDrawerAction, ScopeDrawerTab> = {
  edit: 'identity',
  'manage-assets': 'estate',
  'answer-questionnaire': 'questionnaire',
  'declare-estate': 'declared-estate',
};

export const tabForAction = (action: ScopeDrawerAction): ScopeDrawerTab => TAB_BY_ACTION[action];

export const isScopeDrawerTab = (value: string): value is ScopeDrawerTab =>
  (SCOPE_DRAWER_TABS as ReadonlyArray<string>).includes(value);
