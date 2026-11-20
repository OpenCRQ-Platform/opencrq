ALTER TABLE "tef_estimates" ALTER COLUMN "catalog_vintage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "country_iso_alpha3" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "sector_name" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "size_source" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "read_country" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "read_sector" text;--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "read_size_classes" text[];--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "read_size_weights" double precision[];--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "not_measured" text[];--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD COLUMN "source_ids" text[];--> statement-breakpoint
ALTER TABLE "tef_estimates" ADD CONSTRAINT "tef_estimates_catalogue_read_ck" CHECK (("tef_estimates"."catalog_vintage" IS NOT NULL AND "tef_estimates"."catalog_id" IS NULL AND "tef_estimates"."catalog_version" IS NULL) OR (
    "tef_estimates"."catalog_vintage" IS NULL
    AND "tef_estimates"."catalog_id" IS NOT NULL
    AND "tef_estimates"."catalog_version" IS NOT NULL
    AND "tef_estimates"."size_source" IN ('employee_count', 'revenue_band', 'none')
    AND "tef_estimates"."read_country" IS NOT NULL
    AND "tef_estimates"."read_size_classes" IS NOT NULL
    AND "tef_estimates"."read_size_weights" IS NOT NULL
    AND cardinality("tef_estimates"."read_size_classes") = cardinality("tef_estimates"."read_size_weights")
    AND "tef_estimates"."not_measured" IS NOT NULL
    AND "tef_estimates"."source_ids" IS NOT NULL
  ));