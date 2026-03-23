ALTER TABLE "agents" ADD COLUMN "type" text DEFAULT 'agent' NOT NULL;
ALTER TABLE "agents" ADD CONSTRAINT agents_type_check CHECK (type IN ('agent', 'human'));