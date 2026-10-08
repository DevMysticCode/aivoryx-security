ALTER TABLE "active_test_executions" DROP CONSTRAINT "active_test_executions_finding_id_findings_id_fk";
--> statement-breakpoint
ALTER TABLE "active_test_executions" DROP COLUMN IF EXISTS "finding_id";