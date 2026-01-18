import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { CronExpressionParser } from "cron-parser";

const adapter = new PrismaLibSql({
  url: "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

export type JobStatus = "scheduled" | "pending" | "processing" | "completed" | "failed";

export interface EnqueueOptions {
  queue?: string;
  priority?: number;
  maxAttempts?: number;
}

export interface ScheduleOptions extends EnqueueOptions {
  scheduledFor?: Date;        // One-time future execution
  cronExpression?: string;    // Recurring execution (e.g., "0 9 * * *" = 9 AM daily)
}

export interface Job {
  id: number;
  queue: string;
  payload: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  scheduledFor: Date | null;
  cronExpression: string | null;
  isRecurring: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  parentJobId: number | null;
}

/**
 * Calculate the next run time from a cron expression
 */
export function getNextCronTime(cronExpression: string, fromDate: Date = new Date()): Date {
  const interval = CronExpressionParser.parse(cronExpression, { currentDate: fromDate });
  return interval.next().toDate();
}

/**
 * Validate a cron expression
 */
export function isValidCronExpression(cronExpression: string): boolean {
  try {
    CronExpressionParser.parse(cronExpression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a job to the queue
 */
export async function enqueue<T extends object>(
  payload: T,
  options: EnqueueOptions = {}
): Promise<Job> {
  const job = await prisma.job.create({
    data: {
      payload: JSON.stringify(payload),
      queue: options.queue ?? "default",
      priority: options.priority ?? 0,
      maxAttempts: options.maxAttempts ?? 3,
    },
  });
  return job;
}

/**
 * Schedule a job for future execution (one-time)
 */
export async function scheduleJob<T extends object>(
  payload: T,
  scheduledFor: Date,
  options: EnqueueOptions = {}
): Promise<Job> {
  const job = await prisma.job.create({
    data: {
      payload: JSON.stringify(payload),
      queue: options.queue ?? "default",
      priority: options.priority ?? 0,
      maxAttempts: options.maxAttempts ?? 3,
      status: "scheduled",
      scheduledFor,
    },
  });
  return job;
}

/**
 * Create a recurring job with a cron expression
 */
export async function scheduleRecurringJob<T extends object>(
  payload: T,
  cronExpression: string,
  options: EnqueueOptions = {}
): Promise<Job> {
  if (!isValidCronExpression(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  const nextRunAt = getNextCronTime(cronExpression);

  const job = await prisma.job.create({
    data: {
      payload: JSON.stringify(payload),
      queue: options.queue ?? "default",
      priority: options.priority ?? 0,
      maxAttempts: options.maxAttempts ?? 3,
      status: "scheduled",
      isRecurring: true,
      cronExpression,
      nextRunAt,
    },
  });
  return job;
}

/**
 * Enqueue with flexible scheduling options
 */
export async function enqueueWithSchedule<T extends object>(
  payload: T,
  options: ScheduleOptions = {}
): Promise<Job> {
  // If cron expression provided, create recurring job
  if (options.cronExpression) {
    return scheduleRecurringJob(payload, options.cronExpression, options);
  }

  // If scheduledFor provided, create one-time scheduled job
  if (options.scheduledFor) {
    return scheduleJob(payload, options.scheduledFor, options);
  }

  // Otherwise, create immediate job
  return enqueue(payload, options);
}

/**
 * Claim the next available job from the queue
 * Returns null if no jobs are available
 */
export async function dequeue(queue = "default"): Promise<Job | null> {
  // Use a transaction to atomically find and claim a job
  return prisma.$transaction(async (tx) => {
    // Find the next pending job
    const job = await tx.job.findFirst({
      where: {
        queue,
        status: "pending",
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "asc" },
      ],
    });

    if (!job) return null;

    // Claim it by updating status
    const claimed = await tx.job.update({
      where: { id: job.id },
      data: {
        status: "processing",
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    return claimed;
  });
}

/**
 * Mark a job as completed
 */
export async function ack(jobId: number): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: "completed",
      completedAt: new Date(),
    },
  });
}

/**
 * Mark a job as failed, with optional retry
 */
export async function fail(jobId: number, error: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const shouldRetry = job.attempts < job.maxAttempts;

  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? "pending" : "failed",
      error,
      processedAt: null, // Reset for retry
    },
  });
}

/**
 * Get queue statistics
 */
export async function getStats(queue = "default") {
  const [scheduled, pending, processing, completed, failed, recurring] = await Promise.all([
    prisma.job.count({ where: { queue, status: "scheduled", isRecurring: false } }),
    prisma.job.count({ where: { queue, status: "pending" } }),
    prisma.job.count({ where: { queue, status: "processing" } }),
    prisma.job.count({ where: { queue, status: "completed" } }),
    prisma.job.count({ where: { queue, status: "failed" } }),
    prisma.job.count({ where: { queue, isRecurring: true } }),
  ]);

  return {
    scheduled,
    pending,
    processing,
    completed,
    failed,
    recurring,
    total: scheduled + pending + processing + completed + failed,
  };
}

/**
 * Get recent jobs from the queue
 */
export async function getJobs(queue = "default", limit = 50): Promise<Job[]> {
  return prisma.job.findMany({
    where: { queue },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Reset stale jobs that have been processing too long
 */
export async function resetStaleJobs(maxAgeMs = 5 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  const result = await prisma.job.updateMany({
    where: {
      status: "processing",
      processedAt: { lt: cutoff },
    },
    data: {
      status: "pending",
      processedAt: null,
    },
  });

  return result.count;
}

/**
 * Cleanup old completed/failed jobs
 */
export async function cleanup(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  const result = await prisma.job.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      completedAt: { lt: cutoff },
    },
  });

  return result.count;
}

/**
 * Promote scheduled jobs that are ready to run
 * Moves jobs from "scheduled" to "pending" when their scheduledFor time has passed
 */
export async function promoteScheduledJobs(): Promise<number> {
  const now = new Date();

  const result = await prisma.job.updateMany({
    where: {
      status: "scheduled",
      isRecurring: false,
      scheduledFor: { lte: now },
    },
    data: {
      status: "pending",
    },
  });

  return result.count;
}

/**
 * Spawn job instances for recurring jobs that are due
 * Creates a new pending job for each recurring job whose nextRunAt has passed
 */
export async function spawnRecurringJobs(): Promise<number> {
  const now = new Date();

  // Find recurring jobs that are due
  const dueRecurringJobs = await prisma.job.findMany({
    where: {
      isRecurring: true,
      status: "scheduled",
      nextRunAt: { lte: now },
    },
  });

  let spawned = 0;

  for (const recurringJob of dueRecurringJobs) {
    // Create a new job instance
    await prisma.job.create({
      data: {
        payload: recurringJob.payload,
        queue: recurringJob.queue,
        priority: recurringJob.priority,
        maxAttempts: recurringJob.maxAttempts,
        status: "pending",
        parentJobId: recurringJob.id,
      },
    });

    // Calculate next run time and update the recurring job
    const nextRunAt = getNextCronTime(recurringJob.cronExpression!, now);

    await prisma.job.update({
      where: { id: recurringJob.id },
      data: {
        lastRunAt: now,
        nextRunAt,
      },
    });

    spawned++;
  }

  return spawned;
}

/**
 * Process all scheduled jobs - call this periodically from the worker
 * Promotes one-time scheduled jobs and spawns recurring job instances
 */
export async function processScheduledJobs(): Promise<{ promoted: number; spawned: number }> {
  const [promoted, spawned] = await Promise.all([
    promoteScheduledJobs(),
    spawnRecurringJobs(),
  ]);

  return { promoted, spawned };
}

/**
 * Get all recurring jobs
 */
export async function getRecurringJobs(queue = "default"): Promise<Job[]> {
  return prisma.job.findMany({
    where: {
      queue,
      isRecurring: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all scheduled (one-time) jobs
 */
export async function getScheduledJobs(queue = "default"): Promise<Job[]> {
  return prisma.job.findMany({
    where: {
      queue,
      status: "scheduled",
      isRecurring: false,
    },
    orderBy: { scheduledFor: "asc" },
  });
}

/**
 * Cancel a scheduled or recurring job
 */
export async function cancelScheduledJob(jobId: number): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (job.status !== "scheduled") {
    throw new Error(`Job ${jobId} is not scheduled (status: ${job.status})`);
  }

  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error: "Cancelled",
      completedAt: new Date(),
    },
  });
}

/**
 * Pause a recurring job
 */
export async function pauseRecurringJob(jobId: number): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (!job.isRecurring) {
    throw new Error(`Job ${jobId} is not a recurring job`);
  }

  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error: "Paused",
    },
  });
}

/**
 * Resume a paused recurring job
 */
export async function resumeRecurringJob(jobId: number): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (!job.isRecurring) {
    throw new Error(`Job ${jobId} is not a recurring job`);
  }

  const nextRunAt = getNextCronTime(job.cronExpression!);

  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: "scheduled",
      error: null,
      nextRunAt,
    },
  });
}

// ============ Conversation Functions ============

export interface Conversation {
  id: number;
  title: string | null;
  sessionId: string | null;
  cwd: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  jobId: number | null;
  createdAt: Date;
}

/**
 * Create a new conversation
 */
export async function createConversation(options: {
  title?: string;
  cwd?: string;
}): Promise<Conversation> {
  return prisma.conversation.create({
    data: {
      title: options.title,
      cwd: options.cwd,
    },
  });
}

/**
 * Get a conversation with its messages
 */
export async function getConversation(id: number) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      workspace: true,
    },
  });
}

/**
 * Get conversations, optionally filtered by workspace
 */
export async function getConversations(workspaceId?: number, limit = 50) {
  return prisma.conversation.findMany({
    where: workspaceId ? { workspaceId } : undefined,
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1, // Just get the last message for preview
      },
      workspace: true,
      _count: {
        select: { messages: true },
      },
    },
  });
}

/**
 * Send a message to a conversation (creates a job)
 */
export async function sendMessage(
  conversationId: number,
  message: string,
  options?: {
    scheduledFor?: Date;
    cronExpression?: string;
  }
): Promise<Job> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Determine status and scheduling
  let status = "pending";
  let nextRunAt: Date | null = null;

  if (options?.cronExpression) {
    status = "scheduled";
    nextRunAt = getNextCronTime(options.cronExpression);
  } else if (options?.scheduledFor) {
    status = "scheduled";
  }

  // Create a job to process this message
  const job = await prisma.job.create({
    data: {
      payload: JSON.stringify({
        jobClass: "ConversationMessageJob",
        args: { conversationId, message },
      }),
      queue: "default",
      priority: 0,
      maxAttempts: 3,
      conversationId,
      status,
      scheduledFor: options?.scheduledFor,
      isRecurring: !!options?.cronExpression,
      cronExpression: options?.cronExpression,
      nextRunAt,
    },
  });

  return job;
}

/**
 * Close a conversation
 */
export async function closeConversation(id: number): Promise<Conversation> {
  return prisma.conversation.update({
    where: { id },
    data: { status: "closed" },
  });
}

// ============ Workspace Functions ============

export interface Workspace {
  id: number;
  name: string;
  path: string;
  createdAt: Date;
}

/**
 * Create a new workspace
 */
export async function createWorkspace(name: string, path: string): Promise<Workspace> {
  return prisma.workspace.create({
    data: { name, path },
  });
}

/**
 * Get all workspaces
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  return prisma.workspace.findMany({
    orderBy: { name: "asc" },
  });
}

/**
 * Get a workspace by ID
 */
export async function getWorkspace(id: number): Promise<Workspace | null> {
  return prisma.workspace.findUnique({
    where: { id },
  });
}

/**
 * Delete a workspace
 */
export async function deleteWorkspace(id: number): Promise<Workspace> {
  return prisma.workspace.delete({
    where: { id },
  });
}

/**
 * Create a git worktree for a conversation
 */
export async function createWorktree(
  workspacePath: string,
  branchName: string
): Promise<string> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  const path = await import("path");

  // Create worktree directory path based on branch name
  const worktreePath = path.join(
    path.dirname(workspacePath),
    `.worktrees`,
    `${path.basename(workspacePath)}-${branchName}`
  );

  // Create the worktree
  await execAsync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
    cwd: workspacePath,
  });

  return worktreePath;
}

/**
 * Remove a git worktree
 */
export async function removeWorktree(
  workspacePath: string,
  worktreePath: string
): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  await execAsync(`git worktree remove "${worktreePath}"`, {
    cwd: workspacePath,
  });
}

export { prisma };
