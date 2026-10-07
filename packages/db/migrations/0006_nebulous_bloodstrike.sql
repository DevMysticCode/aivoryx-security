CREATE TYPE "public"."active_test_execution_status" AS ENUM('COMPLETED', 'FAILED', 'CANCELLED', 'BUDGET_EXHAUSTED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."active_test_plan_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BUDGET_EXHAUSTED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "active_test_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"test_id" text NOT NULL,
	"test_version" text NOT NULL,
	"target" text NOT NULL,
	"status" "active_test_execution_status" NOT NULL,
	"requests_used" integer DEFAULT 0 NOT NULL,
	"mutation" jsonb,
	"baseline" jsonb,
	"result" jsonb,
	"finding_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "active_test_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"status" "active_test_plan_status" NOT NULL,
	"request_budget" integer NOT NULL,
	"requests_used" integer DEFAULT 0 NOT NULL,
	"tests_selected_count" integer DEFAULT 0 NOT NULL,
	"tests_completed_count" integer DEFAULT 0 NOT NULL,
	"tests_failed_count" integer DEFAULT 0 NOT NULL,
	"tests_skipped_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_test_executions" ADD CONSTRAINT "active_test_executions_plan_id_active_test_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."active_test_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_test_executions" ADD CONSTRAINT "active_test_executions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_test_executions" ADD CONSTRAINT "active_test_executions_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_test_plans" ADD CONSTRAINT "active_test_plans_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_test_executions_assessment_id_idx" ON "active_test_executions" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_test_executions_plan_id_idx" ON "active_test_executions" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "active_test_executions_plan_test_target_unique" ON "active_test_executions" USING btree ("plan_id","test_id","target");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "active_test_plans_assessment_id_unique" ON "active_test_plans" USING btree ("assessment_id");