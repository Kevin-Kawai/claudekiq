-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT,
    "sessionId" TEXT,
    "cwd" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "workspaceId" INTEGER,
    "worktreePath" TEXT,
    "worktreeBranch" TEXT,
    "queryOptions" TEXT,
    CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("createdAt", "cwd", "id", "queryOptions", "sessionId", "status", "title", "updatedAt", "workspaceId", "worktreeBranch", "worktreePath") SELECT "createdAt", "cwd", "id", "queryOptions", "sessionId", "status", "title", "updatedAt", "workspaceId", "worktreeBranch", "worktreePath" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_status_updatedAt_idx" ON "Conversation"("status", "updatedAt");
CREATE INDEX "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");
CREATE INDEX "Conversation_isArchived_updatedAt_idx" ON "Conversation"("isArchived", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
