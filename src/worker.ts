import { dequeue, ack, fail, getStats, processScheduledJobs, prisma } from "./queue";
import {
  getJobHandler,
  parseJobPayload,
  getRegisteredJobs,
} from "./jobs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    // Process scheduled jobs - promotes one-time jobs and spawns recurring job instances
    const { promoted, spawned } = await processScheduledJobs();
    if (promoted > 0 || spawned > 0) {
      console.log(`Scheduler: promoted ${promoted} jobs, spawned ${spawned} recurring instances`);
    }

    const job = await dequeue(queue);

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
      await fail(job.id, errorMessage);
      continue;
    }

    try {
      await handler(args);
      await ack(job.id);
      console.log(`Job ${job.id} [${jobClass}] completed`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await fail(job.id, errorMessage);
      console.error(`Job ${job.id} [${jobClass}] failed: ${errorMessage}`);
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
