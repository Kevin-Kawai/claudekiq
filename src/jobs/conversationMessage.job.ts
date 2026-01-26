import { query } from "@anthropic-ai/claude-agent-sdk";
import { defineJob, JobContext } from "./registry";
import { prisma } from "../queue";

interface ConversationMessageJobArgs {
  conversationId: number;
  message: string;
  maxTurns?: number;
}

export const ConversationMessageJob = defineJob<ConversationMessageJobArgs>(
  "ConversationMessageJob",
  async (args, context) => {
    const { conversationId, message, maxTurns } = args;

    // Get the conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Store the user message
    await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content: JSON.stringify({ text: message }),
        jobId: context.jobId,
      },
    });

    // Parse stored query options
    const storedOptions = conversation.queryOptions
      ? JSON.parse(conversation.queryOptions)
      : {};

    // Build query options
    const options: Parameters<typeof query>[0]["options"] = {
      allowedTools: storedOptions.allowedTools || ["Read", "Edit", "Glob", "Bash"],
      permissionMode: "acceptEdits",
      cwd: conversation.cwd || process.cwd(),
    };

    // PLACEHOLDER: Add remote MCP servers here
    // Example configuration for remote MCP servers:
    // options.mcpServers = {
    //   "my-remote-server": {
    //     type: "sse",
    //     url: "https://example.com/mcp/sse",
    //     headers: { "Authorization": "Bearer YOUR_TOKEN" }
    //   },
    //   "another-server": {
    //     type: "http",
    //     url: "https://api.example.com/mcp",
    //     headers: { "X-API-Key": "YOUR_API_KEY" }
    //   }
    // };
    options.mcpServers = {
      // Add your remote MCP servers here in this format:
      // "server-name": { type: "sse", url: "https://...", headers: {...} }
      claudekiq: {
        command: "sh",
        args: ["-c", "cd /home/kevin/Projects/claudekiq && npm run mcp"]
      },
      todoist: {
        "command": "npx",
        "args": ["-y", "mcp-remote", "https://ai.todoist.net/mcp"]
      },
      notion: {
        command: "npx",
        args: ["-y", "mcp-remote", "https://mcp.notion.com/mcp"]
      }
    };

    // Add additional directories if specified
    if (storedOptions.additionalDirectories?.length > 0) {
      options.additionalDirectories = storedOptions.additionalDirectories;
    }

    // Resume if we have a session ID
    if (conversation.sessionId) {
      options.resume = conversation.sessionId;
    }

    // Set max turns if specified
    if (maxTurns !== undefined) {
      options.maxTurns = maxTurns;
    }

    let sessionIdCaptured = false;

    // Run the Claude query
    for await (const msg of query({ prompt: message, options })) {
      // Capture session ID from first message
      if (!sessionIdCaptured && "session_id" in msg && msg.session_id) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { sessionId: msg.session_id },
        });
        sessionIdCaptured = true;
      }

      // Store assistant messages
      if (msg.type === "assistant" && msg.message?.content) {
        await prisma.message.create({
          data: {
            conversationId,
            role: "assistant",
            content: JSON.stringify({
              content: msg.message.content,
              uuid: msg.uuid,
            }),
            jobId: context.jobId,
          },
        });

        // Log to console
        for (const block of msg.message.content) {
          if ("text" in block) {
            console.log(block.text);
          } else if ("name" in block) {
            console.log(`Tool: ${block.name}`);
          }
        }
      } else if (msg.type === "result") {
        await prisma.message.create({
          data: {
            conversationId,
            role: "result",
            content: JSON.stringify({
              subtype: msg.subtype,
              result: "result" in msg ? msg.result : undefined,
              total_cost_usd: msg.total_cost_usd,
              num_turns: msg.num_turns,
            }),
            jobId: context.jobId,
          },
        });
        console.log(`Done: ${msg.subtype}`);
      } else if (msg.type === "system" && msg.subtype === "init") {
        await prisma.message.create({
          data: {
            conversationId,
            role: "system",
            content: JSON.stringify({
              subtype: msg.subtype,
              model: msg.model,
              cwd: msg.cwd,
            }),
            jobId: context.jobId,
          },
        });
      }
    }

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
);
