CREATE TABLE "onboarding_wizards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "onboarding_wizards_organization_uq" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "primary_assets" ADD COLUMN "onboarding_template" text;--> statement-breakpoint
ALTER TABLE "onboarding_wizards" ADD CONSTRAINT "onboarding_wizards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_wizards" ADD CONSTRAINT "onboarding_wizards_organization_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."organizations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_onboarding_template_ck" CHECK ("primary_assets"."onboarding_template" IN ('customer-data', 'payments-and-treasury', 'production-and-operations', 'hr-data', 'intellectual-property', 'email-and-collaboration'));--> statement-breakpoint
CREATE UNIQUE INDEX "primary_assets_organization_onboarding_template_uq" ON "primary_assets" USING btree ("organization_id","onboarding_template") WHERE "primary_assets"."onboarding_template" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER onboarding_wizards_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON onboarding_wizards
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();
