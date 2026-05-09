CREATE TABLE IF NOT EXISTS "task_observability_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "event_kind" text NOT NULL,
  "task_id" text NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "task_version" integer NOT NULL,
  "task_status" text NOT NULL,
  "assignment_id" text,
  "agent_id" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by" text,
  "dispatched_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_observability_outbox_event_id_uq"
  ON "task_observability_outbox" ("event_id");

CREATE INDEX IF NOT EXISTS "task_observability_outbox_pending_dispatch_idx"
  ON "task_observability_outbox" ("status", "next_attempt_at", "created_at");

CREATE INDEX IF NOT EXISTS "task_observability_outbox_task_version_idx"
  ON "task_observability_outbox" ("task_id", "task_version");
