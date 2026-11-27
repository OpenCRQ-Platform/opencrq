ALTER TABLE "marking_definitions" ALTER COLUMN "order" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "marking_definitions" ALTER COLUMN "order" DROP NOT NULL;
--> statement-breakpoint
UPDATE "marking_definitions" AS m SET "order" = known.rank
FROM (VALUES
  ('marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9', 1),
  ('marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da', 2),
  ('marking-definition--f88d31f6-486f-44da-b317-01333bde0b82', 3),
  ('marking-definition--826578e1-40ad-459f-bc73-ede076f81f37', 4),
  ('marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed', 5),
  ('marking-definition--4cdff7eb-acb8-543f-8573-829eb9fe8b34', 1),
  ('marking-definition--89484dde-e3d2-547f-a6c6-d14824429eb1', 2),
  ('marking-definition--a6f20d4d-0360-59b6-ba22-3b48707828b1', 3),
  ('marking-definition--4e4e3b84-de45-53df-9d9b-b21207699fd8', 4)
) AS known(stix_id, rank)
WHERE m.stix_id = known.stix_id AND m."order" IS DISTINCT FROM known.rank;
