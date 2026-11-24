import {
  LossDriver_ContractualPenalties,
  LossDriver_NotificationCallHandling,
  LossDriver_RegulatoryFines,
} from '../../modules/loss-drivers/data';
import { requirementLossDriverActivations, requirements, requirementTargets } from '../../modules/requirements/schema';
import { deriveSeedId } from '../../seed-ids';
import {
  Organization_AcmeCorp,
  Organization_AcmeEurope,
  Organization_Tarnwick,
  PrimaryAsset_CustomerAccountData,
  PrimaryAsset_EuCustomerData,
  PrimaryAsset_ProductionPlanning,
  Requirement_AcmeEuropeGdprCustomerData,
  Requirement_AcmeGdprCustomerData,
  Requirement_TarnwickDelivery48h,
  RequirementTarget_AcmeEuropeGdprCustomerData,
  RequirementTarget_AcmeGdprCustomerAccounts,
  RequirementTarget_TarnwickDeliveryPlanning,
  Tenant_Acme,
  Tenant_Tarnwick,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

/**
 * The delivery commitment is broken by Tarnwick's destructive attack and the Acme Bank GDPR
 * obligation by the core banking data breach. The Acme Europe one is left unbroken on purpose: the
 * only scenario on its target is a service disruption, which reaches neither criterion it protects.
 * Nothing priced reads a requirement, so no seeded estimate or run moves with them.
 */
registerPlatformSeed('requirements', async ({ db }) => {
  const gdpr = {
    description: 'Personal data of customers is processed under the GDPR: a breach of its confidentiality or integrity is notifiable and exposes the bank to fines.',
    interestedParty: 'Data subjects and the supervisory authority',
    protectsConfidentiality: true,
    protectsIntegrity: true,
    protectsAvailability: false,
  };

  await db.insert(requirements).values([
    {
      id: Requirement_TarnwickDelivery48h,
      tenantId: Tenant_Tarnwick,
      organizationId: Organization_Tarnwick,
      name: '48-hour delivery',
      description: 'Framework agreements promise delivery within 48 hours of order, with penalties per day late.',
      interestedParty: 'B2B customers',
      protectsConfidentiality: false,
      protectsIntegrity: false,
      protectsAvailability: true,
    },
    { id: Requirement_AcmeGdprCustomerData, tenantId: Tenant_Acme, organizationId: Organization_AcmeCorp, name: 'GDPR on customer data', ...gdpr },
    { id: Requirement_AcmeEuropeGdprCustomerData, tenantId: Tenant_Acme, organizationId: Organization_AcmeEurope, name: 'GDPR on European customer data', ...gdpr },
  ]);

  await db.insert(requirementTargets).values([
    { id: RequirementTarget_TarnwickDeliveryPlanning, tenantId: Tenant_Tarnwick, requirementId: Requirement_TarnwickDelivery48h, primaryAssetId: PrimaryAsset_ProductionPlanning },
    { id: RequirementTarget_AcmeGdprCustomerAccounts, tenantId: Tenant_Acme, requirementId: Requirement_AcmeGdprCustomerData, primaryAssetId: PrimaryAsset_CustomerAccountData },
    { id: RequirementTarget_AcmeEuropeGdprCustomerData, tenantId: Tenant_Acme, requirementId: Requirement_AcmeEuropeGdprCustomerData, primaryAssetId: PrimaryAsset_EuCustomerData },
  ]);

  const acmeGdprDrivers = [LossDriver_RegulatoryFines, LossDriver_NotificationCallHandling].map((catalogId) => deriveSeedId(Tenant_Acme, catalogId));
  await db.insert(requirementLossDriverActivations).values([
    { tenantId: Tenant_Tarnwick, requirementId: Requirement_TarnwickDelivery48h, lossDriverId: deriveSeedId(Tenant_Tarnwick, LossDriver_ContractualPenalties) },
    ...acmeGdprDrivers.map((lossDriverId) => ({ tenantId: Tenant_Acme, requirementId: Requirement_AcmeGdprCustomerData, lossDriverId })),
    ...acmeGdprDrivers.map((lossDriverId) => ({ tenantId: Tenant_Acme, requirementId: Requirement_AcmeEuropeGdprCustomerData, lossDriverId })),
  ]);
});
