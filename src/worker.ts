import { dequeue, ack, fail, getStats, processScheduledJobs, prisma } from "./queue";
import {
  getJobHandler,
  parseJobPayload,
  getRegisteredJobs,
  SendDiscordNotificationJob,
} from "./jobs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff state for database errors */
let dbErrorBackoff = 0;
const MAX_DB_ERROR_BACKOFF = 30000; // Max 30 seconds

export interface WorkerOptions {
  queue?: string;
  pollInterval?: number;
  onEmpty?: () => void;
}

/**
 * Run a worker that processes jobs from the queue
 * Jobs are dispatched to handlers based on their jobClass
 */
export async function runWorker(options: WorkerOptions = {}): Promise<never> {
  const queue = options.queue ?? "default";
  const pollInterval = options.pollInterval ?? 1000;

  console.log(`Worker started for queue: "${queue}"`);
  console.log(`Registered job classes: ${getRegisteredJobs().join(", ")}`);

  while (true) {
    try {
      // Process scheduled jobs - promotes one-time jobs and spawns recurring job instances
      // Note: processScheduledJobs has internal retry logic for individual operations
      const { promoted, spawned } = await processScheduledJobs();
      if (promoted > 0 || spawned > 0) {
        console.log(`Scheduler: promoted ${promoted} jobs, spawned ${spawned} recurring instances`);
      }

      // Reset backoff on success
      dbErrorBackoff = 0;
    } catch (err) {
      // Database error during scheduled job processing - log and continue
      console.error(`Failed to process scheduled jobs: ${err instanceof Error ? err.message : String(err)}`);
      dbErrorBackoff = Math.min(dbErrorBackoff + 1000, MAX_DB_ERROR_BACKOFF);
      await sleep(dbErrorBackoff);
      continue;
    }

    let job;
    try {
      // Note: dequeue has internal retry logic
      job = await dequeue(queue);

      // Reset backoff on success
      dbErrorBackoff = 0;
    } catch (err) {
      // Database error during dequeue - back off and retry
      console.error(`Failed to dequeue job: ${err instanceof Error ? err.message : String(err)}`);
      dbErrorBackoff = Math.min(dbErrorBackoff + 1000, MAX_DB_ERROR_BACKOFF);
      await sleep(dbErrorBackoff);
      continue;
    }

    if (!job) {
      options.onEmpty?.();
      await sleep(pollInterval);
      continue;
    }

    const { jobClass, args } = parseJobPayload(job.payload);

    console.log(
      `Processing job ${job.id} [${jobClass}] (attempt ${job.attempts}/${job.maxAttempts})`
    );

    const handler = getJobHandler(jobClass);

    if (!handler) {
      const errorMessage = `Unknown job class: ${jobClass}. Registered: ${getRegisteredJobs().join(", ")}`;
      console.error(`Job ${job.id} failed: ${errorMessage}`);
      try {
        await fail(job.id, errorMessage);
      } catch (failErr) {
        console.error(`Failed to mark job ${job.id} as failed: ${failErr instanceof Error ? failErr.message : String(failErr)}`);
      }
      continue;
    }

    try {
      await handler(args, { jobId: job.id });
      try {
        await ack(job.id);
        console.log(`Job ${job.id} [${jobClass}] completed`);

        // Send Discord notification for completed conversation jobs
        if (jobClass === "ConversationMessageJob" && process.env.DISCORD_WEBHOOK_URL) {
          const { conversationId } = args as { conversationId: number };
          try {
            // Fetch conversation and latest result message for metadata
            const conversation = await prisma.conversation.findUnique({
              where: { id: conversationId },
              include: {
                messages: {
                  where: { role: "result" },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
              },
            });

            if (conversation) {
              const resultMsg = conversation.messages[0];
              const resultData = resultMsg ? JSON.parse(resultMsg.content) : {};

              await SendDiscordNotificationJob.performLater({
                conversationId,
                conversationTitle: conversation.title || undefined,
                status: "completed",
                cost: resultData.total_cost_usd,
                turns: resultData.num_turns,
              }, { priority: 10 });
            }
          } catch (notifyErr) {
            // Don't fail the job if notification fails
            console.error(`Failed to enqueue Discord notification: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
          }
        }
      } catch (ackErr) {
        // Job completed but we couldn't ack it - log the error but don't crash
        // The job may be retried but that's better than crashing the worker
        console.error(`Job ${job.id} completed but failed to ack: ${ackErr instanceof Error ? ackErr.message : String(ackErr)}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Job ${job.id} [${jobClass}] failed: ${errorMessage}`);
      try {
        await fail(job.id, errorMessage);
      } catch (failErr) {
        // We couldn't mark the job as failed - log and continue
        // The job will remain in "processing" state and eventually be reset by resetStaleJobs
        console.error(`Failed to mark job ${job.id} as failed: ${failErr instanceof Error ? failErr.message : String(failErr)}`);
      }
    }
  }
}

// Run the worker when this file is executed directly
async function main() {
  // Show initial stats
  const stats = await getStats();
  console.log("Queue stats:", stats);

  // Start the worker
  await runWorker({
    queue: "default",
    pollInterval: 1000,
    onEmpty: () => console.log("Queue empty, waiting..."),
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
