import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { CronExpressionParser } from "cron-parser";

/**
 * Create a new Prisma client with the libsql adapter
 */
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaLibSql({
    url: "file:./dev.db",
  });
  return new PrismaClient({ adapter });
}

let prisma = createPrismaClient();

// Reconnection state management
let isReconnecting = false;
let reconnectPromise: Promise<void> | null = null;
let lastSuccessfulQuery = Date.now();

/**
 * Reconnect to the database by creating a fresh Prisma client
 * Uses a mutex to prevent multiple simultaneous reconnections
 */
async function reconnectPrisma(): Promise<void> {
  // If already reconnecting, wait for that to complete
  if (isReconnecting && reconnectPromise) {
    console.log("Reconnection already in progress, waiting...");
    await reconnectPromise;
    return;
  }

  isReconnecting = true;
  reconnectPromise = (async () => {
    console.log("Reconnecting Prisma client due to stale connection...");
    try {
      await prisma.$disconnect();
    } catch {
      // Ignore disconnect errors - the connection may already be dead
    }

    // Small delay before creating new client to let resources clean up
    await new Promise(resolve => setTimeout(resolve, 100));

    prisma = createPrismaClient();

    // Verify the new connection works with a simple query
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log("Prisma client reconnected and verified successfully");
      lastSuccessfulQuery = Date.now();
    } catch (verifyError) {
      console.warn("Reconnection verification failed, will retry on next operation:", verifyError);
    }
  })();

  try {
    await reconnectPromise;
  } finally {
    isReconnecting = false;
    reconnectPromise = null;
  }
}

/**
 * Periodic health check to keep the connection alive
 * This prevents the connection from going stale during idle periods
 */
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const CONNECTION_IDLE_THRESHOLD = 60000; // 1 minute

async function healthCheck(): Promise<void> {
  const timeSinceLastQuery = Date.now() - lastSuccessfulQuery;

  // Only ping if connection has been idle
  if (timeSinceLastQuery > CONNECTION_IDLE_THRESHOLD) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      lastSuccessfulQuery = Date.now();
    } catch (error) {
      console.warn("Health check failed, reconnecting...");
      await reconnectPrisma();
    }
  }
}

// Start the health check interval
setInterval(healthCheck, HEALTH_CHECK_INTERVAL);

/**
 * Check if an error indicates a stale/dead connection that needs reconnection
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P1008: Operations timed out - connection may be stale
    // P1017: Server has closed the connection
    if (error.code === "P1008" || error.code === "P1017") {
      // Check for socket-related errors in the meta
      // The driverAdapterError could be an Error object or have a message property
      const meta = error.meta as { driverAdapterError?: Error | { message?: string } } | undefined;
      if (meta?.driverAdapterError) {
        const adapterError = meta.driverAdapterError;
        // Check the string representation of the error object
        const errorStr = String(adapterError);
        if (errorStr.includes("SocketTimeout") || errorStr.includes("socket")) {
          return true;
        }
        // Also check if it's an Error with a message
        if (adapterError instanceof Error && adapterError.message) {
          if (adapterError.message.toLowerCase().includes("socket")) {
            return true;
          }
        }
      }
      // Also check the main error message
      if (error.message.toLowerCase().includes("socket")) {
        return true;
      }
      // P1008 timeout errors are generally connection-related with libsql
      return true;
    }
  }

  // Check for generic socket timeout errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("sockettimeout") || message.includes("socket timeout")) {
      return true;
    }
  }

  return false;
}

/**
 * Retry a Prisma operation with exponential backoff
 * Handles transient errors like timeouts and connection issues
 * Automatically reconnects on stale connection errors
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5; // Increased from 3 for better resilience
  const baseDelayMs = options.baseDelayMs ?? 200; // Increased base delay
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const operationName = options.operationName ?? "Prisma operation";

  let lastError: Error | undefined;
  let hasReconnected = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      // Track successful query
      lastSuccessfulQuery = Date.now();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a connection error that requires reconnection
      if (isConnectionError(error) && !hasReconnected) {
        console.warn(
          `${operationName} failed with connection error (attempt ${attempt}/${maxAttempts}): ${lastError.message}. Reconnecting...`
        );
        await reconnectPrisma();
        hasReconnected = true;
        // Add a delay after reconnection to let the new connection stabilize
        await new Promise(resolve => setTimeout(resolve, 500));
        // Don't increment attempt count for reconnection
        attempt--;
        continue;
      }

      // Check if this is a retryable Prisma error
      const isRetryable = isPrismaRetryableError(error);

      if (!isRetryable || attempt === maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,
        maxDelayMs
      );

      console.warn(
        `${operationName} failed (attempt ${attempt}/${maxAttempts}): ${lastError.message}. Retrying in ${Math.round(delay)}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Check if a Prisma error is retryable (transient)
 */
function isPrismaRetryableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P1008: Operations timed out
    // P1017: Server has closed the connection
    // P2024: Timed out fetching a new connection from the connection pool
    const retryableCodes = ["P1008", "P1017", "P2024"];
    return retryableCodes.includes(error.code);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    // Check for timeout-related messages
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("socket") ||
      message.includes("connection")
    );
  }

  // Check for generic timeout errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("sockettimeout")
    );
  }

  return false;
}

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
  return withRetry(
    () => prisma.job.create({
      data: {
        payload: JSON.stringify(payload),
        queue: options.queue ?? "default",
        priority: options.priority ?? 0,
        maxAttempts: options.maxAttempts ?? 3,
      },
    }),
    { operationName: "enqueue" }
  );
}

/**
 * Schedule a job for future execution (one-time)
 */
export async function scheduleJob<T extends object>(
  payload: T,
  scheduledFor: Date,
  options: EnqueueOptions = {}
): Promise<Job> {
  return withRetry(
    () => prisma.job.create({
      data: {
        payload: JSON.stringify(payload),
        queue: options.queue ?? "default",
        priority: options.priority ?? 0,
        maxAttempts: options.maxAttempts ?? 3,
        status: "scheduled",
        scheduledFor,
      },
    }),
    { operationName: "scheduleJob" }
  );
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

  return withRetry(
    () => prisma.job.create({
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
    }),
    { operationName: "scheduleRecurringJob" }
  );
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
  return withRetry(
    () => prisma.$transaction(async (tx) => {
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
    }),
    { operationName: "dequeue" }
  );
}

/**
 * Mark a job as completed
 */
export async function ack(jobId: number): Promise<Job> {
  return withRetry(
    () =>
      prisma.job.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      }),
    { operationName: `ack(job ${jobId})` }
  );
}

/**
 * Mark a job as failed, with optional retry
 */
export async function fail(jobId: number, error: string): Promise<Job> {
  return withRetry(
    async () => {
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
    },
    { operationName: `fail(job ${jobId})` }
  );
}

/**
 * Get queue statistics
 */
export async function getStats(queue = "default") {
  const [scheduled, pending, processing, completed, failed, recurring] = await withRetry(
    () => Promise.all([
      prisma.job.count({ where: { queue, status: "scheduled", isRecurring: false } }),
      prisma.job.count({ where: { queue, status: "pending" } }),
      prisma.job.count({ where: { queue, status: "processing" } }),
      prisma.job.count({ where: { queue, status: "completed" } }),
      prisma.job.count({ where: { queue, status: "failed" } }),
      prisma.job.count({ where: { queue, isRecurring: true } }),
    ]),
    { operationName: "getStats" }
  );

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
  return withRetry(
    () => prisma.job.findMany({
      where: { queue },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    { operationName: "getJobs" }
  );
}

/**
 * Reset stale jobs that have been processing too long
 */
export async function resetStaleJobs(maxAgeMs = 5 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  const result = await withRetry(
    () => prisma.job.updateMany({
      where: {
        status: "processing",
        processedAt: { lt: cutoff },
      },
      data: {
        status: "pending",
        processedAt: null,
      },
    }),
    { operationName: "resetStaleJobs" }
  );

  return result.count;
}

/**
 * Cleanup old completed/failed jobs
 */
export async function cleanup(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  const result = await withRetry(
    () => prisma.job.deleteMany({
      where: {
        status: { in: ["completed", "failed"] },
        completedAt: { lt: cutoff },
      },
    }),
    { operationName: "cleanup" }
  );

  return result.count;
}

/**
 * Promote scheduled jobs that are ready to run
 * Moves jobs from "scheduled" to "pending" when their scheduledFor time has passed
 */
export async function promoteScheduledJobs(): Promise<number> {
  const now = new Date();

  const result = await withRetry(
    () => prisma.job.updateMany({
      where: {
        status: "scheduled",
        isRecurring: false,
        scheduledFor: { lte: now },
      },
      data: {
        status: "pending",
      },
    }),
    { operationName: "promoteScheduledJobs" }
  );

  return result.count;
}

/**
 * Spawn job instances for recurring jobs that are due
 * Creates a new pending job for each recurring job whose nextRunAt has passed
 */
export async function spawnRecurringJobs(): Promise<number> {
  const now = new Date();

  // Find recurring jobs that are due
  const dueRecurringJobs = await withRetry(
    () => prisma.job.findMany({
      where: {
        isRecurring: true,
        status: "scheduled",
        nextRunAt: { lte: now },
      },
    }),
    { operationName: "spawnRecurringJobs.findMany" }
  );

  let spawned = 0;

  for (const recurringJob of dueRecurringJobs) {
    try {
      // Create a new job instance
      await withRetry(
        () => prisma.job.create({
          data: {
            payload: recurringJob.payload,
            queue: recurringJob.queue,
            priority: recurringJob.priority,
            maxAttempts: recurringJob.maxAttempts,
            status: "pending",
            parentJobId: recurringJob.id,
          },
        }),
        { operationName: `spawnRecurringJobs.create(parent=${recurringJob.id})` }
      );

      // Calculate next run time and update the recurring job
      const nextRunAt = getNextCronTime(recurringJob.cronExpression!, now);

      await withRetry(
        () => prisma.job.update({
          where: { id: recurringJob.id },
          data: {
            lastRunAt: now,
            nextRunAt,
          },
        }),
        { operationName: `spawnRecurringJobs.update(${recurringJob.id})` }
      );

      spawned++;
    } catch (error) {
      // Log but continue processing other recurring jobs
      console.error(`Failed to spawn instance for recurring job ${recurringJob.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  return withRetry(
    () => prisma.job.findMany({
      where: {
        queue,
        isRecurring: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    { operationName: "getRecurringJobs" }
  );
}

/**
 * Get all scheduled (one-time) jobs
 */
export async function getScheduledJobs(queue = "default"): Promise<Job[]> {
  return withRetry(
    () => prisma.job.findMany({
      where: {
        queue,
        status: "scheduled",
        isRecurring: false,
      },
      orderBy: { scheduledFor: "asc" },
    }),
    { operationName: "getScheduledJobs" }
  );
}

/**
 * Cancel a scheduled or recurring job
 */
export async function cancelScheduledJob(jobId: number): Promise<Job> {
  return withRetry(
    async () => {
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
    },
    { operationName: `cancelScheduledJob(${jobId})` }
  );
}

/**
 * Pause a recurring job
 */
export async function pauseRecurringJob(jobId: number): Promise<Job> {
  return withRetry(
    async () => {
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
    },
    { operationName: `pauseRecurringJob(${jobId})` }
  );
}

/**
 * Resume a paused recurring job
 */
export async function resumeRecurringJob(jobId: number): Promise<Job> {
  return withRetry(
    async () => {
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
    },
    { operationName: `resumeRecurringJob(${jobId})` }
  );
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
  return withRetry(
    () => prisma.conversation.create({
      data: {
        title: options.title,
        cwd: options.cwd,
      },
    }),
    { operationName: "createConversation" }
  );
}

/**
 * Get a conversation with its messages
 */
export async function getConversation(id: number) {
  return withRetry(
    () => prisma.conversation.findUnique({
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
    }),
    { operationName: `getConversation(${id})` }
  );
}

/**
 * Get conversations, optionally filtered by workspace
 */
export async function getConversations(workspaceId?: number, limit = 50) {
  return withRetry(
    () => prisma.conversation.findMany({
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
    }),
    { operationName: "getConversations" }
  );
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
  return withRetry(
    async () => {
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
    },
    { operationName: `sendMessage(conversation=${conversationId})` }
  );
}

/**
 * Close a conversation
 */
export async function closeConversation(id: number): Promise<Conversation> {
  return withRetry(
    () => prisma.conversation.update({
      where: { id },
      data: { status: "closed" },
    }),
    { operationName: `closeConversation(${id})` }
  );
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
  return withRetry(
    () => prisma.workspace.create({
      data: { name, path },
    }),
    { operationName: "createWorkspace" }
  );
}

/**
 * Get all workspaces
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  return withRetry(
    () => prisma.workspace.findMany({
      orderBy: { name: "asc" },
    }),
    { operationName: "getWorkspaces" }
  );
}

/**
 * Get a workspace by ID
 */
export async function getWorkspace(id: number): Promise<Workspace | null> {
  return withRetry(
    () => prisma.workspace.findUnique({
      where: { id },
    }),
    { operationName: `getWorkspace(${id})` }
  );
}

/**
 * Delete a workspace
 */
export async function deleteWorkspace(id: number): Promise<Workspace> {
  return withRetry(
    () => prisma.workspace.delete({
      where: { id },
    }),
    { operationName: `deleteWorkspace(${id})` }
  );
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

export { prisma, reconnectPrisma };
