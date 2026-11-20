import type { ScopeDrawerTab } from '../scope-drawer-tabs';
import { SCOPE_DRAWER_TABS } from '../scope-drawer-tabs';

/** Which of the three things one press of Save can have done, for the caller to put into words. */
export type ScopeSaveOutcome = 'repriced' | 'updated' | 'unchanged';

interface ScopeDirtyState {
  identity: boolean,
  answers: boolean,
  employeeCount: boolean,
  declaredEstate: boolean,
}

/**
 * What a press of Save did, from the dirty state of the drawer's forms. Every write is gated on
 * its own flag, so nothing dirty means nothing written.
 *
 * `repriced` is narrower than "woke the recompute": any write to `organizations` does that, since
 * the table is in the observed recompute's read set, but only the answers, the headcount and the
 * declared estate feed the engine, so only they move a figure the reader would see move.
 */
export const scopeSaveOutcome = ({ identity, answers, employeeCount, declaredEstate }: ScopeDirtyState): ScopeSaveOutcome => {
  if (answers || employeeCount || declaredEstate) {
    return 'repriced';
  }
  return identity ? 'updated' : 'unchanged';
};

const ESTATE_FIELDS: ReadonlyArray<string> = ['estateMode', 'mapping'];

/**
 * The tabs holding an erroring field, in tab order. The identity form carries the Estate tab's two
 * fields as well, since the drawer's tabs are one save.
 */
export const tabsInError = (
  identityFields: ReadonlyArray<string>,
  questionnaireFields: ReadonlyArray<string>,
  declaredEstateInError = false,
): Array<ScopeDrawerTab> => SCOPE_DRAWER_TABS.filter((tab) => {
  if (tab === 'questionnaire') {
    return questionnaireFields.length > 0;
  }
  if (tab === 'declared-estate') {
    return declaredEstateInError;
  }
  return identityFields.some((field) => (ESTATE_FIELDS.includes(field) ? tab === 'estate' : tab === 'identity'));
});
