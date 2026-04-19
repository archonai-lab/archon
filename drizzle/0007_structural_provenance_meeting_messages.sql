ALTER TABLE "meeting_messages"
  ADD COLUMN "speaker_role" text,
  ADD COLUMN "authority_scope" text,
  ADD COLUMN "content_type" text;
