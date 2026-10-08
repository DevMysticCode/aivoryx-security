CREATE TYPE "public"."active_test_failure_reason" AS ENUM('NETWORK_ERROR', 'SCOPE_REJECTED', 'SSRF_REJECTED', 'RATE_LIMITED', 'INTERNAL_ERROR', 'INVALID_TEST_CONFIGURATION');--> statement-breakpoint
CREATE TYPE "public"."active_test_security_result" AS ENUM('NO_FINDING', 'FINDING', 'INCONCLUSIVE');--> statement-breakpoint
CREATE TYPE "public"."active_test_skip_reason" AS ENUM('NO_ELIGIBLE_TARGETS', 'NO_PARAMETERS', 'UNSUPPORTED_CONTENT_TYPE', 'LIMIT_REACHED', 'UNSUPPORTED_ASSET_TYPE', 'MISSING_CAPABILITY');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "active_test_execution_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_test_executions" ADD COLUMN "security_result" "active_test_security_result";--> statement-breakpoint
ALTER TABLE "active_test_executions" ADD COLUMN "skip_reason" "active_test_skip_reason";--> statement-breakpoint
ALTER TABLE "active_test_executions" ADD COLUMN "failure_reason" "active_test_failure_reason";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_test_execution_findings" ADD CONSTRAINT "active_test_execution_findings_execution_id_active_test_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."active_test_executions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_test_execution_findings" ADD CONSTRAINT "active_test_execution_findings_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_test_execution_findings_finding_id_idx" ON "active_test_execution_findings" USING btree ("finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "active_test_execution_findings_unique" ON "active_test_execution_findings" USING btree ("execution_id","finding_id");