ALTER TABLE "meeting_messages"
  ADD COLUMN "speaker_role" text DEFAULT 'participant' NOT NULL,
  ADD COLUMN "authority_scope" text DEFAULT 'meeting:participant' NOT NULL,
  ADD COLUMN "content_type" text DEFAULT 'statement' NOT NULL;
