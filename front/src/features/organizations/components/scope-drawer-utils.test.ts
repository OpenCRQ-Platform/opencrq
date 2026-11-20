/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { scopeSaveOutcome, tabsInError } from './scope-drawer-utils';

describe('scopeSaveOutcome', () => {
  const dirty = (state: Partial<Parameters<typeof scopeSaveOutcome>[0]> = {}) =>
    scopeSaveOutcome({ identity: false, answers: false, employeeCount: false, declaredEstate: false, ...state });

  it('should report nothing written when no form was touched', () => {
    expect(dirty()).toBe('unchanged');
  });

  it('should report a re-pricing when the answers changed', () => {
    expect(dirty({ answers: true })).toBe('repriced');
  });

  it('should report a re-pricing when the headcount changed, which the kernel prices from', () => {
    expect(dirty({ identity: true, employeeCount: true })).toBe('repriced');
  });

  it('should report a plain update for an identity field the kernel does not read', () => {
    expect(dirty({ identity: true })).toBe('updated');
  });

  it('should let the answers win over the identity when both changed', () => {
    expect(dirty({ identity: true, answers: true })).toBe('repriced');
  });

  it('should report a re-pricing when the declared estate changed, which the engine completes the estate from', () => {
    expect(dirty({ declaredEstate: true })).toBe('repriced');
  });
});

describe('tabsInError', () => {
  it('should name no tab when nothing is in error', () => {
    expect(tabsInError([], [])).toEqual([]);
  });

  it('should name Identity for an identity field', () => {
    expect(tabsInError(['name'], [])).toEqual(['identity']);
  });

  it('should name Estate for an estate field', () => {
    expect(tabsInError(['estateMode'], [])).toEqual(['estate']);
  });

  it('should name Questionnaire for an answer', () => {
    expect(tabsInError([], ['annualRevenue'])).toEqual(['questionnaire']);
  });

  it('should name Declared estate for an answer in error there', () => {
    expect(tabsInError([], [], true)).toEqual(['declared-estate']);
  });

  it('should name every tab in tab order', () => {
    expect(tabsInError(['reactionTimeMax', 'mapping'], ['annualRevenue'], true)).toEqual(['identity', 'questionnaire', 'declared-estate', 'estate']);
  });
});
