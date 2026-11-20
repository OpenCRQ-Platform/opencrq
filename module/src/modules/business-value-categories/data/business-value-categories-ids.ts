/**
 * Identifiers of the ten business resources, declared once so seeders and tests can designate an
 * entry without copying a UUID literal.
 *
 * IDENTITY WARNING, read before editing any UUID below.
 * Each one was minted once and is written here permanently; a tenant row is derived from the pair
 * (tenant, that UUID). **Regenerating one is indistinguishable from deleting an entry and adding a
 * different one**: the reseed prunes the old row and every amount saved against it disappears with
 * it. Never regenerate an id, never move one onto another entry.
 */

export const BusinessValueCategory_DataEntrustedByOthers = '520e9b3d-bcc6-44ad-98f1-ae9a2766edd4';
export const BusinessValueCategory_FundsAndAssetsHeldForOthers = '70fe8059-c443-4ead-99d6-16bc51ee55f7';
export const BusinessValueCategory_OperationsAndServices = '490a7802-6b15-404d-8e7e-570aeb574fd7';
export const BusinessValueCategory_OwnFundsAndPaymentAuthority = 'fa53f2e6-80d6-423a-998f-443ac8113c40';
export const BusinessValueCategory_PaymentCardData = 'ea007521-34aa-4422-ad95-f9372d69ff59';
export const BusinessValueCategory_PersonalData = '3e9bf712-cdb6-49fa-8c6e-bde349f5bff0';
export const BusinessValueCategory_PhysicalAssetsAndFacilities = '9edddde6-084e-4551-9495-40eab09eddba';
export const BusinessValueCategory_ProprietaryInformation = '424598b4-73d2-48d6-87d1-3e76aafc0df7';
export const BusinessValueCategory_RegulatedFunctionOrData = '3b91333c-5471-44a4-a7f7-e8e675d29eab';
export const BusinessValueCategory_ServicesUnderCommitments = 'b86cf783-2b4f-46d8-acf6-475953e7be0b';
