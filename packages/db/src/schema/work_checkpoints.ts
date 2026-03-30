import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/**
 * Stores agent work checkpoints — progress snapshots saved at the end of a run
 * that are prepended to the wake text when the same issue is resumed.
 * Enables agents to pick up exactly where they left off across heartbeat boundaries.
 */
export const workCheckpoints = pgTable(
  "work_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueIdx: index("work_checkpoints_issue_idx").on(table.companyId, table.issueId),
    agentIssueIdx: index("work_checkpoints_agent_issue_idx").on(table.companyId, table.agentId, table.issueId),
  }),
);
