import { defineJob } from "./registry";

interface GenerateReportArgs {
  reportType: "daily" | "weekly" | "monthly";
  userId: number;
  startDate: string;
  endDate: string;
}

export const GenerateReportJob = defineJob<GenerateReportArgs>(
  "GenerateReportJob",
  async (args) => {
    console.log(`  [GenerateReportJob] Generating ${args.reportType} report`);
    console.log(`  [GenerateReportJob] User: ${args.userId}`);
    console.log(`  [GenerateReportJob] Period: ${args.startDate} to ${args.endDate}`);

    // Simulate report generation (longer task)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`  [GenerateReportJob] Report generated successfully!`);
  }
);

interface ExportDataArgs {
  format: "csv" | "json" | "pdf";
  tableName: string;
  filters?: Record<string, unknown>;
}

export const ExportDataJob = defineJob<ExportDataArgs>(
  "ExportDataJob",
  async (args) => {
    console.log(`  [ExportDataJob] Exporting ${args.tableName} as ${args.format}`);

    // Simulate export
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Simulate occasional failures
    if (args.format === "pdf" && Math.random() < 0.15) {
      throw new Error("PDF generation failed: out of memory");
    }

    console.log(`  [ExportDataJob] Export completed!`);
  }
);
