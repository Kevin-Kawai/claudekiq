import { query } from "@anthropic-ai/claude-agent-sdk";
import { defineJob } from "./registry";

export const SpawnClaudeSessionJob = defineJob(
  "FixFileJob",
  async (args) => {
    for await (const message of query({
      prompt: "what's your current working directory?",
      options: {
        allowedTools: [
          "Read",
          "Edit",
          "Glob",
          "Bash",
        ],
        permissionMode: "acceptEdits",
        cwd: "/home/kevin/Projects/stuff/borked/"
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

