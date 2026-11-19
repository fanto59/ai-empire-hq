ALTER TABLE "execution_events" ADD COLUMN "stream_id" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
-- Backfill existing events from their task (organization, and the assignee as the agent).
UPDATE "execution_events" e SET "organization_id" = t."organization_id", "agent_id" = t."assignee_agent_id" FROM "tasks" t WHERE t."id" = e."task_id";--> statement-breakpoint
ALTER TABLE "execution_events" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_events_org_stream_idx" ON "execution_events" USING btree ("organization_id","stream_id");--> statement-breakpoint
CREATE INDEX "execution_events_agent_stream_idx" ON "execution_events" USING btree ("agent_id","stream_id");--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_stream_id_unique" UNIQUE("stream_id");