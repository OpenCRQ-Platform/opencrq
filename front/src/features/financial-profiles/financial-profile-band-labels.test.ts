import {
  CARD_TRANSACTIONS_BAND_VALUES,
  CONTRACTED_REVENUE_BAND_VALUES,
  CONTRACTUAL_LIABILITY_CAP_BAND_VALUES,
  COSTLIEST_INCIDENT_BAND_VALUES,
  CUSTOMER_COUNT_BAND_VALUES,
  FULL_RESTORE_BAND_VALUES,
  INDIVIDUALS_BAND_VALUES,
  LARGEST_REPOSITORY_BAND_VALUES,
  OPERATING_DAYS_BAND_VALUES,
  PAYMENT_FLOW_BAND_VALUES,
  RD_IP_VALUE_BAND_VALUES,
  REGULATORY_REGIME_VALUES,
  RESTORE_TEST_RECENCY_VALUES,
  REVENUE_RECAPTURE_BAND_VALUES,
  SENSITIVE_RECORDS_BAND_VALUES,
  TIME_TO_REVENUE_IMPACT_BAND_VALUES,
  WORST_OUTAGE_BAND_VALUES,
} from '@app/module/client';
import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cardTransactionsBandOptions,
  contractedRevenueBandOptions,
  contractualLiabilityCapBandOptions,
  costliestIncidentBandOptions,
  customerCountBandOptions,
  fullRestoreBandOptions,
  individualsBandOptions,
  largestRepositoryBandOptions,
  operatingDaysBandOptions,
  paymentFlowBandOptions,
  rdIpValueBandOptions,
  regulatoryRegimeOptions,
  restoreTestRecencyOptions,
  revenueRecaptureBandOptions,
  sensitiveRecordsBandOptions,
  timeToRevenueImpactBandOptions,
  worstOutageBandOptions,
} from './financial-profile-band-labels';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

/**
 * Each builder against the tuple it labels, in order. Writing the value beside its label already
 * makes a mislabelled band a type error; this catches the other half — a band added to a tuple and
 * never given an option, which leaves the questionnaire unable to record an answer the schema
 * accepts, and one removed but still offered.
 */
const BUILDERS: ReadonlyArray<[string, () => ReadonlyArray<{ value: string, label: string }>, ReadonlyArray<string>]> = [
  ['operatingDaysBandOptions', operatingDaysBandOptions, OPERATING_DAYS_BAND_VALUES],
  ['timeToRevenueImpactBandOptions', timeToRevenueImpactBandOptions, TIME_TO_REVENUE_IMPACT_BAND_VALUES],
  ['fullRestoreBandOptions', fullRestoreBandOptions, FULL_RESTORE_BAND_VALUES],
  ['revenueRecaptureBandOptions', revenueRecaptureBandOptions, REVENUE_RECAPTURE_BAND_VALUES],
  ['restoreTestRecencyOptions', restoreTestRecencyOptions, RESTORE_TEST_RECENCY_VALUES],
  ['individualsBandOptions', individualsBandOptions, INDIVIDUALS_BAND_VALUES],
  ['cardTransactionsBandOptions', cardTransactionsBandOptions, CARD_TRANSACTIONS_BAND_VALUES],
  ['sensitiveRecordsBandOptions', sensitiveRecordsBandOptions, SENSITIVE_RECORDS_BAND_VALUES],
  ['largestRepositoryBandOptions', largestRepositoryBandOptions, LARGEST_REPOSITORY_BAND_VALUES],
  ['regulatoryRegimeOptions', regulatoryRegimeOptions, REGULATORY_REGIME_VALUES],
  ['customerCountBandOptions', customerCountBandOptions, CUSTOMER_COUNT_BAND_VALUES],
  ['contractedRevenueBandOptions', contractedRevenueBandOptions, CONTRACTED_REVENUE_BAND_VALUES],
  ['contractualLiabilityCapBandOptions', contractualLiabilityCapBandOptions, CONTRACTUAL_LIABILITY_CAP_BAND_VALUES],
  ['paymentFlowBandOptions', paymentFlowBandOptions, PAYMENT_FLOW_BAND_VALUES],
  ['rdIpValueBandOptions', rdIpValueBandOptions, RD_IP_VALUE_BAND_VALUES],
  ['worstOutageBandOptions', worstOutageBandOptions, WORST_OUTAGE_BAND_VALUES],
  ['costliestIncidentBandOptions', costliestIncidentBandOptions, COSTLIEST_INCIDENT_BAND_VALUES],
];

describe('band label builders', () => {
  it.each(BUILDERS)('%s offers exactly its band tuple, in order', (_name, build, values) => {
    expect(build().map(({ value }) => value)).toEqual([...values]);
  });

  it.each(BUILDERS)('%s gives every band a non-empty label', (_name, build) => {
    for (const { value, label } of build()) {
      expect(label, value).toBeTruthy();
    }
  });
});
