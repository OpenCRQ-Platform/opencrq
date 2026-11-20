import { t } from '@lingui/core/macro';

/**
 * The user-facing wording of the ten business resources, keyed by the row's `code`: the backend
 * never translates, and the English `name` and `description` it seeds are the fallback for a row
 * this catalogue does not know.
 *
 * Thunks, not strings: the active locale is only known at render time.
 */
const BUSINESS_RESOURCE_NAMES: Record<string, () => string> = {
  'operations-and-services': () => t`Operations and services`,
  'services-under-commitments': () => t`Services delivered to others under commitments`,
  'physical-assets-and-facilities': () => t`Physical assets and facilities`,
  'personal-data': () => t`Personal data`,
  'payment-card-data': () => t`Payment card data`,
  'proprietary-information': () => t`Proprietary information`,
  'data-entrusted-by-others': () => t`Data entrusted by others`,
  'own-funds-and-payment-authority': () => t`Own funds and payment authority`,
  'funds-and-assets-held-for-others': () => t`Funds and assets held for others`,
  'regulated-function-or-data': () => t`Regulated function or data`,
};

const BUSINESS_RESOURCE_PICKER_LINES: Record<string, () => string> = {
  'operations-and-services': () => t`The processes and services your organisation runs for itself: production, logistics, internal support, back office.`,
  'services-under-commitments': () => t`Services and products other organisations or customers rely on under contract, SLA or delivery commitment: SaaS, managed services, contracted deliveries, platforms clients run their business on.`,
  'physical-assets-and-facilities': () => t`Equipment, plants, buildings, OT and ICS, vehicles: anything an attack can physically destroy or render untrustworthy.`,
  'personal-data': () => t`Any data identifying people: customers, employees, patients, users, including special categories such as health or biometrics and non-card financial identifiers.`,
  'payment-card-data': () => t`Cardholder and payment data an attacker can use to carry out fraud: PANs, track and chip data, card verification values, payment credentials. Tick it alone, it covers the personal data it contains.`,
  'proprietary-information': () => t`Your own competitive information: trade secrets, R&D, source code, formulas, pricing, M&A plans, negotiation positions, models and their weights.`,
  'data-entrusted-by-others': () => t`Other organisations' confidential data you hold under contract or NDA: B2B customer data, professional-services files, partner designs, government-client data, licensed corpora.`,
  'own-funds-and-payment-authority': () => t`Your organisation's money and the authority to move it: bank balances, treasury, payment runs, payroll, the mandates and approvals that release funds, crypto assets.`,
  'funds-and-assets-held-for-others': () => t`Money and assets you hold or move for clients: client accounts, escrow, portfolios under management, securities in custody, payment float.`,
  'regulated-function-or-data': () => t`A function or a data set a regulator with fining power supervises: essential or important entities under NIS2, DORA, CER, telecom, energy or health regulators, export-controlled or defence technical data. Tick it together with the resource it regulates.`,
};

export interface BusinessResourceRow {
  code: string,
  name: string,
  description?: string | null,
}

export const businessResourceName = (resource: BusinessResourceRow): string =>
  BUSINESS_RESOURCE_NAMES[resource.code]?.() ?? resource.name;

export const businessResourcePickerLine = (resource: BusinessResourceRow): string =>
  BUSINESS_RESOURCE_PICKER_LINES[resource.code]?.() ?? resource.description ?? '';
