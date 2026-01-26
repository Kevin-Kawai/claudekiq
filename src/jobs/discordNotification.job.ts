import { defineJob } from "./registry";
import { prisma } from "../queue";

interface DiscordNotificationArgs {
  conversationId: number;
  conversationTitle?: string;
  status: "completed" | "failed";
  cost?: number;
  turns?: number;
  error?: string;
  responseText?: string;
}

// Discord limits
const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Gets a user mention string if DISCORD_MENTION_USER_ID is configured
 */
function getUserMention(): string {
  const userId = process.env.DISCORD_MENTION_USER_ID;
  return userId ? `<@${userId}> ` : "";
}

/**
 * Sends a message to an existing Discord thread
 */
async function sendToThread(threadId: string, content: string, mention: boolean = true): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN not configured");

  // Add mention prefix if enabled and configured
  const mentionPrefix = mention ? getUserMention() : "";
  const fullContent = mentionPrefix + content;

  // Truncate if needed
  const truncatedContent = fullContent.length > MAX_MESSAGE_LENGTH
    ? fullContent.slice(0, MAX_MESSAGE_LENGTH - 3) + "..."
    : fullContent;

  const response = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: truncatedContent }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error: ${response.status} ${text}`);
  }
}

/**
 * Creates a thread from a message and returns the thread ID
 */
async function createThreadFromMessage(
  channelId: string,
  messageId: string,
  name: string
): Promise<string> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN not configured");

  // Thread names max 100 chars
  const threadName = name.length > 100 ? name.slice(0, 97) + "..." : name;

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: threadName,
        auto_archive_duration: 1440, // 24 hours
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error creating thread: ${response.status} ${text}`);
  }

  const thread = await response.json();
  return thread.id;
}

/**
 * Locks or unlocks a thread
 */
async function setThreadLocked(threadId: string, locked: boolean): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN not configured");

  const response = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ locked }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API error setting thread lock: ${response.status} ${text}`);
  }
}

/**
 * Sends a notification using webhook (simple mode, one-way)
 */
async function sendWebhookNotification(args: DiscordNotificationArgs): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL not configured, skipping notification");
    return;
  }

  const color = args.status === "completed" ? 0x00ff00 : 0xff0000;
  const emoji = args.status === "completed" ? "\u2705" : "\u274c";

  const baseUrl = process.env.CLAUDEKIQ_BASE_URL;
  const conversationUrl = baseUrl ? `${baseUrl}/conversations/${args.conversationId}` : null;

  const title = `${emoji} Conversation ${args.status}`;
  const conversationName = args.conversationTitle || `Conversation #${args.conversationId}`;

  let description = conversationName;
  if (args.responseText) {
    const truncatedResponse = args.responseText.length > (MAX_DESCRIPTION_LENGTH - conversationName.length - 50)
      ? args.responseText.slice(0, MAX_DESCRIPTION_LENGTH - conversationName.length - 53) + "..."
      : args.responseText;
    description = `**${conversationName}**\n\n${truncatedResponse}`;
  }

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
    fields.push({ name: "Error", value: args.error.slice(0, MAX_FIELD_VALUE_LENGTH) });
  }

  if (conversationUrl) {
    fields.push({ name: "View", value: `[Open Conversation](${conversationUrl})`, inline: true });
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title,
        description,
        color,
        fields,
        timestamp: new Date().toISOString(),
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Sends a notification using bot mode with threads (bi-directional)
 */
async function sendBotNotification(args: DiscordNotificationArgs): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!botToken || !channelId) {
    console.log("DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not configured, skipping bot notification");
    return;
  }

  const conversationName = args.conversationTitle || `Conversation #${args.conversationId}`;
  const emoji = args.status === "completed" ? "\u2705" : "\u274c";

  // Check if we already have a thread for this conversation
  let mapping = await prisma.discordThreadMapping.findUnique({
    where: { conversationId: args.conversationId },
  });

  if (mapping) {
    // Thread exists - unlock it and post the response there
    try {
      await setThreadLocked(mapping.threadId, false);
    } catch (err) {
      // Thread might have been deleted, try to create a new one
      console.log(`Failed to unlock thread, will create new one: ${err}`);
      await prisma.discordThreadMapping.delete({
        where: { conversationId: args.conversationId },
      });
      mapping = null;
    }
  }

  if (!mapping) {
    // No thread yet - create notification message and thread
    const baseUrl = process.env.CLAUDEKIQ_BASE_URL;
    const conversationUrl = baseUrl ? `${baseUrl}/conversations/${args.conversationId}` : null;

    // Post initial notification message
    const notificationContent = conversationUrl
      ? `${emoji} **${conversationName}**\n[Open in UI](${conversationUrl})`
      : `${emoji} **${conversationName}**`;

    const msgResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: notificationContent }),
    });

    if (!msgResponse.ok) {
      const text = await msgResponse.text();
      throw new Error(`Discord API error: ${msgResponse.status} ${text}`);
    }

    const message = await msgResponse.json();

    // Create thread from the message
    const threadId = await createThreadFromMessage(channelId, message.id, conversationName);

    // Store the mapping
    mapping = await prisma.discordThreadMapping.create({
      data: {
        threadId,
        channelId,
        conversationId: args.conversationId,
      },
    });
  }

  // Now post the actual content to the thread
  if (args.status === "completed") {
    // Build completion message
    let message = "";

    if (args.responseText) {
      message = args.responseText;
    }

    // Add metadata footer
    const metadata: string[] = [];
    if (args.turns !== undefined) metadata.push(`Turns: ${args.turns}`);
    if (args.cost !== undefined) metadata.push(`Cost: $${args.cost.toFixed(4)}`);

    if (metadata.length > 0) {
      message += `\n\n*${metadata.join(" | ")}*`;
    }

    if (message.trim()) {
      await sendToThread(mapping.threadId, message);
    }
  } else if (args.status === "failed") {
    const errorMessage = args.error
      ? `\u274c **Error:** ${args.error.slice(0, 500)}`
      : "\u274c Conversation failed";
    await sendToThread(mapping.threadId, errorMessage);
  }
}

export const SendDiscordNotificationJob = defineJob<DiscordNotificationArgs>(
  "SendDiscordNotificationJob",
  async (args) => {
    // Check which mode to use
    const useBotMode = process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID;
    const useWebhookMode = process.env.DISCORD_WEBHOOK_URL;

    if (useBotMode) {
      // Prefer bot mode for bi-directional communication
      await sendBotNotification(args);
      console.log(`  [SendDiscordNotificationJob] Bot notification sent for conversation ${args.conversationId}`);
    } else if (useWebhookMode) {
      // Fall back to simple webhook
      await sendWebhookNotification(args);
      console.log(`  [SendDiscordNotificationJob] Webhook notification sent for conversation ${args.conversationId}`);
    } else {
      console.log("  [SendDiscordNotificationJob] No Discord configuration found, skipping");
    }
  }
);

/**
 * Job to lock a thread when a conversation starts processing
 * Called by the discord bot when it receives a reply
 */
interface LockThreadArgs {
  conversationId: number;
}

export const LockDiscordThreadJob = defineJob<LockThreadArgs>(
  "LockDiscordThreadJob",
  async (args) => {
    const mapping = await prisma.discordThreadMapping.findUnique({
      where: { conversationId: args.conversationId },
    });

    if (mapping) {
      await setThreadLocked(mapping.threadId, true);
      console.log(`  [LockDiscordThreadJob] Locked thread for conversation ${args.conversationId}`);
    }
  }
);
