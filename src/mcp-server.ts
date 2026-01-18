#!/usr/bin/env node
/**
 * MCP Server for Job Queue
 *
 * Exposes tools for LLMs to:
 * - Enqueue jobs by class name with arguments
 * - Check job status
 * - Get queue statistics
 * - List recent jobs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getStats,
  getJobs,
  getScheduledJobs,
  getRecurringJobs,
  cancelScheduledJob,
  pauseRecurringJob,
  resumeRecurringJob,
  isValidCronExpression,
  prisma,
} from "./queue";
import {
  getRegisteredJobs,
  SendEmailJob,
  SendWelcomeEmailJob,
  GenerateReportJob,
  ExportDataJob,
  SpawnClaudeSessionJob,
} from "./jobs";

// Create the MCP server
const server = new McpServer({
  name: "job-queue",
  version: "1.0.0",
});

// Tool: List available job classes
server.registerTool(
  "list_job_classes",
  {
    description: "List all available job classes that can be enqueued",
  },
  async () => {
    const jobClasses = getRegisteredJobs();
    const descriptions: Record<string, string> = {
      SendEmailJob: "Send an email to a recipient with subject and body",
      SendWelcomeEmailJob: "Send a welcome email to a new user",
      GenerateReportJob: "Generate a report (daily/weekly/monthly) for a user",
      ExportDataJob: "Export data from a table in CSV, JSON, or PDF format",
      SpawnClaudeSessionJob: "Spawn a Claude session with a given prompt and optional working directory",
    };

    const result = jobClasses.map((name) => ({
      name,
      description: descriptions[name] || "No description available",
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// Tool: Enqueue a job (with optional scheduling)
server.registerTool(
  "enqueue_job",
  {
    description: "Enqueue a new job to be processed by workers. Can schedule for later or set up recurring execution.",
    inputSchema: {
      jobClass: z
        .enum([
          "SendEmailJob",
          "SendWelcomeEmailJob",
          "GenerateReportJob",
          "ExportDataJob",
          "SpawnClaudeSessionJob",
        ])
        .describe("The job class to enqueue"),
      args: z
        .object({})
        .passthrough()
        .describe("Arguments for the job (varies by job class)"),
      priority: z
        .number()
        .optional()
        .default(0)
        .describe("Job priority (higher = processed first)"),
      scheduledFor: z
        .string()
        .optional()
        .describe("ISO datetime string for when to run the job (e.g., '2025-01-20T09:00:00Z'). If not provided, job runs immediately."),
      cronExpression: z
        .string()
        .optional()
        .describe("Cron expression for recurring jobs (e.g., '0 9 * * *' for 9 AM daily, '*/5 * * * *' for every 5 minutes). If provided, job will repeat on this schedule."),
    },
  },
  async ({ jobClass, args, priority, scheduledFor, cronExpression }) => {
    // Validate cron expression if provided
    if (cronExpression && !isValidCronExpression(cronExpression)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid cron expression '${cronExpression}'. Examples: '0 9 * * *' (9 AM daily), '*/5 * * * *' (every 5 min)`,
          },
        ],
        isError: true,
      };
    }

    const options: { priority: number; scheduledFor?: Date; cronExpression?: string } = { priority };
    if (scheduledFor) {
      options.scheduledFor = new Date(scheduledFor);
    }
    if (cronExpression) {
      options.cronExpression = cronExpression;
    }

    let job;

    try {
      switch (jobClass) {
        case "SendEmailJob":
          // Validate required fields
          if (!args.to || !args.subject || !args.body) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: SendEmailJob requires 'to', 'subject', and 'body' arguments",
                },
              ],
              isError: true,
            };
          }
          job = await SendEmailJob.performLater(
            {
              to: String(args.to),
              subject: String(args.subject),
              body: String(args.body),
            },
            options
          );
          break;

        case "SendWelcomeEmailJob":
          if (!args.userId || !args.email || !args.name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: SendWelcomeEmailJob requires 'userId', 'email', and 'name' arguments",
                },
              ],
              isError: true,
            };
          }
          job = await SendWelcomeEmailJob.performLater(
            {
              userId: Number(args.userId),
              email: String(args.email),
              name: String(args.name),
            },
            options
          );
          break;

        case "GenerateReportJob":
          if (
            !args.reportType ||
            !args.userId ||
            !args.startDate ||
            !args.endDate
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: GenerateReportJob requires 'reportType' (daily/weekly/monthly), 'userId', 'startDate', and 'endDate' arguments",
                },
              ],
              isError: true,
            };
          }
          job = await GenerateReportJob.performLater(
            {
              reportType: args.reportType as "daily" | "weekly" | "monthly",
              userId: Number(args.userId),
              startDate: String(args.startDate),
              endDate: String(args.endDate),
            },
            options
          );
          break;

        case "ExportDataJob":
          if (!args.format || !args.tableName) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: ExportDataJob requires 'format' (csv/json/pdf) and 'tableName' arguments",
                },
              ],
              isError: true,
            };
          }
          job = await ExportDataJob.performLater(
            {
              format: args.format as "csv" | "json" | "pdf",
              tableName: String(args.tableName),
              filters: (args.filters as Record<string, unknown>) || undefined,
            },
            options
          );
          break;

        case "SpawnClaudeSessionJob":
          if (!args.prompt) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: SpawnClaudeSessionJob requires 'prompt' argument",
                },
              ],
              isError: true,
            };
          }
          job = await SpawnClaudeSessionJob.performLater(
            {
              prompt: String(args.prompt),
              cwd: args.cwd ? String(args.cwd) : undefined,
            },
            options
          );
          break;
      }

      let scheduleInfo = "";
      if (job!.cronExpression) {
        scheduleInfo = `\nSchedule: Recurring (${job!.cronExpression})\nNext Run: ${job!.nextRunAt}`;
      } else if (job!.scheduledFor) {
        scheduleInfo = `\nScheduled For: ${job!.scheduledFor}`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Job enqueued successfully!\n\nJob ID: ${job!.id}\nClass: ${jobClass}\nStatus: ${job!.status}\nPriority: ${job!.priority}${scheduleInfo}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error enqueueing job: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Get job status
server.registerTool(
  "get_job_status",
  {
    description: "Get the status and details of a specific job by ID",
    inputSchema: {
      jobId: z.number().describe("The job ID to look up"),
    },
  },
  async ({ jobId }) => {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Job with ID ${jobId} not found`,
          },
        ],
        isError: true,
      };
    }

    const payload = JSON.parse(job.payload);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              id: job.id,
              jobClass: payload.jobClass || "LegacyJob",
              status: job.status,
              args: payload.args || payload,
              attempts: `${job.attempts}/${job.maxAttempts}`,
              error: job.error,
              createdAt: job.createdAt,
              processedAt: job.processedAt,
              completedAt: job.completedAt,
              scheduledFor: job.scheduledFor,
              isRecurring: job.isRecurring,
              cronExpression: job.cronExpression,
              nextRunAt: job.nextRunAt,
              lastRunAt: job.lastRunAt,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: Get queue statistics
server.registerTool(
  "get_queue_stats",
  {
    description: "Get statistics about the job queue (scheduled, recurring, pending, processing, completed, failed counts)",
    inputSchema: {
      queue: z
        .string()
        .optional()
        .default("default")
        .describe("Queue name (default: 'default')"),
    },
  },
  async ({ queue }) => {
    const stats = await getStats(queue);

    return {
      content: [
        {
          type: "text" as const,
          text: `Queue: ${queue}\n\nScheduled: ${stats.scheduled}\nRecurring: ${stats.recurring}\nPending: ${stats.pending}\nProcessing: ${stats.processing}\nCompleted: ${stats.completed}\nFailed: ${stats.failed}\nTotal: ${stats.total}`,
        },
      ],
    };
  }
);

// Tool: List recent jobs
server.registerTool(
  "list_jobs",
  {
    description: "List recent jobs in the queue with their status",
    inputSchema: {
      queue: z
        .string()
        .optional()
        .default("default")
        .describe("Queue name (default: 'default')"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of jobs to return (default: 10)"),
      status: z
        .enum(["scheduled", "pending", "processing", "completed", "failed"])
        .optional()
        .describe("Filter by job status"),
    },
  },
  async ({ queue, limit, status }) => {
    let jobs = await getJobs(queue, limit);

    if (status) {
      jobs = jobs.filter((j) => j.status === status);
    }

    const result = jobs.map((job) => {
      const payload = JSON.parse(job.payload);
      return {
        id: job.id,
        jobClass: payload.jobClass || "LegacyJob",
        status: job.status,
        attempts: `${job.attempts}/${job.maxAttempts}`,
        error: job.error,
        createdAt: job.createdAt,
        scheduledFor: job.scheduledFor,
        isRecurring: job.isRecurring,
        cronExpression: job.cronExpression,
        nextRunAt: job.nextRunAt,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            result.length > 0
              ? JSON.stringify(result, null, 2)
              : "No jobs found matching criteria",
        },
      ],
    };
  }
);

// Tool: List scheduled jobs (one-time)
server.registerTool(
  "list_scheduled_jobs",
  {
    description: "List all one-time scheduled jobs waiting to run",
    inputSchema: {
      queue: z
        .string()
        .optional()
        .default("default")
        .describe("Queue name (default: 'default')"),
    },
  },
  async ({ queue }) => {
    const jobs = await getScheduledJobs(queue);

    const result = jobs.map((job) => {
      const payload = JSON.parse(job.payload);
      return {
        id: job.id,
        jobClass: payload.jobClass || "LegacyJob",
        scheduledFor: job.scheduledFor,
        createdAt: job.createdAt,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            result.length > 0
              ? JSON.stringify(result, null, 2)
              : "No scheduled jobs found",
        },
      ],
    };
  }
);

// Tool: List recurring jobs
server.registerTool(
  "list_recurring_jobs",
  {
    description: "List all recurring jobs with their cron schedules",
    inputSchema: {
      queue: z
        .string()
        .optional()
        .default("default")
        .describe("Queue name (default: 'default')"),
    },
  },
  async ({ queue }) => {
    const jobs = await getRecurringJobs(queue);

    const result = jobs.map((job) => {
      const payload = JSON.parse(job.payload);
      return {
        id: job.id,
        jobClass: payload.jobClass || "LegacyJob",
        cronExpression: job.cronExpression,
        status: job.status,
        nextRunAt: job.nextRunAt,
        lastRunAt: job.lastRunAt,
        createdAt: job.createdAt,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            result.length > 0
              ? JSON.stringify(result, null, 2)
              : "No recurring jobs found",
        },
      ],
    };
  }
);

// Tool: Cancel a scheduled job
server.registerTool(
  "cancel_scheduled_job",
  {
    description: "Cancel a scheduled job (one-time or recurring)",
    inputSchema: {
      jobId: z.number().describe("The job ID to cancel"),
    },
  },
  async ({ jobId }) => {
    try {
      const job = await cancelScheduledJob(jobId);
      return {
        content: [
          {
            type: "text" as const,
            text: `Job ${jobId} has been cancelled`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Pause a recurring job
server.registerTool(
  "pause_recurring_job",
  {
    description: "Pause a recurring job (stops spawning new instances)",
    inputSchema: {
      jobId: z.number().describe("The recurring job ID to pause"),
    },
  },
  async ({ jobId }) => {
    try {
      const job = await pauseRecurringJob(jobId);
      return {
        content: [
          {
            type: "text" as const,
            text: `Recurring job ${jobId} has been paused`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Resume a recurring job
server.registerTool(
  "resume_recurring_job",
  {
    description: "Resume a paused recurring job",
    inputSchema: {
      jobId: z.number().describe("The recurring job ID to resume"),
    },
  },
  async ({ jobId }) => {
    try {
      const job = await resumeRecurringJob(jobId);
      return {
        content: [
          {
            type: "text" as const,
            text: `Recurring job ${jobId} has been resumed. Next run: ${job.nextRunAt}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Job Queue MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
