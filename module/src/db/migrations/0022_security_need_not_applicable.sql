ALTER TABLE "primary_assets" DROP CONSTRAINT "primary_assets_availability_ck";--> statement-breakpoint
ALTER TABLE "primary_assets" DROP CONSTRAINT "primary_assets_integrity_ck";--> statement-breakpoint
ALTER TABLE "primary_assets" DROP CONSTRAINT "primary_assets_confidentiality_ck";--> statement-breakpoint
ALTER TABLE "primary_assets" DROP CONSTRAINT "primary_assets_traceability_ck";--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_availability_ck" CHECK ("primary_assets"."availability" IN ('not_applicable', 'low', 'medium', 'high', 'very_high'));--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_integrity_ck" CHECK ("primary_assets"."integrity" IN ('not_applicable', 'low', 'medium', 'high', 'very_high'));--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_confidentiality_ck" CHECK ("primary_assets"."confidentiality" IN ('not_applicable', 'low', 'medium', 'high', 'very_high'));--> statement-breakpoint
ALTER TABLE "primary_assets" ADD CONSTRAINT "primary_assets_traceability_ck" CHECK ("primary_assets"."traceability" IN ('not_applicable', 'low', 'medium', 'high', 'very_high'));