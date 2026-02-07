/**
 * Discord Bot Worker
 *
 * Listens for replies in Discord threads and routes them back to Claudekiq
 * as follow-up messages to the corresponding conversation.
 *
 * Also supports slash commands to create new conversations directly from Discord.
 *
 * Required environment variables:
 * - DISCORD_BOT_TOKEN: Your Discord bot token
 * - DISCORD_CHANNEL_ID: The channel ID where notifications are posted
 * - DISCORD_CLIENT_ID: Your Discord application's client ID (for slash commands)
 *
 * Optional:
 * - CLAUDEKIQ_BASE_URL: Base URL for conversation links
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  ThreadChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import {
  prisma,
  getWorkspaces,
  getWorkspace,
  getTemplates,
  getTemplateByName,
  getToolset,
} from "./queue";
import { ConversationMessageJob } from "./jobs";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!DISCORD_BOT_TOKEN) {
  console.error("DISCORD_BOT_TOKEN environment variable is required");
  process.exit(1);
}

if (!DISCORD_CHANNEL_ID) {
  console.error("DISCORD_CHANNEL_ID environment variable is required");
  process.exit(1);
}

// Client ID is optional - slash commands just won't be registered without it
if (!DISCORD_CLIENT_ID) {
  console.warn("DISCORD_CLIENT_ID not set - slash commands will not be available");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/**
 * Register slash commands with Discord
 */
async function registerSlashCommands() {
  if (!DISCORD_CLIENT_ID) {
    console.log("Skipping slash command registration (no DISCORD_CLIENT_ID)");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("claude")
      .setDescription("Start a new Claude conversation")
      .addStringOption((option) =>
        option
          .setName("prompt")
          .setDescription("The initial prompt for Claude")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("workspace")
          .setDescription("Workspace to use (optional)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("template")
          .setDescription("Template to use (optional)")
          .setRequired(false)
          .setAutocomplete(true)
      ),
  ];

  const rest = new REST().setToken(DISCORD_BOT_TOKEN!);

  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Slash commands registered successfully");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
}

/**
 * Handle autocomplete for workspace and template options
 */
async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const focusedOption = interaction.options.getFocused(true);
  const focusedValue = focusedOption.value.toLowerCase();

  try {
    if (focusedOption.name === "workspace") {
      const workspaces = await getWorkspaces();
      const filtered = workspaces
        .filter((w) => w.name.toLowerCase().includes(focusedValue))
        .slice(0, 25); // Discord limit

      await interaction.respond(
        filtered.map((w) => ({
          name: w.name,
          value: w.name,
        }))
      );
    } else if (focusedOption.name === "template") {
      const templates = await getTemplates();
      const filtered = templates
        .filter((t) => t.name.toLowerCase().includes(focusedValue))
        .slice(0, 25);

      await interaction.respond(
        filtered.map((t) => ({
          name: t.name,
          value: t.name,
        }))
      );
    }
  } catch (error) {
    console.error("Autocomplete error:", error);
    await interaction.respond([]);
  }
}

/**
 * Handle the /claude slash command
 */
async function handleClaudeCommand(interaction: ChatInputCommandInteraction) {
  const prompt = interaction.options.getString("prompt", true);
  const workspaceName = interaction.options.getString("workspace");
  const templateName = interaction.options.getString("template");

  // Defer reply since creating conversation may take a moment
  await interaction.deferReply();

  try {
    let workspaceId: number | undefined;
    let templateId: number | undefined;
    let cwd: string | undefined;
    let allowedTools: string[] | undefined;
    let additionalDirectories: string[] | undefined;
    let title = `Discord: ${interaction.user.username} - ${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}`;

    // Look up workspace by name
    if (workspaceName) {
      const workspaces = await getWorkspaces();
      const workspace = workspaces.find(
        (w) => w.name.toLowerCase() === workspaceName.toLowerCase()
      );
      if (workspace) {
        workspaceId = workspace.id;
        cwd = workspace.path;
      } else {
        await interaction.editReply({
          content: `Workspace "${workspaceName}" not found. Use autocomplete to see available workspaces.`,
        });
        return;
      }
    }

    // Look up template by name and apply its settings
    if (templateName) {
      const template = await getTemplateByName(templateName);
      if (template) {
        templateId = template.id;

        // Apply template settings (workspace from command takes precedence)
        if (!workspaceId && template.workspaceId) {
          workspaceId = template.workspaceId;
          const workspace = await getWorkspace(template.workspaceId);
          if (workspace) {
            cwd = workspace.path;
          }
        }

        // Use template title if set
        if (template.title) {
          title = template.title;
        }

        // Load toolset or allowed tools from template
        const templateWithToolset = template as { toolset?: { id: number; tools: string } };
        if (templateWithToolset.toolset) {
          allowedTools = JSON.parse(templateWithToolset.toolset.tools);
        } else if (template.allowedTools) {
          allowedTools = JSON.parse(template.allowedTools);
        }

        // Load additional directories
        if (template.additionalDirectories) {
          additionalDirectories = JSON.parse(template.additionalDirectories);
        }
      } else {
        await interaction.editReply({
          content: `Template "${templateName}" not found. Use autocomplete to see available templates.`,
        });
        return;
      }
    }

    // Build query options
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
        cwd,
        workspaceId,
        queryOptions,
      },
    });

    // Enqueue the job to run Claude
    await ConversationMessageJob.performLater({
      conversationId: conversation.id,
      message: prompt,
    });

    // Build response message
    const baseUrl = process.env.CLAUDEKIQ_BASE_URL;
    const conversationUrl = baseUrl
      ? `${baseUrl}/conversations/${conversation.id}`
      : null;

    let responseContent = `**Conversation #${conversation.id} created**\n`;
    responseContent += `Claude is now working on your request...\n\n`;
    responseContent += `> ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}\n\n`;

    if (workspaceName) {
      responseContent += `Workspace: \`${workspaceName}\`\n`;
    }
    if (templateName) {
      responseContent += `Template: \`${templateName}\`\n`;
    }
    if (conversationUrl) {
      responseContent += `\n[Open in UI](${conversationUrl})`;
    }

    await interaction.editReply({
      content: responseContent,
    });

    console.log(
      `Created conversation ${conversation.id} from Discord slash command by ${interaction.user.username}`
    );
  } catch (error) {
    console.error("Error handling /claude command:", error);
    await interaction.editReply({
      content: `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Discord bot ready! Logged in as ${readyClient.user.tag}`);
  console.log(`Watching channel: ${DISCORD_CHANNEL_ID}`);

  // Register slash commands on startup
  await registerSlashCommands();
});

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
    } else if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "claude") {
        await handleClaudeCommand(interaction);
      }
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
  }
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
        content: "Still processing the previous message, please wait...",
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    // React to show we received the message
    await message.react("\u{1F440}");

    // Lock the thread immediately (not via job) to prevent race conditions
    try {
      const thread = message.channel as ThreadChannel;
      await thread.setLocked(true);
      console.log(`Locked thread ${thread.id}`);
    } catch (lockErr) {
      console.error("Failed to lock thread:", lockErr);
      // Continue anyway - locking is nice-to-have
    }

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
        content: "Failed to process your message. Please try again or check the logs.",
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
