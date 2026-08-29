ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    WHERE "provider_id" <> 'credential'
       OR "account_id" <> "user_id"
  ) THEN
    RAISE EXCEPTION 'BETTER_AUTH_ACCOUNT_IDENTITY_BACKFILL_UNSUPPORTED';
  END IF;
END
$$;--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'local:credential'
WHERE "provider_id" = 'credential';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "issuer", "account_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'BETTER_AUTH_ACCOUNT_IDENTITY_COLLISION';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");
