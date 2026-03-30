ALTER TABLE "issues" ADD COLUMN "depends_on" jsonb;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "stalled_check_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE "work_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_checkpoints" ADD CONSTRAINT "work_checkpoints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_checkpoints" ADD CONSTRAINT "work_checkpoints_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_checkpoints" ADD CONSTRAINT "work_checkpoints_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_checkpoints" ADD CONSTRAINT "work_checkpoints_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "work_checkpoints_issue_idx" ON "work_checkpoints" USING btree ("company_id","issue_id");
--> statement-breakpoint
CREATE INDEX "work_checkpoints_agent_issue_idx" ON "work_checkpoints" USING btree ("company_id","agent_id","issue_id");
