/**
 * Job Registry - Sidekiq-like job handler system
 *
 * Usage:
 *   // Define a job
 *   export const EmailJob = defineJob("EmailJob", async (args: { to: string; subject: string }) => {
 *     await sendEmail(args.to, args.subject);
 *   });
 *
 *   // Enqueue a job immediately
 *   await EmailJob.performLater({ to: "user@example.com", subject: "Hello" });
 *
 *   // With priority
 *   await EmailJob.performLater({ to: "user@example.com", subject: "Hello" }, { priority: 10 });
 *
 *   // Schedule for later (one-time)
 *   await EmailJob.performAt(new Date("2025-01-20T09:00:00"), { to: "user@example.com", subject: "Hello" });
 *
 *   // Schedule with cron expression (recurring)
 *   await EmailJob.performEvery("0 9 * * *", { to: "user@example.com", subject: "Daily Report" });
 */

import { enqueue, enqueueWithSchedule, ScheduleOptions, Job } from "../queue";

// Job payload structure stored in the database
export interface JobPayload<T = unknown> {
  jobClass: string;
  args: T;
}

// Job handler function type
export type JobHandler<T> = (args: T) => Promise<void>;

// Base enqueue options (without scheduling)
export interface EnqueueOptions {
  queue?: string;
  priority?: number;
  maxAttempts?: number;
}

// Job definition returned by defineJob
export interface JobDefinition<T> {
  jobClass: string;
  handler: JobHandler<T>;
  performLater: (args: T, options?: ScheduleOptions) => Promise<Job>;
  performAt: (date: Date, args: T, options?: EnqueueOptions) => Promise<Job>;
  performEvery: (cronExpression: string, args: T, options?: EnqueueOptions) => Promise<Job>;
}

// Global registry of all job handlers
const jobRegistry = new Map<string, JobHandler<any>>();

/**
 * Define a new job class with a handler
 */
export function defineJob<T>(
  jobClass: string,
  handler: JobHandler<T>
): JobDefinition<T> {
  // Register the handler
  jobRegistry.set(jobClass, handler);

  return {
    jobClass,
    handler,

    // Enqueue immediately (or with scheduling options)
    performLater: async (args: T, options?: ScheduleOptions): Promise<Job> => {
      const payload: JobPayload<T> = { jobClass, args };
      return enqueueWithSchedule(payload, options);
    },

    // Schedule for a specific time (one-time)
    performAt: async (date: Date, args: T, options?: EnqueueOptions): Promise<Job> => {
      const payload: JobPayload<T> = { jobClass, args };
      return enqueueWithSchedule(payload, { ...options, scheduledFor: date });
    },

    // Schedule with cron expression (recurring)
    performEvery: async (cronExpression: string, args: T, options?: EnqueueOptions): Promise<Job> => {
      const payload: JobPayload<T> = { jobClass, args };
      return enqueueWithSchedule(payload, { ...options, cronExpression });
    },
  };
}

/**
 * Get a job handler by class name
 */
export function getJobHandler(jobClass: string): JobHandler<any> | undefined {
  return jobRegistry.get(jobClass);
}

/**
 * Get all registered job class names
 */
export function getRegisteredJobs(): string[] {
  return Array.from(jobRegistry.keys());
}

/**
 * Check if a job class is registered
 */
export function isJobRegistered(jobClass: string): boolean {
  return jobRegistry.has(jobClass);
}

/**
 * Parse a job payload from the database
 */
export function parseJobPayload(payloadString: string): JobPayload {
  const payload = JSON.parse(payloadString);

  // Handle legacy payloads that don't have jobClass
  if (!payload.jobClass) {
    return {
      jobClass: "LegacyJob",
      args: payload,
    };
  }

  return payload as JobPayload;
}
