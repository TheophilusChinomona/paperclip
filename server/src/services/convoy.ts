import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, workCheckpoints } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = ["done", "cancelled"] as const;
const BLOCKED_STATUSES = ["backlog", "todo", "blocked"] as const;
const STALLED_REASSIGN_THRESHOLD = 3; // consecutive stalled checks before auto-clear
const MAX_CONVOY_PARALLEL = 5; // max issues to unblock per tick

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TickDependenciesResult = {
  checked: number;
  unblocked: number;
};

type TickHealthResult = {
  checked: number;
  stalled: number;
  stuck: number;
  reassigned: number;
};

type SaveCheckpointParams = {
  companyId: string;
  issueId: string;
  agentId: string;
  runId: string | null;
  content: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export function convoyService(db: Db) {
  // ---------------------------------------------------------------------------
  // Dependency resolution — scan issues with depends_on, unblock those whose
  // dependencies are all in a terminal state, and move them to "todo" so the
  // heartbeat timer will pick them up naturally.
  // ---------------------------------------------------------------------------
  async function tickDependencies(): Promise<TickDependenciesResult> {
    // 1. Find issues that are waiting on dependencies (status in blocked set, dependsOn not null)
    const waiting = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        assigneeAgentId: issues.assigneeAgentId,
        dependsOn: issues.dependsOn,
        status: issues.status,
      })
      .from(issues)
      .where(
        and(
          inArray(issues.status, [...BLOCKED_STATUSES]),
          isNotNull(issues.dependsOn),
        ),
      )
      .limit(100);

    if (waiting.length === 0) return { checked: 0, unblocked: 0 };

    let unblocked = 0;

    for (const issue of waiting) {
      const depIds = issue.dependsOn;
      if (!Array.isArray(depIds) || depIds.length === 0) continue;

      // 2. Check if all dependencies are in a terminal state
      const deps = await db
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(inArray(issues.id, depIds));

      const allDone = deps.length === depIds.length &&
        deps.every((d) => (TERMINAL_STATUSES as readonly string[]).includes(d.status));

      if (!allDone) continue;

      // 3. Unblock — move to "todo" so the timer picks it up next tick
      if (unblocked >= MAX_CONVOY_PARALLEL) break;

      await db
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(
          and(
            eq(issues.id, issue.id),
            inArray(issues.status, [...BLOCKED_STATUSES]),
          ),
        );

      logger.info(
        { issueId: issue.id, companyId: issue.companyId, depIds },
        "[convoy] unblocked issue — all dependencies done",
      );

      unblocked++;
    }

    return { checked: waiting.length, unblocked };
  }

  // ---------------------------------------------------------------------------
  // Agent health monitoring — find issues whose execution has stalled (no
  // activity beyond threshold). Increments stalledCheckCount. If the count
  // reaches the reassign threshold, the execution lock is cleared so the
  // heartbeat timer can reassign the work.
  // ---------------------------------------------------------------------------
  async function tickHealth(opts: {
    stalledThresholdMs: number;
    stuckThresholdMs: number;
  }): Promise<TickHealthResult> {
    const now = new Date();
    const stalledCutoff = new Date(now.getTime() - opts.stalledThresholdMs);
    const stuckCutoff = new Date(now.getTime() - opts.stuckThresholdMs);

    // Issues currently locked in execution
    const executing = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        assigneeAgentId: issues.assigneeAgentId,
        executionLockedAt: issues.executionLockedAt,
        executionRunId: issues.executionRunId,
        stalledCheckCount: issues.stalledCheckCount,
      })
      .from(issues)
      .where(
        and(
          isNotNull(issues.executionLockedAt),
          isNotNull(issues.executionRunId),
          inArray(issues.status, ["in_progress"]),
        ),
      )
      .limit(100);

    let stalled = 0;
    let stuck = 0;
    let reassigned = 0;

    for (const issue of executing) {
      if (!issue.executionLockedAt) continue;

      const lockedAt = new Date(issue.executionLockedAt);
      const isStuck = lockedAt < stuckCutoff;
      const isStalled = lockedAt < stalledCutoff;

      if (!isStalled) continue;

      if (isStuck) {
        stuck++;
        logger.warn(
          { issueId: issue.id, companyId: issue.companyId, lockedAt },
          "[convoy] issue execution stuck beyond stuckThreshold",
        );
      } else {
        stalled++;
      }

      const newCount = (issue.stalledCheckCount ?? 0) + 1;

      if (newCount >= STALLED_REASSIGN_THRESHOLD) {
        // Auto-clear execution lock so the issue can be picked up again
        await db
          .update(issues)
          .set({
            executionLockedAt: null,
            executionRunId: null,
            executionAgentNameKey: null,
            stalledCheckCount: 0,
            status: "todo",
            updatedAt: now,
          })
          .where(eq(issues.id, issue.id));

        logger.warn(
          { issueId: issue.id, companyId: issue.companyId, stalledCheckCount: newCount },
          "[convoy] cleared stalled execution lock after threshold — issue reset to todo",
        );

        reassigned++;
      } else {
        await db
          .update(issues)
          .set({ stalledCheckCount: newCount, updatedAt: now })
          .where(eq(issues.id, issue.id));
      }
    }

    return { checked: executing.length, stalled, stuck, reassigned };
  }

  // ---------------------------------------------------------------------------
  // Checkpoints — save a progress snapshot from a completed run.
  // The content is prepended to the wake text when the issue resumes.
  // ---------------------------------------------------------------------------
  async function saveCheckpoint(params: SaveCheckpointParams): Promise<void> {
    if (!params.content.trim()) return;

    await db.insert(workCheckpoints).values({
      companyId: params.companyId,
      issueId: params.issueId,
      agentId: params.agentId,
      runId: params.runId ?? undefined,
      content: params.content.trim(),
    });

    logger.info(
      { issueId: params.issueId, agentId: params.agentId },
      "[convoy] checkpoint saved",
    );
  }

  // ---------------------------------------------------------------------------
  // Load the latest checkpoint for an issue (most recent first).
  // Returns null if none exists.
  // ---------------------------------------------------------------------------
  async function getLatestCheckpoint(issueId: string): Promise<string | null> {
    const rows = await db
      .select({ content: workCheckpoints.content })
      .from(workCheckpoints)
      .where(eq(workCheckpoints.issueId, issueId))
      .orderBy(desc(workCheckpoints.createdAt))
      .limit(1);

    return rows[0]?.content ?? null;
  }

  // ---------------------------------------------------------------------------
  // Clear all checkpoints for an issue (called when issue is marked done).
  // ---------------------------------------------------------------------------
  async function clearCheckpoints(issueId: string): Promise<void> {
    await db.delete(workCheckpoints).where(eq(workCheckpoints.issueId, issueId));
  }

  return {
    tickDependencies,
    tickHealth,
    saveCheckpoint,
    getLatestCheckpoint,
    clearCheckpoints,
  };
}
