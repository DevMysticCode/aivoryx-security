CREATE TYPE "public"."finding_confidence" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"scanner" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"confidence" "finding_confidence" NOT NULL,
	"category" text NOT NULL,
	"status" "finding_status" DEFAULT 'OPEN' NOT NULL,
	"target" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "scope" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence" ADD CONSTRAINT "evidence_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_finding_id_idx" ON "evidence" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_assessment_id_idx" ON "findings" USING btree ("assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "findings_assessment_fingerprint_unique" ON "findings" USING btree ("assessment_id","fingerprint");