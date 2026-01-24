import { defineJob } from "./registry";

interface DiscordNotificationArgs {
  conversationId: number;
  conversationTitle?: string;
  status: "completed" | "failed";
  cost?: number;
  turns?: number;
  error?: string;
}

export const SendDiscordNotificationJob = defineJob<DiscordNotificationArgs>(
  "SendDiscordNotificationJob",
  async (args) => {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log("DISCORD_WEBHOOK_URL not configured, skipping notification");
      return;
    }

    const color = args.status === "completed" ? 0x00ff00 : 0xff0000;
    const emoji = args.status === "completed" ? "\u2705" : "\u274c";

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: "Conversation ID", value: String(args.conversationId), inline: true },
    ];

    if (args.turns !== undefined) {
      fields.push({ name: "Turns", value: String(args.turns), inline: true });
    }

    if (args.cost !== undefined) {
      fields.push({ name: "Cost", value: `$${args.cost.toFixed(4)}`, inline: true });
    }

    if (args.error) {
      fields.push({ name: "Error", value: args.error.slice(0, 200) });
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${emoji} Conversation ${args.status}`,
          description: args.conversationTitle || `Conversation #${args.conversationId}`,
          color,
          fields,
          timestamp: new Date().toISOString(),
        }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    }

    console.log(`  [SendDiscordNotificationJob] Discord notification sent for conversation ${args.conversationId}`);
  }
);
