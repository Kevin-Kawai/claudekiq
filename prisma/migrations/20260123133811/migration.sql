/*
  Warnings:

  - You are about to drop the `JobLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `sessionId` on the `Job` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "JobLog_jobId_createdAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "JobLog";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT,
    "sessionId" TEXT,
    "cwd" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "workspaceId" INTEGER,
    "worktreePath" TEXT,
    "worktreeBranch" TEXT,
    "queryOptions" TEXT,
    CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "jobId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Toolset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "tools" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConversationTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "title" TEXT,
    "workspaceId" INTEGER,
    "useWorktree" BOOLEAN NOT NULL DEFAULT false,
    "branchNamePattern" TEXT,
    "toolsetId" INTEGER,
    "allowedTools" TEXT,
    "additionalDirectories" TEXT,
    "initialMessage" TEXT,
    "cronExpression" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConversationTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ConversationTemplate_toolsetId_fkey" FOREIGN KEY ("toolsetId") REFERENCES "Toolset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "queue" TEXT NOT NULL DEFAULT 'default',
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "completedAt" DATETIME,
    "scheduledFor" DATETIME,
    "cronExpression" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "parentJobId" INTEGER,
    "conversationId" INTEGER,
    CONSTRAINT "Job_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("attempts", "completedAt", "createdAt", "cronExpression", "error", "id", "isRecurring", "lastRunAt", "maxAttempts", "nextRunAt", "parentJobId", "payload", "priority", "processedAt", "queue", "scheduledFor", "status") SELECT "attempts", "completedAt", "createdAt", "cronExpression", "error", "id", "isRecurring", "lastRunAt", "maxAttempts", "nextRunAt", "parentJobId", "payload", "priority", "processedAt", "queue", "scheduledFor", "status" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_queue_status_priority_createdAt_idx" ON "Job"("queue", "status", "priority", "createdAt");
CREATE INDEX "Job_status_scheduledFor_idx" ON "Job"("status", "scheduledFor");
CREATE INDEX "Job_isRecurring_nextRunAt_idx" ON "Job"("isRecurring", "nextRunAt");
CREATE INDEX "Job_conversationId_idx" ON "Job"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_name_key" ON "Workspace"("name");

-- CreateIndex
CREATE INDEX "Workspace_name_idx" ON "Workspace"("name");

-- CreateIndex
CREATE INDEX "Conversation_status_updatedAt_idx" ON "Conversation"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Toolset_name_key" ON "Toolset"("name");

-- CreateIndex
CREATE INDEX "Toolset_isDefault_idx" ON "Toolset"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTemplate_name_key" ON "ConversationTemplate"("name");

-- CreateIndex
CREATE INDEX "ConversationTemplate_name_idx" ON "ConversationTemplate"("name");
