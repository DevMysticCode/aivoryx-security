ALTER TABLE "findings" ADD COLUMN "key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "remediation" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;