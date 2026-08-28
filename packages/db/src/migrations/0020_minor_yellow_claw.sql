ALTER TABLE "publication" DROP CONSTRAINT "ck_publication_confirmed_result";--> statement-breakpoint
ALTER TABLE "activity_event" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "ck_publication_confirmed_result" CHECK ((("publication"."lifecycle" = 'confirmed') = ("publication"."confirmed_at" is not null)) and (("publication"."confirmed_checkpoint_id" is null) = ("publication"."confirmed_provider_result_id" is null)));
