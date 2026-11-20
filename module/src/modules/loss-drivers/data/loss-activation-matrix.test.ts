import { describe, expect, it } from 'vitest';
import * as outcomeIds from '../../attack-outcomes/data/attack-outcomes-ids';
import { ATTACK_OUTCOMES } from '../../attack-outcomes/data';
import { BUSINESS_VALUE_CATEGORIES } from '../../business-value-categories/data';
import { LOSS_ACTIVATION_MATRIX } from './loss-activation-matrix';
import * as lossIds from './loss-drivers-ids';
import { LOSS_DRIVERS } from './loss-drivers-data';

/*
 * Business resources carry a `code` the assertions can read straight from the catalogue; outcomes
 * carry none, so theirs is the one short-label map this file has to hold by hand.
 */
const OUTCOME_CODE_BY_ID: Record<string, string> = {
  [outcomeIds.AttackOutcome_Ransomware]: 'RW',
  [outcomeIds.AttackOutcome_DataTheftExtortion]: 'DTE',
  [outcomeIds.AttackOutcome_DataBreachResale]: 'DBR',
  [outcomeIds.AttackOutcome_FinancialFraudFundsTheft]: 'FFT',
  [outcomeIds.AttackOutcome_Espionage]: 'SEG',
  [outcomeIds.AttackOutcome_ServiceDisruption]: 'SD',
  [outcomeIds.AttackOutcome_DestructiveAttack]: 'DA',
};

const CATEGORY_CODE_BY_ID: Record<string, string> = Object.fromEntries(
  BUSINESS_VALUE_CATEGORIES.map((category) => [category.id, category.code]),
);

const REGULATED = 'regulated-function-or-data';

const DRIVER_CODE_BY_ID: Record<string, string> = {
  [lossIds.LossDriver_ForensicsIncidentManagement]: 'D1.1',
  [lossIds.LossDriver_IncidentLegalCounsel]: 'D1.2',
  [lossIds.LossDriver_CrisisCommunications]: 'D1.3',
  [lossIds.LossDriver_InternalResponseSurgeLabor]: 'D1.4',
  [lossIds.LossDriver_SystemDataRestoration]: 'D2.1',
  [lossIds.LossDriver_HardwareReplacement]: 'D2.2',
  [lossIds.LossDriver_LostMarginFromDowntime]: 'D3.1',
  [lossIds.LossDriver_IncrementalOperatingCost]: 'D3.2',
  [lossIds.LossDriver_ExtortionPayment]: 'D4.1',
  [lossIds.LossDriver_StolenFundsNetOfRecovery]: 'D5.1',
  [lossIds.LossDriver_NotificationCallHandling]: 'D6.1',
  [lossIds.LossDriver_IdentityCreditProtection]: 'D6.2',
  [lossIds.LossDriver_LitigationDefense]: 'D7.1',
  [lossIds.LossDriver_SettlementsDamages]: 'D7.2',
  [lossIds.LossDriver_RegulatoryFines]: 'D7.3',
  [lossIds.LossDriver_PaymentCardAssessments]: 'D7.4',
  [lossIds.LossDriver_ContractualPenalties]: 'D7.5',
  [lossIds.LossDriver_CustomerAttritionWinBack]: 'D8.1',
  [lossIds.LossDriver_CompetitiveAdvantageErosion]: 'D8.2',
};

const CELL_COUNT = 35;
const ACTIVATION_COUNT = 255;

const cellCode = (cell: { attackOutcomeId: string, businessValueCategoryId: string }) =>
  `${OUTCOME_CODE_BY_ID[cell.attackOutcomeId]} × ${CATEGORY_CODE_BY_ID[cell.businessValueCategoryId]}`;

/** The cell codes a driver appears in, sorted, so a set comparison reads as the specification. */
const cellsOf = (driverCode: string) => LOSS_ACTIVATION_MATRIX
  .filter((cell) => cell.lossDriverIds.some((id) => DRIVER_CODE_BY_ID[id] === driverCode))
  .map(cellCode)
  .toSorted();

const countOf = (driverCode: string) => cellsOf(driverCode).length;

describe('LOSS_ACTIVATION_MATRIX structure', () => {
  it('names every entry through a catalog constant, never an unknown identifier', () => {
    const outcomeIdSet = new Set(ATTACK_OUTCOMES.map((entry) => entry.id));
    const categoryIdSet = new Set(BUSINESS_VALUE_CATEGORIES.map((entry) => entry.id));
    const driverIdSet = new Set(LOSS_DRIVERS.map((entry) => entry.id));

    for (const cell of LOSS_ACTIVATION_MATRIX) {
      expect(outcomeIdSet.has(cell.attackOutcomeId)).toBe(true);
      expect(categoryIdSet.has(cell.businessValueCategoryId)).toBe(true);
      for (const driverId of cell.lossDriverIds) {
        expect(driverIdSet.has(driverId)).toBe(true);
      }
    }
  });

  it('repeats no driver inside a cell and no cell inside the matrix', () => {
    for (const cell of LOSS_ACTIVATION_MATRIX) {
      expect(new Set(cell.lossDriverIds).size).toBe(cell.lossDriverIds.length);
    }
    const pairs = LOSS_ACTIVATION_MATRIX.map(cellCode);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  // Pinned so that adding a contingency tag, a probability or a version field to a cell fails here
  // rather than passing review unnoticed.
  it('exposes exactly the expected keys on every cell', () => {
    for (const cell of LOSS_ACTIVATION_MATRIX) {
      expect(Object.keys(cell).toSorted()).toEqual([
        'attackOutcomeId',
        'businessValueCategoryId',
        'lossDriverIds',
      ]);
    }
  });
});

describe('LOSS_ACTIVATION_MATRIX invariants', () => {
  it('S1: holds 35 compatible cells over 255 activations', () => {
    expect(LOSS_ACTIVATION_MATRIX).toHaveLength(CELL_COUNT);
    expect(LOSS_ACTIVATION_MATRIX.reduce((total, cell) => total + cell.lossDriverIds.length, 0))
      .toBe(ACTIVATION_COUNT);
  });

  it('S2: activates each of the nineteen drivers on its pinned number of cells', () => {
    expect(countOf('D1.1')).toBe(28);
    expect(countOf('D1.2')).toBe(28);
    expect(countOf('D1.3')).toBe(25);
    expect(countOf('D1.4')).toBe(28);
    expect(countOf('D2.1')).toBe(14);
    expect(countOf('D2.2')).toBe(2);
    expect(countOf('D3.1')).toBe(9);
    expect(countOf('D3.2')).toBe(9);
    expect(countOf('D4.1')).toBe(10);
    expect(countOf('D5.1')).toBe(2);
    expect(countOf('D6.1')).toBe(9);
    expect(countOf('D6.2')).toBe(7);
    expect(countOf('D7.1')).toBe(15);
    expect(countOf('D7.2')).toBe(15);
    expect(countOf('D7.3')).toBe(17);
    expect(countOf('D7.4')).toBe(3);
    expect(countOf('D7.5')).toBe(10);
    expect(countOf('D8.1')).toBe(21);
    expect(countOf('D8.2')).toBe(3);

    // Every driver of the catalog is reachable: a driver on zero cells could never be recommended.
    for (const driver of LOSS_DRIVERS) {
      expect(countOf(DRIVER_CODE_BY_ID[driver.id])).toBeGreaterThan(0);
    }
  });

  it('S3: spreads the cells 7/5/5/3/4/5/6 by outcome and 3/3/3/6/3/3/5/1/1/7 by resource', () => {
    const cellsPerOutcome = (code: string) =>
      LOSS_ACTIVATION_MATRIX.filter((cell) => OUTCOME_CODE_BY_ID[cell.attackOutcomeId] === code).length;
    const cellsPerCategory = (code: string) =>
      LOSS_ACTIVATION_MATRIX.filter((cell) => CATEGORY_CODE_BY_ID[cell.businessValueCategoryId] === code).length;

    expect(['RW', 'DTE', 'DBR', 'FFT', 'SEG', 'SD', 'DA'].map(cellsPerOutcome)).toEqual([7, 5, 5, 3, 4, 5, 6]);
    expect(BUSINESS_VALUE_CATEGORIES.map((category) => cellsPerCategory(category.code)))
      .toEqual([3, 3, 3, 6, 3, 3, 5, 1, 1, 7]);
  });

  it('S4: places the response, extortion, theft, card, hardware and fine drivers exactly where the model allows', () => {
    const allCells = LOSS_ACTIVATION_MATRIX.map(cellCode).toSorted();
    // The regulated resource adds a fine to whatever else the scenario ticks and prices nothing on
    // its own, so every assertion about a priced line reads against the other cells.
    const regulatedCells = allCells.filter((code) => code.endsWith(` ${REGULATED}`));
    const pricedCells = allCells.filter((code) => !code.endsWith(` ${REGULATED}`));

    // Incident response is unconditional: no priced pairing avoids it.
    expect(cellsOf('D1.1')).toEqual(pricedCells);
    expect(cellsOf('D1.2')).toEqual(pricedCells);
    expect(cellsOf('D1.4')).toEqual(pricedCells);

    // A regulator's fine is the whole of the regulated column, one cell per outcome.
    expect(regulatedCells).toHaveLength(ATTACK_OUTCOMES.length);
    for (const cell of LOSS_ACTIVATION_MATRIX.filter((entry) => CATEGORY_CODE_BY_ID[entry.businessValueCategoryId] === REGULATED)) {
      expect(cell.lossDriverIds.map((id) => DRIVER_CODE_BY_ID[id])).toEqual(['D7.3']);
    }

    // A ransom is only demanded where the attacker has leverage to sell back.
    expect(cellsOf('D4.1')).toEqual(
      pricedCells.filter((code) => code.startsWith('RW ') || code.startsWith('DTE ')),
    );
    // Funds only move on the two custody resources.
    expect(cellsOf('D5.1')).toEqual([
      'FFT × funds-and-assets-held-for-others',
      'FFT × own-funds-and-payment-authority',
    ]);
    // Card-brand assessments require card data, whatever the outcome.
    expect(cellsOf('D7.4')).toEqual(allCells.filter((code) => code.endsWith(' payment-card-data')));
    // Only a destructive attack replaces equipment, and only where the old industrial column landed.
    expect(cellsOf('D2.2')).toEqual([
      'DA × physical-assets-and-facilities',
      'DA × services-under-commitments',
    ]);
  });

  it('S5: keeps the paired drivers in their subset or equality relation', () => {
    const isStrictSubset = (inner: Array<string>, outer: Array<string>) =>
      inner.length < outer.length && inner.every((code) => outer.includes(code));

    // Identity protection is offered on a subset of the notifications that trigger it.
    expect(isStrictSubset(cellsOf('D6.2'), cellsOf('D6.1'))).toBe(true);
    // Equipment is replaced only where systems are already being rebuilt.
    expect(isStrictSubset(cellsOf('D2.2'), cellsOf('D2.1'))).toBe(true);
    // Defending a claim and settling it always travel together.
    expect(cellsOf('D7.2')).toEqual(cellsOf('D7.1'));
    // So do lost margin and the extra cost of running degraded.
    expect(cellsOf('D3.2')).toEqual(cellsOf('D3.1'));
  });
});
