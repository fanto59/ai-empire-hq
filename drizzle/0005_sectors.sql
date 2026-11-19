ALTER TYPE "public"."agent_role" ADD VALUE 'sector-manager';--> statement-breakpoint
DROP INDEX "budgets_scope_period_uq";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sector_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "sector_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sector_id" uuid;--> statement-breakpoint
ALTER TABLE "sectors" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_sector_idx" ON "agents" USING btree ("sector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_org_name_uq" ON "businesses" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "businesses_sector_idx" ON "businesses" USING btree ("sector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_scope_period_uq" ON "budgets" USING btree ("organization_id",coalesce("business_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("sector_id", '00000000-0000-0000-0000-000000000000'::uuid),"period","period_start");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_one_scope_ck" CHECK ("agents"."business_id" is null or "agents"."sector_id" is null);--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_one_scope_ck" CHECK ("budgets"."business_id" is null or "budgets"."sector_id" is null);