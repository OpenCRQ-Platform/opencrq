import {
  BusinessValueCategory_DataEntrustedByOthers,
  BusinessValueCategory_FundsAndAssetsHeldForOthers,
  BusinessValueCategory_OperationsAndServices,
  BusinessValueCategory_OwnFundsAndPaymentAuthority,
  BusinessValueCategory_PaymentCardData,
  BusinessValueCategory_PersonalData,
  BusinessValueCategory_PhysicalAssetsAndFacilities,
  BusinessValueCategory_ProprietaryInformation,
  BusinessValueCategory_RegulatedFunctionOrData,
  BusinessValueCategory_ServicesUnderCommitments,
} from './business-value-categories-ids';

/**
 * The business resource catalog, the single source reseeded into every tenant on boot.
 *
 * `code` is the identity the frontend translates on, and `name` and `description` are the English
 * fallback: nothing anywhere resolves a row by them. The ids live in
 * `business-value-categories-ids.ts` and must never be regenerated.
 */

export interface BusinessValueCategoryReference {
  id: string,
  code: string,
  name: string,
  description: string,
  displayOrder: number,
}

/**
 * The ten business resources, a flat list in which every entry is self-contained: it carries every
 * loss line its loss opens, and none implies, contains or depends on another. Two things of value
 * are the same entry if and only if their loss opens the same lines, so only a difference in which
 * lines open justifies splitting one, never a difference in magnitude.
 */
export const BUSINESS_VALUE_CATEGORIES: ReadonlyArray<BusinessValueCategoryReference> = [
  {
    id: BusinessValueCategory_OperationsAndServices,
    code: 'operations-and-services',
    name: 'Operations and services',
    description: 'The processes and services your organisation runs for itself: production, logistics, internal support, back office.',
    displayOrder: 1,
  },
  {
    id: BusinessValueCategory_ServicesUnderCommitments,
    code: 'services-under-commitments',
    name: 'Services delivered to others under commitments',
    description: 'Services and products other organisations or customers rely on under contract, SLA or delivery commitment: SaaS, managed services, contracted deliveries, platforms clients run their business on.',
    displayOrder: 2,
  },
  {
    id: BusinessValueCategory_PhysicalAssetsAndFacilities,
    code: 'physical-assets-and-facilities',
    name: 'Physical assets and facilities',
    description: 'Equipment, plants, buildings, OT and ICS, vehicles: anything an attack can physically destroy or render untrustworthy.',
    displayOrder: 3,
  },
  {
    id: BusinessValueCategory_PersonalData,
    code: 'personal-data',
    name: 'Personal data',
    description: 'Any data identifying people: customers, employees, patients, users, including special categories such as health or biometrics and non-card financial identifiers.',
    displayOrder: 4,
  },
  {
    id: BusinessValueCategory_PaymentCardData,
    code: 'payment-card-data',
    name: 'Payment card data',
    description: 'Cardholder and payment data an attacker can use to carry out fraud: PANs, track and chip data, card verification values, payment credentials. Tick it alone, it covers the personal data it contains.',
    displayOrder: 5,
  },
  {
    id: BusinessValueCategory_ProprietaryInformation,
    code: 'proprietary-information',
    name: 'Proprietary information',
    description: 'Your own competitive information: trade secrets, R&D, source code, formulas, pricing, M&A plans, negotiation positions, models and their weights.',
    displayOrder: 6,
  },
  {
    id: BusinessValueCategory_DataEntrustedByOthers,
    code: 'data-entrusted-by-others',
    name: 'Data entrusted by others',
    description: "Other organisations' confidential data you hold under contract or NDA: B2B customer data, professional-services files, partner designs, government-client data, licensed corpora.",
    displayOrder: 7,
  },
  {
    id: BusinessValueCategory_OwnFundsAndPaymentAuthority,
    code: 'own-funds-and-payment-authority',
    name: 'Own funds and payment authority',
    description: "Your organisation's money and the authority to move it: bank balances, treasury, payment runs, payroll, the mandates and approvals that release funds, crypto assets.",
    displayOrder: 8,
  },
  {
    id: BusinessValueCategory_FundsAndAssetsHeldForOthers,
    code: 'funds-and-assets-held-for-others',
    name: 'Funds and assets held for others',
    description: 'Money and assets you hold or move for clients: client accounts, escrow, portfolios under management, securities in custody, payment float.',
    displayOrder: 9,
  },
  {
    id: BusinessValueCategory_RegulatedFunctionOrData,
    code: 'regulated-function-or-data',
    name: 'Regulated function or data',
    description: 'A function or a data set a regulator with fining power supervises: essential or important entities under NIS2, DORA, CER, telecom, energy or health regulators, export-controlled or defence technical data. Tick it together with the resource it regulates.',
    displayOrder: 10,
  },
];
