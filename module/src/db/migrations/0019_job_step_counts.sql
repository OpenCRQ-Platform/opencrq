CREATE TABLE "job_step_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"step" text NOT NULL,
	"entity" text NOT NULL,
	"mode" text,
	"read" integer DEFAULT 0 NOT NULL,
	"written" integer DEFAULT 0 NOT NULL,
	"created" integer,
	"removed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_step_counts" ADD CONSTRAINT "job_step_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step_counts" ADD CONSTRAINT "job_step_counts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_step_counts_job_step_entity_uq" ON "job_step_counts" USING btree ("job_id","step","entity");--> statement-breakpoint
CREATE TRIGGER job_step_counts_notify_data_changed
  AFTER INSERT OR UPDATE OR DELETE ON job_step_counts
  FOR EACH ROW EXECUTE FUNCTION notify_data_changed_tenant();