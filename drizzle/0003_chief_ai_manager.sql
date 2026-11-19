ALTER TYPE "public"."agent_permission" ADD VALUE 'org.read';--> statement-breakpoint
ALTER TYPE "public"."agent_permission" ADD VALUE 'task.request';--> statement-breakpoint
ALTER TYPE "public"."task_kind" ADD VALUE 'executive';--> statement-breakpoint
CREATE TABLE "agent_task_contexts" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid,
	"messages" jsonb NOT NULL,
	"work_requests" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_task_contexts" ADD CONSTRAINT "agent_task_contexts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_contexts" ADD CONSTRAINT "agent_task_contexts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;