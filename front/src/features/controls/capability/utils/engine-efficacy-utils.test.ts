import { STRENGTH_BY_RUNG } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { TechniqueTestOutcome } from '../types/validation';
import { formatPointsAsPercent } from '../../../../utils/format-number';
import {
  DECLARATION_CEILING,
  displayedCalculation,
  displayedDeclaration,
  efficacyReadingOf,
  efficacyVerdict,
  ENGINE_FIGURE_DECIMALS,
  evidenceLinkOf,
  failedTests,
  formatEnginePercent,
  isEveryTest,
  parentExternalIdOf,
  shownPercentPoints,
} from './engine-efficacy-utils';

/** L2 strength on L2 coverage on the engine's scale, about 50 %. */
const DECLARED = STRENGTH_BY_RUNG.L2 * 0.7;

const tested = (heldTests: number, hostsTested: number, scopeHosts: number): TechniqueTestOutcome =>
  ({ tests: hostsTested, heldTests, rate: heldTests / hostsTested, hostsTested, scopeHosts, share: hostsTested / scopeHosts });

/** `min(D, (1 - alpha) x D + alpha x T)`, the efficacy the server hands. */
const efficacyOf = (declared: number, outcome: TechniqueTestOutcome): number =>
  Math.min(declared, (1 - outcome.share) * declared + outcome.share * outcome.rate);

describe('the shown precision', () => {
  it('writes every engine figure at the decimals the verdict is read at', () => {
    expect(ENGINE_FIGURE_DECIMALS).toBe(0);
    expect(shownPercentPoints(0.50271)).toBe(50);
    expect(shownPercentPoints(0.145)).toBe(15);
    expect(formatEnginePercent(0.50271)).toBe(formatPointsAsPercent(shownPercentPoints(0.50271), ENGINE_FIGURE_DECIMALS));
    expect(formatEnginePercent(0.50271)).toBe('50%');
    expect(formatEnginePercent(2 / 12)).toBe('17%');
  });
});

describe('efficacyVerdict', () => {
  it('reads a rate below the declaration as lowering it', () => {
    const outcome = tested(1, 10, 20);

    expect(efficacyVerdict({ tested: outcome, declared: DECLARED, efficacy: efficacyOf(DECLARED, outcome) })).toBe('lowered');
  });

  it('reads a rate at or above the declaration as confirming it', () => {
    const outcome = tested(8, 10, 20);

    expect(efficacyVerdict({ tested: outcome, declared: DECLARED, efficacy: DECLARED })).toBe('confirmed');
  });

  it('reads no result as untested', () => {
    expect(efficacyVerdict({ tested: null, declared: DECLARED, efficacy: DECLARED })).toBe('untested');
  });

  it('confirms an efficacy written as the declaration is: T1055.012, 50.27 % beside 50.3 %, both 50 %', () => {
    expect(efficacyVerdict({ tested: tested(1, 2, 20), declared: 0.503, efficacy: 0.5027 })).toBe('confirmed');
  });

  it('confirms an efficacy a whole percent hides, 49.6 % beside 50.3 %', () => {
    expect(efficacyVerdict({ tested: tested(1, 2, 20), declared: 0.503, efficacy: 0.496 })).toBe('confirmed');
  });

  it('lowers an efficacy written below the declaration, 49.4 % beside 50.3 %', () => {
    expect(efficacyVerdict({ tested: tested(1, 2, 20), declared: 0.503, efficacy: 0.494 })).toBe('lowered');
  });

  it('reads a half percent as the figure rounds it, up', () => {
    // 62.5 % is exact in binary and written 63 %.
    expect(efficacyVerdict({ tested: tested(1, 2, 20), declared: 0.63, efficacy: 0.625 })).toBe('confirmed');
    expect(efficacyVerdict({ tested: tested(1, 2, 20), declared: 0.63, efficacy: 0.62499 })).toBe('lowered');
  });
});

describe('efficacyReadingOf', () => {
  it('opens on the confirmation where the tested rate reaches the declaration', () => {
    const outcome = tested(10, 10, 20);

    expect(efficacyReadingOf({ tested: outcome, declared: DECLARED, efficacy: DECLARED })).toBe('confirmed');
  });

  it('opens on the bare facts where the rate falls short on too small a share to move the figure: T1055.012, 1 held of 2 on 2 hosts of 20', () => {
    const outcome = tested(1, 2, 20);
    const efficacy = efficacyOf(DECLARED, outcome);

    expect(shownPercentPoints(efficacy)).toBe(shownPercentPoints(DECLARED));
    expect(efficacyReadingOf({ tested: outcome, declared: DECLARED, efficacy })).toBe('unmoved');
  });

  it('opens on the drop where the figure shows it', () => {
    const outcome = tested(1, 10, 20);

    expect(efficacyReadingOf({ tested: outcome, declared: DECLARED, efficacy: efficacyOf(DECLARED, outcome) })).toBe('lowered');
  });

  it('says nothing was tested without a result', () => {
    expect(efficacyReadingOf({ tested: null, declared: DECLARED, efficacy: DECLARED })).toBe('untested');
  });
});

describe('displayedCalculation', () => {
  it('ends on the figure the cells show, the removal taking what separates it from the declaration: T1055, 2 held of 12 on half the estate', () => {
    const outcome = tested(2, 12, 24);
    const efficacy = efficacyOf(DECLARED, outcome);

    // 50% − 17% = 33%, 33% × 50% ≈ 16%, 50% − 16% = 34%: 33.5 % exact, written 34 %.
    expect(displayedCalculation({ tested: outcome, declared: DECLARED, efficacy })).toEqual({
      declared: 50,
      rate: 17,
      share: 50,
      gap: 33,
      removal: 16,
      removalRounded: true,
      efficacy: 34,
    });
    expect(shownPercentPoints(efficacy)).toBe(34);
  });

  it('writes the weighting as an equality where the written product is the removal: SEG on T1566, 68% − 9% = 59%', () => {
    const declared = 0.97 * 0.7;
    const outcome = tested(1, 2, 4);

    // 68% − 50% = 18%, 18% × 50% = 9%, 68% − 9% = 59%.
    expect(displayedCalculation({ tested: outcome, declared, efficacy: efficacyOf(declared, outcome) })).toEqual({
      declared: 68,
      rate: 50,
      share: 50,
      gap: 18,
      removal: 9,
      removalRounded: false,
      efficacy: 59,
    });
  });

  it('keeps the removal the cells separate when the written product rounds elsewhere', () => {
    const outcome = tested(0, 15, 20);
    const efficacy = efficacyOf(DECLARED, outcome);

    // 50% − 0% = 50%, 50% × 75% = 37.5%, written ≈ 38%, while 50% − 13% = 37%: the cell shows 13%.
    expect(displayedCalculation({ tested: outcome, declared: DECLARED, efficacy })).toEqual({
      declared: 50,
      rate: 0,
      share: 75,
      gap: 50,
      removal: 37,
      removalRounded: true,
      efficacy: 13,
    });
    expect(shownPercentPoints(efficacy)).toBe(13);
  });

  it('opens no gap where the rate is written as the declaration is: T1055.012, 1 held of 2 on 2 hosts of 20', () => {
    const outcome = tested(1, 2, 20);

    expect(displayedCalculation({ tested: outcome, declared: 0.503, efficacy: efficacyOf(0.503, outcome) }))
      .toEqual({ declared: 50, rate: 50, share: 10, gap: 0, removal: 0, removalRounded: false, efficacy: 50 });
  });

  it('writes plain equalities where nothing rounds', () => {
    const outcome = tested(1, 10, 20);

    expect(displayedCalculation({ tested: outcome, declared: 0.5, efficacy: efficacyOf(0.5, outcome) })).toEqual({
      declared: 50,
      rate: 10,
      share: 50,
      gap: 40,
      removal: 20,
      removalRounded: false,
      efficacy: 30,
    });
  });

  it('opens no gap where the tests do better, leaving the declaration', () => {
    const calculation = displayedCalculation({ tested: tested(10, 10, 20), declared: DECLARED, efficacy: DECLARED });

    expect(calculation).toMatchObject({ rate: 100, gap: 0, removal: 0, removalRounded: false, efficacy: 50 });
  });

  it('removes nothing without a result', () => {
    expect(displayedCalculation({ tested: null, declared: DECLARED, efficacy: DECLARED })).toEqual({
      declared: 50,
      rate: null,
      share: null,
      gap: 0,
      removal: 0,
      removalRounded: false,
      efficacy: 50,
    });
  });
});

describe('displayedDeclaration', () => {
  it('flags a product its shown figures only approximate', () => {
    const shown = displayedDeclaration({ strength: STRENGTH_BY_RUNG.L2, coverage: 0.7 }, DECLARED);

    expect(shown).toMatchObject({ coverage: 70, declared: 50, exact: false });
    expect(shown.strength).toBe(shownPercentPoints(STRENGTH_BY_RUNG.L2));
  });

  it('flags the anchored declaration its shown figures only approximate: SEG at delivery, 97% × 70% ≈ 68%', () => {
    expect(displayedDeclaration({ strength: 0.97, coverage: 0.7 }, 0.97 * 0.7)).toEqual({ strength: 97, coverage: 70, declared: 68, exact: false });
  });

  it('keeps an equality that holds as written', () => {
    expect(displayedDeclaration({ strength: 0.5, coverage: 0.4 }, 0.2)).toEqual({ strength: 50, coverage: 40, declared: 20, exact: true });
  });
});

describe('DECLARATION_CEILING', () => {
  it('is the top strength rung on full coverage, short of 100 %', () => {
    expect(DECLARATION_CEILING).toBe(STRENGTH_BY_RUNG.L3);
    expect(DECLARATION_CEILING).toBeLessThan(1);
  });
});

describe('tests', () => {
  it('counts the tests that let the technique through', () => {
    expect(failedTests(tested(1, 10, 20))).toBe(9);
  });

  it('tells every test from some of them', () => {
    expect(isEveryTest(10, tested(10, 10, 20))).toBe(true);
    expect(isEveryTest(9, tested(1, 10, 20))).toBe(false);
  });
});

describe('parentExternalIdOf', () => {
  it('reads a sub-technique\'s parent from its id, and none for a technique', () => {
    expect(parentExternalIdOf('T1055.012')).toBe('T1055');
    expect(parentExternalIdOf('T1055')).toBeNull();
  });
});

describe('evidenceLinkOf', () => {
  it('leads a tested reading to the evidence on the technique its result is stored under', () => {
    expect(evidenceLinkOf({ covered: true, tested: tested(1, 10, 20) }, 'T1055', true))
      .toEqual({ externalId: 'T1055' });
  });

  it('leads a sub-technique to its parent\'s evidence, which its result is', () => {
    expect(evidenceLinkOf({ covered: true, tested: tested(1, 10, 20) }, 'T1055.012', true))
      .toEqual({ externalId: 'T1055' });
  });

  it('leads nowhere without a result, or where the validation cannot be listed', () => {
    expect(evidenceLinkOf({ covered: true, tested: null }, 'T1055', true)).toBeNull();
    expect(evidenceLinkOf({ covered: true, tested: tested(1, 10, 20) }, 'T1055', false)).toBeNull();
  });

  it('leads a result the engine does not read to the evidence on its own technique', () => {
    expect(evidenceLinkOf({ covered: false, tested: tested(1, 10, 20) }, 'T1055', true)).toEqual({ externalId: 'T1055' });
    expect(evidenceLinkOf({ covered: false, tested: tested(1, 10, 20) }, 'T1055.012', true)).toEqual({ externalId: 'T1055.012' });
  });
});
