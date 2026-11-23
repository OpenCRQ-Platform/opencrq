DROP INDEX "cve_updated_at_idx";--> statement-breakpoint
ALTER TABLE "cve_source_observations" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "cve_source_observations" DROP CONSTRAINT "cve_source_observations_cve_source_uq";--> statement-breakpoint
ALTER TABLE "cve_source_observations" ADD CONSTRAINT "cve_source_observations_cve_id_source_pk" PRIMARY KEY("cve_id","source");
