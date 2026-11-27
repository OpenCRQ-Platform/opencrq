CREATE TABLE "openaev_scan_measurements" (
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"supporting_asset_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"scenario_name" text,
	"simulation_id" text,
	"observation_id" text NOT NULL,
	"platform_types" text[] NOT NULL,
	"result" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "openaev_scan_measurements_pk" PRIMARY KEY("connector_id","supporting_asset_id","scenario_id")
);
--> statement-breakpoint
ALTER TABLE "openaev_scan_measurements" ADD CONSTRAINT "openaev_scan_measurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_scan_measurements" ADD CONSTRAINT "openaev_scan_measurements_connector_id_integration_settings_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openaev_scan_measurements" ADD CONSTRAINT "openaev_scan_measurements_supporting_asset_id_supporting_assets_id_fk" FOREIGN KEY ("supporting_asset_id") REFERENCES "public"."supporting_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "openaev_scan_measurements_asset_idx" ON "openaev_scan_measurements" USING btree ("supporting_asset_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "openaev_scan_measurements_tenant_evaluated_idx" ON "openaev_scan_measurements" USING btree ("tenant_id","evaluated_at");--> statement-breakpoint
CREATE TRIGGER openaev_scan_measurements_notify_data_changed AFTER INSERT OR DELETE OR UPDATE ON public.openaev_scan_measurements FOR EACH ROW EXECUTE FUNCTION public.notify_data_changed_tenant('updated_at');