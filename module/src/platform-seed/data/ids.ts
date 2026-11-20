// Stable UUIDs for all platform-seeded entities.
// These are hardcoded so the seed is deterministic and idempotent.

// --- Users ---
export const User_Admin = 'f4ad0db5-4c66-4e5f-8817-7f4dc3b67162';
export const User_Alice = '2458d396-3e4e-45b6-aea6-ff92b1b54154';
export const User_Bob = '612b238d-69ee-4c95-bf0a-f2b012d587e5';
export const User_Charlie = '6e5cbd56-9923-4f7e-a972-d48be649ca3d';
export const User_Eve = 'df0342f2-f474-4381-a0d4-989982c7a608';

// --- Tenants ---
// Acme Bank must sort first among the administrator's tenants: in Community Edition a user reaches only their first tenant by sorted id.
export const Tenant_Acme = '89c70e9a-8317-4da7-8765-1b9ba004c32c';
export const Tenant_Tarnwick = 'bbbe7688-581e-4f4d-af65-19085e0c7916';
export const Tenant_FreshStart = 'c3e1f5a7-2d84-4b96-9f1c-6a0e8d2b4f57';

// --- Roles (tenant-scoped, custom) ---
export const Role_SecurityAnalyst = '66e67e36-34b1-42d8-9738-d4104c40d367';
export const Role_Viewer = 'e609766c-605d-4a13-98c1-118fbf25ba13';

// --- Groups (tenant-scoped, custom) ---
export const Group_SecurityTeam = '111ebad0-1350-46da-8de6-133710828566';
export const Group_Viewers = '2cb5ab13-b525-4594-9c90-79c50fbaa032';

// --- Organizations ---
export const Organization_AcmeCorp = '90b57256-32e4-4369-b768-fa6f2bb64fee';
export const Organization_AcmeEurope = '2938b146-a565-4468-baa4-568acd4c92af';
export const Organization_AcmeAsia = '7a5c914c-f152-4701-a727-8b52cd8f293b';
export const Organization_AcmeSubsidiary = '0c04d416-9b28-4c43-b10d-23db92eb6bb0';
export const Organization_PartnerCorp = 'a4ade4eb-5013-4914-8a20-70c325b2f42c';
export const Organization_Tarnwick = 'f8848f98-29ca-476e-8786-8ed926a8762d';

// --- Risk Scenarios ---
export const RiskScenario_DataBreachCrm = 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c';
export const RiskScenario_BizInterruptionEcommerce = 'f2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d';
export const RiskScenario_PhysicalDamageMfg = 'a3c4d5e6-f7a8-4b9c-8d1e-2f3a4b5c6d7e';
export const RiskScenario_EspionageFirmware = 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f';

// --- Notifications ---
export const Notification_1 = '8c85893a-05fb-4f50-a681-7c1b1bf3f53a';
export const Notification_2 = '2f295b98-4a2d-431f-895d-b08c46b2ebdf';
export const Notification_3 = '5b071454-c5de-4b16-a7bd-c9a43ea81eec';
export const Notification_4 = 'd87bdab3-1cfc-4b95-a045-f18db24794fe';
export const Notification_5 = 'a310e0b3-aa5f-4fda-8abb-7369298fbc2f';

// --- Scenario Loss Estimates ---
export const ScenarioLossEstimate_CrmForensics = 'b0c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e';
export const ScenarioLossEstimate_CrmCrisisPr = 'c1d2e3f4-a5b6-4c7d-9e8f-0a1b2c3d4e5f';
export const ScenarioLossEstimate_CrmRegulatory = 'd2e3f4a5-b6c7-4d8e-af90-1b2c3d4e5f6a';

// --- Primary Assets ---
// Acme Bank HQ
export const PrimaryAsset_CustomerAccountData = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
export const PrimaryAsset_CreditDecisionProcess = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const PrimaryAsset_InterbankPayment = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';
// Acme Bank Europe
export const PrimaryAsset_EuCustomerData = 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a';
export const PrimaryAsset_AmlKycProcess = '01a1b2c3-d4e5-4f6a-8b7c-9d0e1f2a3b4c';
// Acme Wealth Management
export const PrimaryAsset_InvestmentPortfolio = '02b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d';
export const PrimaryAsset_SecuritiesTrading = '03c3d4e5-f6a7-4b8c-ad0e-1f2a3b4c5d6e';
// Kestrelmoor Payments
export const PrimaryAsset_CardTransactionData = '04d4e5f6-a7b8-4c9d-be1f-2a3b4c5d6e7f';
// Tarnwick Industries
export const PrimaryAsset_ManufacturingData = '05e5f6a7-b8c9-4d0e-af2a-3b4c5d6e7f8a';
export const PrimaryAsset_ProductionPlanning = '06f6a7b8-c9d0-4e1f-ba3b-4c5d6e7f8a9b';

// --- Supporting Assets ---
// Acme Bank — Applications
export const SupportingAsset_CoreBanking = 'e5f6a7b8-c9d0-4e1f-aa3b-4c5d6e7f8a9b';
export const SupportingAsset_InternetBanking = 'f6a7b8c9-d0e1-4f2a-ab4c-5d6e7f8a9b0c';
export const SupportingAsset_MobileBanking = 'a7b8c9d0-e1f2-4a3b-8c5d-6e7f8a9b0c1d';
export const SupportingAsset_PaymentGateway = 'b8c9d0e1-f2a3-4b4c-9d6e-7f8a9b0c1d2e';
export const SupportingAsset_AmlPlatform = '07a7b8c9-d0e1-4f2a-8b4c-5d6e7f8a9b0c';
export const SupportingAsset_TradingPlatform = '08b8c9d0-e1f2-4a3b-9c5d-6e7f8a9b0c1d';
export const SupportingAsset_CardAuthEngine = '09c9d0e1-f2a3-4b4c-ad6e-7f8a9b0c1d2e';
// Acme Bank — Infrastructure
export const SupportingAsset_OracleExadata = '10d0e1f2-a3b4-4c5d-8e7f-8a9b0c1d2e3f';
export const SupportingAsset_KubernetesAks = '11e1f2a3-b4c5-4d6e-9f8a-9b0c1d2e3f4a';
export const SupportingAsset_AzureCloud = '12f2a3b4-c5d6-4e7f-aa9b-0c1d2e3f4a5b';
export const SupportingAsset_BackupDr = '13a3b4c5-d6e7-4f8a-8b0c-1d2e3f4a5b6c';
// Acme Bank — Network
export const SupportingAsset_CorporateWan = '14b4c5d6-e7f8-4a9b-9c1d-2e3f4a5b6c7d';
export const SupportingAsset_Firewall = '15c5d6e7-f8a9-4b0c-ad2e-3f4a5b6c7d8e';
export const SupportingAsset_LoadBalancer = '16d6e7f8-a9b0-4c1d-8e3f-4a5b6c7d8e9f';
// Acme Bank — Physical
export const SupportingAsset_DatacenterParis = '17e7f8a9-b0c1-4d2e-9f4a-5b6c7d8e9f0a';
export const SupportingAsset_DatacenterFrankfurt = '18f8a9b0-c1d2-4e3f-aa5b-6c7d8e9f0a1b';
// Acme Bank — Human
export const SupportingAsset_ItOpsTeam = '19a9b0c1-d2e3-4f4a-8b6c-7d8e9f0a1b2c';
// Acme Bank — Third Party
export const SupportingAsset_MicrosoftAzure = '20b0c1d2-e3f4-4a5b-9c7d-8e9f0a1b2c3d';
export const SupportingAsset_Worldline = '21c1d2e3-f4a5-4b6c-ad8e-9f0a1b2c3d4e';
// Acme Bank — AI
export const SupportingAsset_SupportCopilot = '24f4a5b6-c7d8-4e9f-8a0b-1c2d3e4f5a6b';
// Tarnwick
export const SupportingAsset_TarnwickErp = 'c9d0e1f2-a3b4-4c5d-ae7f-8a9b0c1d2e3f';
export const SupportingAsset_TarnwickScada = '22d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
export const SupportingAsset_TarnwickFactoryLan = '23e3f4a5-b6c7-4d8e-9fa0-1b2c3d4e5f6a';

// --- Tags (Acme) ---
export const Tag_Production = '019edb28-0019-7000-8000-000000000001';
export const Tag_Pii = '019edb28-0019-7000-8000-000000000002';
export const TagSource_ProductionOpenaev = '019edb28-001a-7000-8000-000000000001';
export const TagSource_PiiManual = '019edb28-001a-7000-8000-000000000002';
export const SupportingAssetTag_SupportCopilotProduction = '019edb28-001b-7000-8000-000000000001';
export const SupportingAssetTag_SupportCopilotPii = '019edb28-001b-7000-8000-000000000002';

// --- Tags (the `seed` mark, one canonical row per tenant that owns seeded assets) ---
export const Tag_SeedAcme = '019edb28-0019-7000-8000-000000000003';
export const Tag_SeedTarnwick = '019edb28-0019-7000-8000-000000000004';
export const TagSource_SeedAcmeManual = '019edb28-001a-7000-8000-000000000003';
export const TagSource_SeedTarnwickManual = '019edb28-001a-7000-8000-000000000004';

// --- Tags (Acme, manual-only — a tag no connector ever reports) ---
export const Tag_ToBeDecommissioned = '019edb28-0019-7000-8000-000000000005';
export const TagSource_ToBeDecommissionedManual = '019edb28-001a-7000-8000-000000000005';
export const SupportingAssetTag_BackupDrToBeDecommissioned = '019edb28-001b-7000-8000-000000000003';

// --- Tags (Acme, merged — `PII` is merged into `pii`, so the merge and its undo can be tried by hand) ---
export const Tag_PiiUppercase = '019edb28-0019-7000-8000-000000000006';
export const TagSource_PiiUppercaseManual = '019edb28-001a-7000-8000-000000000006';
export const SupportingAssetTag_CoreBankingPiiUppercase = '019edb28-001b-7000-8000-000000000004';

// --- Tags (Acme, pushed by XTM One — the third tag origin, next to OpenAEV and manual) ---
export const Tag_PciScope = '019edb28-0019-7000-8000-000000000007';
export const TagSource_PciScopeXtmOne = '019edb28-001a-7000-8000-000000000007';
export const SupportingAssetTag_PaymentGatewayPciScope = '019edb28-001b-7000-8000-000000000005';

// --- Asset groups (Acme, one per origin: a person, the OpenAEV sync, an XTM One push) ---
export const AssetGroup_PaymentsEstate = '019edb28-0044-7000-8000-000000000001';
export const AssetGroup_TierOneServers = '019edb28-0044-7000-8000-000000000002';
export const AssetGroup_CrownJewels = '019edb28-0044-7000-8000-000000000003';

// --- S→P Links ---
export const SupportingToPrimaryLink_CbsStoresAccount = 'b4c5d6e7-f8a9-4b0c-9d2e-3f4a5b6c7d8e';
export const SupportingToPrimaryLink_CbsExecutesCredit = 'c5d6e7f8-a9b0-4c1d-ae3f-4a5b6c7d8e9f';
export const SupportingToPrimaryLink_CbsProcessesPayment = '40d0e1f2-a3b4-4c5d-8e7f-1a2b3c4d5e6f';
export const SupportingToPrimaryLink_PortalProcessesAccount = '41e1f2a3-b4c5-4d6e-9f8a-2b3c4d5e6f7a';
export const SupportingToPrimaryLink_MobileProcessesAccount = '42f2a3b4-c5d6-4e7f-aa9b-3c4d5e6f7a8b';
export const SupportingToPrimaryLink_GatewayExecutesPayment = '43a3b4c5-d6e7-4f8a-8b0c-4d5e6f7a8b9c';
export const SupportingToPrimaryLink_GatewayTransmitsEu = '44b4c5d6-e7f8-4a9b-9c1d-5e6f7a8b9c0d';
export const SupportingToPrimaryLink_AmlExecutesKyc = '45c5d6e7-f8a9-4b0c-ad2e-6f7a8b9c0d1e';
export const SupportingToPrimaryLink_AmlProcessesEu = '46d6e7f8-a9b0-4c1d-8e3f-7a8b9c0d1e2f';
export const SupportingToPrimaryLink_TradingStoresPortfolio = '47e7f8a9-b0c1-4d2e-9f4a-8b9c0d1e2f3a';
export const SupportingToPrimaryLink_TradingExecutesSecurities = '48f8a9b0-c1d2-4e3f-aa5b-9c0d1e2f3a4b';
export const SupportingToPrimaryLink_CardProcessesTransactions = '49a9b0c1-d2e3-4f4a-8b6c-0d1e2f3a4b5c';
export const SupportingToPrimaryLink_OracleStoresAccount = '50b0c1d2-e3f4-4a5b-9c7d-1e2f3a4b5c6d';
export const SupportingToPrimaryLink_ItOpsSupportsPayment = '51c1d2e3-f4a5-4b6c-ad8e-2f3a4b5c6d7e';

// --- S→S Links ---
export const SupportingToSupportingLink_DcHostsOracle = 'd6e7f8a9-b0c1-4d2e-bf4a-5b6c7d8e9f0a';
export const SupportingToSupportingLink_DcHostsCbs = 'e7f8a9b0-c1d2-4e3f-8a5b-6c7d8e9f0a1b';
export const SupportingToSupportingLink_DcContainsFw = '52d2e3f4-a5b6-4c7d-8e9f-3a4b5c6d7e8f';
export const SupportingToSupportingLink_DrdcHostsBackup = '53e3f4a5-b6c7-4d8e-9fa0-4b5c6d7e8f9a';
export const SupportingToSupportingLink_AzureHostsK8s = '54f4a5b6-c7d8-4e9f-aa0b-5c6d7e8f9a0b';
export const SupportingToSupportingLink_K8sHostsPortal = '55a5b6c7-d8e9-4f0a-8b1c-6d7e8f9a0b1c';
export const SupportingToSupportingLink_K8sHostsMobile = '56b6c7d8-e9f0-4a1b-9c2d-7e8f9a0b1c2d';
export const SupportingToSupportingLink_K8sHostsGateway = '57c7d8e9-f0a1-4b2c-ad3e-8f9a0b1c2d3e';
export const SupportingToSupportingLink_K8sHostsCard = '58d8e9f0-a1b2-4c3d-8e4f-9a0b1c2d3e4f';
export const SupportingToSupportingLink_FwProtectsCbs = '59e9f0a1-b2c3-4d4e-9f5a-0b1c2d3e4f5a';
export const SupportingToSupportingLink_FwProtectsOracle = '60f0a1b2-c3d4-4e5f-aa6b-1c2d3e4f5a6b';
export const SupportingToSupportingLink_LbServesPortal = '61a1b2c3-d4e5-4f6a-8b7c-2d3e4f5a6b7c';
export const SupportingToSupportingLink_WanConnectsDc = '62b2c3d4-e5f6-4a7b-9c8d-3e4f5a6b7c8d';
export const SupportingToSupportingLink_BackupProtectsOracle = '63c3d4e5-f6a7-4b8c-ad0e-4f5a6b7c8d9e';

// Biz Interruption E-commerce loss estimates
export const ScenarioLossEstimate_EcommerceDowntime = 'e3f4a5b6-c7d8-4e9f-b0a1-2c3d4e5f6a7b';
export const ScenarioLossEstimate_EcommerceCrisis = 'f4a5b6c7-d8e9-4f0a-81b2-3d4e5f6a7b8c';

// Espionage Firmware loss estimates
export const ScenarioLossEstimate_FirmwareInvestigation = 'a5b6c7d8-e9f0-4a1b-92c3-4e5f6a7b8c9d';
export const ScenarioLossEstimate_FirmwareIpLoss = 'b6c7d8e9-f0a1-4b2c-a3d4-5f6a7b8c9d0e';

// Physical Damage Manufacturing loss estimates (Tarnwick)
export const ScenarioLossEstimate_MfgForensics = 'af8331f1-0040-4e40-91e5-c0bcedd34628';
export const ScenarioLossEstimate_MfgHardware = 'b9d2ada7-ea74-4151-bc67-49fe08d4a843';
export const ScenarioLossEstimate_MfgDowntime = '58c33d58-b986-47fa-84c6-a4312a3a1a9e';

// === Service Accounts ===
export const ServiceAccount_CveSyncAcme = '019edb28-0002-7000-8000-000000000001';
export const ServiceAccount_CveSyncTarnwick = '019edb28-0002-7000-8000-000000000002';
export const ServiceAccountToken_CveSyncAcme = '019edb28-0003-7000-8000-000000000001';
export const ServiceAccountToken_CveSyncTarnwick = '019edb28-0003-7000-8000-000000000002';

// === Integration Settings ===
// Acme — one row per source (first, nist, cisa, microsoft_graph, openaev)
export const IntegrationSetting_AcmeFirst = '019edb28-0004-7000-8000-000000000001';
export const IntegrationSetting_AcmeNist = '019edb28-0004-7000-8000-000000000002';
export const IntegrationSetting_AcmeCisa = '019edb28-0004-7000-8000-000000000003';
export const IntegrationSetting_AcmeMicrosoftGraph = '019edb28-0004-7000-8000-000000000004';
// OpenAEV was added after the initial source set; keep stable IDs for existing seeded rows.
export const IntegrationSetting_AcmeOpenaev = '019edb28-0004-7000-8000-000000000009';
// Tarnwick — one row per source (first, nist, cisa, microsoft_graph, openaev)
export const IntegrationSetting_TarnwickFirst = '019edb28-0004-7000-8000-000000000005';
export const IntegrationSetting_TarnwickNist = '019edb28-0004-7000-8000-000000000006';
export const IntegrationSetting_TarnwickCisa = '019edb28-0004-7000-8000-000000000007';
export const IntegrationSetting_TarnwickMicrosoftGraph = '019edb28-0004-7000-8000-000000000008';
export const IntegrationSetting_TarnwickOpenaev = '019edb28-0004-7000-8000-000000000010';

// === CVEs (Acme) ===
export const Cve_AcmeLog4shell = '019edb28-0005-7000-8000-000000000001';
export const Cve_AcmeCitrixBleed = '019edb28-0005-7000-8000-000000000002';
export const Cve_AcmeMoveit = '019edb28-0005-7000-8000-000000000003';
export const Cve_AcmeProxynotshellSsrf = '019edb28-0005-7000-8000-000000000004';
export const Cve_AcmeProxynotshellRce = '019edb28-0005-7000-8000-000000000005';
export const Cve_AcmeFortiosTraversal = '019edb28-0005-7000-8000-000000000006';
export const Cve_AcmeFortiosOobWrite = '019edb28-0005-7000-8000-000000000007';
export const Cve_AcmeFortigateHeap = '019edb28-0005-7000-8000-000000000008';
export const Cve_AcmeProxylogon = '019edb28-0005-7000-8000-000000000009';
export const Cve_AcmeConfluenceOgnl = '019edb28-0005-7000-8000-000000000010';
export const Cve_AcmeIvantiAuthBypass = '019edb28-0005-7000-8000-000000000011';
export const Cve_AcmeIvantiCmdInjection = '019edb28-0005-7000-8000-000000000012';
export const Cve_AcmeCitrixAdcRce = '019edb28-0005-7000-8000-000000000013';
export const Cve_AcmeZerologon = '019edb28-0005-7000-8000-000000000014';
export const Cve_AcmePanOs = '019edb28-0005-7000-8000-000000000015';
export const Cve_AcmeCitrixAdcTraversal = '019edb28-0005-7000-8000-000000000016';
export const Cve_AcmeOutlookEop = '019edb28-0005-7000-8000-000000000017';
export const Cve_AcmeRegresshion = '019edb28-0005-7000-8000-000000000018';
export const Cve_AcmePrintNightmare = '019edb28-0005-7000-8000-000000000019';
export const Cve_AcmeFollina = '019edb28-0005-7000-8000-000000000020';
export const Cve_AcmeBluekeep = '019edb28-0005-7000-8000-000000000021';
export const Cve_AcmeEternalblue = '019edb28-0005-7000-8000-000000000022';
export const Cve_AcmeExchangeFixedKey = '019edb28-0005-7000-8000-000000000023';
export const Cve_AcmeProxyshell = '019edb28-0005-7000-8000-000000000024';
export const Cve_AcmeClfsNokoyawa = '019edb28-0005-7000-8000-000000000025';
export const Cve_AcmeSharepointAuthBypass = '019edb28-0005-7000-8000-000000000026';
export const Cve_AcmeCiscoIosXeWebui = '019edb28-0005-7000-8000-000000000027';
export const Cve_AcmeFortiosSslvpnHeap = '019edb28-0005-7000-8000-000000000028';
export const Cve_AcmePulseSecureFileRead = '019edb28-0005-7000-8000-000000000029';
export const Cve_AcmeBigipTmuiRce = '019edb28-0005-7000-8000-000000000030';
export const Cve_AcmeBigipIcontrolBypass = '019edb28-0005-7000-8000-000000000031';
export const Cve_AcmeScreenconnectBypass = '019edb28-0005-7000-8000-000000000032';
export const Cve_AcmeBarracudaEsgInjection = '019edb28-0005-7000-8000-000000000033';
export const Cve_AcmeEsxiOpenslp = '019edb28-0005-7000-8000-000000000034';
export const Cve_AcmeVcenterPluginBypass = '019edb28-0005-7000-8000-000000000035';
export const Cve_AcmeWorkspaceOneSsti = '019edb28-0005-7000-8000-000000000036';
export const Cve_AcmeAriaOperationsInjection = '019edb28-0005-7000-8000-000000000037';
export const Cve_AcmeWeblogicConsoleBypass = '019edb28-0005-7000-8000-000000000038';
export const Cve_AcmeStruts2Ognl = '019edb28-0005-7000-8000-000000000039';
export const Cve_AcmeSpring4shell = '019edb28-0005-7000-8000-000000000040';
export const Cve_AcmeApacheTraversalRce = '019edb28-0005-7000-8000-000000000041';
export const Cve_AcmeWeblogicDeserialization = '019edb28-0005-7000-8000-000000000042';
export const Cve_AcmeConfluenceBrokenAccess = '019edb28-0005-7000-8000-000000000043';
export const Cve_AcmeConfluenceImproperAuth = '019edb28-0005-7000-8000-000000000044';
export const Cve_AcmeTeamcityAuthBypass = '019edb28-0005-7000-8000-000000000045';
export const Cve_AcmeGoanywhereDeserialization = '019edb28-0005-7000-8000-000000000046';
export const Cve_AcmeCleoUnrestrictedUpload = '019edb28-0005-7000-8000-000000000047';
export const Cve_AcmeJenkinsCliFileRead = '019edb28-0005-7000-8000-000000000048';
export const Cve_AcmePapercutAccessControl = '019edb28-0005-7000-8000-000000000049';
export const Cve_AcmePwnkit = '019edb28-0005-7000-8000-000000000050';
export const Cve_AcmeSudoBaronSamedit = '019edb28-0005-7000-8000-000000000051';
export const Cve_AcmeDirtyPipe = '019edb28-0005-7000-8000-000000000052';
export const Cve_AcmeAdselfserviceBypass = '019edb28-0005-7000-8000-000000000053';
export const Cve_AcmeCurlSocks5Overflow = '019edb28-0005-7000-8000-000000000054';
export const Cve_AcmeOpensslPunycodeOverflow = '019edb28-0005-7000-8000-000000000055';
export const Cve_AcmeZlibMinizipOverflow = '019edb28-0005-7000-8000-000000000056';
export const Cve_AcmeExpatUseAfterFree = '019edb28-0005-7000-8000-000000000057';
export const Cve_AcmeGlibcLooneyTunables = '019edb28-0005-7000-8000-000000000058';
export const Cve_AcmeLibwebpHeapOverflow = '019edb28-0005-7000-8000-000000000059';
export const Cve_AcmeHttp2RapidReset = '019edb28-0005-7000-8000-000000000060';

// === Primary Assets (Acme Asia) ===
export const PrimaryAsset_TradeFinance = '019edb28-0006-7000-8000-000000000001';

// === Risk Scenarios (Acme Asia + Kestrelmoor) ===
export const RiskScenario_RansomwareTradeFinance = '019edb28-0007-7000-8000-000000000001';
export const RiskScenario_CardDataBreachKestrelmoor = '019edb28-0007-7000-8000-000000000002';

// === Scenario Loss Estimates (Acme Asia + Kestrelmoor) ===
export const ScenarioLossEstimate_TradeFinanceDowntime = '019edb28-0008-7000-8000-000000000001';
export const ScenarioLossEstimate_TradeFinanceExtortion = '019edb28-0008-7000-8000-000000000002';
export const ScenarioLossEstimate_CardBreachForensics = '019edb28-0008-7000-8000-000000000003';
export const ScenarioLossEstimate_CardBreachCardAssessments = '019edb28-0008-7000-8000-000000000004';
export const ScenarioLossEstimate_CardBreachCrisis = '019edb28-0008-7000-8000-000000000005';
export const ScenarioLossEstimate_TradeFinanceNotification = '019edb28-0008-7000-8000-000000000006';

// === Bulk-generated rows (derived from a stable position, never from uuidv7) ===
const seededRowId = (group: string, index: number): string =>
  `019edb28-${group}-7000-8000-${String(index).padStart(12, '0')}`;

const HALF_BITS = 24;
const HALF_RANGE = 2 ** HALF_BITS;
const FEISTEL_ROUNDS = 4;

const feistelRound = (half: number, key: number): number => {
  let mixed = Math.imul(half ^ key, 0x9e3779b1);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) % HALF_RANGE;
};

/**
 * Like `seededRowId`, but the index goes through a permutation of the 48-bit range keyed on the
 * group, so the id order bears no relation to the index order, nor to the order of any other
 * group. A sequential id hands every index and sort on it a locality that a park's rows never
 * have. Distinct indexes below 2^48 keep distinct ids.
 */
const scrambledRowId = (group: string, index: number): string => {
  const groupKey = Number.parseInt(group, 16);
  let left = Math.floor(index / HALF_RANGE);
  let right = index % HALF_RANGE;
  const groupSeed = Math.imul(groupKey + 1, 0x01000193);
  for (let round = 0; round < FEISTEL_ROUNDS; round++) {
    [left, right] = [right, left ^ feistelRound(right, groupSeed + round * 0x632be5ab)];
  }
  return `019edb28-${group}-7000-8000-${(left * HALF_RANGE + right).toString(16).padStart(12, '0')}`;
};

export const capabilityAssessmentId = (specIndex: number): string => seededRowId('0009', specIndex);
export const capabilityAssessmentEventId = (specIndex: number, eventIndex: number): string =>
  seededRowId('000a', specIndex * 10 + eventIndex);
export const assetFindingId = (specIndex: number): string => seededRowId('000b', specIndex);
export const assetFindingHistoryId = (specIndex: number, historyIndex: number): string =>
  seededRowId('000c', specIndex * 10 + historyIndex);
export const crqHistoryRunId = (scenarioIndex: number, dayIndex: number): string =>
  seededRowId('000d', scenarioIndex * 1000 + dayIndex);
export const assetExpectationFindingId = (specIndex: number): string => seededRowId('000e', specIndex);
export const assetExpectationFindingHistoryId = (specIndex: number, historyIndex: number): string =>
  seededRowId('000f', specIndex * 10 + historyIndex);
export const assetFindingSourceId = (specIndex: number): string => seededRowId('0014', specIndex);
export const assetExpectationFindingSourceId = (specIndex: number): string => seededRowId('0015', specIndex);
export const supportingAssetSourceId = (specIndex: number): string => seededRowId('0016', specIndex);
export const supportingAssetSeedTagId = (assetIndex: number): string => seededRowId('0017', assetIndex);
export const assetGroupMemberId = (memberIndex: number): string => seededRowId('0045', memberIndex);
export const identityAssetId = (specIndex: number): string => seededRowId('0024', specIndex);
export const identityAssetSourceId = (specIndex: number): string => seededRowId('0025', specIndex);
export const identitySeedTagId = (specIndex: number): string => seededRowId('0026', specIndex);
export const sparseIdentityAssetId = (specIndex: number): string => seededRowId('0027', specIndex);
export const sparseIdentitySeedTagId = (specIndex: number): string => seededRowId('0028', specIndex);
export const logonOnlyIdentityAssetId = (specIndex: number): string => seededRowId('0029', specIndex);
export const logonOnlyIdentitySourceId = (specIndex: number): string => seededRowId('0030', specIndex);
export const logonOnlyIdentitySeedTagId = (specIndex: number): string => seededRowId('0031', specIndex);
export const primaryUserWorkstationAssetId = (specIndex: number): string => seededRowId('0033', specIndex);
export const primaryUserWorkstationSourceId = (specIndex: number): string => seededRowId('0034', specIndex);
export const primaryUserWorkstationSeedTagId = (specIndex: number): string => seededRowId('0037', specIndex);
export const primaryUserRelationId = (specIndex: number): string => seededRowId('0036', specIndex);
export const hostCriticalityAssetId = (specIndex: number): string => seededRowId('0038', specIndex);
export const hostCriticalitySourceId = (specIndex: number): string => seededRowId('0039', specIndex);
export const hostCriticalitySeedTagId = (specIndex: number): string => seededRowId('0040', specIndex);
export const capabilityTechniqueOverrideId = (specIndex: number): string => seededRowId('0010', specIndex);
export const capabilityScopeOverrideId = (specIndex: number): string => seededRowId('003c', specIndex);
export const capabilityScopeOverrideEventId = (specIndex: number): string => seededRowId('003d', specIndex);
export const findingScoreHistoryId = (findingIndex: number, dayIndex: number): string =>
  seededRowId('0013', findingIndex * 100 + dayIndex);
export const findingScoreEarlierHistoryId = (findingIndex: number, weekIndex: number): string =>
  seededRowId('0041', findingIndex * 100 + weekIndex);
export const uniqueFindingScoreHistoryId = (lineIndex: number): string => seededRowId('0042', lineIndex);
export const assetPostureHistoryId = (assetIndex: number, dayIndex: number): string =>
  seededRowId('0032', assetIndex * 1000 + dayIndex);
export const cveReferenceId = (specIndex: number, referenceIndex: number): string =>
  seededRowId('0011', specIndex * 10 + referenceIndex);
export const cveAffectedVersionId = (specIndex: number, versionIndex: number): string =>
  seededRowId('0012', specIndex * 10 + versionIndex);

// === Risk Scenarios (Acme Corp + Acme Europe — siblings of RiskScenario_DataBreachCrm, same
// outcome, so the attack outcome overview has several priced scenarios and one unpriced) ===
export const RiskScenario_DataBreachRetailPos = '019edb28-0011-7000-8000-000000000001';
export const RiskScenario_DataBreachAmlExposure = '019edb28-0011-7000-8000-000000000002';

// === Scenario Loss Estimates (siblings above) ===
export const ScenarioLossEstimate_RetailPosForensics = '019edb28-0012-7000-8000-000000000001';
export const ScenarioLossEstimate_RetailPosRegulatory = '019edb28-0012-7000-8000-000000000002';
export const ScenarioLossEstimate_AmlExposureNotification = '019edb28-0012-7000-8000-000000000003';

// === Financial Profiles ===
export const FinancialProfile_AcmeCorp = '019edb28-0013-7000-8000-000000000001';
export const FinancialProfile_AcmeRetailNetwork = '019edb28-0013-7000-8000-000000000002';

// === Large estate profile ===
export const Organization_AcmeRetailNetwork = '019edb28-0017-7000-8000-000000000001';
export const largeEstateAssetId = (index: number): string => scrambledRowId('0018', index);
export const largeEstateFindingId = (index: number): string => scrambledRowId('0019', index);
export const largeEstateFindingHistoryId = (index: number, historyIndex: number): string =>
  scrambledRowId('001a', index * 10 + historyIndex);
export const largeEstateDependencyId = (index: number): string => scrambledRowId('001b', index);
export const largeEstatePrimaryLinkId = (index: number): string => seededRowId('001c', index);
export const largeEstatePrimaryAssetId = (index: number): string => seededRowId('001d', index);
export const largeEstateScenarioId = (index: number): string => seededRowId('001e', index);
export const largeEstateLossEstimateId = (index: number): string => seededRowId('001f', index);
export const largeEstateAssetSourceId = (index: number): string => scrambledRowId('0020', index);
export const largeEstateFindingSourceId = (index: number): string => scrambledRowId('0021', index);

// === Treatment Plans ===
export const TreatmentPlan_HardenIdentity = '019edb28-0022-7000-8000-000000000001';
export const TreatmentPlan_WidenEndpointCoverage = '019edb28-0022-7000-8000-000000000002';
export const treatmentPlanWhatIfId = (planIndex: number, runIndex: number): string =>
  seededRowId('0023', planIndex * 100 + runIndex);

// === Budget Reviews ===
export const BudgetReview_AcmeCorpRunningPeriod = '019edb28-003a-7000-8000-000000000001';
export const BudgetReviewLine_IdentityUpgrades = '019edb28-003a-7000-8000-000000000002';
export const BudgetReviewLine_DetectionRun = '019edb28-003a-7000-8000-000000000003';
export const BudgetReview_AcmeCorpPreviousPeriod = '019edb28-003a-7000-8000-000000000004';
export const BudgetReviewLine_DataLossProject = '019edb28-003a-7000-8000-000000000005';
export const BudgetReviewLine_PreviousDetectionRun = '019edb28-003a-7000-8000-000000000006';
export const BudgetReviewLine_PrivilegedAccess = '019edb28-003a-7000-8000-000000000007';
export const budgetReviewLineControlId = (lineIndex: number, controlIndex: number): string =>
  seededRowId('003b', lineIndex * 100 + controlIndex);

// === Compliance Assessments ===
export const ComplianceAssessment_CsfQ2 = '019edb28-0034-7000-8000-000000000001';
export const ComplianceAssessment_CsfQ4 = '019edb28-0034-7000-8000-000000000002';
export const complianceAnswerId = (assessmentIndex: number, requirementIndex: number): string =>
  seededRowId('0035', assessmentIndex * 1000 + requirementIndex);

// === Declared Estate ===
export const declaredEstateEventId = (index: number): string => seededRowId('0043', index);
