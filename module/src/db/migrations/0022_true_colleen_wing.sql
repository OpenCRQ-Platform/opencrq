ALTER TABLE "business_value_categories" ADD CONSTRAINT "business_value_categories_id_tenant_id_uq" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "loss_drivers" ADD CONSTRAINT "loss_drivers_id_tenant_id_uq" UNIQUE("id","tenant_id");--> statement-breakpoint
CREATE TABLE "requirement_loss_driver_activations" (
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"loss_driver_id" uuid NOT NULL,
	CONSTRAINT "requirement_loss_driver_activations_pk" PRIMARY KEY("requirement_id","loss_driver_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"primary_asset_id" uuid,
	"business_value_category_id" uuid,
	CONSTRAINT "requirement_targets_one_target_ck" CHECK (num_nonnulls("requirement_targets"."primary_asset_id", "requirement_targets"."business_value_category_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_folded" text GENERATED ALWAYS AS (fold_text(name)) STORED,
	"description" text,
	"interested_party" text NOT NULL,
	"protects_confidentiality" boolean DEFAULT false NOT NULL,
	"protects_integrity" boolean DEFAULT false NOT NULL,
	"protects_availability" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_id_tenant_id_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "requirement_loss_driver_activations" ADD CONSTRAINT "requirement_loss_driver_activations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_loss_driver_activations" ADD CONSTRAINT "requirement_loss_driver_activations_requirement_fk" FOREIGN KEY ("requirement_id","tenant_id") REFERENCES "public"."requirements"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_loss_driver_activations" ADD CONSTRAINT "requirement_loss_driver_activations_loss_driver_fk" FOREIGN KEY ("loss_driver_id","tenant_id") REFERENCES "public"."loss_drivers"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_targets" ADD CONSTRAINT "requirement_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_targets" ADD CONSTRAINT "requirement_targets_requirement_fk" FOREIGN KEY ("requirement_id","tenant_id") REFERENCES "public"."requirements"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_targets" ADD CONSTRAINT "requirement_targets_primary_asset_fk" FOREIGN KEY ("primary_asset_id","tenant_id") REFERENCES "public"."primary_assets"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_targets" ADD CONSTRAINT "requirement_targets_category_fk" FOREIGN KEY ("business_value_category_id","tenant_id") REFERENCES "public"."business_value_categories"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_loss_driver_activations_loss_driver_idx" ON "requirement_loss_driver_activations" USING btree ("loss_driver_id");--> statement-breakpoint
CREATE INDEX "requirement_targets_requirement_idx" ON "requirement_targets" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_targets_primary_asset_uq" ON "requirement_targets" USING btree ("primary_asset_id","requirement_id") WHERE "requirement_targets"."primary_asset_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_targets_category_uq" ON "requirement_targets" USING btree ("business_value_category_id","requirement_id") WHERE "requirement_targets"."business_value_category_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "requirements_organization_tenant_idx" ON "requirements" USING btree ("organization_id","tenant_id");--> statement-breakpoint
CREATE TRIGGER requirements_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON requirements
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();--> statement-breakpoint
CREATE TRIGGER requirement_targets_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON requirement_targets
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();--> statement-breakpoint
CREATE TRIGGER requirement_loss_driver_activations_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON requirement_loss_driver_activations
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();
