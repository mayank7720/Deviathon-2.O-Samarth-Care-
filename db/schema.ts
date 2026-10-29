import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "care_events",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(),
    seniorId: text("senior_id").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("care_events_owner_created").on(table.owner, table.createdAt),
  ],
);

export const sessions = sqliteTable("demo_sessions", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  role: text("role").notNull(),
  seniorId: text("senior_id"),
  expiresAt: integer("expires_at").notNull(),
});

export const workspaces = sqliteTable("care_workspaces", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const memberships = sqliteTable(
  "care_memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    seniorId: text("senior_id").notNull(),
    scopeJson: text("scope_json").notNull(),
    isAdmin: integer("is_admin").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memberships_user_workspace").on(table.userId, table.workspaceId),
  ],
);

export const invitations = sqliteTable(
  "care_invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    seniorId: text("senior_id").notNull(),
    scopeJson: text("scope_json").notNull(),
    createdBy: text("created_by").notNull(),
    status: text("status").notNull(),
    expiresAt: integer("expires_at").notNull(),
    redeemedBy: text("redeemed_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("invitations_token").on(table.tokenHash)],
);

export const runtime = sqliteTable('care_runtime', {
  owner: text('owner').primaryKey(), mode: text('mode').notNull(),
  asOfDate: text('as_of_date').notNull(), timezone: text('timezone').notNull(), updatedAt: text('updated_at').notNull(),
});
export const dailyScores = sqliteTable('care_daily_scores', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), seniorId: text('senior_id').notNull(),
  scoreDate: text('score_date').notNull(), revision: text('revision').notNull(), payload: text('payload').notNull(), computedAt: text('computed_at').notNull(),
}, t => [index('daily_scores_owner_date').on(t.owner,t.scoreDate,t.seniorId)]);
export const deliveries = sqliteTable('care_deliveries', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), seniorId: text('senior_id').notNull(),
  recipientRole: text('recipient_role').notNull(), userId: text('user_id').notNull(), kind: text('kind').notNull(),
  channel: text('channel').notNull(), status: text('status').notNull(), payload: text('payload').notNull(),
  sourceId: text('source_id').notNull(), createdAt: text('created_at').notNull(), deliveredAt: text('delivered_at'),
  readAt: text('read_at'), lastError: text('last_error'), attempts: integer('attempts').notNull().default(0), claimedAt:text('claimed_at'),
}, t => [index('deliveries_owner_recipient').on(t.owner,t.userId,t.createdAt),index('deliveries_owner_status').on(t.owner,t.status,t.createdAt)]);
export const pushSubscriptions = sqliteTable('care_push_subscriptions', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), userId: text('user_id').notNull(),
  endpoint: text('endpoint').notNull(), subscriptionJson: text('subscription_json').notNull(), createdAt: text('created_at').notNull(), disabled: integer('disabled').notNull().default(0),
}, t => [index('push_owner_user').on(t.owner,t.userId)]);
export const dailyJobs = sqliteTable('care_jobs', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(), jobDate: text('job_date').notNull(),
  status: text('status').notNull(), resultJson: text('result_json').notNull(), createdAt: text('created_at').notNull(), completedAt: text('completed_at'),
}, t=>[index('jobs_owner_date').on(t.owner,t.jobDate)]);
export const consentState = sqliteTable('care_consents', {
  id: text('id').primaryKey(), owner: text('owner').notNull(),seniorId:text('senior_id').notNull(),allowed:integer('allowed').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('consent_owner_senior').on(t.owner,t.seniorId)]);
