import { defineJob } from "./registry";

interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
}

export const SendEmailJob = defineJob<SendEmailArgs>(
  "SendEmailJob",
  async (args) => {
    console.log(`  [SendEmailJob] Sending email to: ${args.to}`);
    console.log(`  [SendEmailJob] Subject: ${args.subject}`);

    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Simulate occasional failures (10% chance)
    if (Math.random() < 0.1) {
      throw new Error("SMTP connection failed");
    }

    console.log(`  [SendEmailJob] Email sent successfully!`);
  }
);

interface WelcomeEmailArgs {
  userId: number;
  email: string;
  name: string;
}

export const SendWelcomeEmailJob = defineJob<WelcomeEmailArgs>(
  "SendWelcomeEmailJob",
  async (args) => {
    console.log(`  [SendWelcomeEmailJob] Sending welcome email to ${args.name}`);

    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log(`  [SendWelcomeEmailJob] Welcome email sent to ${args.email}!`);
  }
);
