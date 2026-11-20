-- Hand-written: the extensions, and the functions the generated statements call. drizzle-kit generates neither.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fold_text(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, value)) $function$;
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_roles" (
	"group_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "group_roles_group_id_role_id_pk" PRIMARY KEY("group_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "group_users" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "group_users_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"slug" text,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_capabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_group_roles" (
	"platform_group_id" uuid NOT NULL,
	"platform_role_id" uuid NOT NULL,
	CONSTRAINT "platform_group_roles_platform_group_id_platform_role_id_pk" PRIMARY KEY("platform_group_id","platform_role_id")
);
--> statement-breakpoint
CREATE TABLE "platform_group_users" (
	"platform_group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "platform_group_users_platform_group_id_user_id_pk" PRIMARY KEY("platform_group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	CONSTRAINT "platform_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "platform_role_capabilities" (
	"platform_role_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	CONSTRAINT "platform_role_capabilities_platform_role_id_capability_id_pk" PRIMARY KEY("platform_role_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "platform_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	CONSTRAINT "platform_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_capabilities" (
	"role_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	CONSTRAINT "role_capabilities_role_id_capability_id_pk" PRIMARY KEY("role_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"title" text,
	CONSTRAINT "tenant_users_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_locale" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text,
	"title" text,
	"locale" text,
	"theme" text,
	"home_dashboard_id" text,
	"xtm_subject" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"last_signed_in_at" timestamp with time zone,
	"join_token_hash" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_xtm_subject_unique" UNIQUE("xtm_subject"),
	CONSTRAINT "users_join_token_hash_unique" UNIQUE("join_token_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_asset_mapping_event_assets" (
	"event_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change" text NOT NULL,
	CONSTRAINT "organization_asset_mapping_event_assets_event_id_supporting_asset_id_pk" PRIMARY KEY("event_id","supporting_asset_id")
);
--> statement-breakpoint
CREATE TABLE "organization_asset_mapping_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"added_count" integer NOT NULL,
	"removed_count" integer NOT NULL,
	"old_estate_mode" text,
	"new_estate_mode" text,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "organization_asset_mapping_events_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "organization_assets" (
	"organization_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "organization_assets_organization_id_supporting_asset_id_pk" PRIMARY KEY("organization_id","supporting_asset_id")
);
--> statement-breakpoint
CREATE TABLE "organization_identity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"field" text NOT NULL,
	"user_id" uuid,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_risk_tolerances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"annual_loss" double precision NOT NULL,
	"max_exceedance_probability" double precision NOT NULL,
	CONSTRAINT "organization_risk_tolerances_organization_unique" UNIQUE("organization_id"),
	CONSTRAINT "organization_risk_tolerances_annual_loss_ck" CHECK ("organization_risk_tolerances"."annual_loss" > 0),
	CONSTRAINT "organization_risk_tolerances_probability_ck" CHECK ("organization_risk_tolerances"."max_exceedance_probability" BETWEEN 0.001 AND 1)
);
--> statement-breakpoint
CREATE TABLE "organization_unpins" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "organization_unpins_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"legal_entity_name" text,
	"sector_id" uuid,
	"country_id" uuid,
	"revenue_band" text,
	"employee_count" integer,
	"domain" text,
	"reaction_time_min" double precision,
	"reaction_time_likely" double precision,
	"reaction_time_max" double precision,
	"estate_mode" text DEFAULT 'open' NOT NULL,
	"estate_changed_at" timestamp with time zone,
	CONSTRAINT "organizations_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "sectors_tenant_id_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "sectors_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"iso_alpha_2" text NOT NULL,
	"iso_alpha_3" text NOT NULL,
	CONSTRAINT "countries_tenant_id_iso_alpha_3_unique" UNIQUE("tenant_id","iso_alpha_3"),
	CONSTRAINT "countries_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "business_value_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	CONSTRAINT "business_value_categories_tenant_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "primary_asset_business_value_categories" (
	"primary_asset_id" uuid NOT NULL,
	"business_value_category_id" uuid NOT NULL,
	CONSTRAINT "pa_business_value_categories_pk" PRIMARY KEY("primary_asset_id","business_value_category_id")
);
--> statement-breakpoint
CREATE TABLE "attack_outcome_mitre_techniques" (
	"attack_outcome_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "attack_outcome_mitre_techniques_attack_outcome_id_mitre_technique_id_pk" PRIMARY KEY("attack_outcome_id","mitre_technique_id")
);
--> statement-breakpoint
CREATE TABLE "attack_outcome_mixture_groups" (
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"attack_outcome_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"group_key" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"mitre_group_id" text,
	"share" double precision NOT NULL,
	"theta" double precision NOT NULL,
	"rho" double precision NOT NULL,
	"tau" double precision NOT NULL,
	"anchor_provenance" text NOT NULL,
	"last_activity_at" timestamp with time zone,
	"country_match" boolean NOT NULL,
	"sector_match" boolean NOT NULL,
	"member_group_keys" text[] NOT NULL,
	"deduped_stix_ids" text[] NOT NULL,
	"technique_external_ids" text[] NOT NULL,
	CONSTRAINT "attack_outcome_mixture_groups_pk" PRIMARY KEY("tenant_id","organization_id","attack_outcome_id","group_key"),
	CONSTRAINT "attack_outcome_mixture_groups_entity_type_ck" CHECK ("attack_outcome_mixture_groups"."entity_type" IN ('intrusion-set', 'threat-actor', 'campaign')),
	CONSTRAINT "attack_outcome_mixture_groups_anchor_provenance_ck" CHECK ("attack_outcome_mixture_groups"."anchor_provenance" IN ('observed', 'authored', 'none'))
);
--> statement-breakpoint
CREATE TABLE "attack_outcome_mixtures" (
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"attack_outcome_id" uuid NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"denominator" double precision NOT NULL,
	CONSTRAINT "attack_outcome_mixtures_pk" PRIMARY KEY("tenant_id","organization_id","attack_outcome_id")
);
--> statement-breakpoint
CREATE TABLE "attack_outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"reference_dwell_days" double precision NOT NULL,
	"terminal_tactic" text,
	"reaches_availability" text DEFAULT 'none' NOT NULL,
	"reaches_integrity" text DEFAULT 'none' NOT NULL,
	"reaches_confidentiality" text DEFAULT 'none' NOT NULL,
	"reaches_traceability" text DEFAULT 'none' NOT NULL,
	CONSTRAINT "attack_outcomes_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "risk_scenario_business_value_categories" (
	"risk_scenario_id" uuid NOT NULL,
	"business_value_category_id" uuid NOT NULL,
	CONSTRAINT "rs_business_value_categories_pk" PRIMARY KEY("risk_scenario_id","business_value_category_id")
);
--> statement-breakpoint
CREATE TABLE "risk_scenario_primary_assets" (
	"risk_scenario_id" uuid NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	CONSTRAINT "rs_primary_assets_pk" PRIMARY KEY("risk_scenario_id","primary_asset_id")
);
--> statement-breakpoint
CREATE TABLE "risk_scenario_risk_tolerances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"risk_scenario_id" uuid NOT NULL,
	"annual_loss" double precision NOT NULL,
	"max_exceedance_probability" double precision NOT NULL,
	CONSTRAINT "risk_scenario_risk_tolerances_scenario_unique" UNIQUE("risk_scenario_id"),
	CONSTRAINT "risk_scenario_risk_tolerances_annual_loss_ck" CHECK ("risk_scenario_risk_tolerances"."annual_loss" > 0),
	CONSTRAINT "risk_scenario_risk_tolerances_probability_ck" CHECK ("risk_scenario_risk_tolerances"."max_exceedance_probability" BETWEEN 0.001 AND 1)
);
--> statement-breakpoint
CREATE TABLE "risk_scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"owner_id" uuid,
	"attack_outcome_id" uuid NOT NULL,
	"tef_mode" text DEFAULT 'auto' NOT NULL,
	"derived_answers_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loss_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loss_driver_activations" (
	"attack_outcome_id" uuid NOT NULL,
	"business_value_category_id" uuid NOT NULL,
	"loss_driver_id" uuid NOT NULL,
	CONSTRAINT "loss_driver_activations_pk" PRIMARY KEY("attack_outcome_id","business_value_category_id","loss_driver_id")
);
--> statement-breakpoint
CREATE TABLE "loss_drivers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loss_category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"dwell_sensitivity" text NOT NULL,
	"scaling_variable" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_loss_estimates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"risk_scenario_id" uuid NOT NULL,
	"loss_driver_id" uuid NOT NULL,
	"min_value" double precision,
	"likely_value" double precision,
	"max_value" double precision,
	"provenance" text DEFAULT 'manual' NOT NULL,
	"model_version" text,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"is_posture" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_loss_estimates_risk_scenario_id_loss_driver_id_unique" UNIQUE("risk_scenario_id","loss_driver_id")
);
--> statement-breakpoint
CREATE TABLE "financial_profile_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"field" text NOT NULL,
	"user_id" uuid,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"loaded_daily_labour_cost" double precision,
	"annual_revenue" double precision,
	"gross_margin_pct" double precision,
	"operating_days_band" text,
	"seasonal_peak_pct" double precision,
	"it_dependent_revenue_pct" double precision,
	"time_to_revenue_impact_band" text,
	"full_restore_band" text,
	"revenue_recapture_band" text,
	"restore_test_recency" text,
	"records_held_gate" boolean,
	"individuals_band" text,
	"card_transactions_band" text,
	"sensitive_records_band" text,
	"largest_repository_band" text,
	"regulatory_regime" text,
	"customer_count_band" text,
	"b2c_revenue_pct" double precision,
	"recurring_revenue_pct" double precision,
	"contracted_revenue_band" text,
	"contractual_liability_cap_band" text,
	"payment_flow_daily_value_band" text,
	"out_of_band_verification_gate" boolean,
	"out_of_band_threshold" double precision,
	"rd_ip_value_band" text,
	"ransom_payment_posture" boolean,
	"ransom_payment_ceiling" double precision,
	"worst_outage_band" text,
	"costliest_incident_band" text,
	"coefficient_set_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_profiles_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "declared_estate" (
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"low" integer NOT NULL,
	"high" integer NOT NULL,
	"internet_facing" boolean,
	"set_by_user_id" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declared_estate_pk" PRIMARY KEY("organization_id","kind"),
	CONSTRAINT "declared_estate_bounds_ck" CHECK (0 <= "declared_estate"."low" AND "declared_estate"."low" <= "declared_estate"."high")
);
--> statement-breakpoint
CREATE TABLE "declared_estate_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"old_low" integer,
	"old_high" integer,
	"old_internet_facing" boolean,
	"new_low" integer,
	"new_high" integer,
	"new_internet_facing" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attack_surface_mitre_techniques" (
	"attack_surface_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	CONSTRAINT "attack_surface_mitre_tech_pk" PRIMARY KEY("attack_surface_id","mitre_technique_id")
);
--> statement-breakpoint
CREATE TABLE "attack_surfaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attack_surfaces_tenant_category_uq" UNIQUE("tenant_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "mitre_mitigation_techniques" (
	"mitigation_id" uuid NOT NULL,
	"technique_id" uuid NOT NULL,
	CONSTRAINT "mitre_mitigation_techniques_mitigation_id_technique_id_pk" PRIMARY KEY("mitigation_id","technique_id")
);
--> statement-breakpoint
CREATE TABLE "mitre_mitigations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text,
	CONSTRAINT "mitre_mitigations_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "mitre_tactics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text,
	"order" integer NOT NULL,
	CONSTRAINT "mitre_tactics_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "mitre_technique_tactics" (
	"technique_id" uuid NOT NULL,
	"tactic_id" uuid NOT NULL,
	CONSTRAINT "mitre_technique_tactics_technique_id_tactic_id_pk" PRIMARY KEY("technique_id","tactic_id")
);
--> statement-breakpoint
CREATE TABLE "mitre_techniques" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"url" text,
	"parent_technique_id" uuid,
	"is_subtechnique" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"replaced_by_technique_id" uuid,
	CONSTRAINT "mitre_techniques_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "control_capabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"domain" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "control_capabilities_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "control_capability_assessment_event_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"source" text NOT NULL,
	"compliance_assessment_id" uuid,
	"compliance_assessment_name" text,
	"compliance_assessment_name_folded" text GENERATED ALWAYS AS (fold_text(compliance_assessment_name)) STORED,
	CONSTRAINT "control_capability_assessment_event_sources_assessment_ck" CHECK (("control_capability_assessment_event_sources"."compliance_assessment_id" IS NULL) = ("control_capability_assessment_event_sources"."compliance_assessment_name" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "control_capability_assessment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"capability_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"connector" text,
	"type" text NOT NULL,
	"old_strength" text,
	"new_strength" text,
	"old_coverage" text,
	"new_coverage" text,
	"strength_mode" text,
	"coverage_mode" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_capability_assessment_events_id_tenant_uniq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "control_capability_assessment_sources" (
	"assessment_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "control_capability_assessment_sources_pk" PRIMARY KEY("assessment_id","axis","source")
);
--> statement-breakpoint
CREATE TABLE "control_capability_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"capability_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"strength_rung" text DEFAULT 'L0' NOT NULL,
	"coverage_bucket" text DEFAULT 'L0' NOT NULL,
	"strength_mode" text DEFAULT 'manual' NOT NULL,
	"coverage_mode" text DEFAULT 'manual' NOT NULL,
	"coverage_basis" text DEFAULT 'declared' NOT NULL,
	"comment" text,
	CONSTRAINT "control_capability_assessments_capability_tenant_uniq" UNIQUE("capability_id","tenant_id"),
	CONSTRAINT "control_capability_assessments_id_tenant_uniq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "control_capability_crosswalk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"capability_id" uuid NOT NULL,
	"framework" text NOT NULL,
	"external_id" text NOT NULL,
	CONSTRAINT "control_capability_crosswalk_uniq" UNIQUE("capability_id","framework","external_id")
);
--> statement-breakpoint
CREATE TABLE "control_capability_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"capability_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"technique_external_id" text NOT NULL,
	"function" text NOT NULL,
	CONSTRAINT "control_capability_edges_capability_technique_function_uniq" UNIQUE("capability_id","mitre_technique_id","function")
);
--> statement-breakpoint
CREATE TABLE "control_capability_protected_families" (
	"capability_id" uuid NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "control_capability_protected_families_pk" PRIMARY KEY("capability_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "control_capability_scope_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"strength_rung" text,
	"coverage_bucket" text,
	"comment" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_capability_scope_overrides_scope_capability_uniq" UNIQUE("organization_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "control_capability_strength_rung_labels" (
	"capability_id" uuid NOT NULL,
	"rung" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "control_capability_strength_rung_labels_capability_id_rung_pk" PRIMARY KEY("capability_id","rung")
);
--> statement-breakpoint
CREATE TABLE "control_capability_technique_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"function" text NOT NULL,
	CONSTRAINT "control_capability_technique_overrides_uniq" UNIQUE("tenant_id","capability_id","mitre_technique_id","function")
);
--> statement-breakpoint
CREATE TABLE "security_platform_families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"platform_type_key" text NOT NULL,
	CONSTRAINT "security_platform_families_platform_type_key_unique" UNIQUE("platform_type_key")
);
--> statement-breakpoint
CREATE TABLE "security_platform_family_controls" (
	"family_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	CONSTRAINT "security_platform_family_controls_pk" PRIMARY KEY("family_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "primary_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"owner_id" uuid,
	"reference" text,
	"business_function" text,
	"availability" text,
	"integrity" text,
	"confidentiality" text,
	"traceability" text,
	"rto_minutes" integer,
	"rpo_minutes" integer,
	"mtpd_minutes" integer,
	CONSTRAINT "primary_assets_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "primary_assets_availability_ck" CHECK ("primary_assets"."availability" IN ('low', 'medium', 'high', 'very_high')),
	CONSTRAINT "primary_assets_integrity_ck" CHECK ("primary_assets"."integrity" IN ('low', 'medium', 'high', 'very_high')),
	CONSTRAINT "primary_assets_confidentiality_ck" CHECK ("primary_assets"."confidentiality" IN ('low', 'medium', 'high', 'very_high')),
	CONSTRAINT "primary_assets_traceability_ck" CHECK ("primary_assets"."traceability" IN ('low', 'medium', 'high', 'very_high')),
	CONSTRAINT "primary_assets_durations_ck" CHECK ("primary_assets"."rto_minutes" >= 0 AND "primary_assets"."rpo_minutes" >= 0 AND "primary_assets"."mtpd_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_enumerations" (
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_enumerations_connector_id_supporting_asset_id_scope_pk" PRIMARY KEY("connector_id","supporting_asset_id","scope")
);
--> statement-breakpoint
CREATE TABLE "asset_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_id" uuid,
	"mitre_technique_id" uuid,
	"expectation_type" text,
	"security_platform_type" text,
	"evaluated_at" timestamp with time zone,
	"source_scenario_id" text,
	"source_scenario_name" text,
	"source_simulation_id" text,
	"source_inject_id" text,
	"user_id" uuid,
	"current_state" text DEFAULT 'applicable' NOT NULL,
	"current_state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"latest_verdict_exposed" boolean,
	"latest_verdict_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_evidence_uq" UNIQUE NULLS NOT DISTINCT("supporting_asset_id","cve_id","mitre_technique_id","expectation_type","security_platform_type","source_scenario_id"),
	CONSTRAINT "asset_evidence_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "asset_evidence_fk_exclusive_chk" CHECK (("asset_evidence"."cve_id" IS NOT NULL AND "asset_evidence"."mitre_technique_id" IS NULL AND "asset_evidence"."expectation_type" IS NULL) OR ("asset_evidence"."cve_id" IS NULL AND "asset_evidence"."mitre_technique_id" IS NOT NULL AND "asset_evidence"."expectation_type" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "asset_evidence_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_evidence_id" uuid NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone,
	"state" text NOT NULL,
	"reason" text,
	"dismissal_type" text,
	"dismissal_reason_code" text,
	"changed_by_user_id" uuid,
	"origin" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_evidence_source_software" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_evidence_source_id" uuid NOT NULL,
	"vendor" text,
	"name" text NOT NULL,
	"version" text NOT NULL,
	CONSTRAINT "asset_evidence_source_software_uq" UNIQUE NULLS NOT DISTINCT("asset_evidence_source_id","vendor","name","version")
);
--> statement-breakpoint
CREATE TABLE "asset_evidence_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_evidence_id" uuid NOT NULL,
	"connector_id" uuid,
	"source_finding_id" text,
	"scope" text DEFAULT '' NOT NULL,
	"is_exposed" boolean DEFAULT true NOT NULL,
	"reason" text,
	"external_reference" text,
	"reported_severity" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_evidence_sources_uq" UNIQUE NULLS NOT DISTINCT("asset_evidence_id","connector_id","source_finding_id"),
	CONSTRAINT "asset_evidence_sources_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "asset_evidence_verdicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_evidence_id" uuid NOT NULL,
	"connector_id" uuid,
	"source_finding_id" text,
	"is_exposed" boolean NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_group_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_group_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"source" text NOT NULL,
	"connector_id" uuid,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_group_members_group_asset_author_uq" UNIQUE NULLS NOT DISTINCT("asset_group_id","supporting_asset_id","source","connector_id"),
	CONSTRAINT "asset_group_members_source_ck" CHECK ("asset_group_members"."source" IN ('manual', 'connector', 'xtm_one')),
	CONSTRAINT "asset_group_members_connector_ck" CHECK (("asset_group_members"."source" = 'connector') = ("asset_group_members"."connector_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "asset_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"external_reference" text,
	"connector_id" uuid,
	"source_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_groups_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "asset_groups_tenant_connector_source_uq" UNIQUE("tenant_id","connector_id","source_group_id")
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_ai_target_properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporting_asset_source_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text,
	"endpoint_url" text,
	"normalized_endpoint_url" text,
	"model" text,
	"modality" text,
	"system_prompt" text,
	CONSTRAINT "supporting_asset_ai_target_properties_source_unique" UNIQUE("supporting_asset_source_id")
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_criticality_lifts" (
	"supporting_asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"criticality" text NOT NULL,
	"from_asset_id" uuid,
	CONSTRAINT "supporting_asset_criticality_lifts_pk" PRIMARY KEY("tenant_id","supporting_asset_id")
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_identity_properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporting_asset_source_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"directory_object_id" text,
	"cloud_sid" text,
	"on_prem_sid" text,
	"user_principal_name" text,
	"account_domain" text,
	"account_name" text,
	"directory_type" text,
	"identity_provider" text,
	"department" text,
	"job_title" text,
	"is_enabled" boolean,
	"assigned_roles" text[],
	"privileged_pim_roles" text[],
	CONSTRAINT "supporting_asset_identity_properties_source_unique" UNIQUE("supporting_asset_source_id")
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_machine_properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporting_asset_source_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hostname" text,
	"ip_addresses" text[],
	"mac_addresses" text[],
	"seen_ip" text,
	"hardware_uuid" text,
	"directory_device_id" text,
	"cloud_vm_id" text,
	"cloud_resource_id" text,
	"cloud_provider" text,
	"cloud_native_type" text,
	"cloud_region" text,
	"platform" text,
	"arch" text,
	"vendor" text,
	"model" text,
	"operating_system" text,
	"os_version" text,
	"is_eol" boolean,
	"agent_external_reference" text,
	"agent_executor_type" text,
	CONSTRAINT "supporting_asset_machine_properties_source_unique" UNIQUE("supporting_asset_source_id")
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_manual_values" (
	"supporting_asset_id" uuid NOT NULL,
	"attribute" text NOT NULL,
	"value" text NOT NULL,
	"set_by_user_id" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supporting_asset_manual_values_supporting_asset_id_attribute_pk" PRIMARY KEY("supporting_asset_id","attribute")
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"from_asset_id" uuid NOT NULL,
	"to_asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "supporting_asset_relations_uq" UNIQUE("tenant_id","connector_id","from_asset_id","to_asset_id","kind"),
	CONSTRAINT "supporting_asset_relations_kind_ck" CHECK ("supporting_asset_relations"."kind" IN ('primary_user_of')),
	CONSTRAINT "supporting_asset_relations_source_ck" CHECK ("supporting_asset_relations"."source" IN ('entra_registered_owner', 'intune_primary_user'))
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid,
	"origin" text DEFAULT 'connector' NOT NULL,
	"source_asset_id" text NOT NULL,
	"reported_name" text,
	"reported_category_id" text NOT NULL,
	"reported_subcategory_id" text,
	"reported_description" text,
	"reported_exposure" text DEFAULT 'unknown' NOT NULL,
	"reported_criticality" text DEFAULT 'unknown' NOT NULL,
	"reported_criticality_rule" text,
	"external_reference" text,
	"reported_url" text,
	"reported_linked_person" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supporting_asset_sources_tenant_source_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","connector_id","source_asset_id"),
	CONSTRAINT "supporting_asset_sources_criticality_rule_ck" CHECK ("supporting_asset_sources"."reported_criticality_rule" IN ('domain_controller', 'certificate_services', 'federation_services', 'entra_connect', 'hypervisor', 'backup', 'asset_value_very_high', 'asset_value_high', 'asset_value_low'))
);
--> statement-breakpoint
CREATE TABLE "supporting_asset_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"connector_id" uuid,
	"pushed_by_xtm_one" boolean DEFAULT false NOT NULL,
	CONSTRAINT "supporting_asset_tags_asset_tag_connector_uq" UNIQUE("supporting_asset_id","tag_id","connector_id","pushed_by_xtm_one")
);
--> statement-breakpoint
CREATE TABLE "supporting_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"description" text,
	"owner_id" uuid,
	"owner_source" text,
	"exposure" text DEFAULT 'unknown' NOT NULL,
	"category_id" text NOT NULL,
	"subcategory_id" text,
	"criticality" text DEFAULT 'unknown' NOT NULL,
	"external_reference" text,
	"url" text,
	"linked_person" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"derived_name" text,
	"display_name" text GENERATED ALWAYS AS (coalesce(name, derived_name)) STORED,
	"display_name_folded" text GENERATED ALWAYS AS (fold_text(coalesce(name, derived_name))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supporting_assets_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tag_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"connector_id" uuid,
	"source_tag_id" text,
	"reported_name" text NOT NULL,
	"reported_color" text,
	"pushed_by_xtm_one" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tag_sources_tenant_connector_source_uq" UNIQUE("tenant_id","connector_id","source_tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"merged_into_tag_id" uuid,
	"merged_at" timestamp with time zone,
	CONSTRAINT "tags_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "tags_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "tags_merged_pair_ck" CHECK (("tags"."merged_into_tag_id" IS NULL) = ("tags"."merged_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "primary_asset_reach" (
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"depth" smallint NOT NULL,
	CONSTRAINT "primary_asset_reach_pk" PRIMARY KEY("tenant_id","primary_asset_id","supporting_asset_id"),
	CONSTRAINT "primary_asset_reach_depth_ck" CHECK ("primary_asset_reach"."depth" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "primary_to_primary_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dependent_asset_id" uuid NOT NULL,
	"provider_asset_id" uuid NOT NULL,
	"strength" text DEFAULT 'unknown' NOT NULL,
	CONSTRAINT "primary_to_primary_links_pair_uq" UNIQUE("dependent_asset_id","provider_asset_id"),
	CONSTRAINT "primary_to_primary_links_not_self_ck" CHECK ("primary_to_primary_links"."dependent_asset_id" <> "primary_to_primary_links"."provider_asset_id"),
	CONSTRAINT "primary_to_primary_links_strength_known_ck" CHECK ("primary_to_primary_links"."strength" IN ('critical', 'important', 'minor', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "support_to_primary_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	"roles" text[] DEFAULT '{unknown}' NOT NULL,
	CONSTRAINT "support_to_primary_links_pair_uq" UNIQUE("supporting_asset_id","primary_asset_id"),
	CONSTRAINT "support_to_primary_links_roles_known_ck" CHECK ("support_to_primary_links"."roles" <@ ARRAY['stores', 'processes', 'reads', 'transmits', 'administers', 'monitors', 'supports_availability', 'performs', 'unknown']::text[]),
	CONSTRAINT "support_to_primary_links_roles_not_empty_ck" CHECK (cardinality("support_to_primary_links"."roles") > 0),
	CONSTRAINT "support_to_primary_links_roles_unknown_alone_ck" CHECK (NOT ('unknown' = ANY("support_to_primary_links"."roles")) OR cardinality("support_to_primary_links"."roles") = 1)
);
--> statement-breakpoint
CREATE TABLE "support_to_support_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_asset_id" uuid NOT NULL,
	"dependent_asset_id" uuid NOT NULL,
	CONSTRAINT "support_to_support_links_pair_uq" UNIQUE("provider_asset_id","dependent_asset_id")
);
--> statement-breakpoint
CREATE TABLE "threat_relevance_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"act_half_life_observed_days" integer DEFAULT 180 NOT NULL,
	"act_half_life_authored_days" integer DEFAULT 365 NOT NULL,
	"confidence_gate" integer DEFAULT 60 NOT NULL,
	"unknown_activity_age_days" integer DEFAULT 365 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"iterations" integer DEFAULT 1000 NOT NULL,
	"exposure_weight_internet_facing" double precision DEFAULT 1 NOT NULL,
	"exposure_weight_internal" double precision DEFAULT 0.4 NOT NULL,
	"susceptibility_gamma" double precision DEFAULT 0.7 NOT NULL,
	"measured_validity_days" integer,
	"unknown_criticality_counts_as" text DEFAULT 'low' NOT NULL,
	"unknown_exposure_counts_as" text DEFAULT 'internal' NOT NULL,
	"phishing_failure_rate" double precision,
	"phishing_failure_measured_on" date,
	CONSTRAINT "crq_indicator_settings_phishing_failure_rate_ck" CHECK ("crq_indicator_settings"."phishing_failure_rate" BETWEEN 0 AND 1),
	CONSTRAINT "crq_indicator_settings_phishing_failure_pair_ck" CHECK (("crq_indicator_settings"."phishing_failure_rate" IS NULL) = ("crq_indicator_settings"."phishing_failure_measured_on" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "dashboard_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"home_dashboard_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crq_budget_review_annual_losses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"review_version" integer NOT NULL,
	"posture" text NOT NULL,
	"years" integer NOT NULL,
	"mean" double precision NOT NULL,
	"loss_year_share" double precision NOT NULL,
	"loss_event_year_share" double precision NOT NULL,
	"probabilities" double precision[] NOT NULL,
	"losses" double precision[] NOT NULL,
	CONSTRAINT "crq_budget_review_annual_losses_run_posture_uniq" UNIQUE("run_id","review_id","posture"),
	CONSTRAINT "crq_budget_review_annual_losses_posture_ck" CHECK ("crq_budget_review_annual_losses"."posture" IN ('reference', 'without-build'))
);
--> statement-breakpoint
CREATE TABLE "crq_budget_review_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"review_version" integer NOT NULL,
	"basket" text NOT NULL,
	"line_id" uuid,
	"step_on" date,
	"ale_reduction_mean" double precision,
	"ale_reduction_p10" double precision,
	"ale_reduction_p90" double precision,
	CONSTRAINT "crq_budget_review_results_run_basket_uniq" UNIQUE NULLS NOT DISTINCT("run_id","review_id","basket","line_id","step_on")
);
--> statement-breakpoint
CREATE TABLE "crq_control_what_if_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"control_kind" text NOT NULL,
	"dimension" text NOT NULL,
	"current_strength" text NOT NULL,
	"upgraded_strength" text NOT NULL,
	"current_coverage" text NOT NULL,
	"upgraded_coverage" text NOT NULL,
	"ale_reduction_mean" double precision,
	"ale_reduction_p10" double precision,
	"ale_reduction_p90" double precision,
	"zero_reason" text
);
--> statement-breakpoint
CREATE TABLE "crq_cve_what_if_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"ale_reduction_mean" double precision,
	"ale_reduction_p10" double precision,
	"ale_reduction_p90" double precision
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_group_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"group_key" uuid,
	"group_name" text,
	"group_entity_type" text,
	"share" double precision NOT NULL,
	"vulnerability_p5" double precision NOT NULL,
	"vulnerability_p50" double precision NOT NULL,
	"vulnerability_p95" double precision NOT NULL,
	"vulnerability_mean" double precision NOT NULL,
	"actor_class" text,
	"ale_mean" double precision,
	"attack_run_days" integer,
	"reaction_time_exceeded_share" double precision
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_run_annual_losses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"years" integer NOT NULL,
	"mean" double precision NOT NULL,
	"loss_year_share" double precision NOT NULL,
	"loss_event_year_share" double precision NOT NULL,
	"probabilities" double precision[] NOT NULL,
	"losses" double precision[] NOT NULL,
	CONSTRAINT "crq_indicator_run_annual_losses_run_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_run_reach_gaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"family" text NOT NULL,
	"gap" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_run_unplayable_obstacles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"group_key" uuid,
	"obstacle_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"risk_scenario_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid,
	"read_at" timestamp with time zone,
	"inputs_fingerprint" text,
	"iterations" integer NOT NULL,
	"vulnerability_p5" double precision NOT NULL,
	"vulnerability_p50" double precision NOT NULL,
	"vulnerability_p95" double precision NOT NULL,
	"vulnerability_mean" double precision,
	"tef_min" double precision,
	"tef_likely" double precision,
	"tef_max" double precision,
	"lef_mean" double precision,
	"lef_p10" double precision,
	"lef_p90" double precision,
	"ale_mean" double precision,
	"ale_p10" double precision,
	"ale_p90" double precision,
	"magnitude_mean" double precision,
	"magnitude_p10" double precision,
	"magnitude_p90" double precision,
	"technique_count" integer NOT NULL,
	"covered_technique_count" integer NOT NULL,
	"threat_evidence_mode" text,
	"admitted_actor_count" integer,
	"outcome_blocked" double precision,
	"outcome_evicted" double precision,
	"outcome_impact_detected" double precision,
	"outcome_impact_undetected" double precision,
	"path_share_stopped_at_initial_access" double precision,
	"path_share_direct" double precision,
	"path_share_long" double precision,
	"path_share_without_initial_access" double precision,
	"no_target" boolean,
	"calibration_vintage" text,
	"corner_constants" text[],
	"catalogue_vintage" text,
	"unscanned_asset_share" double precision,
	"unscanned_asset_count" integer,
	"estate_asset_count" integer,
	"declared_asset_count" integer,
	"declared_asset_share" double precision,
	"estate_mode" text,
	"boost_applied" double precision,
	"uncontested_pair_count" integer,
	"uncontestable_pair_count" integer,
	"ale_at_memoryless_detection" double precision,
	"profile" text[] DEFAULT '{techniques,levers,plans}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crq_indicator_tef_inputs" (
	"risk_scenario_id" uuid PRIMARY KEY NOT NULL,
	"min" double precision NOT NULL,
	"likely" double precision NOT NULL,
	"max" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crq_plan_what_if_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_scope_version" integer NOT NULL,
	"ale_reduction_mean" double precision,
	"ale_reduction_p10" double precision,
	"ale_reduction_p90" double precision,
	CONSTRAINT "crq_plan_what_if_results_run_plan_uniq" UNIQUE("run_id","plan_id")
);
--> statement-breakpoint
CREATE TABLE "crq_technique_what_if_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"prevent_value_mean" double precision,
	"detect_value_mean" double precision
);
--> statement-breakpoint
CREATE TABLE "tef_estimate_contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tef_estimate_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"multiplier" double precision
);
--> statement-breakpoint
CREATE TABLE "tef_estimates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"risk_scenario_id" uuid NOT NULL,
	"catalog_vintage" integer NOT NULL,
	"min" double precision NOT NULL,
	"likely" double precision NOT NULL,
	"max" double precision NOT NULL,
	"positioned" boolean NOT NULL,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_errors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"retryable" boolean NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"max_runtime_ms" integer DEFAULT 900000 NOT NULL,
	"bounded" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"triggered_by_id" text,
	"interactive" boolean DEFAULT false NOT NULL,
	"absorbed_ask" boolean DEFAULT false NOT NULL,
	"absorbed_ask_interactive" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"leased_until" timestamp with time zone,
	"abort_requested_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"error_message_folded" text GENERATED ALWAYS AS (fold_text(error_message)) STORED,
	"state_snapshot" jsonb,
	"processed_total" integer DEFAULT 0 NOT NULL,
	"expected_total" integer,
	"progress_message" text,
	"progress_message_folded" text GENERATED ALWAYS AS (fold_text(progress_message)) STORED,
	CONSTRAINT "jobs_absorbed_ask_interactive_ck" CHECK (absorbed_ask OR NOT absorbed_ask_interactive)
);
--> statement-breakpoint
CREATE TABLE "job_dependencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_kind" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"access" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cadence" text NOT NULL,
	"at_minute" integer,
	"weekday" integer,
	"time_zone" text,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_schedules_cadence_ck" CHECK (cadence IN ('manual', 'hourly', 'every_6_hours', 'every_12_hours', 'daily', 'weekly')),
	CONSTRAINT "job_schedules_at_minute_ck" CHECK ((at_minute IS NOT NULL) = (cadence IN ('daily', 'weekly')) AND (at_minute IS NULL OR at_minute BETWEEN 0 AND 1439)),
	CONSTRAINT "job_schedules_weekday_ck" CHECK ((weekday IS NOT NULL) = (cadence = 'weekly') AND (weekday IS NULL OR weekday BETWEEN 0 AND 6)),
	CONSTRAINT "job_schedules_time_zone_ck" CHECK ((time_zone IS NOT NULL) = (cadence IN ('daily', 'weekly'))),
	CONSTRAINT "job_schedules_next_run_ck" CHECK ((next_run_at IS NULL) = (cadence = 'manual'))
);
--> statement-breakpoint
CREATE TABLE "cve" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_id" text NOT NULL,
	"cvss" double precision,
	"cvss_vector" text,
	"cvss_v2_user_interaction_required" boolean,
	"cvss_updated_at" timestamp with time zone,
	"epss" double precision,
	"epss_updated_at" timestamp with time zone,
	"kev" boolean,
	"kev_updated_at" timestamp with time zone,
	"kev_required_action" text,
	"kev_due_date" timestamp with time zone,
	"kev_notes" text,
	"kev_ransomware_use" text,
	"vendor_solution" text,
	"cve_title" text,
	"cve_title_folded" text GENERATED ALWAYS AS (fold_text(cve_title)) STORED,
	"cve_description" text,
	"cwe" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cve_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "cve_affected_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"vendor" text,
	"product" text,
	"affected_from" text,
	"affected_up_to" text NOT NULL,
	"affected_up_to_included" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cve_affected_versions_cveid_product_bound_uq" UNIQUE NULLS NOT DISTINCT("cve_id","vendor","product","affected_up_to")
);
--> statement-breakpoint
CREATE TABLE "cve_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source" text,
	"tags" text[]
);
--> statement-breakpoint
CREATE TABLE "cve_source_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"source" text NOT NULL,
	"cvss" double precision,
	"cvss_vector" text,
	"cvss_version" text,
	"cvss_v2_user_interaction_required" boolean,
	"cvss_updated_at" timestamp with time zone,
	"cwe" text[],
	"title" text,
	"description" text,
	"published_at" timestamp with time zone,
	"last_modified_at" timestamp with time zone,
	"epss" double precision,
	"epss_updated_at" timestamp with time zone,
	"kev" boolean,
	"kev_updated_at" timestamp with time zone,
	"kev_required_action" text,
	"kev_due_date" timestamp with time zone,
	"kev_notes" text,
	"kev_ransomware_use" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cve_source_observations_cve_source_uq" UNIQUE("cve_id","source"),
	CONSTRAINT "cve_source_observations_source_ck" CHECK ("cve_source_observations"."source" IN ('nvd', 'first', 'cisa_kev', 'microsoft_defender'))
);
--> statement-breakpoint
CREATE TABLE "cwe_technique_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cwe_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"technique_external_id" text NOT NULL,
	"justification_kind" text NOT NULL,
	"justification_ref" text NOT NULL,
	"justification_name" text,
	CONSTRAINT "cwe_technique_links_uniq" UNIQUE("cwe_id","mitre_technique_id","justification_kind","justification_ref")
);
--> statement-breakpoint
CREATE TABLE "cwe_technique_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cwe_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "cwe_technique_overrides_uniq" UNIQUE("tenant_id","cwe_id","mitre_technique_id")
);
--> statement-breakpoint
CREATE TABLE "cwe_weaknesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "cwe_weaknesses_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "cve_technique_mapping" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resolution_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"role" text NOT NULL,
	"lane" text NOT NULL,
	"grain" text NOT NULL,
	"tables_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cve_technique_resolution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"state" text NOT NULL,
	"tables_version" text NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"service_account_id" uuid,
	"last_reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_account_groups" (
	"service_account_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "service_account_groups_service_account_id_group_id_pk" PRIMARY KEY("service_account_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_account_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_account_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_account_tokens_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "platform_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" uuid NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_by_service_account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "threat_activity_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stix_relation_id" text NOT NULL,
	"observed_at" timestamp with time zone,
	"authored_at" timestamp with time zone,
	"confidence" integer,
	"producer_stix_id" text,
	CONSTRAINT "threat_activity_anchors_analysis_relation_unique" UNIQUE("analysis_id","stix_relation_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"entity_type" text DEFAULT 'intrusion-set' NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"mitre_group_id" text,
	"confidence" integer,
	"stix_created" timestamp with time zone,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"primary_motivation" text,
	"resource_level" text,
	"sophistication" text,
	"objective" text,
	"actor_class" text DEFAULT 'default' NOT NULL,
	"actor_class_override" text,
	"outcome_model_version" text,
	"outcome_evidence_sufficient" boolean DEFAULT false NOT NULL,
	"outcome_judged_at" timestamp with time zone,
	"last_observed_at" timestamp with time zone,
	"last_observed_via_analysis_id" uuid,
	"last_authored_at" timestamp with time zone,
	"activity_score" double precision,
	"activity_computed_at" timestamp with time zone,
	"activity_gate" integer,
	"first_ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threat_analyses_tenant_stix_unique" UNIQUE("tenant_id","stix_id"),
	CONSTRAINT "threat_analyses_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "threat_analyses_entity_type_ck" CHECK ("threat_analyses"."entity_type" IN ('intrusion-set', 'threat-actor', 'campaign'))
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_attributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"stix_relation_id" text NOT NULL,
	"target_stix_id" text NOT NULL,
	"producer_stix_id" text,
	"producer_name" text,
	"is_inferred" boolean DEFAULT false NOT NULL,
	"rel_created" timestamp with time zone,
	"rel_start_time" timestamp with time zone,
	"rel_stop_time" timestamp with time zone,
	"rel_modified" timestamp with time zone,
	"rel_confidence" integer,
	CONSTRAINT "threat_analysis_attributions_analysis_relation_unique" UNIQUE("analysis_id","stix_relation_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_counts" (
	"analysis_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cve_count" integer NOT NULL,
	"technique_count" integer NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"confidence_gate" integer NOT NULL,
	"projection_version" text NOT NULL,
	"catalogue_fingerprint" text NOT NULL,
	CONSTRAINT "threat_analysis_counts_tenant_id_analysis_id_pk" PRIMARY KEY("tenant_id","analysis_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_cves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"stix_relation_id" text NOT NULL,
	"cve_id" text NOT NULL,
	"producer_stix_id" text,
	"producer_name" text,
	"is_inferred" boolean DEFAULT false NOT NULL,
	"rel_created" timestamp with time zone,
	"rel_start_time" timestamp with time zone,
	"rel_stop_time" timestamp with time zone,
	"rel_modified" timestamp with time zone,
	"rel_confidence" integer,
	CONSTRAINT "threat_analysis_cves_analysis_relation_unique" UNIQUE("analysis_id","stix_relation_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"stix_relation_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"producer_stix_id" text,
	"producer_name" text,
	"is_inferred" boolean DEFAULT false NOT NULL,
	"rel_created" timestamp with time zone,
	"rel_start_time" timestamp with time zone,
	"rel_stop_time" timestamp with time zone,
	"rel_modified" timestamp with time zone,
	"rel_confidence" integer,
	CONSTRAINT "threat_analysis_locations_analysis_relation_unique" UNIQUE("analysis_id","stix_relation_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_outcome_probabilities" (
	"analysis_id" uuid NOT NULL,
	"attack_outcome_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"probability" double precision NOT NULL,
	"judged" boolean DEFAULT false NOT NULL,
	CONSTRAINT "threat_analysis_outcome_probabilities_pk" PRIMARY KEY("tenant_id","analysis_id","attack_outcome_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_secondary_motives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_sectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"stix_relation_id" text NOT NULL,
	"name" text NOT NULL,
	"producer_stix_id" text,
	"producer_name" text,
	"is_inferred" boolean DEFAULT false NOT NULL,
	"rel_created" timestamp with time zone,
	"rel_start_time" timestamp with time zone,
	"rel_stop_time" timestamp with time zone,
	"rel_modified" timestamp with time zone,
	"rel_confidence" integer,
	CONSTRAINT "threat_analysis_sectors_analysis_relation_unique" UNIQUE("analysis_id","stix_relation_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_techniques" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"stix_relation_id" text NOT NULL,
	"name" text NOT NULL,
	"mitre_external_id" text NOT NULL,
	"parent_external_id" text GENERATED ALWAYS AS (split_part(mitre_external_id, '.', 1)) STORED,
	"producer_stix_id" text,
	"producer_name" text,
	"is_inferred" boolean DEFAULT false NOT NULL,
	"rel_created" timestamp with time zone,
	"rel_start_time" timestamp with time zone,
	"rel_stop_time" timestamp with time zone,
	"rel_modified" timestamp with time zone,
	"rel_confidence" integer,
	CONSTRAINT "threat_analysis_techniques_analysis_relation_unique" UNIQUE("analysis_id","stix_relation_id")
);
--> statement-breakpoint
CREATE TABLE "threat_analysis_threat_actor_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_id" uuid NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_outcome_counter_versions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"dispatched_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_outcome_scores" (
	"analysis_id" uuid NOT NULL,
	"attack_outcome_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"is_top" boolean NOT NULL,
	CONSTRAINT "threat_outcome_scores_tenant_id_analysis_id_attack_outcome_id_pk" PRIMARY KEY("tenant_id","analysis_id","attack_outcome_id")
);
--> statement-breakpoint
CREATE TABLE "opencti_connector_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_account_id" uuid,
	"stream_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"cursor" text,
	"last_event_at" timestamp with time zone,
	"history_start_at" timestamp with time zone,
	"backfill_target_at" timestamp with time zone,
	"reached_live_tail_at" timestamp with time zone,
	"stream_generation" integer DEFAULT 0 NOT NULL,
	"objects_read" bigint DEFAULT 0 NOT NULL,
	"objects_read_at" timestamp with time zone,
	"auth_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opencti_stream_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"stix_type" text NOT NULL,
	"source_ref" text,
	"target_ref" text,
	"relationship_type" text,
	"created_by_ref" text,
	"data" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"pending" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opencti_stream_report_refs" (
	"tenant_id" uuid NOT NULL,
	"report_stix_id" text NOT NULL,
	"threat_stix_id" text NOT NULL,
	CONSTRAINT "opencti_stream_report_refs_pk" PRIMARY KEY("tenant_id","report_stix_id","threat_stix_id")
);
--> statement-breakpoint
CREATE TABLE "default_threats_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"etag" text,
	"last_modified" text,
	"app_version" text,
	"attack_release" text,
	"loaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openaev_assets" (
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"source_asset_id" text NOT NULL,
	"openaev_tenant_id" text NOT NULL,
	"needs_description_fetch" boolean NOT NULL,
	"description_fetched_at" timestamp with time zone,
	CONSTRAINT "openaev_assets_pk" PRIMARY KEY("connector_id","source_asset_id")
);
--> statement-breakpoint
CREATE TABLE "openaev_attack_observations" (
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"openaev_tenant_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"source_asset_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"attack_pattern_external_id" text NOT NULL,
	"expectation_type" text NOT NULL,
	"simulation_start_date" timestamp with time zone,
	"simulation_status" text NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	"evidence_written_at" timestamp with time zone,
	"evidence_platform_types" text[],
	CONSTRAINT "openaev_attack_observations_pk" PRIMARY KEY("connector_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "openaev_sync_streams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"openaev_tenant_id" text NOT NULL,
	"stream" text NOT NULL,
	"cursor" text,
	"full_walk_started_at" timestamp with time zone,
	"last_full_walk_completed_at" timestamp with time zone,
	"last_full_walk_attempted_at" timestamp with time zone,
	"unreconciled_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drata_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"drata_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_ready" boolean DEFAULT false NOT NULL,
	"is_monitored" boolean DEFAULT false NOT NULL,
	"has_evidence" boolean DEFAULT false NOT NULL,
	"has_policy" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drata_frameworks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"drata_id" integer NOT NULL,
	"slug" text NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"is_ready" boolean DEFAULT false NOT NULL,
	"num_in_scope_requirements" integer DEFAULT 0 NOT NULL,
	"num_ready_in_scope_requirements" integer DEFAULT 0 NOT NULL,
	"num_in_scope_controls" integer DEFAULT 0 NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drata_requirement_controls" (
	"requirement_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "drata_requirement_controls_requirement_id_control_id_pk" PRIMARY KEY("requirement_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "drata_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"framework_id" uuid NOT NULL,
	"drata_id" integer NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_in_scope" boolean DEFAULT true NOT NULL,
	"is_ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"process_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid,
	"scope_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_posture_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"score" integer,
	"changed_at" timestamp with time zone NOT NULL,
	"worst_asset_evidence_id" uuid,
	"worst_exploitability" integer,
	"critical_count" integer,
	"high_count" integer,
	"medium_count" integer,
	"low_count" integer
);
--> statement-breakpoint
CREATE TABLE "asset_postures" (
	"supporting_asset_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"score" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_technique_scores" (
	"tenant_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"asset_evidence_id" uuid NOT NULL,
	CONSTRAINT "asset_technique_scores_tenant_id_supporting_asset_id_mitre_technique_id_pk" PRIMARY KEY("tenant_id","supporting_asset_id","mitre_technique_id")
);
--> statement-breakpoint
CREATE TABLE "finding_metric_daily" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "finding_metric_daily_tenant_id_day_metric_pk" PRIMARY KEY("tenant_id","day","metric")
);
--> statement-breakpoint
CREATE TABLE "finding_score_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_evidence_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"score" double precision,
	"band" text,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_scores" (
	"asset_evidence_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"score" double precision,
	"band" text,
	"exploitability" double precision,
	"impact" double precision,
	"potential_impact" double precision,
	"exploitation_let_through" double precision,
	"impact_let_through" double precision,
	"reachability" double precision,
	"threat" double precision,
	"weakest_technique_id" uuid,
	"score_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unique_finding_score_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid,
	"cve_id" uuid NOT NULL,
	"score" double precision,
	"band" text,
	"worst_score" double precision,
	"affected_asset_count" integer,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unique_finding_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid,
	"cve_id" uuid,
	"mitre_technique_id" uuid,
	"expectation_type" text,
	"score" double precision,
	"band" text,
	"worst_score" double precision,
	"affected_asset_count" integer NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "unique_finding_scores_group_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","organization_id","cve_id","mitre_technique_id","expectation_type")
);
--> statement-breakpoint
CREATE TABLE "control_proven_posture_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"organization_id" uuid,
	"function" text NOT NULL,
	"credited" integer NOT NULL,
	"tested" integer NOT NULL,
	"held" integer NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"replayed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_technique_test_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"organization_id" uuid,
	"function" text NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"grain" text NOT NULL,
	"rate" double precision NOT NULL,
	"tests" integer NOT NULL,
	"held_tests" integer NOT NULL,
	"hosts_tested" integer NOT NULL,
	"scope_hosts" integer NOT NULL,
	"booked_rate" double precision,
	"booked_hosts_tested" integer,
	"booked_scope_hosts" integer,
	CONSTRAINT "control_technique_test_results_cell_uq" UNIQUE NULLS NOT DISTINCT("capability_id","tenant_id","organization_id","function","mitre_technique_id"),
	CONSTRAINT "control_technique_test_results_grain_ck" CHECK ("control_technique_test_results"."grain" IN ('technique', 'sub_technique')),
	CONSTRAINT "control_technique_test_results_booked_grain_ck" CHECK ("control_technique_test_results"."grain" = 'technique' OR "control_technique_test_results"."booked_rate" IS NULL),
	CONSTRAINT "control_technique_test_results_rate_ck" CHECK ("control_technique_test_results"."rate" BETWEEN 0 AND 1),
	CONSTRAINT "control_technique_test_results_tests_ck" CHECK ("control_technique_test_results"."held_tests" BETWEEN 0 AND "control_technique_test_results"."tests" AND "control_technique_test_results"."hosts_tested" <= "control_technique_test_results"."tests"),
	CONSTRAINT "control_technique_test_results_hosts_ck" CHECK ("control_technique_test_results"."hosts_tested" > 0 AND "control_technique_test_results"."hosts_tested" <= "control_technique_test_results"."scope_hosts")
);
--> statement-breakpoint
CREATE TABLE "entry_openings" (
	"tenant_id" uuid NOT NULL,
	"asset_evidence_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"mitre_technique_id" uuid NOT NULL,
	"cve_id" uuid NOT NULL,
	"opening" double precision NOT NULL,
	"threat" double precision NOT NULL,
	CONSTRAINT "entry_openings_tenant_id_asset_evidence_id_mitre_technique_id_pk" PRIMARY KEY("tenant_id","asset_evidence_id","mitre_technique_id")
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"target_strength_rung" text,
	"target_coverage_bucket" text,
	CONSTRAINT "treatment_plan_moves_plan_capability_uniq" UNIQUE("plan_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"start_date" date,
	"end_date" date,
	"rationale" text,
	"cost_one_off" double precision,
	"cost_recurring_annual" double precision,
	"promised_ale_reduction" double precision,
	"promised_at" timestamp with time zone,
	"scope_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_review_closed_figures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"basket" text NOT NULL,
	"line_id" uuid,
	"state" text NOT NULL,
	"ale_reduction_mean" double precision,
	"ale_reduction_p10" double precision,
	"ale_reduction_p90" double precision,
	"priced_scenario_count" integer NOT NULL,
	"scope_scenario_count" integer NOT NULL,
	"priced_at" timestamp with time zone,
	CONSTRAINT "budget_review_closed_figures_review_basket_uniq" UNIQUE NULLS NOT DISTINCT("review_id","basket","line_id")
);
--> statement-breakpoint
CREATE TABLE "budget_review_closed_postures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"start_strength_rung" text NOT NULL,
	"start_coverage_bucket" text NOT NULL,
	"end_strength_rung" text NOT NULL,
	"end_coverage_bucket" text NOT NULL,
	CONSTRAINT "budget_review_closed_postures_review_capability_uniq" UNIQUE("review_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "budget_review_closed_tolerances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"risk_scenario_id" uuid,
	"scenario_name" text NOT NULL,
	"tolerance_annual_loss" double precision,
	"tolerance_max_exceedance_probability" double precision,
	"tolerance_source" text,
	"reference_losses" double precision[],
	"reference_probabilities" double precision[],
	"without_build_losses" double precision[],
	"without_build_probabilities" double precision[],
	CONSTRAINT "budget_review_closed_tolerances_review_scenario_uniq" UNIQUE("review_id","risk_scenario_id")
);
--> statement-breakpoint
CREATE TABLE "budget_review_line_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"line_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	CONSTRAINT "budget_review_line_controls_line_capability_uniq" UNIQUE("line_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "budget_review_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"name" text NOT NULL,
	"nature" text NOT NULL,
	"amount_spent" double precision NOT NULL,
	"amortization_years" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_review_lines_id_review_uniq" UNIQUE("id","review_id")
);
--> statement-breakpoint
CREATE TABLE "budget_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid,
	"period_start" date NOT NULL,
	"context" text,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_assessment_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"level" integer,
	"not_applicable" boolean DEFAULT false NOT NULL,
	"comment" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_assessment_answers_assessment_requirement_uq" UNIQUE("assessment_id","requirement_id"),
	CONSTRAINT "compliance_assessment_answers_level_range_ck" CHECK ("compliance_assessment_answers"."level" BETWEEN 0 AND 5),
	CONSTRAINT "compliance_assessment_answers_level_or_na_ck" CHECK (NOT ("compliance_assessment_answers"."not_applicable" AND "compliance_assessment_answers"."level" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "compliance_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"framework_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_id" uuid,
	"created_by_service_account_id" uuid,
	"published_at" timestamp with time zone,
	"published_by_id" uuid,
	"published_by_service_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_assessments_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "compliance_framework_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"framework_id" uuid NOT NULL,
	"parent_id" uuid,
	"oscal_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"statement" text,
	"kind" text NOT NULL,
	"is_requirement" boolean NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "compliance_framework_nodes_framework_oscal_id_uq" UNIQUE("framework_id","oscal_id")
);
--> statement-breakpoint
CREATE TABLE "compliance_frameworks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"title_folded" text GENERATED ALWAYS AS (fold_text(title)) STORED,
	"version" text NOT NULL,
	"oscal_catalog_uuid" uuid NOT NULL,
	CONSTRAINT "compliance_frameworks_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "compliance_requirement_controls" (
	"requirement_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"axis" text NOT NULL,
	CONSTRAINT "compliance_requirement_controls_pk" PRIMARY KEY("requirement_id","capability_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_users" ADD CONSTRAINT "group_users_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_users" ADD CONSTRAINT "group_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_group_roles" ADD CONSTRAINT "platform_group_roles_platform_group_id_platform_groups_id_fk" FOREIGN KEY ("platform_group_id") REFERENCES "public"."platform_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_group_roles" ADD CONSTRAINT "platform_group_roles_platform_role_id_platform_roles_id_fk" FOREIGN KEY ("platform_role_id") REFERENCES "public"."platform_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_group_users" ADD CONSTRAINT "platform_group_users_platform_group_id_platform_groups_id_fk" FOREIGN KEY ("platform_group_id") REFERENCES "public"."platform_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_group_users" ADD CONSTRAINT "platform_group_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_role_capabilities" ADD CONSTRAINT "platform_role_capabilities_platform_role_id_platform_roles_id_fk" FOREIGN KEY ("platform_role_id") REFERENCES "public"."platform_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_role_capabilities" ADD CONSTRAINT "platform_role_capabilities_capability_id_platform_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."platform_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_capabilities" ADD CONSTRAINT "role_capabilities_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_capabilities" ADD CONSTRAINT "role_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_asset_mapping_event_assets" ADD CONSTRAINT "organization_asset_mapping_event_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_asset_mapping_event_assets" ADD CONSTRAINT "organization_asset_mapping_event_assets_event_tenant_fk" FOREIGN KEY ("event_id","tenant_id") REFERENCES "public"."organization_asset_mapping_events"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_asset_mapping_event_assets" ADD CONSTRAINT "organization_asset_mapping_event_assets_asset_tenant_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_asset_mapping_events" ADD CONSTRAINT "organization_asset_mapping_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_asset_mapping_events" ADD CONSTRAINT "organization_asset_mapping_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_asset_mapping_events" ADD CONSTRAINT "organization_asset_mapping_events_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_assets" ADD CONSTRAINT "organization_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_assets" ADD CONSTRAINT "organization_assets_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_assets" ADD CONSTRAINT "organization_assets_supporting_asset_tenant_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_identity_events" ADD CONSTRAINT "organization_identity_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_identity_events" ADD CONSTRAINT "organization_identity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_identity_events" ADD CONSTRAINT "organization_identity_events_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_risk_tolerances" ADD CONSTRAINT "organization_risk_tolerances_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_unpins" ADD CONSTRAINT "organization_unpins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_unpins" ADD CONSTRAINT "organization_unpins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_unpins" ADD CONSTRAINT "organization_unpins_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_sector_tenant_fk" FOREIGN KEY ("sector_id","tenant_id") REFERENCES "public"."sectors"("id","tenant_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_country_tenant_fk" FOREIGN KEY ("country_id","tenant_id") REFERENCES "public"."countries"("id","tenant_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_value_categories" ADD CONSTRAINT "business_value_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_asset_business_value_categories" ADD CONSTRAINT "primary_asset_business_value_categories_primary_asset_id_primary_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "public"."primary_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_asset_business_value_categories" ADD CONSTRAINT "primary_asset_business_value_categories_business_value_category_id_business_value_categories_id_fk" FOREIGN KEY ("business_value_category_id") REFERENCES "public"."business_value_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mitre_techniques" ADD CONSTRAINT "attack_outcome_mitre_techniques_attack_outcome_id_attack_outcomes_id_fk" FOREIGN KEY ("attack_outcome_id") REFERENCES "public"."attack_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mitre_techniques" ADD CONSTRAINT "attack_outcome_mitre_techniques_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mixture_groups" ADD CONSTRAINT "attack_outcome_mixture_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mixture_groups" ADD CONSTRAINT "attack_outcome_mixture_groups_mixture_fk" FOREIGN KEY ("tenant_id","organization_id","attack_outcome_id") REFERENCES "public"."attack_outcome_mixtures"("tenant_id","organization_id","attack_outcome_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mixtures" ADD CONSTRAINT "attack_outcome_mixtures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mixtures" ADD CONSTRAINT "attack_outcome_mixtures_organization_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcome_mixtures" ADD CONSTRAINT "attack_outcome_mixtures_attack_outcome_fk" FOREIGN KEY ("attack_outcome_id","tenant_id") REFERENCES "public"."attack_outcomes"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_outcomes" ADD CONSTRAINT "attack_outcomes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_business_value_categories" ADD CONSTRAINT "risk_scenario_business_value_categories_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_business_value_categories" ADD CONSTRAINT "risk_scenario_business_value_categories_business_value_category_id_business_value_categories_id_fk" FOREIGN KEY ("business_value_category_id") REFERENCES "public"."business_value_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_primary_assets" ADD CONSTRAINT "risk_scenario_primary_assets_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_primary_assets" ADD CONSTRAINT "risk_scenario_primary_assets_primary_asset_id_primary_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "public"."primary_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_risk_tolerances" ADD CONSTRAINT "risk_scenario_risk_tolerances_scenario_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenarios" ADD CONSTRAINT "risk_scenarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenarios" ADD CONSTRAINT "risk_scenarios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenarios" ADD CONSTRAINT "risk_scenarios_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenarios" ADD CONSTRAINT "risk_scenarios_attack_outcome_tenant_fk" FOREIGN KEY ("attack_outcome_id","tenant_id") REFERENCES "public"."attack_outcomes"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_categories" ADD CONSTRAINT "loss_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_driver_activations" ADD CONSTRAINT "loss_driver_activations_attack_outcome_id_attack_outcomes_id_fk" FOREIGN KEY ("attack_outcome_id") REFERENCES "public"."attack_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_driver_activations" ADD CONSTRAINT "loss_driver_activations_business_value_category_id_business_value_categories_id_fk" FOREIGN KEY ("business_value_category_id") REFERENCES "public"."business_value_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_driver_activations" ADD CONSTRAINT "loss_driver_activations_loss_driver_id_loss_drivers_id_fk" FOREIGN KEY ("loss_driver_id") REFERENCES "public"."loss_drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_drivers" ADD CONSTRAINT "loss_drivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_drivers" ADD CONSTRAINT "loss_drivers_loss_category_id_loss_categories_id_fk" FOREIGN KEY ("loss_category_id") REFERENCES "public"."loss_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_loss_estimates" ADD CONSTRAINT "scenario_loss_estimates_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_loss_estimates" ADD CONSTRAINT "scenario_loss_estimates_loss_driver_id_loss_drivers_id_fk" FOREIGN KEY ("loss_driver_id") REFERENCES "public"."loss_drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profile_events" ADD CONSTRAINT "financial_profile_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profile_events" ADD CONSTRAINT "financial_profile_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profile_events" ADD CONSTRAINT "financial_profile_events_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_estate" ADD CONSTRAINT "declared_estate_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_estate" ADD CONSTRAINT "declared_estate_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_estate" ADD CONSTRAINT "declared_estate_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_estate_events" ADD CONSTRAINT "declared_estate_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_estate_events" ADD CONSTRAINT "declared_estate_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declared_estate_events" ADD CONSTRAINT "declared_estate_events_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_surface_mitre_techniques" ADD CONSTRAINT "attack_surface_mitre_tech_surface_fk" FOREIGN KEY ("attack_surface_id") REFERENCES "public"."attack_surfaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_surface_mitre_techniques" ADD CONSTRAINT "attack_surface_mitre_tech_technique_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_surfaces" ADD CONSTRAINT "attack_surfaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitre_mitigation_techniques" ADD CONSTRAINT "mitre_mitigation_techniques_mitigation_id_mitre_mitigations_id_fk" FOREIGN KEY ("mitigation_id") REFERENCES "public"."mitre_mitigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitre_mitigation_techniques" ADD CONSTRAINT "mitre_mitigation_techniques_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitre_technique_tactics" ADD CONSTRAINT "mitre_technique_tactics_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitre_technique_tactics" ADD CONSTRAINT "mitre_technique_tactics_tactic_id_mitre_tactics_id_fk" FOREIGN KEY ("tactic_id") REFERENCES "public"."mitre_tactics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitre_techniques" ADD CONSTRAINT "mitre_techniques_parent_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("parent_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitre_techniques" ADD CONSTRAINT "mitre_techniques_replaced_by_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("replaced_by_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_event_sources" ADD CONSTRAINT "control_capability_assessment_event_sources_event_fk" FOREIGN KEY ("event_id","tenant_id") REFERENCES "public"."control_capability_assessment_events"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_event_sources" ADD CONSTRAINT "control_capability_assessment_event_sources_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_events" ADD CONSTRAINT "control_capability_assessment_events_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_events" ADD CONSTRAINT "control_capability_assessment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_events" ADD CONSTRAINT "control_capability_assessment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_events" ADD CONSTRAINT "control_capability_assessment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_sources" ADD CONSTRAINT "control_capability_assessment_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessment_sources" ADD CONSTRAINT "control_capability_assessment_sources_assessment_fk" FOREIGN KEY ("assessment_id","tenant_id") REFERENCES "public"."control_capability_assessments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessments" ADD CONSTRAINT "control_capability_assessments_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_assessments" ADD CONSTRAINT "control_capability_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_crosswalk" ADD CONSTRAINT "control_capability_crosswalk_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_edges" ADD CONSTRAINT "control_capability_edges_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_edges" ADD CONSTRAINT "control_capability_edges_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_protected_families" ADD CONSTRAINT "control_capability_protected_families_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_scope_overrides" ADD CONSTRAINT "control_capability_scope_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_scope_overrides" ADD CONSTRAINT "control_capability_scope_overrides_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_strength_rung_labels" ADD CONSTRAINT "control_capability_strength_rung_labels_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_technique_overrides" ADD CONSTRAINT "control_capability_technique_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_technique_overrides" ADD CONSTRAINT "control_capability_technique_overrides_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_capability_technique_overrides" ADD CONSTRAINT "control_capability_technique_overrides_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_platform_family_controls" ADD CONSTRAINT "security_platform_family_controls_family_id_security_platform_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."security_platform_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_platform_family_controls" ADD CONSTRAINT "security_platform_family_controls_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_enumerations" ADD CONSTRAINT "asset_enumerations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_enumerations" ADD CONSTRAINT "asset_enumerations_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_enumerations" ADD CONSTRAINT "asset_enumerations_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_cve_tenant_fk" FOREIGN KEY ("cve_id","tenant_id") REFERENCES "public"."cve"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_history" ADD CONSTRAINT "asset_evidence_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_history" ADD CONSTRAINT "asset_evidence_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_history" ADD CONSTRAINT "asset_evidence_history_evidence_tenant_fk" FOREIGN KEY ("asset_evidence_id","tenant_id") REFERENCES "public"."asset_evidence"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_source_software" ADD CONSTRAINT "asset_evidence_source_software_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_source_software" ADD CONSTRAINT "asset_evidence_source_software_source_fk" FOREIGN KEY ("asset_evidence_source_id","tenant_id") REFERENCES "public"."asset_evidence_sources"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_sources" ADD CONSTRAINT "asset_evidence_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_sources" ADD CONSTRAINT "asset_evidence_sources_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_sources" ADD CONSTRAINT "asset_evidence_sources_evidence_tenant_fk" FOREIGN KEY ("asset_evidence_id","tenant_id") REFERENCES "public"."asset_evidence"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_verdicts" ADD CONSTRAINT "asset_evidence_verdicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_verdicts" ADD CONSTRAINT "asset_evidence_verdicts_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_verdicts" ADD CONSTRAINT "asset_evidence_verdicts_evidence_tenant_fk" FOREIGN KEY ("asset_evidence_id","tenant_id") REFERENCES "public"."asset_evidence"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_group_members" ADD CONSTRAINT "asset_group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_group_members" ADD CONSTRAINT "asset_group_members_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_group_members" ADD CONSTRAINT "asset_group_members_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_group_members" ADD CONSTRAINT "asset_group_members_group_tenant_fk" FOREIGN KEY ("asset_group_id","tenant_id") REFERENCES "public"."asset_groups"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_group_members" ADD CONSTRAINT "asset_group_members_asset_tenant_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_groups" ADD CONSTRAINT "asset_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_groups" ADD CONSTRAINT "asset_groups_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_ai_target_properties" ADD CONSTRAINT "supporting_asset_ai_target_properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_ai_target_properties" ADD CONSTRAINT "supporting_asset_ai_target_properties_source_fk" FOREIGN KEY ("supporting_asset_source_id") REFERENCES "public"."supporting_asset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_criticality_lifts" ADD CONSTRAINT "supporting_asset_criticality_lifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_criticality_lifts" ADD CONSTRAINT "supporting_asset_criticality_lifts_asset_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_criticality_lifts" ADD CONSTRAINT "supporting_asset_criticality_lifts_from_fk" FOREIGN KEY ("from_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_identity_properties" ADD CONSTRAINT "supporting_asset_identity_properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_identity_properties" ADD CONSTRAINT "supporting_asset_identity_properties_source_fk" FOREIGN KEY ("supporting_asset_source_id") REFERENCES "public"."supporting_asset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_machine_properties" ADD CONSTRAINT "supporting_asset_machine_properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_machine_properties" ADD CONSTRAINT "supporting_asset_machine_properties_source_fk" FOREIGN KEY ("supporting_asset_source_id") REFERENCES "public"."supporting_asset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_manual_values" ADD CONSTRAINT "supporting_asset_manual_values_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_manual_values" ADD CONSTRAINT "supporting_asset_manual_values_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD CONSTRAINT "supporting_asset_relations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD CONSTRAINT "supporting_asset_relations_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD CONSTRAINT "supporting_asset_relations_from_fk" FOREIGN KEY ("from_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD CONSTRAINT "supporting_asset_relations_to_fk" FOREIGN KEY ("to_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_sources" ADD CONSTRAINT "supporting_asset_sources_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_sources" ADD CONSTRAINT "supporting_asset_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_sources" ADD CONSTRAINT "supporting_asset_sources_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_tags" ADD CONSTRAINT "supporting_asset_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_tags" ADD CONSTRAINT "supporting_asset_tags_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_tags" ADD CONSTRAINT "supporting_asset_tags_asset_tenant_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_asset_tags" ADD CONSTRAINT "supporting_asset_tags_tag_tenant_fk" FOREIGN KEY ("tag_id","tenant_id") REFERENCES "public"."tags"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_assets" ADD CONSTRAINT "supporting_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_assets" ADD CONSTRAINT "supporting_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sources" ADD CONSTRAINT "tag_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sources" ADD CONSTRAINT "tag_sources_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sources" ADD CONSTRAINT "tag_sources_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_merged_into_tag_id_tags_id_fk" FOREIGN KEY ("merged_into_tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_asset_reach" ADD CONSTRAINT "primary_asset_reach_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_asset_reach" ADD CONSTRAINT "primary_asset_reach_primary_asset_fk" FOREIGN KEY ("primary_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_asset_reach" ADD CONSTRAINT "primary_asset_reach_supporting_asset_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_asset_reach" ADD CONSTRAINT "primary_asset_reach_organization_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_to_primary_links" ADD CONSTRAINT "primary_to_primary_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_to_primary_links" ADD CONSTRAINT "primary_to_primary_links_dependent_asset_tenant_fk" FOREIGN KEY ("dependent_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_to_primary_links" ADD CONSTRAINT "primary_to_primary_links_provider_asset_tenant_fk" FOREIGN KEY ("provider_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_to_primary_links" ADD CONSTRAINT "support_to_primary_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_to_primary_links" ADD CONSTRAINT "support_to_primary_links_supporting_asset_tenant_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_to_primary_links" ADD CONSTRAINT "support_to_primary_links_primary_asset_tenant_fk" FOREIGN KEY ("primary_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_to_support_links" ADD CONSTRAINT "support_to_support_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_to_support_links" ADD CONSTRAINT "support_to_support_links_provider_asset_tenant_fk" FOREIGN KEY ("provider_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_to_support_links" ADD CONSTRAINT "support_to_support_links_dependent_asset_tenant_fk" FOREIGN KEY ("dependent_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_relevance_settings" ADD CONSTRAINT "threat_relevance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_settings" ADD CONSTRAINT "crq_indicator_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_settings" ADD CONSTRAINT "dashboard_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_budget_review_annual_losses" ADD CONSTRAINT "crq_budget_review_annual_losses_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_budget_review_annual_losses" ADD CONSTRAINT "crq_budget_review_annual_losses_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_budget_review_results" ADD CONSTRAINT "crq_budget_review_results_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_budget_review_results" ADD CONSTRAINT "crq_budget_review_results_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_budget_review_results" ADD CONSTRAINT "crq_budget_review_results_line_id_budget_review_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_review_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_control_what_if_results" ADD CONSTRAINT "crq_control_what_if_results_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_control_what_if_results" ADD CONSTRAINT "crq_control_what_if_results_control_id_control_capabilities_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_cve_what_if_results" ADD CONSTRAINT "crq_cve_what_if_results_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_cve_what_if_results" ADD CONSTRAINT "crq_cve_what_if_results_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_group_scores" ADD CONSTRAINT "crq_indicator_group_scores_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_run_annual_losses" ADD CONSTRAINT "crq_indicator_run_annual_losses_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_run_reach_gaps" ADD CONSTRAINT "crq_indicator_run_reach_gaps_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_run_reach_gaps" ADD CONSTRAINT "crq_indicator_run_reach_gaps_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_run_unplayable_obstacles" ADD CONSTRAINT "crq_indicator_run_unplayable_obstacles_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_runs" ADD CONSTRAINT "crq_indicator_runs_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_indicator_tef_inputs" ADD CONSTRAINT "crq_indicator_tef_inputs_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_plan_what_if_results" ADD CONSTRAINT "crq_plan_what_if_results_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_plan_what_if_results" ADD CONSTRAINT "crq_plan_what_if_results_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_technique_what_if_results" ADD CONSTRAINT "crq_technique_what_if_results_run_id_crq_indicator_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crq_indicator_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crq_technique_what_if_results" ADD CONSTRAINT "crq_technique_what_if_results_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tef_estimate_contributions" ADD CONSTRAINT "tef_estimate_contributions_tef_estimate_id_tef_estimates_id_fk" FOREIGN KEY ("tef_estimate_id") REFERENCES "public"."tef_estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD CONSTRAINT "tef_estimates_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_errors" ADD CONSTRAINT "job_errors_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_dependencies" ADD CONSTRAINT "job_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve" ADD CONSTRAINT "cve_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_affected_versions" ADD CONSTRAINT "cve_affected_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_affected_versions" ADD CONSTRAINT "cve_affected_versions_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_references" ADD CONSTRAINT "cve_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_references" ADD CONSTRAINT "cve_references_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_source_observations" ADD CONSTRAINT "cve_source_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_source_observations" ADD CONSTRAINT "cve_source_observations_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwe_technique_links" ADD CONSTRAINT "cwe_technique_links_cwe_id_cwe_weaknesses_id_fk" FOREIGN KEY ("cwe_id") REFERENCES "public"."cwe_weaknesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwe_technique_links" ADD CONSTRAINT "cwe_technique_links_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwe_technique_overrides" ADD CONSTRAINT "cwe_technique_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwe_technique_overrides" ADD CONSTRAINT "cwe_technique_overrides_cwe_id_cwe_weaknesses_id_fk" FOREIGN KEY ("cwe_id") REFERENCES "public"."cwe_weaknesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwe_technique_overrides" ADD CONSTRAINT "cwe_technique_overrides_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_technique_mapping" ADD CONSTRAINT "cve_technique_mapping_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_technique_mapping" ADD CONSTRAINT "cve_technique_mapping_resolution_id_cve_technique_resolution_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."cve_technique_resolution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_technique_mapping" ADD CONSTRAINT "cve_technique_mapping_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_technique_mapping" ADD CONSTRAINT "cve_technique_mapping_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_technique_resolution" ADD CONSTRAINT "cve_technique_resolution_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cve_technique_resolution" ADD CONSTRAINT "cve_technique_resolution_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_groups" ADD CONSTRAINT "service_account_groups_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_groups" ADD CONSTRAINT "service_account_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_tokens" ADD CONSTRAINT "service_account_tokens_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_tokens" ADD CONSTRAINT "service_account_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_service_account_id_service_accounts_id_fk" FOREIGN KEY ("created_by_service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_activity_anchors" ADD CONSTRAINT "threat_activity_anchors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_activity_anchors" ADD CONSTRAINT "threat_activity_anchors_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analyses" ADD CONSTRAINT "threat_analyses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_aliases" ADD CONSTRAINT "threat_analysis_aliases_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_attributions" ADD CONSTRAINT "threat_analysis_attributions_analysis_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_counts" ADD CONSTRAINT "threat_analysis_counts_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_counts" ADD CONSTRAINT "threat_analysis_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_cves" ADD CONSTRAINT "threat_analysis_cves_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_goals" ADD CONSTRAINT "threat_analysis_goals_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_locations" ADD CONSTRAINT "threat_analysis_locations_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_outcome_probabilities" ADD CONSTRAINT "threat_analysis_outcome_probabilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_outcome_probabilities" ADD CONSTRAINT "threat_analysis_outcome_probabilities_analysis_fk" FOREIGN KEY ("analysis_id","tenant_id") REFERENCES "public"."threat_analyses"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_outcome_probabilities" ADD CONSTRAINT "threat_analysis_outcome_probabilities_attack_outcome_fk" FOREIGN KEY ("attack_outcome_id","tenant_id") REFERENCES "public"."attack_outcomes"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_roles" ADD CONSTRAINT "threat_analysis_roles_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_secondary_motives" ADD CONSTRAINT "threat_analysis_secondary_motives_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_sectors" ADD CONSTRAINT "threat_analysis_sectors_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_techniques" ADD CONSTRAINT "threat_analysis_techniques_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_analysis_threat_actor_types" ADD CONSTRAINT "threat_analysis_threat_actor_types_analysis_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_outcome_counter_versions" ADD CONSTRAINT "threat_outcome_counter_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_outcome_scores" ADD CONSTRAINT "threat_outcome_scores_analysis_id_threat_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."threat_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_outcome_scores" ADD CONSTRAINT "threat_outcome_scores_attack_outcome_id_attack_outcomes_id_fk" FOREIGN KEY ("attack_outcome_id") REFERENCES "public"."attack_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_outcome_scores" ADD CONSTRAINT "threat_outcome_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" ADD CONSTRAINT "opencti_connector_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" ADD CONSTRAINT "opencti_connector_settings_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opencti_stream_objects" ADD CONSTRAINT "opencti_stream_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opencti_stream_report_refs" ADD CONSTRAINT "opencti_stream_report_refs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "default_threats_settings" ADD CONSTRAINT "default_threats_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_assets" ADD CONSTRAINT "openaev_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_assets" ADD CONSTRAINT "openaev_assets_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_attack_observations" ADD CONSTRAINT "openaev_attack_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_attack_observations" ADD CONSTRAINT "openaev_attack_observations_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_sync_streams" ADD CONSTRAINT "openaev_sync_streams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_sync_streams" ADD CONSTRAINT "openaev_sync_streams_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drata_controls" ADD CONSTRAINT "drata_controls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drata_frameworks" ADD CONSTRAINT "drata_frameworks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drata_requirement_controls" ADD CONSTRAINT "drata_requirement_controls_requirement_id_drata_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."drata_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drata_requirement_controls" ADD CONSTRAINT "drata_requirement_controls_control_id_drata_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."drata_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drata_requirements" ADD CONSTRAINT "drata_requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drata_requirements" ADD CONSTRAINT "drata_requirements_framework_id_drata_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."drata_frameworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_posture_history" ADD CONSTRAINT "asset_posture_history_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_posture_history" ADD CONSTRAINT "asset_posture_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_posture_history" ADD CONSTRAINT "asset_posture_history_worst_asset_evidence_id_asset_evidence_id_fk" FOREIGN KEY ("worst_asset_evidence_id") REFERENCES "public"."asset_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_postures" ADD CONSTRAINT "asset_postures_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_postures" ADD CONSTRAINT "asset_postures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_technique_scores" ADD CONSTRAINT "asset_technique_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_technique_scores" ADD CONSTRAINT "asset_technique_scores_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_technique_scores" ADD CONSTRAINT "asset_technique_scores_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_technique_scores" ADD CONSTRAINT "asset_technique_scores_asset_evidence_id_asset_evidence_id_fk" FOREIGN KEY ("asset_evidence_id") REFERENCES "public"."asset_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_metric_daily" ADD CONSTRAINT "finding_metric_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_score_history" ADD CONSTRAINT "finding_score_history_asset_evidence_id_asset_evidence_id_fk" FOREIGN KEY ("asset_evidence_id") REFERENCES "public"."asset_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_score_history" ADD CONSTRAINT "finding_score_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_scores" ADD CONSTRAINT "finding_scores_asset_evidence_id_asset_evidence_id_fk" FOREIGN KEY ("asset_evidence_id") REFERENCES "public"."asset_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_scores" ADD CONSTRAINT "finding_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_scores" ADD CONSTRAINT "finding_scores_weakest_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("weakest_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_score_history" ADD CONSTRAINT "unique_finding_score_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_score_history" ADD CONSTRAINT "unique_finding_score_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_score_history" ADD CONSTRAINT "unique_finding_score_history_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_scores" ADD CONSTRAINT "unique_finding_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_scores" ADD CONSTRAINT "unique_finding_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_scores" ADD CONSTRAINT "unique_finding_scores_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unique_finding_scores" ADD CONSTRAINT "unique_finding_scores_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_proven_posture_history" ADD CONSTRAINT "control_proven_posture_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_proven_posture_history" ADD CONSTRAINT "control_proven_posture_history_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_proven_posture_history" ADD CONSTRAINT "control_proven_posture_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_technique_test_results" ADD CONSTRAINT "control_technique_test_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_technique_test_results" ADD CONSTRAINT "control_technique_test_results_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_technique_test_results" ADD CONSTRAINT "control_technique_test_results_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_technique_test_results" ADD CONSTRAINT "control_technique_test_results_organization_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_openings" ADD CONSTRAINT "entry_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_openings" ADD CONSTRAINT "entry_openings_asset_evidence_id_asset_evidence_id_fk" FOREIGN KEY ("asset_evidence_id") REFERENCES "public"."asset_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_openings" ADD CONSTRAINT "entry_openings_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_openings" ADD CONSTRAINT "entry_openings_mitre_technique_id_mitre_techniques_id_fk" FOREIGN KEY ("mitre_technique_id") REFERENCES "public"."mitre_techniques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_openings" ADD CONSTRAINT "entry_openings_cve_id_cve_id_fk" FOREIGN KEY ("cve_id") REFERENCES "public"."cve"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_moves" ADD CONSTRAINT "treatment_plan_moves_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_moves" ADD CONSTRAINT "treatment_plan_moves_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_closed_figures" ADD CONSTRAINT "budget_review_closed_figures_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_closed_figures" ADD CONSTRAINT "budget_review_closed_figures_line_id_budget_review_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_review_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_closed_postures" ADD CONSTRAINT "budget_review_closed_postures_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_closed_postures" ADD CONSTRAINT "budget_review_closed_postures_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_closed_tolerances" ADD CONSTRAINT "budget_review_closed_tolerances_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_closed_tolerances" ADD CONSTRAINT "budget_review_closed_tolerances_risk_scenario_id_risk_scenarios_id_fk" FOREIGN KEY ("risk_scenario_id") REFERENCES "public"."risk_scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_line_controls" ADD CONSTRAINT "budget_review_line_controls_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_line_controls" ADD CONSTRAINT "budget_review_line_controls_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_line_controls" ADD CONSTRAINT "budget_review_line_controls_line_fk" FOREIGN KEY ("line_id","review_id") REFERENCES "public"."budget_review_lines"("id","review_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_review_lines" ADD CONSTRAINT "budget_review_lines_review_id_budget_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."budget_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reviews" ADD CONSTRAINT "budget_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reviews" ADD CONSTRAINT "budget_reviews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessment_answers" ADD CONSTRAINT "compliance_assessment_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessment_answers" ADD CONSTRAINT "compliance_assessment_answers_requirement_id_compliance_framework_nodes_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."compliance_framework_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessment_answers" ADD CONSTRAINT "compliance_assessment_answers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessment_answers" ADD CONSTRAINT "compliance_assessment_answers_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessment_answers" ADD CONSTRAINT "compliance_assessment_answers_assessment_fk" FOREIGN KEY ("assessment_id","tenant_id") REFERENCES "public"."compliance_assessments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_framework_id_compliance_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."compliance_frameworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_created_by_service_account_id_service_accounts_id_fk" FOREIGN KEY ("created_by_service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_published_by_service_account_id_service_accounts_id_fk" FOREIGN KEY ("published_by_service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_framework_nodes" ADD CONSTRAINT "compliance_framework_nodes_framework_id_compliance_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."compliance_frameworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_framework_nodes" ADD CONSTRAINT "compliance_framework_nodes_parent_id_compliance_framework_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."compliance_framework_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_requirement_controls" ADD CONSTRAINT "compliance_requirement_controls_requirement_id_compliance_framework_nodes_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."compliance_framework_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_requirement_controls" ADD CONSTRAINT "compliance_requirement_controls_capability_id_control_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."control_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_tenant_slug_unique" ON "groups" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "organization_asset_mapping_event_assets_asset_idx" ON "organization_asset_mapping_event_assets" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "organization_asset_mapping_events_organization_date_idx" ON "organization_asset_mapping_events" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "organization_assets_supporting_asset_idx" ON "organization_assets" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "organization_identity_events_organization_date_idx" ON "organization_identity_events" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "organization_unpins_organization_idx" ON "organization_unpins" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "attack_outcome_mixtures_attack_outcome_idx" ON "attack_outcome_mixtures" USING btree ("tenant_id","attack_outcome_id");--> statement-breakpoint
CREATE INDEX "risk_scenario_primary_assets_primary_asset_idx" ON "risk_scenario_primary_assets" USING btree ("primary_asset_id");--> statement-breakpoint
CREATE INDEX "risk_scenarios_organization_idx" ON "risk_scenarios" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "financial_profile_events_organization_date_idx" ON "financial_profile_events" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "declared_estate_events_organization_date_idx" ON "declared_estate_events" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "attack_surface_mitre_tech_technique_idx" ON "attack_surface_mitre_techniques" USING btree ("mitre_technique_id");--> statement-breakpoint
CREATE INDEX "control_capability_assessment_event_sources_event_idx" ON "control_capability_assessment_event_sources" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "control_capability_assessment_events_cap_tenant_date_idx" ON "control_capability_assessment_events" USING btree ("capability_id","tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "control_capability_assessment_events_organization_idx" ON "control_capability_assessment_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "control_capability_edges_technique_idx" ON "control_capability_edges" USING btree ("mitre_technique_id");--> statement-breakpoint
CREATE INDEX "control_capability_protected_families_family_idx" ON "control_capability_protected_families" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "control_capability_scope_overrides_capability_idx" ON "control_capability_scope_overrides" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "primary_assets_organization_tenant_idx" ON "primary_assets" USING btree ("organization_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "primary_assets_organization_reference_uq" ON "primary_assets" USING btree ("organization_id","reference") WHERE "primary_assets"."reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_enumerations_supporting_asset_idx" ON "asset_enumerations" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "asset_evidence_cve_idx" ON "asset_evidence" USING btree ("cve_id") WHERE "asset_evidence"."cve_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_evidence_technique_tenant_idx" ON "asset_evidence" USING btree ("mitre_technique_id","tenant_id") WHERE "asset_evidence"."mitre_technique_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_evidence_technique_expectation_idx" ON "asset_evidence" USING btree ("mitre_technique_id","expectation_type");--> statement-breakpoint
CREATE INDEX "asset_evidence_cve_state_idx" ON "asset_evidence" USING btree ("cve_id","current_state","id") WHERE "asset_evidence"."cve_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_evidence_cve_changed_idx" ON "asset_evidence" USING btree ("cve_id","current_state_changed_at","id") WHERE "asset_evidence"."cve_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_evidence_technique_state_idx" ON "asset_evidence" USING btree ("mitre_technique_id","tenant_id","current_state","id") WHERE "asset_evidence"."mitre_technique_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_evidence_technique_changed_idx" ON "asset_evidence" USING btree ("mitre_technique_id","tenant_id","current_state_changed_at","id") WHERE "asset_evidence"."mitre_technique_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_evidence_history_tenant_evidence_idx" ON "asset_evidence_history" USING btree ("tenant_id","asset_evidence_id","state_changed_at" DESC NULLS FIRST,"id" DESC NULLS FIRST,"state","origin","observed_at");--> statement-breakpoint
CREATE INDEX "asset_evidence_sources_tenant_evidence_idx" ON "asset_evidence_sources" USING btree ("tenant_id","asset_evidence_id");--> statement-breakpoint
CREATE INDEX "asset_evidence_verdicts_evidence_recorded_idx" ON "asset_evidence_verdicts" USING btree ("asset_evidence_id","recorded_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "asset_group_members_asset_idx" ON "asset_group_members" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "asset_group_members_tenant_group_idx" ON "asset_group_members" USING btree ("tenant_id","asset_group_id","supporting_asset_id");--> statement-breakpoint
CREATE INDEX "asset_groups_tenant_name_idx" ON "asset_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "supporting_asset_ai_target_properties_tenant_endpoint_idx" ON "supporting_asset_ai_target_properties" USING btree ("tenant_id","normalized_endpoint_url");--> statement-breakpoint
CREATE INDEX "supporting_asset_criticality_lifts_asset_idx" ON "supporting_asset_criticality_lifts" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_criticality_lifts_from_idx" ON "supporting_asset_criticality_lifts" USING btree ("from_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_identity_properties_tenant_object_idx" ON "supporting_asset_identity_properties" USING btree ("tenant_id","directory_object_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_identity_properties_tenant_cloud_sid_idx" ON "supporting_asset_identity_properties" USING btree ("tenant_id","cloud_sid");--> statement-breakpoint
CREATE INDEX "supporting_asset_identity_properties_tenant_onprem_sid_idx" ON "supporting_asset_identity_properties" USING btree ("tenant_id","on_prem_sid");--> statement-breakpoint
CREATE INDEX "supporting_asset_machine_properties_tenant_hostname_idx" ON "supporting_asset_machine_properties" USING btree ("tenant_id","hostname");--> statement-breakpoint
CREATE INDEX "supporting_asset_machine_properties_tenant_hw_uuid_idx" ON "supporting_asset_machine_properties" USING btree ("tenant_id","hardware_uuid");--> statement-breakpoint
CREATE INDEX "supporting_asset_machine_properties_tenant_agent_ref_idx" ON "supporting_asset_machine_properties" USING btree ("tenant_id","agent_external_reference");--> statement-breakpoint
CREATE INDEX "supporting_asset_relations_from_idx" ON "supporting_asset_relations" USING btree ("tenant_id","from_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_relations_to_idx" ON "supporting_asset_relations" USING btree ("tenant_id","to_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_sources_asset_idx" ON "supporting_asset_sources" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_tags_asset_idx" ON "supporting_asset_tags" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_asset_tags_tenant_tag_idx" ON "supporting_asset_tags" USING btree ("tenant_id","tag_id","supporting_asset_id");--> statement-breakpoint
CREATE INDEX "supporting_assets_tenant_display_name_idx" ON "supporting_assets" USING btree ("tenant_id","display_name_folded","display_name" collate "C","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_sources_manual_per_tag_uq" ON "tag_sources" USING btree ("tag_id","pushed_by_xtm_one") WHERE "tag_sources"."source_tag_id" IS NULL;--> statement-breakpoint
CREATE INDEX "tag_sources_tag_idx" ON "tag_sources" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tags_merged_into_idx" ON "tags" USING btree ("merged_into_tag_id");--> statement-breakpoint
CREATE INDEX "primary_asset_reach_organization_idx" ON "primary_asset_reach" USING btree ("tenant_id","organization_id","supporting_asset_id");--> statement-breakpoint
CREATE INDEX "primary_asset_reach_supporting_asset_idx" ON "primary_asset_reach" USING btree ("supporting_asset_id","tenant_id");--> statement-breakpoint
CREATE INDEX "primary_to_primary_links_provider_asset_idx" ON "primary_to_primary_links" USING btree ("provider_asset_id","tenant_id");--> statement-breakpoint
CREATE INDEX "support_to_primary_links_primary_asset_idx" ON "support_to_primary_links" USING btree ("primary_asset_id","tenant_id");--> statement-breakpoint
CREATE INDEX "support_to_support_links_dependent_asset_idx" ON "support_to_support_links" USING btree ("dependent_asset_id","tenant_id");--> statement-breakpoint
CREATE INDEX "crq_budget_review_annual_losses_review_idx" ON "crq_budget_review_annual_losses" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "crq_budget_review_results_review_idx" ON "crq_budget_review_results" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "crq_budget_review_results_line_idx" ON "crq_budget_review_results" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "crq_control_what_if_results_run_idx" ON "crq_control_what_if_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "crq_cve_what_if_results_run_cve_idx" ON "crq_cve_what_if_results" USING btree ("run_id","cve_id");--> statement-breakpoint
CREATE INDEX "crq_indicator_group_scores_run_idx" ON "crq_indicator_group_scores" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "crq_indicator_run_reach_gaps_run_idx" ON "crq_indicator_run_reach_gaps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "crq_indicator_run_unplayable_obstacles_run_idx" ON "crq_indicator_run_unplayable_obstacles" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "crq_indicator_runs_risk_scenario_created_idx" ON "crq_indicator_runs" USING btree ("risk_scenario_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "crq_plan_what_if_results_plan_idx" ON "crq_plan_what_if_results" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "crq_technique_what_if_results_run_idx" ON "crq_technique_what_if_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tef_estimate_contributions_tef_estimate_idx" ON "tef_estimate_contributions" USING btree ("tef_estimate_id");--> statement-breakpoint
CREATE INDEX "tef_estimates_risk_scenario_created_idx" ON "tef_estimates" USING btree ("risk_scenario_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "job_errors_job_id_idx" ON "job_errors" USING btree ("job_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("priority" DESC NULLS FIRST,"run_after") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("leased_until") WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_idx" ON "jobs" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_idx" ON "jobs" USING btree ("kind","tenant_id","payload_hash") WHERE status IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_tenant_idx" ON "jobs" USING btree ("tenant_id","enqueued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "jobs_scheduler_idx" ON "jobs" USING btree ("tenant_id","kind","enqueued_at" DESC NULLS FIRST) WHERE triggered_by = 'scheduler';--> statement-breakpoint
CREATE UNIQUE INDEX "job_dependencies_kind_tenant_table_access_idx" ON "job_dependencies" USING btree ("job_kind","tenant_id","table_name","access");--> statement-breakpoint
CREATE UNIQUE INDEX "job_schedules_tenant_kind_idx" ON "job_schedules" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "cve_tenantid_cveid_idx" ON "cve" USING btree ("tenant_id","cve_id");--> statement-breakpoint
CREATE INDEX "cve_updated_at_idx" ON "cve" USING btree ("updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "cve_references_cveid_url_idx" ON "cve_references" USING btree ("cve_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "cve_technique_mapping_cve_technique_role_uq" ON "cve_technique_mapping" USING btree ("cve_id","mitre_technique_id","role");--> statement-breakpoint
CREATE INDEX "cve_technique_mapping_resolution_idx" ON "cve_technique_mapping" USING btree ("resolution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cve_technique_resolution_cve_uq" ON "cve_technique_resolution" USING btree ("cve_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_settings_tenantid_source_idx" ON "integration_settings" USING btree ("tenant_id","source");--> statement-breakpoint
CREATE INDEX "threat_activity_anchors_analysis_id_idx" ON "threat_activity_anchors" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analyses_name_lower_idx" ON "threat_analyses" USING btree ("name_folded" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "threat_analysis_aliases_analysis_id_idx" ON "threat_analysis_aliases" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threat_analysis_aliases_analysis_alias_unique" ON "threat_analysis_aliases" USING btree ("analysis_id",lower("alias"));--> statement-breakpoint
CREATE INDEX "threat_analysis_attributions_analysis_id_idx" ON "threat_analysis_attributions" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_attributions_target_stix_id_idx" ON "threat_analysis_attributions" USING btree ("target_stix_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_counts_analysis_id_idx" ON "threat_analysis_counts" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_cves_analysis_id_idx" ON "threat_analysis_cves" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_cves_cve_id_idx" ON "threat_analysis_cves" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_goals_analysis_id_idx" ON "threat_analysis_goals" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threat_analysis_goals_analysis_value_unique" ON "threat_analysis_goals" USING btree ("analysis_id",lower("value"));--> statement-breakpoint
CREATE INDEX "threat_analysis_locations_analysis_id_idx" ON "threat_analysis_locations" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_outcome_probabilities_tenant_outcome_probability_idx" ON "threat_analysis_outcome_probabilities" USING btree ("tenant_id","attack_outcome_id","probability" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "threat_analysis_roles_analysis_id_idx" ON "threat_analysis_roles" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threat_analysis_roles_analysis_value_unique" ON "threat_analysis_roles" USING btree ("analysis_id",lower("value"));--> statement-breakpoint
CREATE INDEX "threat_analysis_secondary_motives_analysis_id_idx" ON "threat_analysis_secondary_motives" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threat_analysis_secondary_motives_analysis_value_unique" ON "threat_analysis_secondary_motives" USING btree ("analysis_id",lower("value"));--> statement-breakpoint
CREATE INDEX "threat_analysis_sectors_analysis_id_idx" ON "threat_analysis_sectors" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_techniques_analysis_id_idx" ON "threat_analysis_techniques" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_techniques_mitre_external_id_idx" ON "threat_analysis_techniques" USING btree ("mitre_external_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_techniques_parent_external_id_idx" ON "threat_analysis_techniques" USING btree ("parent_external_id");--> statement-breakpoint
CREATE INDEX "threat_analysis_threat_actor_types_analysis_id_idx" ON "threat_analysis_threat_actor_types" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threat_analysis_threat_actor_types_analysis_value_unique" ON "threat_analysis_threat_actor_types" USING btree ("analysis_id",lower("value"));--> statement-breakpoint
CREATE INDEX "threat_outcome_scores_tenant_outcome_score_idx" ON "threat_outcome_scores" USING btree ("tenant_id","attack_outcome_id","score" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "threat_outcome_scores_tenant_top_score_idx" ON "threat_outcome_scores" USING btree ("tenant_id","score" DESC NULLS LAST) WHERE is_top;--> statement-breakpoint
CREATE INDEX "threat_outcome_scores_analysis_id_idx" ON "threat_outcome_scores" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "threat_outcome_scores_attack_outcome_id_idx" ON "threat_outcome_scores" USING btree ("attack_outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opencti_connector_settings_tenantid_idx" ON "opencti_connector_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opencti_stream_objects_tenantid_stixid_idx" ON "opencti_stream_objects" USING btree ("tenant_id","stix_id");--> statement-breakpoint
CREATE INDEX "opencti_stream_objects_source_ref_idx" ON "opencti_stream_objects" USING btree ("tenant_id","source_ref","relationship_type");--> statement-breakpoint
CREATE INDEX "opencti_stream_objects_target_ref_idx" ON "opencti_stream_objects" USING btree ("tenant_id","target_ref","relationship_type");--> statement-breakpoint
CREATE INDEX "opencti_stream_objects_created_by_ref_idx" ON "opencti_stream_objects" USING btree ("tenant_id","created_by_ref");--> statement-breakpoint
CREATE INDEX "opencti_stream_objects_pending_idx" ON "opencti_stream_objects" USING btree ("tenant_id","updated_at","stix_id") WHERE "opencti_stream_objects"."pending";--> statement-breakpoint
CREATE INDEX "opencti_stream_report_refs_threat_idx" ON "opencti_stream_report_refs" USING btree ("tenant_id","threat_stix_id");--> statement-breakpoint
CREATE UNIQUE INDEX "default_threats_settings_tenantid_idx" ON "default_threats_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "openaev_attack_observations_asset_scenario_idx" ON "openaev_attack_observations" USING btree ("connector_id","source_asset_id","scenario_id");--> statement-breakpoint
CREATE INDEX "openaev_attack_observations_tenant_reported_idx" ON "openaev_attack_observations" USING btree ("connector_id","openaev_tenant_id","last_reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "openaev_sync_streams_connector_tenant_stream_idx" ON "openaev_sync_streams" USING btree ("connector_id","openaev_tenant_id","stream");--> statement-breakpoint
CREATE UNIQUE INDEX "drata_controls_tenant_drata_id_idx" ON "drata_controls" USING btree ("tenant_id","drata_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drata_frameworks_tenant_drata_id_idx" ON "drata_frameworks" USING btree ("tenant_id","drata_id");--> statement-breakpoint
CREATE INDEX "drata_requirement_controls_control_idx" ON "drata_requirement_controls" USING btree ("control_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drata_requirements_framework_drata_id_idx" ON "drata_requirements" USING btree ("framework_id","drata_id");--> statement-breakpoint
CREATE INDEX "workers_heartbeat_at_idx" ON "workers" USING btree ("heartbeat_at");--> statement-breakpoint
CREATE INDEX "job_logs_job_idx" ON "job_logs" USING btree ("job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "job_logs_scope_kind_idx" ON "job_logs" USING btree ("tenant_id","scope_kind","occurred_at");--> statement-breakpoint
CREATE INDEX "asset_posture_history_tenant_changed_idx" ON "asset_posture_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "asset_posture_history_asset_changed_idx" ON "asset_posture_history" USING btree ("supporting_asset_id","changed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "asset_posture_history_worst_evidence_idx" ON "asset_posture_history" USING btree ("worst_asset_evidence_id");--> statement-breakpoint
CREATE INDEX "asset_postures_tenant_score_idx" ON "asset_postures" USING btree ("tenant_id","score");--> statement-breakpoint
CREATE INDEX "asset_technique_scores_supporting_asset_idx" ON "asset_technique_scores" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "asset_technique_scores_asset_evidence_idx" ON "asset_technique_scores" USING btree ("asset_evidence_id");--> statement-breakpoint
CREATE INDEX "finding_score_history_tenant_changed_idx" ON "finding_score_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "finding_score_history_evidence_changed_idx" ON "finding_score_history" USING btree ("asset_evidence_id","changed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "unique_finding_score_history_tenant_changed_idx" ON "unique_finding_score_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "unique_finding_score_history_cve_changed_idx" ON "unique_finding_score_history" USING btree ("cve_id","organization_id","changed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "unique_finding_score_history_organization_idx" ON "unique_finding_score_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "unique_finding_scores_scope_score_idx" ON "unique_finding_scores" USING btree ("tenant_id","organization_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unique_finding_scores_cve_idx" ON "unique_finding_scores" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "unique_finding_scores_organization_idx" ON "unique_finding_scores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "control_proven_posture_history_key_changed_idx" ON "control_proven_posture_history" USING btree ("capability_id","tenant_id","organization_id","function","changed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "control_proven_posture_history_tenant_changed_idx" ON "control_proven_posture_history" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "control_proven_posture_history_organization_idx" ON "control_proven_posture_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "control_technique_test_results_organization_idx" ON "control_technique_test_results" USING btree ("tenant_id","organization_id");--> statement-breakpoint
CREATE INDEX "control_technique_test_results_technique_idx" ON "control_technique_test_results" USING btree ("mitre_technique_id","tenant_id","organization_id");--> statement-breakpoint
CREATE INDEX "entry_openings_asset_evidence_idx" ON "entry_openings" USING btree ("asset_evidence_id");--> statement-breakpoint
CREATE INDEX "entry_openings_supporting_asset_idx" ON "entry_openings" USING btree ("supporting_asset_id");--> statement-breakpoint
CREATE INDEX "entry_openings_cve_idx" ON "entry_openings" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "treatment_plans_organization_idx" ON "treatment_plans" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "budget_review_closed_figures_line_idx" ON "budget_review_closed_figures" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "budget_review_closed_tolerances_risk_scenario_idx" ON "budget_review_closed_tolerances" USING btree ("risk_scenario_id");--> statement-breakpoint
CREATE INDEX "budget_review_line_controls_review_idx" ON "budget_review_line_controls" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "budget_review_lines_review_idx" ON "budget_review_lines" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "budget_reviews_organization_idx" ON "budget_reviews" USING btree ("organization_id");
--> statement-breakpoint
-- Hand-written from here on: drizzle-kit generates no function and no trigger.
CREATE OR REPLACE FUNCTION public.asset_evidence_derived_state(history public.asset_evidence_history[])
 RETURNS TABLE(state text, state_changed_at timestamp with time zone, entered_at timestamp with time zone)
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  current_row asset_evidence_history;
  previous_row asset_evidence_history;
BEGIN
  FOR current_row IN SELECT h.* FROM unnest(history) h ORDER BY h.state_changed_at, h.id LOOP
    IF previous_row.id IS NULL OR previous_row.state <> current_row.state THEN
      entered_at := asset_evidence_history_entered_at(current_row.observed_at, current_row.state_changed_at, previous_row.state_changed_at);
    END IF;
    previous_row := current_row;
  END LOOP;
  state := previous_row.state;
  state_changed_at := previous_row.state_changed_at;
  RETURN NEXT;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.asset_evidence_history_entered_at(observed_at timestamp with time zone, state_changed_at timestamp with time zone, previous_state_changed_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT greatest(coalesce(observed_at, state_changed_at), previous_state_changed_at)
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.asset_evidence_history_refresh_state()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Taken in a statement of its own, in id order: a statement that waits for a row lock re-checks the
  -- row but not the log it already read, so the derivation below has to start after the wait to see
  -- the row a concurrent writer committed.
  PERFORM 1 FROM asset_evidence e
  WHERE (e.tenant_id, e.id) IN (SELECT tenant_id, asset_evidence_id FROM touched_rows)
  ORDER BY e.id
  FOR NO KEY UPDATE;
  UPDATE asset_evidence e SET
    current_state = coalesce(d.state, 'applicable'),
    current_state_changed_at = coalesce(d.state_changed_at, e.created_at),
    current_state_since = coalesce(d.entered_at, e.created_at)
  FROM (SELECT DISTINCT tenant_id, asset_evidence_id FROM touched_rows) t
  CROSS JOIN LATERAL asset_evidence_derived_state((
    SELECT array_agg(h ORDER BY h.state_changed_at, h.id)
    FROM asset_evidence_history h
    WHERE h.tenant_id = t.tenant_id AND h.asset_evidence_id = t.asset_evidence_id
  )) d
  WHERE e.id = t.asset_evidence_id AND e.tenant_id = t.tenant_id
    AND (e.current_state, e.current_state_changed_at, e.current_state_since) IS DISTINCT FROM (
      coalesce(d.state, 'applicable'),
      coalesce(d.state_changed_at, e.created_at),
      coalesce(d.entered_at, e.created_at)
    );
  RETURN NULL;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.asset_evidence_initial_state()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.current_state_changed_at := NEW.created_at;
  NEW.current_state_since := NEW.created_at;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.asset_evidence_verdicts_refresh_latest()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Taken in a statement of its own, in id order: a statement that waits for a row lock re-checks the
  -- row but not the log it already read, so the derivation below has to start after the wait to see
  -- the row a concurrent writer committed.
  PERFORM 1 FROM asset_evidence e
  WHERE (e.tenant_id, e.id) IN (SELECT tenant_id, asset_evidence_id FROM touched_rows)
  ORDER BY e.id
  FOR NO KEY UPDATE;
  UPDATE asset_evidence e SET
    latest_verdict_exposed = r.is_exposed,
    latest_verdict_observed_at = r.observed_at
  FROM (SELECT DISTINCT tenant_id, asset_evidence_id FROM touched_rows) t
  CROSS JOIN LATERAL (
    SELECT v.is_exposed, v.observed_at
    FROM asset_evidence_verdicts v
    WHERE v.tenant_id = t.tenant_id AND v.asset_evidence_id = t.asset_evidence_id
    ORDER BY v.recorded_at DESC, v.observed_at DESC, v.id DESC
    LIMIT 1
  ) r
  WHERE e.id = t.asset_evidence_id AND e.tenant_id = t.tenant_id
    AND (e.latest_verdict_exposed, e.latest_verdict_observed_at) IS DISTINCT FROM (r.is_exposed, r.observed_at);
  RETURN NULL;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_global()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  PERFORM pg_notify('data_changed', json_build_object(
    'table',       TG_TABLE_NAME,
    'op',          TG_OP,
    'origin',      nullif(current_setting('app.job_kind', true), ''),
    'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_self_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  PERFORM pg_notify('data_changed', json_build_object(
    'tenantId',    COALESCE(NEW.id, OLD.id),
    'table',       TG_TABLE_NAME,
    'op',          TG_OP,
    'origin',      nullif(current_setting('app.job_kind', true), ''),
    'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_masked record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NULL;
    END IF;
    IF TG_NARGS > 0 THEN
      v_masked := NEW;
      IF 'last_reported_at' = ANY(TG_ARGV) THEN
        v_masked.last_reported_at := OLD.last_reported_at;
      END IF;
      IF 'last_seen_at' = ANY(TG_ARGV) THEN
        v_masked.last_seen_at := OLD.last_seen_at;
      END IF;
      IF 'last_ingested_at' = ANY(TG_ARGV) THEN
        v_masked.last_ingested_at := OLD.last_ingested_at;
      END IF;
      IF v_masked IS NOT DISTINCT FROM OLD THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  PERFORM pg_notify('data_changed', json_build_object(
    'tenantId',    COALESCE(NEW.tenant_id, OLD.tenant_id),
    'table',       TG_TABLE_NAME,
    'op',          TG_OP,
    'origin',      nullif(current_setting('app.job_kind', true), ''),
    'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_tenant_via_2hop_fk()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_fk_id    uuid;
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_fk_id USING COALESCE(NEW, OLD);
  EXECUTE format(
    'SELECT f.tenant_id FROM %I f JOIN %I m ON m.%I = f.id WHERE m.id = $1',
    TG_ARGV[3], TG_ARGV[1], TG_ARGV[2]
  ) INTO v_tenant_id USING v_fk_id;
  IF v_tenant_id IS NOT NULL THEN
    PERFORM pg_notify('data_changed', json_build_object(
      'tenantId',    v_tenant_id,
      'table',       TG_TABLE_NAME,
      'op',          TG_OP,
      'origin',      nullif(current_setting('app.job_kind', true), ''),
      'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
    )::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_tenant_via_crq_run()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  SELECT rs.tenant_id INTO v_tenant_id
  FROM crq_indicator_runs r
  JOIN risk_scenarios rs ON rs.id = r.risk_scenario_id
  WHERE r.id = COALESCE(NEW.run_id, OLD.run_id);
  IF v_tenant_id IS NOT NULL THEN
    PERFORM pg_notify('data_changed', json_build_object(
      'tenantId',    v_tenant_id,
      'table',       TG_TABLE_NAME,
      'op',          TG_OP,
      'origin',      nullif(current_setting('app.job_kind', true), ''),
      'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
    )::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_tenant_via_fk()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_fk_id    uuid;
  v_tenant_id uuid;
  v_masked   record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NULL;
    END IF;
    IF TG_NARGS > 2 THEN
      v_masked := NEW;
      IF 'last_reported_at' = ANY(TG_ARGV[2:]) THEN
        v_masked.last_reported_at := OLD.last_reported_at;
      END IF;
      IF 'last_seen_at' = ANY(TG_ARGV[2:]) THEN
        v_masked.last_seen_at := OLD.last_seen_at;
      END IF;
      IF 'last_ingested_at' = ANY(TG_ARGV[2:]) THEN
        v_masked.last_ingested_at := OLD.last_ingested_at;
      END IF;
      IF v_masked IS NOT DISTINCT FROM OLD THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_fk_id USING COALESCE(NEW, OLD);
  EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', TG_ARGV[1]) INTO v_tenant_id USING v_fk_id;
  IF v_tenant_id IS NOT NULL THEN
    PERFORM pg_notify('data_changed', json_build_object(
      'tenantId',    v_tenant_id,
      'table',       TG_TABLE_NAME,
      'op',          TG_OP,
      'origin',      nullif(current_setting('app.job_kind', true), ''),
      'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
    )::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_data_changed_tenant_via_tef_estimate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  SELECT rs.tenant_id INTO v_tenant_id
  FROM tef_estimates te
  JOIN risk_scenarios rs ON rs.id = te.risk_scenario_id
  WHERE te.id = COALESCE(NEW.tef_estimate_id, OLD.tef_estimate_id);
  IF v_tenant_id IS NOT NULL THEN
    PERFORM pg_notify('data_changed', json_build_object(
      'tenantId',    v_tenant_id,
      'table',       TG_TABLE_NAME,
      'op',          TG_OP,
      'origin',      nullif(current_setting('app.job_kind', true), ''),
      'interactive', nullif(current_setting('app.job_interactive', true), '')::boolean
    )::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_jobs_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('jobs_changed', json_build_object(
      'jobId', NEW.id,
      'kind', NEW.kind,
      'tenantId', NEW.tenant_id
    )::text);
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'queued' AND OLD.status <> 'queued' THEN
    PERFORM pg_notify('jobs_changed', json_build_object(
      'jobId', NEW.id,
      'kind', NEW.kind,
      'tenantId', NEW.tenant_id
    )::text);
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_opencti_config_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.enabled IS DISTINCT FROM OLD.enabled
     OR NEW.stream_id IS DISTINCT FROM OLD.stream_id
     OR NEW.service_account_id IS DISTINCT FROM OLD.service_account_id
     OR NEW.stream_generation IS DISTINCT FROM OLD.stream_generation
     OR (OLD.cursor IS NOT NULL AND NEW.cursor IS NULL)
     OR (OLD.last_event_at IS NOT NULL AND NEW.last_event_at IS NULL)
     OR (OLD.history_start_at IS NOT NULL AND NEW.history_start_at IS NULL)
     OR (OLD.reached_live_tail_at IS NOT NULL AND NEW.reached_live_tail_at IS NULL)
  THEN
    PERFORM pg_notify('opencti_config_changed', NEW.tenant_id::text);
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_opencti_service_account_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pg_notify('opencti_config_changed', tenant_id::text)
  FROM opencti_connector_settings
  WHERE service_account_id = NEW.id;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_session_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pg_notify('session_revoked', OLD.id::text);
  RETURN OLD;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER asset_enumerations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_enumerations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_reported_at');
--> statement-breakpoint
CREATE TRIGGER asset_evidence_initial_state BEFORE INSERT ON public.asset_evidence FOR EACH ROW EXECUTE FUNCTION public.asset_evidence_initial_state();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_evidence FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_history_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_evidence_history FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_history_refresh_state_deleted AFTER DELETE ON public.asset_evidence_history REFERENCING OLD TABLE AS touched_rows FOR EACH STATEMENT EXECUTE FUNCTION public.asset_evidence_history_refresh_state();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_history_refresh_state_inserted AFTER INSERT ON public.asset_evidence_history REFERENCING NEW TABLE AS touched_rows FOR EACH STATEMENT EXECUTE FUNCTION public.asset_evidence_history_refresh_state();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_source_software_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_evidence_source_software FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_sources_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_evidence_sources FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_seen_at', 'last_reported_at');
--> statement-breakpoint
CREATE TRIGGER asset_evidence_verdicts_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_evidence_verdicts FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_evidence_verdicts_refresh_latest AFTER INSERT ON public.asset_evidence_verdicts REFERENCING NEW TABLE AS touched_rows FOR EACH STATEMENT EXECUTE FUNCTION public.asset_evidence_verdicts_refresh_latest();
--> statement-breakpoint
CREATE TRIGGER asset_group_members_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_group_members FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_groups_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_groups FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_posture_history_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_posture_history FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_postures_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_postures FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER asset_technique_scores_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.asset_technique_scores FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER attack_outcome_mitre_techniques_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.attack_outcome_mitre_techniques FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('attack_outcome_id', 'attack_outcomes');
--> statement-breakpoint
CREATE TRIGGER attack_outcome_mixture_groups_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.attack_outcome_mixture_groups FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER attack_outcome_mixtures_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.attack_outcome_mixtures FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER attack_outcomes_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.attack_outcomes FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER attack_surface_mitre_techniques_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.attack_surface_mitre_techniques FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('attack_surface_id', 'attack_surfaces');
--> statement-breakpoint
CREATE TRIGGER attack_surfaces_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.attack_surfaces FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER budget_review_closed_figures_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.budget_review_closed_figures FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER budget_review_closed_postures_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.budget_review_closed_postures FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER budget_review_closed_tolerances_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.budget_review_closed_tolerances FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER budget_review_line_controls_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.budget_review_line_controls FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER budget_review_lines_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.budget_review_lines FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER budget_reviews_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.budget_reviews FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER business_value_categories_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.business_value_categories FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER capabilities_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.capabilities FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER compliance_assessment_answers_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.compliance_assessment_answers FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER compliance_assessments_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.compliance_assessments FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER compliance_framework_nodes_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.compliance_framework_nodes FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER compliance_frameworks_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.compliance_frameworks FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER compliance_requirement_controls_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.compliance_requirement_controls FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER control_capabilities_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capabilities FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER control_capability_assessment_event_sources_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_assessment_event_sources FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER control_capability_assessment_events_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_assessment_events FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER control_capability_assessment_sources_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_assessment_sources FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER control_capability_assessments_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_assessments FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER control_capability_crosswalk_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_crosswalk FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER control_capability_edges_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_edges FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER control_capability_protected_families_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_protected_families FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER control_capability_scope_overrides_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_scope_overrides FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER control_capability_strength_rung_labels_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_strength_rung_labels FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER control_capability_technique_overrides_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_capability_technique_overrides FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER control_proven_posture_history_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_proven_posture_history FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER control_technique_test_results_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.control_technique_test_results FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER countries_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.countries FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER crq_budget_review_annual_losses_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_budget_review_annual_losses FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER crq_budget_review_results_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_budget_review_results FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('review_id', 'budget_reviews', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER crq_control_what_if_results_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_control_what_if_results FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER crq_cve_what_if_results_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_cve_what_if_results FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER crq_indicator_group_scores_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_group_scores FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER crq_indicator_run_annual_losses_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_run_annual_losses FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER crq_indicator_run_reach_gaps_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_run_reach_gaps FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER crq_indicator_run_unplayable_obstacles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_run_unplayable_obstacles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER crq_indicator_runs_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_runs FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER crq_indicator_settings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_settings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER crq_indicator_tef_inputs_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_indicator_tef_inputs FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER crq_plan_what_if_results_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_plan_what_if_results FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('plan_id', 'treatment_plans', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER crq_technique_what_if_results_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.crq_technique_what_if_results FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_crq_run();
--> statement-breakpoint
CREATE TRIGGER cve_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cve FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cve_affected_versions_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cve_affected_versions FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cve_references_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cve_references FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cve_source_observations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cve_source_observations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cve_technique_mapping_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cve_technique_mapping FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cve_technique_resolution_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cve_technique_resolution FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cwe_technique_links_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cwe_technique_links FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER cwe_technique_overrides_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cwe_technique_overrides FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER cwe_weaknesses_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.cwe_weaknesses FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER dashboard_settings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.dashboard_settings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER declared_estate_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.declared_estate FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER declared_estate_events_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.declared_estate_events FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER default_threats_settings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.default_threats_settings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER drata_controls_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.drata_controls FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER drata_frameworks_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.drata_frameworks FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_reported_at');
--> statement-breakpoint
CREATE TRIGGER drata_requirement_controls_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.drata_requirement_controls FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('requirement_id', 'drata_requirements');
--> statement-breakpoint
CREATE TRIGGER drata_requirements_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.drata_requirements FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER entry_openings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.entry_openings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER financial_profile_events_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.financial_profile_events FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER financial_profiles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.financial_profiles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER finding_metric_daily_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.finding_metric_daily FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER finding_score_history_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.finding_score_history FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER finding_scores_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.finding_scores FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER group_roles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.group_roles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('group_id', 'groups');
--> statement-breakpoint
CREATE TRIGGER group_users_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.group_users FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('group_id', 'groups');
--> statement-breakpoint
CREATE TRIGGER groups_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER integration_settings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.integration_settings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_reported_at');
--> statement-breakpoint
CREATE TRIGGER job_errors_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.job_errors FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('job_id', 'jobs');
--> statement-breakpoint
CREATE TRIGGER job_schedules_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.job_schedules FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER jobs_notify_changed AFTER INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_jobs_changed();
--> statement-breakpoint
CREATE TRIGGER jobs_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER loss_categories_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.loss_categories FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER loss_driver_activations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.loss_driver_activations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('attack_outcome_id', 'attack_outcomes');
--> statement-breakpoint
CREATE TRIGGER loss_drivers_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.loss_drivers FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER mitre_mitigation_techniques_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.mitre_mitigation_techniques FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER mitre_mitigations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.mitre_mitigations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER mitre_tactics_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.mitre_tactics FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER mitre_technique_tactics_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.mitre_technique_tactics FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER mitre_techniques_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.mitre_techniques FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER notifications_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER openaev_assets_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.openaev_assets FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER openaev_attack_observations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.openaev_attack_observations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_reported_at');
--> statement-breakpoint
CREATE TRIGGER openaev_sync_streams_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.openaev_sync_streams FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER opencti_connector_settings_notify_config_changed AFTER INSERT OR UPDATE ON public.opencti_connector_settings FOR EACH ROW EXECUTE FUNCTION public.notify_opencti_config_changed();
--> statement-breakpoint
CREATE TRIGGER opencti_connector_settings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.opencti_connector_settings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER opencti_stream_objects_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.opencti_stream_objects FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER opencti_stream_report_refs_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.opencti_stream_report_refs FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER organization_asset_mapping_event_assets_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organization_asset_mapping_event_assets FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER organization_asset_mapping_events_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organization_asset_mapping_events FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER organization_assets_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organization_assets FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER organization_identity_events_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organization_identity_events FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER organization_risk_tolerances_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organization_risk_tolerances FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER organization_unpins_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organization_unpins FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER organizations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER platform_capabilities_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.platform_capabilities FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER platform_group_roles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.platform_group_roles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER platform_group_users_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.platform_group_users FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER platform_groups_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.platform_groups FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER platform_role_capabilities_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.platform_role_capabilities FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER platform_roles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.platform_roles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER primary_asset_business_value_categories_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.primary_asset_business_value_categories FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('primary_asset_id', 'primary_assets');
--> statement-breakpoint
CREATE TRIGGER primary_asset_reach_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.primary_asset_reach FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER primary_assets_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.primary_assets FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER primary_to_primary_links_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.primary_to_primary_links FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER risk_scenario_business_value_categories_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.risk_scenario_business_value_categories FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER risk_scenario_primary_assets_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.risk_scenario_primary_assets FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER risk_scenario_risk_tolerances_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.risk_scenario_risk_tolerances FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER risk_scenarios_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.risk_scenarios FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER role_capabilities_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.role_capabilities FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('role_id', 'roles');
--> statement-breakpoint
CREATE TRIGGER roles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER scenario_loss_estimates_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.scenario_loss_estimates FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER sectors_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.sectors FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER security_platform_families_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.security_platform_families FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER security_platform_family_controls_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.security_platform_family_controls FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
--> statement-breakpoint
CREATE TRIGGER service_account_groups_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.service_account_groups FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('service_account_id', 'service_accounts');
--> statement-breakpoint
CREATE TRIGGER service_account_tokens_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.service_account_tokens FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER service_accounts_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.service_accounts FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER service_accounts_notify_opencti_config_changed AFTER UPDATE OF active ON public.service_accounts FOR EACH ROW WHEN ((old.active IS DISTINCT FROM new.active)) EXECUTE FUNCTION public.notify_opencti_service_account_changed();
--> statement-breakpoint
CREATE TRIGGER sessions_notify_session_revoked AFTER DELETE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.notify_session_revoked();
--> statement-breakpoint
CREATE TRIGGER stored_files_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.stored_files FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER support_to_primary_links_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.support_to_primary_links FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER support_to_support_links_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.support_to_support_links FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER supporting_asset_ai_target_properties_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_ai_target_properties FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER supporting_asset_criticality_lifts_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_criticality_lifts FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER supporting_asset_identity_properties_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_identity_properties FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER supporting_asset_machine_properties_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_machine_properties FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER supporting_asset_manual_values_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_manual_values FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('supporting_asset_id', 'supporting_assets');
--> statement-breakpoint
CREATE TRIGGER supporting_asset_relations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_relations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_reported_at');
--> statement-breakpoint
CREATE TRIGGER supporting_asset_sources_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_sources FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_seen_at');
--> statement-breakpoint
CREATE TRIGGER supporting_asset_tags_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_asset_tags FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER supporting_assets_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.supporting_assets FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_seen_at');
--> statement-breakpoint
CREATE TRIGGER tag_sources_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.tag_sources FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER tags_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER tef_estimate_contributions_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.tef_estimate_contributions FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_tef_estimate();
--> statement-breakpoint
CREATE TRIGGER tef_estimates_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.tef_estimates FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('risk_scenario_id', 'risk_scenarios');
--> statement-breakpoint
CREATE TRIGGER tenant_users_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.tenant_users FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER tenants_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_self_tenant();
--> statement-breakpoint
CREATE TRIGGER threat_activity_anchors_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_activity_anchors FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER threat_analyses_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analyses FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('last_ingested_at');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_aliases_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_aliases FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_attributions_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_attributions FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_counts_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_counts FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER threat_analysis_cves_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_cves FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_goals_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_goals FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_locations_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_locations FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_outcome_probabilities_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_outcome_probabilities FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER threat_analysis_roles_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_roles FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_secondary_motives_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_secondary_motives FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_sectors_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_sectors FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_techniques_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_techniques FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_analysis_threat_actor_types_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_analysis_threat_actor_types FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('analysis_id', 'threat_analyses');
--> statement-breakpoint
CREATE TRIGGER threat_outcome_counter_versions_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_outcome_counter_versions FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER threat_outcome_scores_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_outcome_scores FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER threat_relevance_settings_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.threat_relevance_settings FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER treatment_plan_moves_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.treatment_plan_moves FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_2hop_fk('plan_id', 'treatment_plans', 'organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER treatment_plans_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.treatment_plans FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant_via_fk('organization_id', 'organizations');
--> statement-breakpoint
CREATE TRIGGER unique_finding_score_history_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.unique_finding_score_history FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER unique_finding_scores_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.unique_finding_scores FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();
--> statement-breakpoint
CREATE TRIGGER users_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_global();
