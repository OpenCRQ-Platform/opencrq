import { describe, expect, it } from 'vitest';
import { tabForAction } from './scope-drawer-tabs';

describe('tabForAction', () => {
  it('should open Edit on Identity', () => {
    expect(tabForAction('edit')).toBe('identity');
  });

  it('should open Manage assets on Estate', () => {
    expect(tabForAction('manage-assets')).toBe('estate');
  });

  it('should open Answer the questionnaire on Questionnaire', () => {
    expect(tabForAction('answer-questionnaire')).toBe('questionnaire');
  });

  it('should open Declare the estate on Declared estate', () => {
    expect(tabForAction('declare-estate')).toBe('declared-estate');
  });
});
