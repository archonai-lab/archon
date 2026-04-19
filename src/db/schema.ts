import {
  pgTable,
  text,
  timestamp,
  jsonb,
  serial,
  integer,
  boolean,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/pg-core";

// --- Departments ---

export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Roles ---

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    name: text("name").notNull(),
    permissions: jsonb("permissions").notNull().$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("uq_roles_dept_name").on(table.departmentId, table.name)]
);

// --- Agents ---

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  workspacePath: text("workspace_path").notNull(),
  status: text("status", { enum: ["active", "deactivated"] })
    .notNull()
    .default("active"),
  ephemeral: boolean("ephemeral").notNull().default(false),
  agentCard: jsonb("agent_card"),
  modelConfig: jsonb("model_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Agent ↔ Department memberships ---

export const agentDepartments = pgTable(
  "agent_departments",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.departmentId] }),
    index("idx_agent_departments_agent").on(table.agentId),
    index("idx_agent_departments_dept").on(table.departmentId),
  ]
);

// --- Permissions ---

export const permissions = pgTable(
  "permissions",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_permissions_agent").on(table.agentId)]
);

// --- Projects ---

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  methodology: text("methodology", { enum: ["waterfall", "scrum", "kanban"] })
    .notNull()
    .default("kanban"),
  status: text("status", { enum: ["active", "completed", "archived"] })
    .notNull()
    .default("active"),
  departmentId: text("department_id").references(() => departments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Meetings ---

export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id),
    title: text("title").notNull(),
    phase: text("phase").notNull().default("present"),
    methodology: text("methodology").notNull().default("general"),
    status: text("status", { enum: ["active", "completed", "cancelled"] })
      .notNull()
      .default("active"),
    initiatorId: text("initiator_id")
      .notNull()
      .references(() => agents.id),
    tokenBudget: integer("token_budget").notNull().default(50000),
    tokensUsed: integer("tokens_used").notNull().default(0),
    agenda: jsonb("agenda"),
    decisions: jsonb("decisions").$type<unknown[]>().default([]),
    actionItems: jsonb("action_items").$type<unknown[]>().default([]),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_meetings_project").on(table.projectId),
    index("idx_meetings_status").on(table.status),
  ]
);

// --- Meeting Participants ---

export const meetingParticipants = pgTable(
  "meeting_participants",
  {
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.agentId] })]
);

// --- Meeting Messages ---

export const meetingMessages = pgTable(
  "meeting_messages",
  {
    id: serial("id").primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    phase: text("phase").notNull(),
    content: text("content").notNull(),
    speakerRole: text("speaker_role"),
    authorityScope: text("authority_scope"),
    contentType: text("content_type", {
      enum: ["statement", "proposal", "vote", "assignment", "acknowledgement"],
    }),
    provenanceKnown: boolean("provenance_known").notNull().default(false),
    tokenCount: integer("token_count").notNull().default(0),
    relevance: text("relevance", { enum: ["must_speak", "could_add", "pass"] }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_meeting_messages_meeting").on(table.meetingId)]
);

// --- Tasks ---

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["pending", "in_progress", "done", "failed"] })
      .notNull()
      .default("pending"),
    assignedTo: text("assigned_to").references(() => agents.id),
    assignedBy: text("assigned_by"),
    meetingId: text("meeting_id"),
    result: text("result"),
    version: integer("version").notNull().default(1),
    changedBy: text("changed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_tasks_assigned_to").on(table.assignedTo),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_meeting_id").on(table.meetingId),
  ]
);
