CREATE TYPE "public"."discovered_url_type" AS ENUM('PAGE', 'RESOURCE', 'FORM_ACTION', 'SITEMAP', 'ROBOTS');--> statement-breakpoint
CREATE TYPE "public"."discovery_method" AS ENUM('SEED', 'HTML_LINK', 'HTML_RESOURCE', 'FORM', 'ROBOTS', 'SITEMAP', 'REDIRECT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovered_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source_url" text,
	"url_type" "discovered_url_type" NOT NULL,
	"discovery_method" "discovery_method" NOT NULL,
	"depth" integer NOT NULL,
	"status_code" integer,
	"content_type" text,
	"response_bytes" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovered_urls" ADD CONSTRAINT "discovered_urls_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovered_urls_assessment_id_idx" ON "discovered_urls" USING btree ("assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovered_urls_assessment_url_type_unique" ON "discovered_urls" USING btree ("assessment_id","url","url_type");