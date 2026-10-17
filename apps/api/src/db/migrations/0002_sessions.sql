CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sessions_expire_idx" ON "sessions" USING btree ("expire");