ALTER TABLE "organizations" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "dark_logo_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "favicon_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "theme_preset" text DEFAULT 'aivoryx' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "primary_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "secondary_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "accent_color" text;