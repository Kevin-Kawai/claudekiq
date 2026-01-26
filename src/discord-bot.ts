/**
 * Discord Bot Worker
 *
 * Listens for replies in Discord threads and routes them back to Claudekiq
 * as follow-up messages to the corresponding conversation.
 *
 * Required environment variables:
 * - DISCORD_BOT_TOKEN: Your Discord bot token
 * - DISCORD_CHANNEL_ID: The channel ID where notifications are posted
 *
 * Optional:
 * - CLAUDEKIQ_BASE_URL: Base URL for conversation links
 */

import { Client, GatewayIntentBits, Events, Message } from "discord.js";
import { prisma } from "./queue";
import { ConversationMessageJob, LockDiscordThreadJob } from "./jobs";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!DISCORD_BOT_TOKEN) {
  console.error("DISCORD_BOT_TOKEN environment variable is required");
  process.exit(1);
}

if (!DISCORD_CHANNEL_ID) {
  console.error("DISCORD_CHANNEL_ID environment variable is required");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot ready! Logged in as ${readyClient.user.tag}`);
  console.log(`Watching channel: ${DISCORD_CHANNEL_ID}`);
});

client.on(Events.MessageCreate, async (message: Message) => {
  try {
    // Ignore bot messages (including our own)
    if (message.author.bot) return;

    // Only process messages in threads
    if (!message.channel.isThread()) return;

    // Check if this thread's parent is our notification channel
    if (message.channel.parentId !== DISCORD_CHANNEL_ID) return;

    // Look up if this thread is mapped to a conversation
    const mapping = await prisma.discordThreadMapping.findUnique({
      where: { threadId: message.channel.id },
    });

    if (!mapping) {
      // Not a thread we created, ignore
      return;
    }

    console.log(`Received message in thread ${message.channel.id} for conversation ${mapping.conversationId}`);

    // Check if there's already a pending/processing job for this conversation
    const existingJob = await prisma.job.findFirst({
      where: {
        conversationId: mapping.conversationId,
        status: { in: ["pending", "processing"] },
      },
    });

    if (existingJob) {
      // Already processing - let the user know
      await message.reply({
        content: "⏳ Still processing the previous message, please wait...",
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    // React to show we received the message
    await message.react("👀");

    // Lock the thread while processing
    await LockDiscordThreadJob.performLater({
      conversationId: mapping.conversationId,
    }, { priority: 100 }); // High priority to lock quickly

    // Enqueue the conversation message job
    await ConversationMessageJob.performLater({
      conversationId: mapping.conversationId,
      message: message.content,
    });

    console.log(`Enqueued follow-up message for conversation ${mapping.conversationId}`);

  } catch (err) {
    console.error("Error handling Discord message:", err);

    // Try to let the user know something went wrong
    try {
      await message.reply({
        content: "❌ Failed to process your message. Please try again or check the logs.",
        allowedMentions: { repliedUser: false },
      });
    } catch {
      // Ignore if we can't send the error message
    }
  }
});

// Handle errors
client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down Discord bot...");
  client.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down Discord bot...");
  client.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

// Start the bot
console.log("Starting Discord bot...");
client.login(DISCORD_BOT_TOKEN).catch((err) => {
  console.error("Failed to login to Discord:", err);
  process.exit(1);
});
