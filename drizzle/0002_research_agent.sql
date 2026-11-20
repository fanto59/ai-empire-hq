CREATE TYPE "public"."task_kind" AS ENUM('general', 'research');--> statement-breakpoint
ALTER TYPE "public"."agent_permission" ADD VALUE 'research.web_search';--> statement-breakpoint
ALTER TYPE "public"."agent_permission" ADD VALUE 'research.web_fetch';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" "task_kind" DEFAULT 'general' NOT NULL;