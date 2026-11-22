import { aleChangeExplainService } from './ale-change-explain';
import { attackOutcomesService } from './attack-outcomes';
import { assetDependenciesService } from './asset-dependencies';
import { authService } from './auth';
import { capabilitiesService } from './capabilities';
import { countriesService } from './countries';
import { groupsService } from './groups';
import { markingDefinitionsService } from './marking-definitions';
import { membersService } from './members';
// A seed registers when its module is first evaluated, and evaluation follows the whole import
// graph, not the order of these lines: seedLossDrivers registers before seedBusinessValueCategories
// however the two are placed here. A seed that needs another's rows cannot get that from this file.
import { businessValueCategoriesService } from './business-value-categories';
import { lossDriversService } from './loss-drivers';
import { mitreAttackService } from './mitre-attack';
import { scenarioLossEstimatesService } from './scenario-loss-estimates';
import { financialProfilesService } from './financial-profiles';
import { declaredEstateService } from './declared-estate';
import { notificationsService } from './notifications';
import { primaryAssetsService } from './primary-assets';
import { riskScenariosService } from './risk-scenarios';
import { controlCapabilityService } from './controls/capability';

import { organizationsService } from './organizations';
import { supportingAssetsService } from './supporting-assets';
import { attackSurfacesService } from './attack-surfaces';
import { platformCapabilitiesService } from './platform-capabilities';
import { platformGroupsService } from './platform-groups';
import { platformRolesService } from './platform-roles';
import { rolesService } from './roles';
import { sectorsService } from './sectors';
import { tenantsService } from './tenants';
import { usersService } from './users';
import { threatRelevanceSettingsService } from './threat-relevance-settings';
import { crqIndicatorSettingsService } from './crq-indicator-settings';
import { findingScoreService } from './finding-score';
import { controlValidationService } from './control-validation';
import { crqIndicatorsService } from './crq-indicators';
import { dashboardService } from './dashboard';
import { dashboardSettingsService } from './dashboard-settings';
import { onboardingWizardsService } from './onboarding-wizards';
import { jobsService } from './jobs';
import { jobDependenciesService } from './job-dependencies';
import { jobSchedulesService } from './job-schedules';
import { integrationSettingsService } from './integration-settings';
import { cveService } from './cve';
import { cweService } from './cwe';
import { techniqueMappingService } from './technique-mapping';
import { serviceAccountsService } from './service-accounts';
import { serviceAccountTokensService } from './service-account-tokens';
import { fileStorageService } from './file-storage';
import { threatActivityService, threatAnalysesService } from './threat-analyses';
import { openctiConnectorService } from './opencti-connector';
import { defaultThreatsService } from './default-threats';
import { openaevConnectorService } from './openaev-connector';
import { drataService } from './drata';
import { connectorsService } from './connectors';
import { workersService } from './workers';
import { jobLogsService } from './job-logs';
import { treatmentPlansService } from './treatment-plans';
import { budgetReviewsService } from './budget-reviews';
import { complianceAssessmentsService } from './compliance-assessments';
import { globalSearchService } from './global-search';

export * from './attack-outcomes';
export * from './asset-dependencies';
export * from './auth';
export * from './tenants';
export * from './users';
export * from './platform-capabilities';
export * from './platform-groups';
export * from './platform-roles';
export * from './roles';
export * from './groups';
export * from './marking-definitions';
export * from './capabilities';
export * from './organizations';
export * from './business-value-categories';
export * from './primary-assets';
export * from './attack-surfaces';
export * from './supporting-assets';
export * from './members';
export * from './notifications';
export * from './sectors';
export * from './countries';
export * from './risk-scenarios';
export * from './loss-drivers';
export * from './scenario-loss-estimates';
export * from './financial-profiles';
export * from './declared-estate';
export * from './mitre-attack';
export * from './tef-catalog';
export * from './controls';
export * from './threat-relevance-settings';
export * from './crq-indicator-settings';
export * from './entry-openings';
export * from './finding-score';
export * from './control-validation';
export * from './crq-indicators';
export * from './dashboard';
export * from './ale-change-explain';
export * from './dashboard-settings';
export * from './onboarding-wizards';
export * from './events';
export * from './jobs';
export * from './job-dependencies';
export * from './job-schedules';
export * from './integration-settings';
export * from './connectors';
export * from './cve';
export * from './cwe';
export * from './technique-mapping';
export * from './service-accounts';
export * from './service-account-tokens';
export * from './file-storage';
export * from './threat-analyses';
export * from './opencti-connector';
export * from './default-threats';
export * from './openaev-connector';
export * from './drata';
export * from './workers';
export * from './job-logs';
export * from './treatment-plans';
export * from './budget-reviews';
export * from './compliance-assessments';
export * from './global-search';
export * as schema from './schema';

export const allServiceDefinitions = [
  authService,
  tenantsService,
  usersService,
  businessValueCategoriesService,
  platformCapabilitiesService,
  platformGroupsService,
  platformRolesService,
  groupsService,
  markingDefinitionsService,
  rolesService,
  capabilitiesService,
  organizationsService,
  membersService,
  notificationsService,
  sectorsService,
  countriesService,
  attackOutcomesService,
  riskScenariosService,
  lossDriversService,
  scenarioLossEstimatesService,
  financialProfilesService,
  declaredEstateService,
  mitreAttackService,
  controlCapabilityService,
  primaryAssetsService,
  supportingAssetsService,
  attackSurfacesService,
  assetDependenciesService,
  threatRelevanceSettingsService,
  crqIndicatorSettingsService,
  findingScoreService,
  controlValidationService,
  crqIndicatorsService,
  dashboardService,
  aleChangeExplainService,
  dashboardSettingsService,
  onboardingWizardsService,
  jobsService,
  jobDependenciesService,
  jobSchedulesService,
  integrationSettingsService,
  cveService,
  cweService,
  techniqueMappingService,
  serviceAccountsService,
  serviceAccountTokensService,
  fileStorageService,
  threatAnalysesService,
  threatActivityService,
  openctiConnectorService,
  defaultThreatsService,
  openaevConnectorService,
  drataService,
  connectorsService,
  workersService,
  jobLogsService,
  treatmentPlansService,
  budgetReviewsService,
  complianceAssessmentsService,
  globalSearchService,
] as const;
