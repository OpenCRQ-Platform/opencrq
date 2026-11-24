CREATE TABLE "opencti_stream_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_event_at" timestamp with time zone,
	"history_start_at" timestamp with time zone,
	"backfill_target_at" timestamp with time zone,
	"reached_live_tail_at" timestamp with time zone,
	"stream_generation" integer DEFAULT 0 NOT NULL,
	"objects_read" bigint DEFAULT 0 NOT NULL,
	"objects_read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "opencti_stream_state" ADD CONSTRAINT "opencti_stream_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" ADD COLUMN "threat_visibility" text DEFAULT 'per_member' NOT NULL;--> statement-breakpoint
UPDATE "opencti_connector_settings" AS s SET "threat_visibility" = t."threat_visibility"
  FROM "tenants" AS t
  WHERE t."id" = s."tenant_id" AND t."threat_visibility" <> 'per_member';--> statement-breakpoint
INSERT INTO "opencti_connector_settings" ("id", "tenant_id", "threat_visibility")
  SELECT t."id", t."id", t."threat_visibility"
  FROM "tenants" AS t
  WHERE t."threat_visibility" <> 'per_member'
    AND NOT EXISTS (SELECT 1 FROM "opencti_connector_settings" AS s WHERE s."tenant_id" = t."id");--> statement-breakpoint
INSERT INTO "opencti_stream_state" ("tenant_id", "cursor", "last_event_at", "history_start_at", "backfill_target_at", "reached_live_tail_at", "stream_generation", "objects_read", "objects_read_at")
  SELECT "tenant_id", "cursor", "last_event_at", "history_start_at", "backfill_target_at", "reached_live_tail_at", "stream_generation", "objects_read", "objects_read_at"
  FROM "opencti_connector_settings";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" ADD CONSTRAINT "opencti_connector_settings_threat_visibility_ck" CHECK ("opencti_connector_settings"."threat_visibility" IN ('per_member', 'service_account'));--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_threat_visibility_ck";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "threat_visibility";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "last_event_at";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "history_start_at";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "backfill_target_at";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "reached_live_tail_at";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "stream_generation";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "objects_read";--> statement-breakpoint
ALTER TABLE "opencti_connector_settings" DROP COLUMN "objects_read_at";--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_opencti_config_changed() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.enabled IS DISTINCT FROM OLD.enabled
     OR NEW.stream_id IS DISTINCT FROM OLD.stream_id
     OR NEW.service_account_id IS DISTINCT FROM OLD.service_account_id
  THEN
    PERFORM pg_notify('opencti_config_changed', NEW.tenant_id::text);
  END IF;
  RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_opencti_stream_state_changed() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.stream_generation IS DISTINCT FROM OLD.stream_generation
     OR (OLD.cursor IS NOT NULL AND NEW.cursor IS NULL)
     OR (OLD.last_event_at IS NOT NULL AND NEW.last_event_at IS NULL)
     OR (OLD.history_start_at IS NOT NULL AND NEW.history_start_at IS NULL)
     OR (OLD.reached_live_tail_at IS NOT NULL AND NEW.reached_live_tail_at IS NULL)
  THEN
    PERFORM pg_notify('opencti_config_changed', NEW.tenant_id::text);
  END IF;
  RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION create_opencti_stream_state() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO opencti_stream_state (tenant_id) VALUES (NEW.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER opencti_connector_settings_create_stream_state
  AFTER INSERT ON opencti_connector_settings
  FOR EACH ROW EXECUTE FUNCTION create_opencti_stream_state();--> statement-breakpoint
CREATE TRIGGER opencti_stream_state_notify_config_changed
  AFTER UPDATE ON opencti_stream_state
  FOR EACH ROW EXECUTE FUNCTION notify_opencti_stream_state_changed();--> statement-breakpoint
CREATE TRIGGER opencti_stream_state_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON opencti_stream_state
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();
