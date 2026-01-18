/**
 * Job Registry Index
 *
 * Import this file to register all job handlers.
 * Add new job files here to make them available to the worker.
 */

// Re-export registry utilities
export {
  defineJob,
  getJobHandler,
  getRegisteredJobs,
  isJobRegistered,
  parseJobPayload,
  type JobPayload,
  type JobHandler,
  type JobDefinition,
} from "./registry";

// Import all job files to register them
// Add new job imports here
export * from "./email.job";
export * from "./report.job";
export * from "./spawnClaudeSession.job"
