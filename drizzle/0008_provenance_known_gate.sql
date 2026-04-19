ALTER TABLE "meeting_messages"
  ADD COLUMN "provenance_known" boolean NOT NULL DEFAULT false,
  ALTER COLUMN "speaker_role" DROP NOT NULL,
  ALTER COLUMN "speaker_role" DROP DEFAULT,
  ALTER COLUMN "authority_scope" DROP NOT NULL,
  ALTER COLUMN "authority_scope" DROP DEFAULT,
  ALTER COLUMN "content_type" DROP NOT NULL,
  ALTER COLUMN "content_type" DROP DEFAULT;
