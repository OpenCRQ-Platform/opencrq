ALTER TABLE "cve" ADD COLUMN "remediation_read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "crq_cve_what_if_results_cve_idx" ON "crq_cve_what_if_results" USING btree ("cve_id");--> statement-breakpoint
-- A CVE holding references had its NVD record read for its remediation by an earlier crawl.
UPDATE "cve" SET "remediation_read_at" = "updated_at"
WHERE "remediation_read_at" IS NULL AND EXISTS (SELECT 1 FROM "cve_references" WHERE "cve_references"."cve_id" = "cve"."id");
