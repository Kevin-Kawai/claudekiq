import { query } from "@anthropic-ai/claude-agent-sdk";
import { defineJob } from "./registry";

interface SpawnClaudeSessionArgs {
  prompt: string;
  cwd?: string;
}

export const SpawnClaudeSessionJob = defineJob<SpawnClaudeSessionArgs>(
  "SpawnClaudeSessionJob",
  async (args) => {
    for await (const message of query({
      prompt: args.prompt,
      options: {
        allowedTools: [
          "Read",
          "Edit",
          "Glob",
          "Bash",
        ],
        permissionMode: "acceptEdits",
        cwd: args.cwd || process.cwd()
      }
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            console.log(block.text)
          } else if ("name" in block) {
            console.log(`Tool: ${block.name}`)
          }
        }
      } else if (message.type === "result") {
        console.log(`Done: ${message.subtype}`)
      }
    }
  }
)

