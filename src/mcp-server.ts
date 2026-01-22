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
  getWorkspaces,
  getWorkspace,
  getConversations,
  getConversation,
  sendMessage,
  createWorktree,
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getToolsets,
  getToolset,
  createToolset,
  updateToolset,
  deleteToolset,
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
  name: "claudekiq",
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
    const data = await getJobs(queue, limit);
    let jobs = data.jobs;

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
              ? JSON.stringify({ jobs: result, total: data.total }, null, 2)
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

// ============ Workspace Tools ============

// Tool: List workspaces
server.registerTool(
  "list_workspaces",
  {
    description: "List all configured workspaces (directories for conversations)",
  },
  async () => {
    const workspaces = await getWorkspaces();

    if (workspaces.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No workspaces configured",
          },
        ],
      };
    }

    const result = workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      path: ws.path,
      createdAt: ws.createdAt,
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

// ============ Toolset Tools ============

// Tool: List toolsets
server.registerTool(
  "list_toolsets",
  {
    description: "List all toolsets (saved tool configurations)",
  },
  async () => {
    const toolsets = await getToolsets();

    if (toolsets.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No toolsets found. Create one with create_toolset.",
          },
        ],
      };
    }

    const result = toolsets.map((t) => ({
      id: t.id,
      name: t.name,
      tools: JSON.parse(t.tools),
      isDefault: t.isDefault,
      createdAt: t.createdAt,
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

// Tool: Get toolset details
server.registerTool(
  "get_toolset",
  {
    description: "Get details of a specific toolset",
    inputSchema: {
      toolsetId: z.number().describe("The toolset ID to get"),
    },
  },
  async ({ toolsetId }) => {
    const toolset = await getToolset(toolsetId);

    if (!toolset) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Toolset with ID ${toolsetId} not found`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              id: toolset.id,
              name: toolset.name,
              tools: JSON.parse(toolset.tools),
              isDefault: toolset.isDefault,
              createdAt: toolset.createdAt,
              updatedAt: toolset.updatedAt,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: Create toolset
server.registerTool(
  "create_toolset",
  {
    description: "Create a new toolset (saved tool configuration)",
    inputSchema: {
      name: z.string().describe("Unique name for this toolset"),
      tools: z
        .array(z.string())
        .describe("Array of tool names (e.g., ['Read', 'Edit', 'Glob', 'Bash'])"),
      isDefault: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set as the default toolset (only one can be default)"),
    },
  },
  async ({ name, tools, isDefault }) => {
    try {
      const toolset = await createToolset(name, tools, isDefault);

      return {
        content: [
          {
            type: "text" as const,
            text: `Toolset created successfully!\n\nID: ${toolset.id}\nName: ${toolset.name}\nTools: ${tools.join(", ")}${isDefault ? "\nDefault: Yes" : ""}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isDuplicate = message.includes("Unique constraint");
      return {
        content: [
          {
            type: "text" as const,
            text: isDuplicate
              ? `Error: A toolset with name '${name}' already exists`
              : `Error creating toolset: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Update toolset
server.registerTool(
  "update_toolset",
  {
    description: "Update an existing toolset",
    inputSchema: {
      toolsetId: z.number().describe("The toolset ID to update"),
      name: z.string().optional().describe("New name for the toolset"),
      tools: z.array(z.string()).optional().describe("New array of tool names"),
      isDefault: z.boolean().optional().describe("Set as the default toolset"),
    },
  },
  async ({ toolsetId, name, tools, isDefault }) => {
    try {
      const toolset = await updateToolset(toolsetId, { name, tools, isDefault });

      return {
        content: [
          {
            type: "text" as const,
            text: `Toolset ${toolset.id} updated successfully!`,
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

// Tool: Delete toolset
server.registerTool(
  "delete_toolset",
  {
    description: "Delete a toolset",
    inputSchema: {
      toolsetId: z.number().describe("The toolset ID to delete"),
    },
  },
  async ({ toolsetId }) => {
    try {
      await deleteToolset(toolsetId);

      return {
        content: [
          {
            type: "text" as const,
            text: `Toolset ${toolsetId} deleted successfully`,
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

// ============ Template Tools ============

// Tool: List templates
server.registerTool(
  "list_templates",
  {
    description: "List all conversation templates (saved conversation presets)",
  },
  async () => {
    const templates = await getTemplates();

    if (templates.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No templates found. Create one with create_template.",
          },
        ],
      };
    }

    const result = templates.map((t) => {
      const tWithRelations = t as { workspace?: { name: string }; toolset?: { name: string } };
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        workspace: tWithRelations.workspace?.name || null,
        toolset: tWithRelations.toolset?.name || null,
        useWorktree: t.useWorktree,
        hasInitialMessage: !!t.initialMessage,
        createdAt: t.createdAt,
      };
    });

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

// Tool: Get template details
server.registerTool(
  "get_template",
  {
    description: "Get full details of a conversation template",
    inputSchema: {
      templateId: z.number().describe("The template ID to get"),
    },
  },
  async ({ templateId }) => {
    const template = await getTemplate(templateId);

    if (!template) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Template with ID ${templateId} not found`,
          },
        ],
        isError: true,
      };
    }

    const templateWithRelations = template as {
      workspace?: { id: number; name: string; path: string };
      toolset?: { id: number; name: string; tools: string };
    };

    const result = {
      id: template.id,
      name: template.name,
      description: template.description,
      title: template.title,
      workspace: templateWithRelations.workspace || null,
      useWorktree: template.useWorktree,
      branchNamePattern: template.branchNamePattern,
      toolset: templateWithRelations.toolset ? {
        id: templateWithRelations.toolset.id,
        name: templateWithRelations.toolset.name,
        tools: JSON.parse(templateWithRelations.toolset.tools),
      } : null,
      allowedTools: template.allowedTools ? JSON.parse(template.allowedTools) : null,
      additionalDirectories: template.additionalDirectories ? JSON.parse(template.additionalDirectories) : null,
      initialMessage: template.initialMessage,
      cronExpression: template.cronExpression,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };

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

// Tool: Create template
server.registerTool(
  "create_template",
  {
    description: "Create a conversation template to save and reuse conversation settings",
    inputSchema: {
      name: z.string().describe("Unique name for this template"),
      description: z.string().optional().describe("Description of what this template is for"),
      title: z.string().optional().describe("Default conversation title"),
      workspaceId: z.number().optional().describe("Workspace ID to use"),
      useWorktree: z.boolean().optional().default(false).describe("Create git worktree for conversations"),
      branchNamePattern: z.string().optional().describe("Pattern for branch name, e.g., 'feature/{name}'"),
      toolsetId: z.number().optional().describe("Toolset ID to use (get IDs from list_toolsets)"),
      allowedTools: z.array(z.string()).optional().describe("Tools Claude is allowed to use (ignored if toolsetId is provided)"),
      additionalDirectories: z.array(z.string()).optional().describe("Additional directories Claude can access"),
      initialMessage: z.string().optional().describe("The prompt/message to start conversations with"),
      cronExpression: z.string().optional().describe("Cron expression for recurring initial messages"),
    },
  },
  async ({ name, description, title, workspaceId, useWorktree, branchNamePattern, toolsetId, allowedTools, additionalDirectories, initialMessage, cronExpression }) => {
    // Validate cron expression if provided
    if (cronExpression && !isValidCronExpression(cronExpression)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid cron expression '${cronExpression}'`,
          },
        ],
        isError: true,
      };
    }

    // Validate toolset if provided
    if (toolsetId) {
      const toolset = await getToolset(toolsetId);
      if (!toolset) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Toolset with ID ${toolsetId} not found`,
            },
          ],
          isError: true,
        };
      }
    }

    try {
      const template = await createTemplate({
        name,
        description,
        title,
        workspaceId,
        useWorktree,
        branchNamePattern,
        toolsetId,
        allowedTools,
        additionalDirectories,
        initialMessage,
        cronExpression,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Template created successfully!\n\nID: ${template.id}\nName: ${template.name}${description ? `\nDescription: ${description}` : ""}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isDuplicate = message.includes("Unique constraint");
      return {
        content: [
          {
            type: "text" as const,
            text: isDuplicate
              ? `Error: A template with name '${name}' already exists`
              : `Error creating template: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Update template
server.registerTool(
  "update_template",
  {
    description: "Update an existing conversation template",
    inputSchema: {
      templateId: z.number().describe("The template ID to update"),
      name: z.string().optional().describe("New name for the template"),
      description: z.string().optional().describe("New description"),
      title: z.string().optional().describe("New default conversation title"),
      workspaceId: z.number().optional().describe("New workspace ID"),
      useWorktree: z.boolean().optional().describe("Create git worktree for conversations"),
      branchNamePattern: z.string().optional().describe("Pattern for branch name"),
      toolsetId: z.number().optional().describe("Toolset ID to use"),
      allowedTools: z.array(z.string()).optional().describe("Tools Claude is allowed to use"),
      additionalDirectories: z.array(z.string()).optional().describe("Additional directories Claude can access"),
      initialMessage: z.string().optional().describe("The prompt/message to start conversations with"),
      cronExpression: z.string().optional().describe("Cron expression for recurring initial messages"),
    },
  },
  async ({ templateId, ...updates }) => {
    // Validate cron expression if provided
    if (updates.cronExpression && !isValidCronExpression(updates.cronExpression)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid cron expression '${updates.cronExpression}'`,
          },
        ],
        isError: true,
      };
    }

    // Validate toolset if provided
    if (updates.toolsetId) {
      const toolset = await getToolset(updates.toolsetId);
      if (!toolset) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Toolset with ID ${updates.toolsetId} not found`,
            },
          ],
          isError: true,
        };
      }
    }

    try {
      const template = await updateTemplate(templateId, updates);

      return {
        content: [
          {
            type: "text" as const,
            text: `Template ${template.id} updated successfully!`,
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

// Tool: Delete template
server.registerTool(
  "delete_template",
  {
    description: "Delete a conversation template",
    inputSchema: {
      templateId: z.number().describe("The template ID to delete"),
    },
  },
  async ({ templateId }) => {
    try {
      await deleteTemplate(templateId);

      return {
        content: [
          {
            type: "text" as const,
            text: `Template ${templateId} deleted successfully`,
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

// ============ Conversation Tools ============

// Tool: List conversations
server.registerTool(
  "list_conversations",
  {
    description: "List conversations with their status and message count, optionally filtered by workspace",
    inputSchema: {
      workspaceId: z
        .number()
        .optional()
        .describe("Filter by workspace ID (get IDs from list_workspaces). If not provided, returns all conversations."),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of conversations to return (default: 20)"),
    },
  },
  async ({ workspaceId, limit }) => {
    const data = await getConversations(workspaceId, limit);

    if (data.conversations.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: workspaceId ? "No conversations found for this workspace" : "No conversations found",
          },
        ],
      };
    }

    const result = data.conversations.map((conv) => ({
      id: conv.id,
      title: conv.title || `Conversation #${conv.id}`,
      status: conv.status,
      messageCount: conv._count?.messages || 0,
      workspace: conv.workspace?.name || null,
      worktreeBranch: conv.worktreeBranch || null,
      cwd: conv.cwd,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ conversations: result, total: data.total }, null, 2),
        },
      ],
    };
  }
);

// Tool: Create conversation
server.registerTool(
  "create_conversation",
  {
    description: "Create a new conversation and optionally send an initial message. Supports workspaces, git worktrees, scheduling, templates, and toolsets.",
    inputSchema: {
      templateId: z
        .number()
        .optional()
        .describe("Template ID to use as a base (get IDs from list_templates). Other parameters override template values."),
      message: z
        .string()
        .optional()
        .describe("Initial message to send (overrides template's initialMessage)"),
      title: z
        .string()
        .optional()
        .describe("Optional title for the conversation"),
      workspaceId: z
        .number()
        .optional()
        .describe("Workspace ID to use (get IDs from list_workspaces)"),
      useWorktree: z
        .boolean()
        .optional()
        .describe("Create a git worktree for this conversation (requires workspaceId)"),
      branchName: z
        .string()
        .optional()
        .describe("Branch name for the worktree (required if useWorktree is true)"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (used if workspaceId is not provided)"),
      scheduledFor: z
        .string()
        .optional()
        .describe("ISO datetime string for when to send the initial message (e.g., '2025-01-20T09:00:00Z')"),
      cronExpression: z
        .string()
        .optional()
        .describe("Cron expression for recurring messages (e.g., '0 9 * * *' for 9 AM daily)"),
      additionalDirectories: z
        .array(z.string())
        .optional()
        .describe("Additional directories Claude can access beyond the working directory"),
      toolsetId: z
        .number()
        .optional()
        .describe("Toolset ID to use (get IDs from list_toolsets). Overrides allowedTools."),
      allowedTools: z
        .array(z.string())
        .optional()
        .describe("Tools Claude is allowed to use (defaults to ['Read', 'Edit', 'Glob', 'Bash']). Ignored if toolsetId is provided."),
    },
  },
  async ({ templateId, message, title, workspaceId, useWorktree, branchName, cwd, scheduledFor, cronExpression, additionalDirectories, toolsetId, allowedTools }) => {
    // Load template if specified
    let templateName: string | undefined;
    if (templateId) {
      const template = await getTemplate(templateId);
      if (!template) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Template with ID ${templateId} not found`,
            },
          ],
          isError: true,
        };
      }

      templateName = template.name;
      const templateWithToolset = template as { toolset?: { id: number; tools: string } };

      // Apply template defaults (explicit params override template)
      if (title === undefined) title = template.title ?? undefined;
      if (workspaceId === undefined) workspaceId = template.workspaceId ?? undefined;
      if (useWorktree === undefined) useWorktree = template.useWorktree;
      if (branchName === undefined && template.branchNamePattern) {
        // Replace {name} and {date} placeholders in branch pattern
        branchName = template.branchNamePattern
          .replace("{name}", title || "conversation")
          .replace("{date}", new Date().toISOString().split("T")[0]);
      }
      if (cronExpression === undefined) cronExpression = template.cronExpression ?? undefined;
      if (additionalDirectories === undefined && template.additionalDirectories) {
        additionalDirectories = JSON.parse(template.additionalDirectories);
      }
      // Toolset from template (can be overridden by explicit toolsetId or allowedTools)
      if (toolsetId === undefined && allowedTools === undefined) {
        if (templateWithToolset.toolset) {
          allowedTools = JSON.parse(templateWithToolset.toolset.tools);
        } else if (template.allowedTools) {
          allowedTools = JSON.parse(template.allowedTools);
        }
      }
      // Use template's initial message if no message provided
      if (message === undefined) message = template.initialMessage ?? undefined;
    }

    // If toolsetId provided, load the toolset and use its tools
    if (toolsetId) {
      const toolset = await getToolset(toolsetId);
      if (!toolset) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Toolset with ID ${toolsetId} not found`,
            },
          ],
          isError: true,
        };
      }
      allowedTools = JSON.parse(toolset.tools);
    }
    let finalCwd = cwd;
    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;

    // Handle workspace and worktree
    if (workspaceId) {
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Workspace with ID ${workspaceId} not found`,
            },
          ],
          isError: true,
        };
      }

      if (useWorktree) {
        if (!branchName) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: branchName is required when useWorktree is true",
              },
            ],
            isError: true,
          };
        }

        try {
          worktreePath = await createWorktree(workspace.path, branchName);
          worktreeBranch = branchName;
          finalCwd = worktreePath;
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error creating worktree: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        finalCwd = workspace.path;
      }
    }

    // Build query options if provided
    let queryOptions: string | undefined;
    if (additionalDirectories || allowedTools) {
      queryOptions = JSON.stringify({
        additionalDirectories,
        allowedTools,
      });
    }

    // Create the conversation
    const conversation = await prisma.conversation.create({
      data: {
        title,
        cwd: finalCwd,
        workspaceId,
        worktreePath,
        worktreeBranch,
        queryOptions,
      },
    });

    // Validate cron expression if provided
    if (cronExpression && !isValidCronExpression(cronExpression)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid cron expression '${cronExpression}'`,
          },
        ],
        isError: true,
      };
    }

    // Send initial message if provided
    if (message) {
      const scheduleOptions: { scheduledFor?: Date; cronExpression?: string } = {};
      if (scheduledFor) {
        scheduleOptions.scheduledFor = new Date(scheduledFor);
      }
      if (cronExpression) {
        scheduleOptions.cronExpression = cronExpression;
      }
      await sendMessage(conversation.id, message, Object.keys(scheduleOptions).length > 0 ? scheduleOptions : undefined);
    }

    let responseText = `Conversation created successfully!\n\nID: ${conversation.id}`;
    if (templateName) responseText += `\nTemplate: ${templateName}`;
    if (title) responseText += `\nTitle: ${title}`;
    if (finalCwd) responseText += `\nWorking Directory: ${finalCwd}`;
    if (worktreeBranch) responseText += `\nBranch: ${worktreeBranch}`;
    if (message) {
      if (cronExpression) {
        responseText += `\n\nInitial message scheduled (recurring: ${cronExpression})`;
      } else if (scheduledFor) {
        responseText += `\n\nInitial message scheduled for ${scheduledFor}`;
      } else {
        responseText += `\n\nInitial message queued for processing.`;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: responseText,
        },
      ],
    };
  }
);

// Tool: Get conversation messages
server.registerTool(
  "get_conversation_messages",
  {
    description: "Get all messages from a conversation",
    inputSchema: {
      conversationId: z
        .number()
        .describe("The conversation ID to get messages from"),
    },
  },
  async ({ conversationId }) => {
    const conversation = await getConversation(conversationId);

    if (!conversation) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Conversation with ID ${conversationId} not found`,
          },
        ],
        isError: true,
      };
    }

    if (!conversation.messages || conversation.messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Conversation #${conversationId} has no messages yet`,
          },
        ],
      };
    }

    const messages = conversation.messages.map((msg) => {
      let content;
      try {
        const parsed = JSON.parse(msg.content);
        // Extract text content based on message type
        if (msg.role === "user") {
          content = parsed.text || parsed.prompt;
        } else if (msg.role === "assistant") {
          // Extract text blocks from assistant messages
          if (parsed.content && Array.isArray(parsed.content)) {
            content = parsed.content
              .filter((block: { text?: string }) => block.text)
              .map((block: { text: string }) => block.text)
              .join("\n");
          } else {
            content = parsed;
          }
        } else if (msg.role === "result") {
          content = `Session ${parsed.subtype}${parsed.total_cost_usd ? ` (Cost: $${parsed.total_cost_usd.toFixed(4)})` : ""}`;
        } else {
          content = parsed;
        }
      } catch {
        content = msg.content;
      }

      return {
        id: msg.id,
        role: msg.role,
        content,
        createdAt: msg.createdAt,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              conversationId: conversation.id,
              title: conversation.title || `Conversation #${conversation.id}`,
              status: conversation.status,
              workspace: conversation.workspace?.name || null,
              cwd: conversation.cwd,
              messageCount: messages.length,
              messages,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: Send message to conversation
server.registerTool(
  "send_conversation_message",
  {
    description: "Send a follow-up message to an existing conversation. Supports scheduling for later or recurring execution.",
    inputSchema: {
      conversationId: z
        .number()
        .describe("The conversation ID to send the message to"),
      message: z
        .string()
        .describe("The message to send"),
      scheduledFor: z
        .string()
        .optional()
        .describe("ISO datetime string for when to send the message (e.g., '2025-01-20T09:00:00Z')"),
      cronExpression: z
        .string()
        .optional()
        .describe("Cron expression for recurring messages (e.g., '0 9 * * *' for 9 AM daily)"),
    },
  },
  async ({ conversationId, message, scheduledFor, cronExpression }) => {
    // Validate cron expression if provided
    if (cronExpression && !isValidCronExpression(cronExpression)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid cron expression '${cronExpression}'`,
          },
        ],
        isError: true,
      };
    }

    try {
      const scheduleOptions: { scheduledFor?: Date; cronExpression?: string } = {};
      if (scheduledFor) {
        scheduleOptions.scheduledFor = new Date(scheduledFor);
      }
      if (cronExpression) {
        scheduleOptions.cronExpression = cronExpression;
      }

      const job = await sendMessage(
        conversationId,
        message,
        Object.keys(scheduleOptions).length > 0 ? scheduleOptions : undefined
      );

      let responseText = `Message ${job.status === 'scheduled' ? 'scheduled' : 'queued for processing'}.\n\nConversation ID: ${conversationId}\nJob ID: ${job.id}\nStatus: ${job.status}`;
      if (cronExpression) {
        responseText += `\nSchedule: ${cronExpression}`;
        if (job.nextRunAt) {
          responseText += `\nNext Run: ${job.nextRunAt}`;
        }
      } else if (scheduledFor) {
        responseText += `\nScheduled For: ${scheduledFor}`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: responseText,
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
