ALTER TABLE "groups" ADD CONSTRAINT "groups_id_tenant_id_uq" UNIQUE("id","tenant_id");--> statement-breakpoint
CREATE TABLE "group_marking_definitions" (
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"marking_definition_id" uuid NOT NULL,
	CONSTRAINT "group_marking_definitions_group_id_marking_definition_id_pk" PRIMARY KEY("group_id","marking_definition_id")
);
--> statement-breakpoint
CREATE TABLE "marking_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stix_id" text NOT NULL,
	"definition_type" text NOT NULL,
	"definition" text NOT NULL,
	"color" text,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "marking_definitions_tenant_stix_id_uq" UNIQUE("tenant_id","stix_id"),
	CONSTRAINT "marking_definitions_id_tenant_id_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "marking_definitions_stix_id_ck" CHECK ("marking_definitions"."stix_id" ~ '^marking-definition--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
--> statement-breakpoint
ALTER TABLE "group_marking_definitions" ADD CONSTRAINT "group_marking_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_marking_definitions" ADD CONSTRAINT "group_marking_definitions_group_tenant_fk" FOREIGN KEY ("group_id","tenant_id") REFERENCES "public"."groups"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_marking_definitions" ADD CONSTRAINT "group_marking_definitions_marking_tenant_fk" FOREIGN KEY ("marking_definition_id","tenant_id") REFERENCES "public"."marking_definitions"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marking_definitions" ADD CONSTRAINT "marking_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_marking_definitions_marking_idx" ON "group_marking_definitions" USING btree ("marking_definition_id");--> statement-breakpoint
-- The TLP 2.0 markings under OpenCTI's static ids for every existing tenant, its Admin group cleared for them all (new tenants get them at provisioning).
INSERT INTO "marking_definitions" ("id", "tenant_id", "stix_id", "definition_type", "definition", "color", "order")
SELECT gen_random_uuid(), t."id", m.stix_id, 'TLP', m.definition, m.color, m.ord
FROM "tenants" t
CROSS JOIN (VALUES
	('marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9', 'TLP:CLEAR', '#E6E7E8', 1),
	('marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da', 'TLP:GREEN', '#4CAF50', 2),
	('marking-definition--f88d31f6-486f-44da-b317-01333bde0b82', 'TLP:AMBER', '#FFB300', 3),
	('marking-definition--826578e1-40ad-459f-bc73-ede076f81f37', 'TLP:AMBER+STRICT', '#FF8F00', 4),
	('marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed', 'TLP:RED', '#E53935', 5)
) AS m(stix_id, definition, color, ord)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "group_marking_definitions" ("tenant_id", "group_id", "marking_definition_id")
SELECT g."tenant_id", g."id", md."id"
FROM "groups" g
JOIN "marking_definitions" md ON md."tenant_id" = g."tenant_id"
WHERE g."slug" = 'admin'
ON CONFLICT DO NOTHING;