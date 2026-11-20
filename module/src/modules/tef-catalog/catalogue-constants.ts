import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from '../attack-outcomes/data/attack-outcomes-ids';

/** The package format this platform reads; any other `schema` is refused. */
export const TEF_CATALOGUE_SCHEMA = 'opencrq-tef-catalogue/1';

/** A package row's value for any country, sector or size class. */
export const TEF_ANY = '*';

/** The size classes of a catalogue, by number of employees. */
export const TEF_SIZE_CLASSES = ['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+'] as const;
export type TefSizeClass = typeof TEF_SIZE_CLASSES[number];

/** The smallest headcount of each size class; a declared count of 0 reads the first class. */
export const TEF_SIZE_CLASS_FLOOR: Readonly<Record<TefSizeClass, number>> = {
  '0-9': 0,
  '10-49': 10,
  '50-249': 50,
  '250-999': 250,
  '1000-4999': 1000,
  '5000+': 5000,
};

export const sizeClassOfEmployees = (employees: number): TefSizeClass =>
  TEF_SIZE_CLASSES.findLast((sizeClass) => employees >= TEF_SIZE_CLASS_FLOOR[sizeClass]) ?? '0-9';

/** Where a read's size came from: the risk scope's employee count, else its revenue band, else nothing. */
export const TEF_SIZE_SOURCES = ['employee_count', 'revenue_band', 'none'] as const;
export type TefSizeSource = typeof TEF_SIZE_SOURCES[number];

export interface TefCatalogueSizeShare {
  readonly sizeClass: TefSizeClass,
  readonly weight: number,
}

/**
 * The classes a read with no size mixes, every one weighing the same. The package's every-size row is
 * the enterprise-weighted average instead, which micro enterprises dominate.
 */
export const TEF_EVERY_SIZE: ReadonlyArray<TefCatalogueSizeShare> = TEF_SIZE_CLASSES.map((sizeClass) => ({ sizeClass, weight: 1 / TEF_SIZE_CLASSES.length }));

/** The dimensions a row may not measure for itself, its range then being wider. */
export const TEF_NOT_MEASURED = ['country', 'sector', 'size'] as const;
export type TefNotMeasured = typeof TEF_NOT_MEASURED[number];

/** The package's outcome keys to the platform's catalogue attack outcomes. */
export const TEF_OUTCOME_BY_KEY: Readonly<Record<string, string>> = {
  ransomware: AttackOutcome_Ransomware,
  data_theft_extortion: AttackOutcome_DataTheftExtortion,
  data_breach_resale: AttackOutcome_DataBreachResale,
  financial_fraud: AttackOutcome_FinancialFraudFundsTheft,
  espionage: AttackOutcome_Espionage,
  service_disruption: AttackOutcome_ServiceDisruption,
  destructive_attack: AttackOutcome_DestructiveAttack,
};
