/**
 * Identifiers of the seven attack outcomes, declared once so seeders and tests can designate an
 * entry without copying a UUID literal.
 *
 * IDENTITY WARNING, read before editing any UUID below.
 * Each one was minted once and is written here permanently; a tenant row is derived from the pair
 * (tenant, that UUID). **Regenerating one is indistinguishable from deleting an entry and adding a
 * different one**: the reseed prunes the old row and every amount saved against it disappears with
 * it. Never regenerate an id, never move one onto another entry.
 */

export const AttackOutcome_DataBreachResale = '9fc07642-7648-4178-a469-951c7f6bba9e';
export const AttackOutcome_DataTheftExtortion = 'd98a602a-cdd7-40ab-85bd-44fd8c834021';
export const AttackOutcome_DestructiveAttack = 'e87138d3-a68b-4428-85df-b7387b308ecf';
export const AttackOutcome_Espionage = '4756f512-edab-4393-98ee-c442619e3c99';
export const AttackOutcome_FinancialFraudFundsTheft = 'f00427ea-1d38-4918-a7ff-03fee32f6374';
export const AttackOutcome_Ransomware = 'a22b9a0c-4c77-45c1-a1b6-f8ec5531bc27';
export const AttackOutcome_ServiceDisruption = 'b56965c3-5a76-4215-83af-cfcd69e33686';
