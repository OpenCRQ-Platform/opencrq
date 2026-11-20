/**
 * Identifiers of the eight loss categories and the nineteen loss drivers, declared once so the
 * driver catalog, the seeders and the tests can designate an entry without copying a UUID literal.
 *
 * IDENTITY WARNING, read before editing any UUID below.
 * Each one was minted once and is written here permanently; a tenant row is derived from the pair
 * (tenant, that UUID). **Regenerating one is indistinguishable from deleting an entry and adding a
 * different one**: the reseed prunes the old row and every amount saved against it disappears with
 * it. Never regenerate an id, never move one onto another entry.
 */

export const LossCategory_AffectedPartyNotification = '79d8c052-37a9-486f-ad93-dbae27fefd58';
export const LossCategory_BusinessInterruption = '12251f3e-ea7c-4cb4-b7f8-1dc106e24b67';
export const LossCategory_DirectFinancialTheft = 'f9d1bf4a-8e53-4a03-bc6c-bd33f1b46f77';
export const LossCategory_Extortion = '199a10c9-ea6e-4568-91f8-c0074a4a0073';
export const LossCategory_FutureRevenueLoss = '7cd2783f-b4b5-4719-b2c0-4b7276ca0d73';
export const LossCategory_LegalRegulatoryContractual = 'bdee3716-56d5-425f-9f62-d4c10aa659f3';
export const LossCategory_ResponseInvestigation = '52ef172a-3a0e-4ac5-a8b3-f73dd66915c4';
export const LossCategory_RestorationRebuild = '1a30196d-cf85-4ffa-8bee-3036e195c9b3';

/** The closed set of loss-category ids a driver may be attached to. */
export type LossCategoryId =
  | typeof LossCategory_AffectedPartyNotification
  | typeof LossCategory_BusinessInterruption
  | typeof LossCategory_DirectFinancialTheft
  | typeof LossCategory_Extortion
  | typeof LossCategory_FutureRevenueLoss
  | typeof LossCategory_LegalRegulatoryContractual
  | typeof LossCategory_ResponseInvestigation
  | typeof LossCategory_RestorationRebuild;

export const LossDriver_CompetitiveAdvantageErosion = '540d7435-0b3b-49c7-90bb-d3ca5bbfd357';
export const LossDriver_ContractualPenalties = 'aa2dbc8c-e507-473b-b5e8-c16d14afa561';
export const LossDriver_CrisisCommunications = '51539040-ff7a-430e-90a7-99007e67a16b';
export const LossDriver_CustomerAttritionWinBack = '9c5d6fe6-8c6e-466a-971c-e3104072a900';
export const LossDriver_ExtortionPayment = 'b107453a-ac09-45ea-acd0-e7e1537182ec';
export const LossDriver_ForensicsIncidentManagement = 'daefedbd-15a9-4bf8-bcaf-14b92d25e2bd';
export const LossDriver_HardwareReplacement = '46544e6b-ffd1-4459-8bd2-18d9d00c9149';
export const LossDriver_IdentityCreditProtection = '8455e652-65af-4a2f-bbdc-62d55794ccd2';
export const LossDriver_IncidentLegalCounsel = 'f0eea3dd-d091-4928-89b1-4f48fa1c9b3b';
export const LossDriver_IncrementalOperatingCost = 'da735a05-ea99-4997-b10a-3da054389b61';
export const LossDriver_InternalResponseSurgeLabor = '156f8fb6-f0ac-4c15-a858-3d9f7e2d8945';
export const LossDriver_LitigationDefense = '68384439-54b2-479f-aecd-de85ac9d088e';
export const LossDriver_LostMarginFromDowntime = 'f17f91a3-8883-4e37-8bbe-12728736083a';
export const LossDriver_NotificationCallHandling = '20e5556a-27b3-4858-bcf3-1954164ecbcc';
export const LossDriver_PaymentCardAssessments = 'bf2ac013-1a4d-4d6f-a3b5-f76794636898';
export const LossDriver_RegulatoryFines = 'c629f017-cebd-46e3-8d94-6246824fb829';
export const LossDriver_SettlementsDamages = '1f469e55-5de0-4fbc-ae03-a040bb5f0077';
export const LossDriver_StolenFundsNetOfRecovery = '177c8ea7-0644-49dd-87cf-cf57a511e746';
export const LossDriver_SystemDataRestoration = 'd77f5cd9-317d-408d-b5b2-5c74478763cf';
