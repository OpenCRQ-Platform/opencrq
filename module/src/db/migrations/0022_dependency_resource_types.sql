CREATE TABLE "dependency_resource_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	CONSTRAINT "dependency_resource_types_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "dependency_resource_types_tenant_name_uq" UNIQUE("tenant_id","name_folded")
);
--> statement-breakpoint
ALTER TABLE "primary_to_primary_links" ADD COLUMN "dependency_resource_type_id" uuid;--> statement-breakpoint
ALTER TABLE "dependency_resource_types" ADD CONSTRAINT "dependency_resource_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_to_primary_links" ADD CONSTRAINT "primary_to_primary_links_resource_type_tenant_fk" FOREIGN KEY ("dependency_resource_type_id","tenant_id") REFERENCES "public"."dependency_resource_types"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "primary_to_primary_links_resource_type_idx" ON "primary_to_primary_links" USING btree ("dependency_resource_type_id","tenant_id") WHERE "primary_to_primary_links"."dependency_resource_type_id" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER dependency_resource_types_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON dependency_resource_types
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();
--> statement-breakpoint
INSERT INTO "dependency_resource_types" ("id", "tenant_id", "name")
SELECT gen_random_uuid(), "tenants"."id", CASE WHEN "tenants"."default_locale" = 'fr' THEN "defaults"."name_fr" ELSE "defaults"."name_en" END
FROM "tenants"
CROSS JOIN (VALUES
  ('IT', 'Informatique'),
  ('Supplier', 'Fournisseur'),
  ('Information', 'Information'),
  ('People', 'Personnes'),
  ('Premises', 'Locaux'),
  ('Equipment', 'Équipements'),
  ('Transport', 'Transport'),
  ('Finance', 'Finance')
) AS "defaults" ("name_en", "name_fr")
WHERE NOT EXISTS (SELECT 1 FROM "dependency_resource_types" WHERE "dependency_resource_types"."tenant_id" = "tenants"."id");
