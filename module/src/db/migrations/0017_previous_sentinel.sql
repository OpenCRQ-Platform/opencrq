CREATE TABLE "dependency_rule_suppressions" (
	"tenant_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependency_rule_suppressions_pk" PRIMARY KEY("tenant_id","supporting_asset_id","primary_asset_id")
);
--> statement-breakpoint
CREATE TABLE "dependency_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	"roles" text[] DEFAULT '{unknown}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"category_id" text,
	"subcategory_id" text,
	"name_pattern" text,
	"name_pattern_kind" text,
	"tag_id" uuid,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependency_rules_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "dependency_rules_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "dependency_rules_roles_known_ck" CHECK ("dependency_rules"."roles" <@ ARRAY['stores', 'processes', 'reads', 'transmits', 'administers', 'monitors', 'supports_availability', 'performs', 'unknown']::text[]),
	CONSTRAINT "dependency_rules_roles_not_empty_ck" CHECK (cardinality("dependency_rules"."roles") > 0),
	CONSTRAINT "dependency_rules_roles_unknown_alone_ck" CHECK (NOT ('unknown' = ANY("dependency_rules"."roles")) OR cardinality("dependency_rules"."roles") = 1),
	CONSTRAINT "dependency_rules_pattern_pair_ck" CHECK (("dependency_rules"."name_pattern" IS NULL) = ("dependency_rules"."name_pattern_kind" IS NULL)),
	CONSTRAINT "dependency_rules_pattern_kind_ck" CHECK ("dependency_rules"."name_pattern_kind" IN ('glob', 'regex')),
	CONSTRAINT "dependency_rules_condition_ck" CHECK (num_nonnulls("dependency_rules"."category_id", "dependency_rules"."subcategory_id", "dependency_rules"."name_pattern", "dependency_rules"."tag_id", "dependency_rules"."source") > 0)
);
--> statement-breakpoint
ALTER TABLE "support_to_primary_links" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "dependency_rule_suppressions" ADD CONSTRAINT "dependency_rule_suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_rule_suppressions" ADD CONSTRAINT "dependency_rule_suppressions_supporting_asset_fk" FOREIGN KEY ("supporting_asset_id","tenant_id") REFERENCES "public"."supporting_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_rule_suppressions" ADD CONSTRAINT "dependency_rule_suppressions_primary_asset_fk" FOREIGN KEY ("primary_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_rules" ADD CONSTRAINT "dependency_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_rules" ADD CONSTRAINT "dependency_rules_primary_asset_tenant_fk" FOREIGN KEY ("primary_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependency_rules" ADD CONSTRAINT "dependency_rules_tag_tenant_fk" FOREIGN KEY ("tag_id","tenant_id") REFERENCES "public"."tags"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dependency_rule_suppressions_primary_asset_idx" ON "dependency_rule_suppressions" USING btree ("primary_asset_id","tenant_id");--> statement-breakpoint
CREATE INDEX "dependency_rules_primary_asset_idx" ON "dependency_rules" USING btree ("primary_asset_id","tenant_id");--> statement-breakpoint
CREATE INDEX "dependency_rules_tag_idx" ON "dependency_rules" USING btree ("tag_id","tenant_id");--> statement-breakpoint
ALTER TABLE "support_to_primary_links" ADD CONSTRAINT "support_to_primary_links_rule_tenant_fk" FOREIGN KEY ("rule_id","tenant_id") REFERENCES "public"."dependency_rules"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_to_primary_links_rule_idx" ON "support_to_primary_links" USING btree ("rule_id","tenant_id");--> statement-breakpoint
CREATE TRIGGER dependency_rules_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.dependency_rules FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();--> statement-breakpoint
CREATE TRIGGER dependency_rule_suppressions_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.dependency_rule_suppressions FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant();