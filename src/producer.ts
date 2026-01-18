import { getStats, prisma } from "./queue";
import {
  SendEmailJob,
  SendWelcomeEmailJob,
  GenerateReportJob,
  ExportDataJob,
} from "./jobs";

async function main() {
  console.log("Adding jobs to the queue...\n");

  // Add some email jobs
  const emailJob1 = await SendEmailJob.performLater(
    { to: "alice@example.com", subject: "Welcome!", body: "Thanks for signing up." },
    { priority: 5 }
  );
  console.log(`Enqueued SendEmailJob ${emailJob1.id}: to alice@example.com`);

  const emailJob2 = await SendEmailJob.performLater(
    { to: "bob@example.com", subject: "Your order shipped", body: "Track it here..." },
    { priority: 3 }
  );
  console.log(`Enqueued SendEmailJob ${emailJob2.id}: to bob@example.com`);

  // Add a welcome email job
  const welcomeJob = await SendWelcomeEmailJob.performLater(
    { userId: 42, email: "newuser@example.com", name: "New User" },
    { priority: 10 }
  );
  console.log(`Enqueued SendWelcomeEmailJob ${welcomeJob.id}: for user 42`);

  // Add a report job
  const reportJob = await GenerateReportJob.performLater(
    {
      reportType: "weekly",
      userId: 1,
      startDate: "2025-01-01",
      endDate: "2025-01-07",
    },
    { priority: 2 }
  );
  console.log(`Enqueued GenerateReportJob ${reportJob.id}: weekly report`);

  // Add an export job
  const exportJob = await ExportDataJob.performLater(
    { format: "csv", tableName: "users", filters: { active: true } },
    { priority: 1 }
  );
  console.log(`Enqueued ExportDataJob ${exportJob.id}: users as CSV`);

  console.log("\n--- Queue Stats ---");
  const stats = await getStats();
  console.log(stats);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
