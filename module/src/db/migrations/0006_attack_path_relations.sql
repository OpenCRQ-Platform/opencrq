ALTER TABLE "supporting_asset_relations" DROP CONSTRAINT "supporting_asset_relations_kind_ck";--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" DROP CONSTRAINT "supporting_asset_relations_source_ck";--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD COLUMN "evidence_ref" text;--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD CONSTRAINT "supporting_asset_relations_kind_ck" CHECK ("supporting_asset_relations"."kind" IN ('primary_user_of', 'reachable_from'));--> statement-breakpoint
ALTER TABLE "supporting_asset_relations" ADD CONSTRAINT "supporting_asset_relations_source_ck" CHECK ("supporting_asset_relations"."source" IN ('entra_registered_owner', 'intune_primary_user', 'openaev_attack_path_proven', 'openaev_attack_path_inferred'));