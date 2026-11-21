ALTER TABLE "threat_analyses" ADD COLUMN "marking_refs" text[];--> statement-breakpoint
-- Backfill the mirrored threats from the STIX body the mirror already holds; a connector threat the
-- mirror no longer holds stays null, which no reader sees until the next replay rewrites it.
UPDATE "threat_analyses" AS ta
SET "marking_refs" = coalesce((
  SELECT array_agg(DISTINCT ref ORDER BY ref)
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(so."data"->'object_marking_refs') = 'array' THEN so."data"->'object_marking_refs' ELSE '[]'::jsonb END
  ) AS ref
), '{}'::text[])
FROM "opencti_stream_objects" AS so
WHERE ta."kind" = 'connector'
  AND so."tenant_id" = ta."tenant_id"
  AND so."stix_id" = ta."stix_id"
  AND so."deleted_at" IS NULL;--> statement-breakpoint
-- Uploads and the default catalog are the tenant's own data: no OpenCTI marking applies to them.
UPDATE "threat_analyses" SET "marking_refs" = '{}'::text[] WHERE "kind" <> 'connector';
