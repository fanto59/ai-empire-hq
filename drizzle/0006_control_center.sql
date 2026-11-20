CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'canceled');--> statement-breakpoint
CREATE TABLE "action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"proposed_by_kind" "actor_kind" NOT NULL,
	"proposed_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"executed_by" text,
	"executed_at" timestamp with time zone,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_controls" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"new_work_suspended" boolean DEFAULT false NOT NULL,
	"reason" text,
	"changed_by" text,
	"changed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_one_scope_ck";--> statement-breakpoint
DROP INDEX "budgets_scope_period_uq";--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_requests" ADD CONSTRAINT "control_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_controls" ADD CONSTRAINT "org_controls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_proposals_org_status_idx" ON "action_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "control_requests_org_key_uq" ON "control_requests" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_scope_period_uq" ON "budgets" USING btree ("organization_id",coalesce("business_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("sector_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("agent_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("provider", ''),"period","period_start");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_one_scope_ck" CHECK ((case when "budgets"."business_id" is null then 0 else 1 end + case when "budgets"."sector_id" is null then 0 else 1 end + case when "budgets"."agent_id" is null then 0 else 1 end + case when "budgets"."provider" is null then 0 else 1 end) <= 1);