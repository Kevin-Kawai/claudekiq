import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import {
  getStats,
  getJobs,
  getScheduledJobs,
  getRecurringJobs,
  cancelScheduledJob,
  pauseRecurringJob,
  resumeRecurringJob,
  isValidCronExpression,
  prisma,
  createConversation,
  getConversation,
  getConversations,
  sendMessage,
  createWorkspace,
  getWorkspaces,
  getWorkspace,
  deleteWorkspace,
  createWorktree,
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  archiveConversation,
  unarchiveConversation,
} from "./queue";
import {
  getRegisteredJobs,
  SendEmailJob,
  SendWelcomeEmailJob,
  GenerateReportJob,
  ExportDataJob,
  SpawnClaudeSessionJob,
  ConversationMessageJob,
} from "./jobs";

const app = new Hono();

// Enable CORS for API endpoints
app.use("/api/*", cors());

// ============ JSX Components ============

const Layout: FC<{ children: any }> = ({ children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Queue Dashboard</title>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f5f5f5;
          padding: 20px;
        }
        h1 { margin-bottom: 20px; color: #333; }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .stat-card {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          text-align: center;
        }
        .stat-card h3 { font-size: 14px; color: #666; margin-bottom: 8px; text-transform: uppercase; }
        .stat-card .value { font-size: 32px; font-weight: bold; }
        .stat-card.scheduled .value { color: #8b5cf6; }
        .stat-card.recurring .value { color: #06b6d4; }
        .stat-card.pending .value { color: #f59e0b; }
        .stat-card.processing .value { color: #3b82f6; }
        .stat-card.completed .value { color: #10b981; }
        .stat-card.failed .value { color: #ef4444; }
        .stat-card.total .value { color: #6b7280; }
        .status-scheduled { background: #ede9fe; color: #5b21b6; }
        .jobs-section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .jobs-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }
        .jobs-header h2 { font-size: 18px; }
        .job-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        .add-job-btn {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        .add-job-btn:hover { background: #2563eb; }
        .add-job-btn.email { background: #8b5cf6; }
        .add-job-btn.email:hover { background: #7c3aed; }
        .add-job-btn.report { background: #10b981; }
        .add-job-btn.report:hover { background: #059669; }
        .add-job-btn.export { background: #f59e0b; }
        .add-job-btn.export:hover { background: #d97706; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 600; }
        td { font-size: 14px; }
        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-processing { background: #dbeafe; color: #1e40af; }
        .status-completed { background: #d1fae5; color: #065f46; }
        .status-failed { background: #fee2e2; color: #991b1b; }
        .job-class { font-weight: 600; color: #4f46e5; }
        .args { font-family: monospace; font-size: 11px; color: #6b7280; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .timestamp { color: #6b7280; font-size: 13px; }
        .error-text { color: #ef4444; font-size: 12px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .empty-state { padding: 40px; text-align: center; color: #6b7280; }
        .view-link { color: #1976d2; text-decoration: none; font-weight: 500; }
        .view-link:hover { text-decoration: underline; }
        .actions-cell { white-space: nowrap; }
        .action-btn { padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: 6px; font-weight: 500; }
        .cancel-btn { background: #fee2e2; color: #dc2626; }
        .cancel-btn:hover { background: #fecaca; }
        .pause-btn { background: #fef3c7; color: #d97706; }
        .pause-btn:hover { background: #fde68a; }
        .resume-btn { background: #d1fae5; color: #059669; }
        .resume-btn:hover { background: #a7f3d0; }
        .refresh-info { font-size: 12px; color: #9ca3af; }
        .cron-badge { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; }
        .schedule-info { font-size: 12px; color: #6b7280; }
        .schedule-info small { color: #9ca3af; }
        .conversations-section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .conversations-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .conversations-list { padding: 0; }
        .conversation-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background 0.15s; text-decoration: none; color: inherit; }
        .conversation-item:hover { background: #f9fafb; }
        .conversation-item:last-child { border-bottom: none; }
        .conversation-info { flex: 1; }
        .conversation-title { font-weight: 500; margin-bottom: 4px; }
        .conversation-preview { font-size: 13px; color: #6b7280; max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .conversation-meta { font-size: 12px; color: #9ca3af; display: flex; gap: 12px; }
        .conversation-status { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
        .conversation-status.active { background: #d1fae5; color: #065f46; }
        .conversation-status.closed { background: #e5e7eb; color: #374151; }
        .conversation-archived { background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 6px; }
        .show-archived-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #6b7280; cursor: pointer; }
        .show-archived-toggle input { cursor: pointer; }
        .pagination { display: flex; justify-content: center; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid #e5e7eb; }
        .pagination button { padding: 6px 12px; border: 1px solid #d1d5db; background: white; border-radius: 4px; cursor: pointer; font-size: 13px; }
        .pagination button:hover:not(:disabled) { background: #f3f4f6; }
        .pagination button:disabled { opacity: 0.5; cursor: not-allowed; }
        .pagination .page-info { font-size: 13px; color: #6b7280; }
        .add-job-btn.schedule { background: #8b5cf6; }
        .add-job-btn.schedule:hover { background: #7c3aed; }
        .workspaces-section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .workspaces-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .workspaces-list { padding: 0; }
        .workspace-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f3f4f6; }
        .workspace-item:last-child { border-bottom: none; }
        .workspace-info { flex: 1; }
        .workspace-name { font-weight: 500; margin-bottom: 4px; }
        .workspace-path { font-size: 13px; color: #6b7280; font-family: monospace; }
        .workspace-actions { display: flex; gap: 8px; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-danger:hover { background: #dc2626; }
        .btn-small { padding: 4px 8px; font-size: 12px; }
        .toolsets-section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .toolsets-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .toolsets-list { padding: 0; }
        .toolset-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f3f4f6; }
        .toolset-item:last-child { border-bottom: none; }
        .toolset-info { flex: 1; }
        .toolset-name { font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
        .toolset-default-badge { background: #3b82f6; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; }
        .toolset-tools { font-size: 13px; color: #6b7280; font-family: monospace; }
        .toolset-actions { display: flex; gap: 8px; }
        .tools-checkboxes { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; padding: 8px; background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; }
        .tools-checkboxes .checkbox-label { font-size: 13px; }
        .tool-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: #e0f2fe; color: #0369a1; border-radius: 4px; font-size: 12px; font-family: monospace; }
        .tool-tag button { background: none; border: none; color: #0369a1; cursor: pointer; font-size: 14px; padding: 0; line-height: 1; }
        .tool-tag button:hover { color: #ef4444; }

        /* Custom Tool Dropdown */
        .custom-tool-dropdown { position: relative; }
        .custom-tool-dropdown-menu { position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: white; border: 1px solid #d1d5db; border-top: none; border-radius: 0 0 6px 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 50; display: none; }
        .custom-tool-dropdown-menu.active { display: block; }
        .custom-tool-dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
        .custom-tool-dropdown-item:hover { background: #f3f4f6; }
        .custom-tool-dropdown-item-name { font-family: monospace; font-size: 13px; color: #1f2937; }
        .custom-tool-dropdown-item-display { font-size: 12px; color: #6b7280; }
        .custom-tool-dropdown-add { padding: 8px 12px; border-top: 1px solid #e5e7eb; color: #3b82f6; cursor: pointer; font-size: 13px; }
        .custom-tool-dropdown-add:hover { background: #f0f9ff; }
        .custom-tool-dropdown-empty { padding: 8px 12px; color: #6b7280; font-size: 13px; }

        /* Custom Tools List (Management Modal) */
        .custom-tool-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
        .custom-tool-item:last-child { border-bottom: none; }
        .custom-tool-info { flex: 1; min-width: 0; }
        .custom-tool-name { font-weight: 500; font-family: monospace; font-size: 13px; word-break: break-all; }
        .custom-tool-display { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .custom-tool-desc { font-size: 12px; color: #9ca3af; margin-top: 2px; }
        .custom-tool-actions { display: flex; gap: 8px; margin-left: 12px; flex-shrink: 0; }

        .templates-section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .templates-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .templates-list { padding: 0; }
        .template-item { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 20px; border-bottom: 1px solid #f3f4f6; }
        .template-item:last-child { border-bottom: none; }
        .template-info { flex: 1; }
        .template-name { font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
        .template-description { font-size: 13px; color: #6b7280; margin-bottom: 4px; }
        .template-details { font-size: 12px; color: #9ca3af; display: flex; flex-wrap: wrap; gap: 12px; }
        .template-detail { display: flex; align-items: center; gap: 4px; }
        .template-actions { display: flex; gap: 8px; flex-shrink: 0; margin-left: 12px; }
        .dir-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; min-height: 24px; }
        .dir-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: #e0f2fe; color: #0369a1; border-radius: 4px; font-size: 12px; font-family: monospace; }
        .dir-tag button { background: none; border: none; color: #0369a1; cursor: pointer; font-size: 14px; padding: 0; line-height: 1; }
        .dir-tag button:hover { color: #ef4444; }
        .add-row { display: flex; gap: 8px; margin-top: 8px; }
        .add-row input { flex: 1; }
        .add-row button { padding: 8px 12px; background: #e5e7eb; color: #374151; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; white-space: nowrap; }
        .add-row button:hover { background: #d1d5db; }
        .form-group input[type="checkbox"] { width: auto; margin-right: 8px; }
        .checkbox-label { display: flex; align-items: center; cursor: pointer; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100; overflow-y: auto; }
        .modal.active { display: flex; justify-content: center; align-items: flex-start; padding: 40px 0; }
        .modal-content { background: white; padding: 24px; border-radius: 12px; max-width: 500px; width: 90%; max-height: calc(100vh - 80px); overflow-y: auto; }
        .modal-content h3 { margin-bottom: 16px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500; }
        .form-group input, .form-group select { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
        .form-group small { color: #6b7280; font-size: 12px; }
        .modal-buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
        .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-primary:hover { background: #2563eb; }
        .btn-secondary { background: #e5e7eb; color: #374151; }
        .btn-secondary:hover { background: #d1d5db; }

        /* ============ Mobile Responsive Styles ============ */
        @media (max-width: 768px) {
          body { padding: 12px; }
          h1 { font-size: 22px; margin-bottom: 16px; }

          /* Stats Grid */
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .stat-card { padding: 14px 10px; }
          .stat-card h3 { font-size: 11px; }
          .stat-card .value { font-size: 24px; }

          /* Jobs Section */
          .jobs-section { overflow: hidden; }
          .jobs-header {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .jobs-header h2 { font-size: 16px; }
          .job-buttons {
            width: 100%;
            flex-wrap: wrap;
            gap: 6px;
          }
          .add-job-btn {
            padding: 8px 10px;
            font-size: 12px;
            flex: 1 1 calc(50% - 4px);
            min-width: 0;
            text-align: center;
          }
          .refresh-info { font-size: 11px; }

          /* Tables - Horizontal Scroll */
          .jobs-section table {
            display: block;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            white-space: nowrap;
          }
          th, td { padding: 10px 12px; font-size: 12px; }
          th { font-size: 10px; }
          .args { max-width: 150px; }
          .error-text { max-width: 100px; }
          .action-btn { padding: 4px 6px; font-size: 10px; }

          /* Conversations Section */
          .conversations-section { margin-bottom: 16px; }
          .conversations-header {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .conversations-header h2 { font-size: 16px; }
          .conversations-header .job-buttons {
            width: 100%;
            flex-direction: column;
            gap: 8px;
          }
          .conversations-header .job-buttons select {
            width: 100%;
            padding: 10px 12px;
          }
          .conversations-header .job-buttons button {
            width: 100%;
            text-align: center;
          }

          /* Conversation Items */
          .conversation-item {
            flex-direction: column;
            align-items: flex-start;
            padding: 14px 14px;
            gap: 10px;
          }
          .conversation-info { width: 100%; }
          .conversation-title { font-size: 15px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
          .conversation-preview { max-width: 100%; font-size: 12px; white-space: normal; -webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
          .conversation-meta {
            width: 100%;
            flex-wrap: wrap;
            gap: 8px;
            font-size: 11px;
          }

          /* Pagination */
          .pagination { padding: 12px 14px; gap: 8px; flex-wrap: wrap; justify-content: center; }
          .pagination button { padding: 8px 12px; font-size: 12px; }
          .pagination .page-info { font-size: 12px; width: 100%; text-align: center; order: -1; }

          /* Workspaces Section */
          .workspaces-section { margin-bottom: 16px; }
          .workspaces-header {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .workspaces-header h2 { font-size: 16px; }
          .workspaces-header .job-buttons { width: 100%; }
          .workspaces-header .job-buttons button { width: 100%; text-align: center; }
          .workspace-item {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .workspace-info { width: 100%; }
          .workspace-name { font-size: 14px; }
          .workspace-path { font-size: 11px; word-break: break-all; }
          .workspace-actions { width: 100%; justify-content: flex-end; }

          /* Toolsets Section */
          .toolsets-section { margin-bottom: 16px; }
          .toolsets-header {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .toolsets-header h2 { font-size: 16px; }
          .toolsets-header .job-buttons { width: 100%; }
          .toolsets-header .job-buttons button { width: 100%; text-align: center; }
          .toolset-item {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .toolset-info { width: 100%; }
          .toolset-name { font-size: 14px; flex-wrap: wrap; }
          .toolset-tools { font-size: 11px; word-break: break-all; }
          .toolset-actions { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
          .tools-checkboxes { grid-template-columns: repeat(2, 1fr); gap: 6px; }

          /* Templates Section */
          .templates-section { margin-bottom: 16px; }
          .templates-header {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .templates-header h2 { font-size: 16px; }
          .templates-header .job-buttons { width: 100%; }
          .templates-header .job-buttons button { width: 100%; text-align: center; }
          .template-item {
            flex-direction: column;
            align-items: flex-start;
            padding: 12px 14px;
            gap: 10px;
          }
          .template-info { width: 100%; }
          .template-name { font-size: 14px; flex-wrap: wrap; }
          .template-description { font-size: 12px; }
          .template-details { font-size: 11px; gap: 8px; }
          .template-actions { width: 100%; margin-left: 0; justify-content: flex-end; }

          /* Modal Styles for Mobile */
          .modal.active {
            align-items: flex-start;
            padding: 0;
          }
          .modal-content {
            width: 100%;
            max-width: 100%;
            border-radius: 0;
            padding: 20px 16px;
            min-height: 100vh;
            max-height: none;
          }
          .modal-content h3 { font-size: 18px; margin-bottom: 20px; }
          .form-group { margin-bottom: 18px; }
          .form-group label { font-size: 13px; margin-bottom: 6px; }
          .form-group input, .form-group select, .form-group textarea {
            padding: 12px 14px;
            font-size: 16px; /* Prevents iOS zoom */
          }
          .form-group small { font-size: 11px; margin-top: 4px; display: block; }
          .modal-buttons {
            flex-direction: column-reverse;
            gap: 10px;
            margin-top: 24px;
            position: sticky;
            bottom: 0;
            background: white;
            padding: 16px 0;
            margin-bottom: -20px;
            margin-left: -16px;
            margin-right: -16px;
            padding-left: 16px;
            padding-right: 16px;
            border-top: 1px solid #e5e7eb;
          }
          .modal-buttons .btn {
            width: 100%;
            padding: 14px 16px;
            font-size: 15px;
          }

          /* Additional Directories */
          .dir-list { gap: 6px; }
          .dir-tag { font-size: 10px; padding: 4px 6px; max-width: 100%; }
          .add-row { flex-direction: column; gap: 8px; }
          .add-row input, .add-row select { width: 100%; }
          .add-row button { width: 100%; padding: 12px; }

          /* Tool Tags */
          .tool-tag { font-size: 10px; padding: 4px 6px; }

          /* Empty States */
          .empty-state { padding: 30px 16px; font-size: 14px; }
        }

        /* Small Mobile (phones in portrait) */
        @media (max-width: 480px) {
          body { padding: 8px; }
          .stats-grid { gap: 8px; }
          .stat-card { padding: 12px 8px; }
          .stat-card h3 { font-size: 10px; }
          .stat-card .value { font-size: 20px; }

          .add-job-btn {
            flex: 1 1 100%;
            padding: 10px 8px;
          }

          .conversation-title { font-size: 14px; }
          .conversation-meta span { font-size: 10px; }

          .tools-checkboxes { grid-template-columns: 1fr; }

          .btn-small { padding: 6px 10px; font-size: 11px; }
        }
      `}</style>
    </head>
    <body>
      {children}
      {raw(`<script>
        async function fetchStats() {
          try {
            const res = await fetch('/api/stats');
            const stats = await res.json();
            document.getElementById('stat-scheduled').textContent = stats.scheduled;
            document.getElementById('stat-recurring').textContent = stats.recurring;
            document.getElementById('stat-pending').textContent = stats.pending;
            document.getElementById('stat-processing').textContent = stats.processing;
            document.getElementById('stat-completed').textContent = stats.completed;
            document.getElementById('stat-failed').textContent = stats.failed;
            document.getElementById('stat-total').textContent = stats.total;
          } catch (e) {
            console.error('Failed to fetch stats:', e);
          }
        }

        var currentJobsPage = 1;
        var currentJobsStatus = '';

        function goToJobsPage(page) {
          currentJobsPage = page;
          fetchJobs();
        }

        function onJobStatusFilterChange() {
          currentJobsStatus = document.getElementById('job-status-filter').value;
          currentJobsPage = 1;
          fetchJobs();
        }

        async function fetchJobs() {
          try {
            var url = '/api/jobs?page=' + currentJobsPage;
            if (currentJobsStatus) {
              url += '&status=' + currentJobsStatus;
            }
            const res = await fetch(url);
            const data = await res.json();
            const jobs = data.jobs;
            const tbody = document.getElementById('jobs-tbody');
            const paginationDiv = document.getElementById('jobs-pagination');

            if (jobs.length === 0) {
              tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No jobs in queue</td></tr>';
              paginationDiv.style.display = 'none';
              return;
            }

            tbody.innerHTML = jobs.map(function(job) {
              var parsed = JSON.parse(job.payload);
              var jobClass = parsed.jobClass || 'LegacyJob';
              var args = parsed.args || parsed;
              var argsStr = JSON.stringify(args);
              var created = new Date(job.createdAt).toLocaleString();
              var scheduleInfo = '-';
              if (job.isRecurring && job.cronExpression) {
                scheduleInfo = '<span class="cron-badge">' + job.cronExpression + '</span>';
                if (job.nextRunAt) {
                  scheduleInfo += '<br><small>Next: ' + new Date(job.nextRunAt).toLocaleString() + '</small>';
                }
              } else if (job.scheduledFor) {
                scheduleInfo = new Date(job.scheduledFor).toLocaleString();
              }

              // Build action buttons based on job status
              var actions = '<a href="/jobs/' + job.id + '" class="view-link">View</a>';
              if (job.status === 'scheduled') {
                if (job.isRecurring) {
                  actions += ' <button class="action-btn pause-btn" onclick="pauseJob(' + job.id + ')">Pause</button>';
                } else {
                  actions += ' <button class="action-btn cancel-btn" onclick="cancelJob(' + job.id + ')">Cancel</button>';
                }
              } else if (job.status === 'pending') {
                actions += ' <button class="action-btn cancel-btn" onclick="cancelJob(' + job.id + ')">Cancel</button>';
              } else if (job.status === 'failed' && job.error === 'Paused' && job.isRecurring) {
                actions += ' <button class="action-btn resume-btn" onclick="resumeJob(' + job.id + ')">Resume</button>';
              }

              return '<tr>' +
                '<td>' + job.id + '</td>' +
                '<td><span class="job-class">' + jobClass + '</span></td>' +
                '<td><span class="status-badge status-' + job.status + '">' + job.status + '</span></td>' +
                '<td class="schedule-info">' + scheduleInfo + '</td>' +
                '<td class="args" title="' + argsStr.replace(/"/g, '&quot;') + '">' + argsStr + '</td>' +
                '<td>' + job.attempts + '/' + job.maxAttempts + '</td>' +
                '<td class="timestamp">' + created + '</td>' +
                '<td class="error-text" title="' + (job.error || '') + '">' + (job.error || '-') + '</td>' +
                '<td class="actions-cell">' + actions + '</td>' +
              '</tr>';
            }).join('');

            // Update pagination controls
            if (data.totalPages > 1) {
              paginationDiv.style.display = 'flex';
              paginationDiv.innerHTML =
                '<button onclick="goToJobsPage(' + (data.page - 1) + ')" ' + (data.page <= 1 ? 'disabled' : '') + '>&laquo; Prev</button>' +
                '<span class="page-info">Page ' + data.page + ' of ' + data.totalPages + ' (' + data.total + ' total)</span>' +
                '<button onclick="goToJobsPage(' + (data.page + 1) + ')" ' + (data.page >= data.totalPages ? 'disabled' : '') + '>Next &raquo;</button>';
            } else {
              paginationDiv.style.display = 'none';
            }
          } catch (e) {
            console.error('Failed to fetch jobs:', e);
          }
        }

        async function addJob(jobClass) {
          if (jobClass === 'SpawnClaudeSessionJob') {
            openClaudePromptModal();
            return;
          }
          try {
            await fetch('/api/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobClass: jobClass })
            });
            fetchStats();
            fetchJobs();
          } catch (e) {
            console.error('Failed to add job:', e);
          }
        }

        async function cancelJob(jobId) {
          if (!confirm('Are you sure you want to cancel this job?')) return;
          try {
            const res = await fetch('/api/jobs/' + jobId, { method: 'DELETE' });
            if (!res.ok) {
              const data = await res.json();
              alert('Failed to cancel job: ' + (data.error || 'Unknown error'));
              return;
            }
            fetchStats();
            fetchJobs();
          } catch (e) {
            console.error('Failed to cancel job:', e);
            alert('Failed to cancel job');
          }
        }

        async function pauseJob(jobId) {
          try {
            const res = await fetch('/api/jobs/' + jobId + '/pause', { method: 'POST' });
            if (!res.ok) {
              const data = await res.json();
              alert('Failed to pause job: ' + (data.error || 'Unknown error'));
              return;
            }
            fetchStats();
            fetchJobs();
          } catch (e) {
            console.error('Failed to pause job:', e);
            alert('Failed to pause job');
          }
        }

        async function resumeJob(jobId) {
          try {
            const res = await fetch('/api/jobs/' + jobId + '/resume', { method: 'POST' });
            if (!res.ok) {
              const data = await res.json();
              alert('Failed to resume job: ' + (data.error || 'Unknown error'));
              return;
            }
            fetchStats();
            fetchJobs();
          } catch (e) {
            console.error('Failed to resume job:', e);
            alert('Failed to resume job');
          }
        }

        function openClaudePromptModal() {
          document.getElementById('claude-prompt-modal').classList.add('active');
        }

        function closeClaudePromptModal() {
          document.getElementById('claude-prompt-modal').classList.remove('active');
          document.getElementById('claude-prompt').value = '';
          document.getElementById('claude-cwd').value = '';
        }

        async function submitClaudeSession() {
          var prompt = document.getElementById('claude-prompt').value;
          if (!prompt.trim()) {
            alert('Please enter a prompt');
            return;
          }
          var cwd = document.getElementById('claude-cwd').value;
          var body = { jobClass: 'SpawnClaudeSessionJob', prompt: prompt };
          if (cwd.trim()) {
            body.cwd = cwd;
          }
          try {
            var res = await fetch('/api/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            closeClaudePromptModal();
            fetchStats();
            fetchJobs();
          } catch (e) {
            console.error('Failed to spawn Claude session:', e);
          }
        }

        function openScheduleModal() {
          document.getElementById('schedule-modal').classList.add('active');
        }

        function closeScheduleModal() {
          document.getElementById('schedule-modal').classList.remove('active');
        }

        function updateScheduleType() {
          var type = document.getElementById('schedule-type').value;
          document.getElementById('scheduled-for-group').style.display = type === 'once' ? 'block' : 'none';
          document.getElementById('cron-group').style.display = type === 'recurring' ? 'block' : 'none';
        }

        async function submitScheduledJob() {
          var jobClass = document.getElementById('schedule-job-class').value;
          var scheduleType = document.getElementById('schedule-type').value;
          var body = { jobClass: jobClass };

          if (scheduleType === 'once') {
            var scheduledFor = document.getElementById('scheduled-for').value;
            if (!scheduledFor) {
              alert('Please enter a date/time');
              return;
            }
            body.scheduledFor = new Date(scheduledFor).toISOString();
          } else if (scheduleType === 'recurring') {
            var cronExpression = document.getElementById('cron-expression').value;
            if (!cronExpression) {
              alert('Please enter a cron expression');
              return;
            }
            body.cronExpression = cronExpression;
          }

          try {
            var res = await fetch('/api/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            closeScheduleModal();
            fetchStats();
            fetchJobs();
          } catch (e) {
            console.error('Failed to schedule job:', e);
            alert('Failed to schedule job');
          }
        }

        // ============ Workspaces ============
        var workspacesCache = [];

        async function fetchWorkspaces() {
          try {
            var res = await fetch('/api/workspaces');
            var workspaces = await res.json();
            workspacesCache = workspaces;
            var container = document.getElementById('workspaces-list');

            if (workspaces.length === 0) {
              container.innerHTML = '<div class="empty-state">No workspaces configured. Add one to get started!</div>';
              return;
            }

            container.innerHTML = workspaces.map(function(ws) {
              return '<div class="workspace-item">' +
                '<div class="workspace-info">' +
                  '<div class="workspace-name">' + escapeHtml(ws.name) + '</div>' +
                  '<div class="workspace-path">' + escapeHtml(ws.path) + '</div>' +
                '</div>' +
                '<div class="workspace-actions">' +
                  '<button class="btn btn-danger btn-small" onclick="deleteWorkspace(' + ws.id + ')">Delete</button>' +
                '</div>' +
              '</div>';
            }).join('');

            // Update the conversation workspace filter dropdown
            updateConversationWorkspaceFilter();
          } catch (e) {
            console.error('Failed to fetch workspaces:', e);
          }
        }

        function openNewWorkspaceModal() {
          document.getElementById('new-workspace-modal').classList.add('active');
        }

        function closeNewWorkspaceModal() {
          document.getElementById('new-workspace-modal').classList.remove('active');
          document.getElementById('new-workspace-name').value = '';
          document.getElementById('new-workspace-path').value = '';
        }

        async function submitNewWorkspace() {
          var name = document.getElementById('new-workspace-name').value.trim();
          var path = document.getElementById('new-workspace-path').value.trim();

          if (!name || !path) {
            alert('Please enter both name and path');
            return;
          }

          try {
            var res = await fetch('/api/workspaces', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name, path: path })
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            closeNewWorkspaceModal();
            fetchWorkspaces();
          } catch (e) {
            console.error('Failed to add workspace:', e);
            alert('Failed to add workspace');
          }
        }

        async function deleteWorkspace(id) {
          if (!confirm('Are you sure you want to delete this workspace?')) {
            return;
          }
          try {
            var res = await fetch('/api/workspaces/' + id, { method: 'DELETE' });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            fetchWorkspaces();
          } catch (e) {
            console.error('Failed to delete workspace:', e);
            alert('Failed to delete workspace');
          }
        }

        // ============ Custom Tools ============
        var customToolsCache = [];

        async function fetchCustomTools() {
          try {
            var res = await fetch('/api/custom-tools');
            customToolsCache = await res.json();
          } catch (e) {
            console.error('Failed to fetch custom tools:', e);
          }
        }

        function openCustomToolsModal() {
          document.getElementById('custom-tools-modal-title').textContent = 'Manage Custom Tools';
          document.getElementById('edit-custom-tool-id').value = '';
          document.getElementById('new-custom-tool-name').value = '';
          document.getElementById('new-custom-tool-display').value = '';
          document.getElementById('new-custom-tool-desc').value = '';
          document.getElementById('custom-tools-modal').classList.add('active');
          fetchCustomToolsList();
        }

        function closeCustomToolsModal() {
          document.getElementById('custom-tools-modal').classList.remove('active');
        }

        async function fetchCustomToolsList() {
          try {
            var res = await fetch('/api/custom-tools');
            customToolsCache = await res.json();
            renderCustomToolsList();
          } catch (e) {
            console.error('Failed to fetch custom tools:', e);
            document.getElementById('custom-tools-list').innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:#ef4444;">Failed to load custom tools</div>';
          }
        }

        function renderCustomToolsList() {
          var container = document.getElementById('custom-tools-list');
          if (customToolsCache.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:#6b7280;">No custom tools saved yet. Add one above!</div>';
            return;
          }
          container.innerHTML = customToolsCache.map(function(tool) {
            var displayPart = tool.displayName ? '<div class="custom-tool-display">' + escapeHtml(tool.displayName) + '</div>' : '';
            var descPart = tool.description ? '<div class="custom-tool-desc">' + escapeHtml(tool.description) + '</div>' : '';
            return '<div class="custom-tool-item">' +
              '<div class="custom-tool-info">' +
                '<div class="custom-tool-name">' + escapeHtml(tool.name) + '</div>' +
                displayPart +
                descPart +
              '</div>' +
              '<div class="custom-tool-actions">' +
                '<button class="btn btn-secondary btn-small" onclick="editCustomTool(' + tool.id + ')">Edit</button>' +
                '<button class="btn btn-danger btn-small" onclick="deleteCustomTool(' + tool.id + ')">Delete</button>' +
              '</div>' +
            '</div>';
          }).join('');
        }

        async function submitCustomTool() {
          var editId = document.getElementById('edit-custom-tool-id').value;
          var name = document.getElementById('new-custom-tool-name').value.trim();
          var displayName = document.getElementById('new-custom-tool-display').value.trim();
          var description = document.getElementById('new-custom-tool-desc').value.trim();

          if (!name) {
            alert('Tool name is required');
            return;
          }

          try {
            var url = editId ? '/api/custom-tools/' + editId : '/api/custom-tools';
            var method = editId ? 'PUT' : 'POST';
            var res = await fetch(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name, displayName: displayName || null, description: description || null })
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            // Reset form
            document.getElementById('edit-custom-tool-id').value = '';
            document.getElementById('new-custom-tool-name').value = '';
            document.getElementById('new-custom-tool-display').value = '';
            document.getElementById('new-custom-tool-desc').value = '';
            document.getElementById('custom-tools-modal-title').textContent = 'Manage Custom Tools';
            document.getElementById('custom-tools-form-label').textContent = 'Add New Custom Tool';
            document.getElementById('custom-tools-submit-btn').textContent = 'Add Tool';
            document.getElementById('custom-tools-cancel-btn').style.display = 'none';
            fetchCustomToolsList();
          } catch (e) {
            console.error('Failed to save custom tool:', e);
            alert('Failed to save custom tool');
          }
        }

        function editCustomTool(id) {
          var tool = customToolsCache.find(function(t) { return t.id === id; });
          if (!tool) return;

          document.getElementById('custom-tools-modal-title').textContent = 'Edit Custom Tool';
          document.getElementById('custom-tools-form-label').textContent = 'Edit Custom Tool';
          document.getElementById('edit-custom-tool-id').value = id;
          document.getElementById('new-custom-tool-name').value = tool.name;
          document.getElementById('new-custom-tool-display').value = tool.displayName || '';
          document.getElementById('new-custom-tool-desc').value = tool.description || '';
          document.getElementById('custom-tools-submit-btn').textContent = 'Save Changes';
          document.getElementById('custom-tools-cancel-btn').style.display = 'inline-block';
          // Scroll to the form
          document.getElementById('custom-tools-add-form').scrollIntoView({ behavior: 'smooth' });
        }

        function cancelEditCustomTool() {
          document.getElementById('custom-tools-modal-title').textContent = 'Manage Custom Tools';
          document.getElementById('custom-tools-form-label').textContent = 'Add New Custom Tool';
          document.getElementById('edit-custom-tool-id').value = '';
          document.getElementById('new-custom-tool-name').value = '';
          document.getElementById('new-custom-tool-display').value = '';
          document.getElementById('new-custom-tool-desc').value = '';
          document.getElementById('custom-tools-submit-btn').textContent = 'Add Tool';
          document.getElementById('custom-tools-cancel-btn').style.display = 'none';
        }

        async function deleteCustomTool(id) {
          if (!confirm('Are you sure you want to delete this custom tool?')) return;

          try {
            var res = await fetch('/api/custom-tools/' + id, { method: 'DELETE' });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            fetchCustomToolsList();
          } catch (e) {
            console.error('Failed to delete custom tool:', e);
            alert('Failed to delete custom tool');
          }
        }

        // ============ Custom Tool Autocomplete Dropdown ============
        function showCustomToolDropdown(inputId, listId, customToolsArrayName) {
          var input = document.getElementById(inputId);
          var menuId = inputId + '-dropdown';
          var menu = document.getElementById(menuId);

          if (!menu) {
            // Create dropdown menu if it doesn't exist
            menu = document.createElement('div');
            menu.id = menuId;
            menu.className = 'custom-tool-dropdown-menu';
            input.parentNode.appendChild(menu);
          }

          var query = input.value.toLowerCase().trim();
          var currentTools = window[customToolsArrayName] || [];

          // Filter custom tools based on query
          var matches = customToolsCache.filter(function(tool) {
            // Exclude already selected tools
            if (currentTools.indexOf(tool.name) !== -1) return false;
            // Exclude common tools
            if (commonToolsList.indexOf(tool.name) !== -1) return false;
            // Match query
            if (!query) return true;
            return tool.name.toLowerCase().includes(query) ||
                   (tool.displayName && tool.displayName.toLowerCase().includes(query));
          });

          // Clear and rebuild menu with event listeners (avoids escaping issues in raw template)
          menu.innerHTML = '';

          matches.forEach(function(tool) {
            var item = document.createElement('div');
            item.className = 'custom-tool-dropdown-item';
            var nameDiv = document.createElement('div');
            nameDiv.className = 'custom-tool-dropdown-item-name';
            nameDiv.textContent = tool.name;
            item.appendChild(nameDiv);
            if (tool.displayName) {
              var displayDiv = document.createElement('div');
              displayDiv.className = 'custom-tool-dropdown-item-display';
              displayDiv.textContent = tool.displayName;
              item.appendChild(displayDiv);
            }
            (function(toolName) {
              item.addEventListener('click', function() {
                selectCustomToolFromDropdown(inputId, listId, customToolsArrayName, toolName);
              });
            })(tool.name);
            menu.appendChild(item);
          });

          // Add option to add as new tool if query doesn't match existing
          if (query && !matches.some(function(t) { return t.name.toLowerCase() === query; })) {
            var addItem = document.createElement('div');
            addItem.className = 'custom-tool-dropdown-add';
            addItem.textContent = 'Add "' + input.value.trim() + '"';
            addItem.addEventListener('click', function() {
              addCustomToolFromInput(inputId, listId, customToolsArrayName);
            });
            menu.appendChild(addItem);
          }

          if (menu.children.length === 0 && !query) {
            menu.innerHTML = '<div class="custom-tool-dropdown-empty">No saved custom tools. Type to add one.</div>';
          } else if (menu.children.length === 0) {
            menu.innerHTML = '<div class="custom-tool-dropdown-empty">No matches. Press Enter to add.</div>';
          }

          menu.classList.add('active');
        }

        function hideCustomToolDropdown(inputId) {
          var menu = document.getElementById(inputId + '-dropdown');
          if (menu) {
            menu.classList.remove('active');
          }
        }

        function selectCustomToolFromDropdown(inputId, listId, customToolsArrayName, toolName) {
          var currentTools = window[customToolsArrayName] || [];
          if (currentTools.indexOf(toolName) === -1) {
            currentTools.push(toolName);
            window[customToolsArrayName] = currentTools;
            renderSelectedCustomTools(listId, customToolsArrayName);
          }
          document.getElementById(inputId).value = '';
          hideCustomToolDropdown(inputId);
        }

        function addCustomToolFromInput(inputId, listId, customToolsArrayName) {
          var input = document.getElementById(inputId);
          var tool = input.value.trim();
          if (!tool) return;

          var currentTools = window[customToolsArrayName] || [];
          if (currentTools.indexOf(tool) === -1 && commonToolsList.indexOf(tool) === -1) {
            currentTools.push(tool);
            window[customToolsArrayName] = currentTools;
            renderSelectedCustomTools(listId, customToolsArrayName);
          }
          input.value = '';
          hideCustomToolDropdown(inputId);
        }

        function renderSelectedCustomTools(listId, customToolsArrayName) {
          var container = document.getElementById(listId);
          var tools = window[customToolsArrayName] || [];
          container.innerHTML = '';
          tools.forEach(function(tool, idx) {
            var span = document.createElement('span');
            span.className = 'tool-tag';
            span.appendChild(document.createTextNode(tool));
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = '&times;';
            (function(index) {
              btn.addEventListener('click', function() {
                removeSelectedCustomTool(listId, customToolsArrayName, index);
              });
            })(idx);
            span.appendChild(btn);
            container.appendChild(span);
          });
        }

        function removeSelectedCustomTool(listId, customToolsArrayName, index) {
          var tools = window[customToolsArrayName] || [];
          tools.splice(index, 1);
          window[customToolsArrayName] = tools;
          renderSelectedCustomTools(listId, customToolsArrayName);
        }

        function initCustomToolInput(inputId, listId, customToolsArrayName) {
          var input = document.getElementById(inputId);
          if (!input) return;

          input.addEventListener('focus', function() {
            showCustomToolDropdown(inputId, listId, customToolsArrayName);
          });

          input.addEventListener('input', function() {
            showCustomToolDropdown(inputId, listId, customToolsArrayName);
          });

          input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomToolFromInput(inputId, listId, customToolsArrayName);
            }
          });

          // Close dropdown when clicking outside
          document.addEventListener('click', function(e) {
            var menu = document.getElementById(inputId + '-dropdown');
            if (menu && !input.contains(e.target) && !menu.contains(e.target)) {
              hideCustomToolDropdown(inputId);
            }
          });
        }

        // ============ Toolsets ============
        var toolsetsCache = [];
        var toolsetCustomTools = [];
        var commonToolsList = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit'];

        async function fetchToolsets() {
          try {
            var res = await fetch('/api/toolsets');
            var toolsets = await res.json();
            toolsetsCache = toolsets;
            var container = document.getElementById('toolsets-list');

            if (toolsets.length === 0) {
              container.innerHTML = '<div class="empty-state">No toolsets configured. Add one to create preset tool configurations!</div>';
              return;
            }

            container.innerHTML = toolsets.map(function(ts) {
              var tools = JSON.parse(ts.tools);
              var defaultBadge = ts.isDefault ? '<span class="toolset-default-badge">Default</span>' : '';
              return '<div class="toolset-item">' +
                '<div class="toolset-info">' +
                  '<div class="toolset-name">' + escapeHtml(ts.name) + ' ' + defaultBadge + '</div>' +
                  '<div class="toolset-tools">' + tools.join(', ') + '</div>' +
                '</div>' +
                '<div class="toolset-actions">' +
                  (ts.isDefault ? '' : '<button class="btn btn-secondary btn-small" onclick="setDefaultToolset(' + ts.id + ')">Set Default</button>') +
                  '<button class="btn btn-secondary btn-small" onclick="editToolset(' + ts.id + ')">Edit</button>' +
                  '<button class="btn btn-danger btn-small" onclick="deleteToolset(' + ts.id + ')">Delete</button>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (e) {
            console.error('Failed to fetch toolsets:', e);
          }
        }

        function openNewToolsetModal() {
          document.getElementById('toolset-modal-title').textContent = 'Add Toolset';
          document.getElementById('edit-toolset-id').value = '';
          document.getElementById('new-toolset-modal').classList.add('active');
          // Reset to default tools
          var checkboxes = document.querySelectorAll('#toolset-tools-checkboxes input[type="checkbox"]');
          checkboxes.forEach(function(cb) {
            cb.checked = ['Read', 'Edit', 'Glob', 'Bash'].indexOf(cb.value) !== -1;
          });
          // Reset custom tools
          toolsetCustomTools = [];
          document.getElementById('toolset-custom-tool-input').value = '';
          renderSelectedCustomTools('toolset-custom-tools-list', 'toolsetCustomTools');
          // Initialize autocomplete
          initCustomToolInput('toolset-custom-tool-input', 'toolset-custom-tools-list', 'toolsetCustomTools');
        }

        function closeNewToolsetModal() {
          document.getElementById('new-toolset-modal').classList.remove('active');
          document.getElementById('new-toolset-name').value = '';
          document.getElementById('new-toolset-default').checked = false;
          document.getElementById('edit-toolset-id').value = '';
          toolsetCustomTools = [];
          renderToolsetCustomTools();
        }

        function addToolsetCustomTool() {
          var input = document.getElementById('toolset-custom-tool-input');
          var tool = input.value.trim();
          if (!tool) return;
          if (toolsetCustomTools.indexOf(tool) === -1 && commonToolsList.indexOf(tool) === -1) {
            toolsetCustomTools.push(tool);
            renderToolsetCustomTools();
          }
          input.value = '';
        }

        function removeToolsetCustomTool(index) {
          toolsetCustomTools.splice(index, 1);
          renderSelectedCustomTools('toolset-custom-tools-list', 'toolsetCustomTools');
        }

        function renderToolsetCustomTools() {
          renderSelectedCustomTools('toolset-custom-tools-list', 'toolsetCustomTools');
        }

        function getSelectedTools() {
          var checkboxes = document.querySelectorAll('#toolset-tools-checkboxes input[type="checkbox"]:checked');
          var tools = Array.from(checkboxes).map(function(cb) { return cb.value; });
          return tools.concat(toolsetCustomTools);
        }

        function setToolCheckboxes(tools) {
          var checkboxes = document.querySelectorAll('#toolset-tools-checkboxes input[type="checkbox"]');
          toolsetCustomTools = [];
          checkboxes.forEach(function(cb) {
            cb.checked = tools.indexOf(cb.value) !== -1;
          });
          // Extract custom tools (not in common list)
          tools.forEach(function(tool) {
            if (commonToolsList.indexOf(tool) === -1) {
              toolsetCustomTools.push(tool);
            }
          });
          renderToolsetCustomTools();
        }

        async function submitToolset() {
          var name = document.getElementById('new-toolset-name').value.trim();
          var tools = getSelectedTools();
          var isDefault = document.getElementById('new-toolset-default').checked;
          var editId = document.getElementById('edit-toolset-id').value;

          if (!name) {
            alert('Please enter a name');
            return;
          }

          if (tools.length === 0) {
            alert('Please select at least one tool');
            return;
          }

          try {
            var url = editId ? '/api/toolsets/' + editId : '/api/toolsets';
            var method = editId ? 'PUT' : 'POST';
            var res = await fetch(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name, tools: tools, isDefault: isDefault })
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            closeNewToolsetModal();
            fetchToolsets();
          } catch (e) {
            console.error('Failed to save toolset:', e);
            alert('Failed to save toolset');
          }
        }

        function editToolset(id) {
          var toolset = toolsetsCache.find(function(ts) { return ts.id === id; });
          if (!toolset) return;

          document.getElementById('toolset-modal-title').textContent = 'Edit Toolset';
          document.getElementById('edit-toolset-id').value = id;
          document.getElementById('new-toolset-name').value = toolset.name;
          document.getElementById('new-toolset-default').checked = toolset.isDefault;
          setToolCheckboxes(JSON.parse(toolset.tools));
          document.getElementById('new-toolset-modal').classList.add('active');
        }

        async function deleteToolset(id) {
          if (!confirm('Are you sure you want to delete this toolset?')) {
            return;
          }
          try {
            var res = await fetch('/api/toolsets/' + id, { method: 'DELETE' });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            fetchToolsets();
          } catch (e) {
            console.error('Failed to delete toolset:', e);
            alert('Failed to delete toolset');
          }
        }

        async function setDefaultToolset(id) {
          try {
            var res = await fetch('/api/toolsets/' + id + '/set-default', { method: 'POST' });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            fetchToolsets();
          } catch (e) {
            console.error('Failed to set default toolset:', e);
            alert('Failed to set default toolset');
          }
        }

        // ============ Templates ============
        var templatesCache = [];
        var templateDirectories = [];

        function renderTemplateDirectories() {
          var container = document.getElementById('template-dirs-list');
          if (!container) return;
          var html = '';
          templateDirectories.forEach(function(dir, idx) {
            html += '<span class="dir-tag">' + escapeHtml(dir) + '<button type="button" onclick="removeTemplateDirectory(' + idx + ')">×</button></span>';
          });
          container.innerHTML = html;
        }

        function addTemplateDirectory() {
          var input = document.getElementById('new-template-dir-input');
          var dir = input.value.trim();
          if (!dir) return;
          if (templateDirectories.indexOf(dir) === -1) {
            templateDirectories.push(dir);
            renderTemplateDirectories();
          }
          input.value = '';
        }

        function addTemplateDirFromWorkspace() {
          var select = document.getElementById('template-dir-workspace-select');
          var path = select.value;
          if (!path) {
            alert('Please select a workspace');
            return;
          }
          if (templateDirectories.indexOf(path) === -1) {
            templateDirectories.push(path);
            renderTemplateDirectories();
          }
          select.value = '';
        }

        function populateTemplateDirWorkspaces() {
          var select = document.getElementById('template-dir-workspace-select');
          select.innerHTML = '<option value="">-- Add from workspace --</option>';
          workspacesCache.forEach(function(ws) {
            select.innerHTML += '<option value="' + escapeHtml(ws.path) + '">' + escapeHtml(ws.name) + '</option>';
          });
        }

        function removeTemplateDirectory(idx) {
          templateDirectories.splice(idx, 1);
          renderTemplateDirectories();
        }

        async function fetchTemplates() {
          try {
            var res = await fetch('/api/templates');
            var templates = await res.json();
            templatesCache = templates;
            var container = document.getElementById('templates-list');

            if (templates.length === 0) {
              container.innerHTML = '<div class="empty-state">No templates yet. Add one to save conversation presets!</div>';
              return;
            }

            container.innerHTML = templates.map(function(t) {
              var details = [];
              if (t.workspace) details.push('<span class="template-detail">📁 ' + escapeHtml(t.workspace.name) + '</span>');
              if (t.toolset) details.push('<span class="template-detail">🔧 ' + escapeHtml(t.toolset.name) + '</span>');
              if (t.useWorktree) details.push('<span class="template-detail">🌿 Worktree</span>');
              if (t.cronExpression) details.push('<span class="template-detail">🔄 ' + escapeHtml(t.cronExpression) + '</span>');
              if (t.initialMessage) details.push('<span class="template-detail">💬 Has prompt</span>');

              return '<div class="template-item">' +
                '<div class="template-info">' +
                  '<div class="template-name">' + escapeHtml(t.name) + '</div>' +
                  (t.description ? '<div class="template-description">' + escapeHtml(t.description) + '</div>' : '') +
                  '<div class="template-details">' + details.join('') + '</div>' +
                '</div>' +
                '<div class="template-actions">' +
                  '<button class="btn btn-secondary btn-small" onclick="useTemplate(' + t.id + ')">Use</button>' +
                  '<button class="btn btn-secondary btn-small" onclick="editTemplate(' + t.id + ')">Edit</button>' +
                  '<button class="btn btn-danger btn-small" onclick="deleteTemplate(' + t.id + ')">Delete</button>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (e) {
            console.error('Failed to fetch templates:', e);
          }
        }

        function openNewTemplateModal() {
          document.getElementById('template-modal-title').textContent = 'Add Template';
          document.getElementById('edit-template-id').value = '';
          document.getElementById('new-template-modal').classList.add('active');
          // Reset form
          document.getElementById('new-template-name').value = '';
          document.getElementById('new-template-description').value = '';
          document.getElementById('new-template-message').value = '';
          document.getElementById('new-template-title').value = '';
          document.getElementById('new-template-workspace').value = '';
          document.getElementById('new-template-worktree').checked = false;
          document.getElementById('new-template-branch-pattern').value = '';
          document.getElementById('new-template-toolset').value = '';
          document.getElementById('new-template-cron').value = '';
          document.getElementById('template-worktree-option').style.display = 'none';
          document.getElementById('template-branch-pattern-group').style.display = 'none';
          // Reset directories
          templateDirectories = [];
          renderTemplateDirectories();
          // Populate dropdowns
          populateTemplateWorkspaces();
          populateTemplateToolsets();
          populateTemplateDirWorkspaces();
        }

        function closeNewTemplateModal() {
          document.getElementById('new-template-modal').classList.remove('active');
        }

        function onTemplateWorkspaceChange() {
          var hasWorkspace = document.getElementById('new-template-workspace').value !== '';
          document.getElementById('template-worktree-option').style.display = hasWorkspace ? 'block' : 'none';
          if (!hasWorkspace) {
            document.getElementById('new-template-worktree').checked = false;
            document.getElementById('template-branch-pattern-group').style.display = 'none';
          }
        }

        function onTemplateWorktreeChange() {
          var checked = document.getElementById('new-template-worktree').checked;
          document.getElementById('template-branch-pattern-group').style.display = checked ? 'block' : 'none';
        }

        function populateTemplateWorkspaces() {
          var select = document.getElementById('new-template-workspace');
          select.innerHTML = '<option value="">-- No workspace --</option>';
          workspacesCache.forEach(function(ws) {
            select.innerHTML += '<option value="' + ws.id + '">' + escapeHtml(ws.name) + '</option>';
          });
        }

        function populateTemplateToolsets() {
          var select = document.getElementById('new-template-toolset');
          select.innerHTML = '<option value="">-- Use default tools --</option>';
          toolsetsCache.forEach(function(ts) {
            select.innerHTML += '<option value="' + ts.id + '">' + escapeHtml(ts.name) + '</option>';
          });
        }

        async function submitTemplate() {
          var name = document.getElementById('new-template-name').value.trim();
          var editId = document.getElementById('edit-template-id').value;

          if (!name) {
            alert('Please enter a name');
            return;
          }

          var data = {
            name: name,
            description: document.getElementById('new-template-description').value.trim() || null,
            initialMessage: document.getElementById('new-template-message').value.trim() || null,
            title: document.getElementById('new-template-title').value.trim() || null,
            workspaceId: document.getElementById('new-template-workspace').value ? parseInt(document.getElementById('new-template-workspace').value) : null,
            useWorktree: document.getElementById('new-template-worktree').checked,
            branchNamePattern: document.getElementById('new-template-branch-pattern').value.trim() || null,
            toolsetId: document.getElementById('new-template-toolset').value ? parseInt(document.getElementById('new-template-toolset').value) : null,
            cronExpression: document.getElementById('new-template-cron').value.trim() || null
          };

          // Add directories if any
          if (templateDirectories.length > 0) {
            data.additionalDirectories = templateDirectories.slice();
          }

          try {
            var url = editId ? '/api/templates/' + editId : '/api/templates';
            var method = editId ? 'PUT' : 'POST';
            var res = await fetch(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            closeNewTemplateModal();
            fetchTemplates();
          } catch (e) {
            console.error('Failed to save template:', e);
            alert('Failed to save template');
          }
        }

        function editTemplate(id) {
          var template = templatesCache.find(function(t) { return t.id === id; });
          if (!template) return;

          document.getElementById('template-modal-title').textContent = 'Edit Template';
          document.getElementById('edit-template-id').value = id;
          document.getElementById('new-template-name').value = template.name;
          document.getElementById('new-template-description').value = template.description || '';
          document.getElementById('new-template-message').value = template.initialMessage || '';
          document.getElementById('new-template-title').value = template.title || '';
          document.getElementById('new-template-cron').value = template.cronExpression || '';

          // Populate dropdowns first
          populateTemplateWorkspaces();
          populateTemplateToolsets();

          // Then set values
          document.getElementById('new-template-workspace').value = template.workspaceId || '';
          document.getElementById('new-template-toolset').value = template.toolsetId || '';
          document.getElementById('new-template-worktree').checked = template.useWorktree;
          document.getElementById('new-template-branch-pattern').value = template.branchNamePattern || '';

          // Parse additional directories
          populateTemplateDirWorkspaces();
          if (template.additionalDirectories) {
            try {
              templateDirectories = JSON.parse(template.additionalDirectories);
            } catch (e) {
              templateDirectories = [];
            }
          } else {
            templateDirectories = [];
          }
          renderTemplateDirectories();

          // Show/hide conditional fields
          onTemplateWorkspaceChange();
          onTemplateWorktreeChange();

          document.getElementById('new-template-modal').classList.add('active');
        }

        async function deleteTemplate(id) {
          if (!confirm('Are you sure you want to delete this template?')) {
            return;
          }
          try {
            var res = await fetch('/api/templates/' + id, { method: 'DELETE' });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            fetchTemplates();
          } catch (e) {
            console.error('Failed to delete template:', e);
            alert('Failed to delete template');
          }
        }

        function useTemplate(id) {
          var template = templatesCache.find(function(t) { return t.id === id; });
          if (!template) return;

          // Open the new conversation modal with template values pre-filled
          openNewConversationModal();

          // Pre-fill values from template
          if (template.title) {
            document.getElementById('new-conversation-name').value = template.title;
          }
          if (template.initialMessage) {
            document.getElementById('new-conversation-message').value = template.initialMessage;
          }
          if (template.workspaceId) {
            document.getElementById('new-conversation-workspace').value = template.workspaceId;
            onWorkspaceChange();
          }
          if (template.useWorktree) {
            document.getElementById('new-conversation-worktree').checked = true;
            onWorktreeChange();
            if (template.branchNamePattern) {
              // Replace placeholders for branch name
              var branchName = template.branchNamePattern
                .replace('{name}', template.title || 'conversation')
                .replace('{date}', new Date().toISOString().split('T')[0]);
              document.getElementById('new-conversation-branch').value = branchName;
            }
          }
          if (template.toolsetId) {
            var toolset = toolsetsCache.find(function(ts) { return ts.id === template.toolsetId; });
            if (toolset) {
              addToolsetToConversation(JSON.parse(toolset.tools));
            }
          }
          if (template.additionalDirectories) {
            try {
              var dirs = JSON.parse(template.additionalDirectories);
              if (dirs.length > 0) {
                // Enable additional directories section
                document.getElementById('new-conversation-add-dirs').checked = true;
                onAddDirsChange();
                // Populate directories
                additionalDirs = dirs.slice();
                renderAdditionalDirsList();
              }
            } catch (e) {}
          }
          if (template.cronExpression) {
            document.getElementById('new-conversation-schedule').checked = true;
            onConversationScheduleChange();
            document.getElementById('new-conversation-schedule-type').value = 'recurring';
            onConversationScheduleTypeChange();
            document.getElementById('new-conversation-cron').value = template.cronExpression;
          }
        }

        // ============ Conversations ============
        var selectedWorkspaceId = null;
        var currentConversationPage = 1;
        var showArchivedConversations = false;

        function onConversationWorkspaceChange() {
          var select = document.getElementById('conversation-workspace-filter');
          selectedWorkspaceId = select.value ? parseInt(select.value) : null;
          currentConversationPage = 1;
          fetchConversations();
        }

        function onShowArchivedChange() {
          showArchivedConversations = document.getElementById('show-archived-toggle').checked;
          currentConversationPage = 1;
          fetchConversations();
        }

        function goToConversationPage(page) {
          currentConversationPage = page;
          fetchConversations();
        }

        async function fetchConversations() {
          var container = document.getElementById('conversations-list');

          try {
            var url = '/api/conversations?page=' + currentConversationPage;
            if (selectedWorkspaceId) {
              url += '&workspaceId=' + selectedWorkspaceId;
            }
            if (showArchivedConversations) {
              url += '&includeArchived=true';
            }
            var res = await fetch(url);
            var data = await res.json();
            var conversations = data.conversations;

            if (conversations.length === 0) {
              var emptyMsg = selectedWorkspaceId
                ? 'No conversations in this workspace. Start one!'
                : 'No conversations yet. Select a workspace and start one!';
              container.innerHTML = '<div class="empty-state">' + emptyMsg + '</div>';
              return;
            }

            var html = conversations.map(function(conv) {
              var preview = '';
              if (conv.messages && conv.messages.length > 0) {
                try {
                  var lastMsg = JSON.parse(conv.messages[0].content);
                  preview = lastMsg.text || lastMsg.prompt || '(message)';
                } catch(e) { preview = '(message)'; }
              }
              var title = conv.title || 'Conversation #' + conv.id;
              var date = new Date(conv.updatedAt).toLocaleString();
              var msgCount = conv._count ? conv._count.messages : 0;
              var branchBadge = conv.worktreeBranch ? '<span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-size:11px;font-family:monospace;">' + escapeHtml(conv.worktreeBranch) + '</span>' : '';
              // Show workspace badge when viewing all conversations (no filter)
              var workspaceBadge = !selectedWorkspaceId && conv.workspace ? '<span style="background:#f0fdf4;color:#166534;padding:2px 6px;border-radius:4px;font-size:11px;">' + escapeHtml(conv.workspace.name) + '</span>' : '';
              // Show archived badge
              var archivedBadge = conv.isArchived ? '<span class="conversation-archived">archived</span>' : '';

              return '<a class="conversation-item" href="/conversations/' + conv.id + '">' +
                '<div class="conversation-info">' +
                  '<div class="conversation-title">' + escapeHtml(title) + ' ' + branchBadge + ' ' + workspaceBadge + archivedBadge + '</div>' +
                  '<div class="conversation-preview">' + escapeHtml(preview) + '</div>' +
                '</div>' +
                '<div class="conversation-meta">' +
                  '<span>' + msgCount + ' messages</span>' +
                  '<span>' + date + '</span>' +
                  '<span class="conversation-status ' + conv.status + '">' + conv.status + '</span>' +
                '</div>' +
              '</a>';
            }).join('');

            // Add pagination controls if more than one page
            if (data.totalPages > 1) {
              html += '<div class="pagination">';
              html += '<button onclick="goToConversationPage(' + (data.page - 1) + ')" ' + (data.page <= 1 ? 'disabled' : '') + '>&laquo; Prev</button>';
              html += '<span class="page-info">Page ' + data.page + ' of ' + data.totalPages + ' (' + data.total + ' total)</span>';
              html += '<button onclick="goToConversationPage(' + (data.page + 1) + ')" ' + (data.page >= data.totalPages ? 'disabled' : '') + '>Next &raquo;</button>';
              html += '</div>';
            }

            container.innerHTML = html;
          } catch (e) {
            console.error('Failed to fetch conversations:', e);
          }
        }

        function updateConversationWorkspaceFilter() {
          var select = document.getElementById('conversation-workspace-filter');
          var currentValue = select.value;
          select.innerHTML = '<option value="">All conversations</option>';
          workspacesCache.forEach(function(ws) {
            var opt = document.createElement('option');
            opt.value = ws.id;
            opt.textContent = ws.name;
            if (currentValue && parseInt(currentValue) === ws.id) {
              opt.selected = true;
            }
            select.appendChild(opt);
          });
        }

        function escapeHtml(text) {
          if (!text) return '';
          var div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function openNewConversationModal() {
          document.getElementById('new-conversation-modal').classList.add('active');
          // Populate workspace dropdown
          var select = document.getElementById('new-conversation-workspace');
          select.innerHTML = '<option value="">-- Select workspace or enter path below --</option>';
          workspacesCache.forEach(function(ws) {
            var opt = document.createElement('option');
            opt.value = ws.id;
            opt.textContent = ws.name + ' (' + ws.path + ')';
            select.appendChild(opt);
          });

          // Apply default toolset tools if available
          var defaultToolset = toolsetsCache.find(function(ts) { return ts.isDefault; });
          if (defaultToolset) {
            setConversationTools(JSON.parse(defaultToolset.tools));
          } else {
            // Set default tools: Read, Edit, Glob, Bash
            setConversationTools(['Read', 'Edit', 'Glob', 'Bash']);
          }

          // Initialize autocomplete for toolsets and custom tools
          initConversationToolsetInput();
          initCustomToolInput('conversation-custom-tool-input', 'conversation-custom-tools-list', 'conversationCustomTools');
        }

        var conversationCustomTools = [];

        function showConversationToolsetDropdown() {
          var input = document.getElementById('new-conversation-toolset-input');
          var menuId = 'new-conversation-toolset-dropdown';
          var menu = document.getElementById(menuId);

          if (!menu) {
            menu = document.createElement('div');
            menu.id = menuId;
            menu.className = 'custom-tool-dropdown-menu';
            input.parentNode.appendChild(menu);
          }

          var query = input.value.toLowerCase().trim();

          var matches = toolsetsCache.filter(function(ts) {
            if (!query) return true;
            return ts.name.toLowerCase().includes(query);
          });

          menu.innerHTML = '';

          matches.forEach(function(ts) {
            var item = document.createElement('div');
            item.className = 'custom-tool-dropdown-item';
            var toolsList = JSON.parse(ts.tools);
            item.innerHTML = '<div class="custom-tool-dropdown-item-name">' + escapeHtml(ts.name) + '</div>' +
              '<div class="custom-tool-dropdown-item-display">' + toolsList.slice(0, 5).join(', ') + (toolsList.length > 5 ? '...' : '') + '</div>';
            item.addEventListener('click', function() {
              addToolsetToConversation(JSON.parse(ts.tools));
              input.value = '';
              hideConversationToolsetDropdown();
            });
            menu.appendChild(item);
          });

          if (menu.children.length === 0) {
            menu.innerHTML = '<div class="custom-tool-dropdown-empty">No toolsets found</div>';
          }

          menu.classList.add('active');
        }

        function hideConversationToolsetDropdown() {
          var menu = document.getElementById('new-conversation-toolset-dropdown');
          if (menu) menu.classList.remove('active');
        }

        var conversationToolsetClickListenerAdded = false;
        function initConversationToolsetInput() {
          var input = document.getElementById('new-conversation-toolset-input');
          if (!input || input.dataset.initialized) return;
          input.dataset.initialized = 'true';

          input.addEventListener('focus', function() {
            showConversationToolsetDropdown();
          });

          input.addEventListener('input', function() {
            showConversationToolsetDropdown();
          });

          if (!conversationToolsetClickListenerAdded) {
            conversationToolsetClickListenerAdded = true;
            document.addEventListener('click', function(e) {
              var currentInput = document.getElementById('new-conversation-toolset-input');
              var menu = document.getElementById('new-conversation-toolset-dropdown');
              if (menu && currentInput && !currentInput.contains(e.target) && !menu.contains(e.target)) {
                hideConversationToolsetDropdown();
              }
            });
          }
        }

        // Adds toolset tools to existing tools (merges instead of replacing)
        function addToolsetToConversation(tools) {
          var checkboxes = document.querySelectorAll('#conversation-tools-list input[type="checkbox"]');
          checkboxes.forEach(function(cb) {
            // Check the box if tool is in the toolset (don't uncheck existing)
            if (tools.indexOf(cb.value) !== -1) {
              cb.checked = true;
            }
          });
          // Add custom tools from toolset (if not already present)
          tools.forEach(function(tool) {
            if (commonToolsList.indexOf(tool) === -1 && conversationCustomTools.indexOf(tool) === -1) {
              conversationCustomTools.push(tool);
            }
          });
          renderConversationCustomTools();
        }

        function setConversationTools(tools) {
          var checkboxes = document.querySelectorAll('#conversation-tools-list input[type="checkbox"]');
          conversationCustomTools = [];
          checkboxes.forEach(function(cb) {
            cb.checked = tools.indexOf(cb.value) !== -1;
          });
          // Extract custom tools (not in common list)
          tools.forEach(function(tool) {
            if (commonToolsList.indexOf(tool) === -1) {
              conversationCustomTools.push(tool);
            }
          });
          renderConversationCustomTools();
        }

        function getConversationTools() {
          var checkboxes = document.querySelectorAll('#conversation-tools-list input[type="checkbox"]:checked');
          var tools = Array.from(checkboxes).map(function(cb) { return cb.value; });
          return tools.concat(conversationCustomTools);
        }

        function addConversationCustomTool() {
          var input = document.getElementById('conversation-custom-tool-input');
          var tool = input.value.trim();
          if (!tool) return;
          if (conversationCustomTools.indexOf(tool) === -1 && commonToolsList.indexOf(tool) === -1) {
            conversationCustomTools.push(tool);
            renderConversationCustomTools();
          }
          input.value = '';
        }

        function removeConversationCustomTool(index) {
          conversationCustomTools.splice(index, 1);
          renderSelectedCustomTools('conversation-custom-tools-list', 'conversationCustomTools');
        }

        function renderConversationCustomTools() {
          renderSelectedCustomTools('conversation-custom-tools-list', 'conversationCustomTools');
        }

        function closeNewConversationModal() {
          document.getElementById('new-conversation-modal').classList.remove('active');
          document.getElementById('new-conversation-message').value = '';
          document.getElementById('new-conversation-cwd').value = '';
          document.getElementById('new-conversation-workspace').value = '';
          document.getElementById('new-conversation-worktree').checked = false;
          document.getElementById('new-conversation-branch').value = '';
          document.getElementById('new-conversation-schedule').checked = false;
          document.getElementById('new-conversation-schedule-type').value = 'once';
          document.getElementById('new-conversation-scheduled-for').value = '';
          document.getElementById('new-conversation-cron').value = '';
          document.getElementById('worktree-option').style.display = 'none';
          document.getElementById('branch-name-group').style.display = 'none';
          document.getElementById('cwd-group').style.display = 'block';
          document.getElementById('conversation-schedule-type-group').style.display = 'none';
          document.getElementById('conversation-scheduled-for-group').style.display = 'none';
          document.getElementById('conversation-cron-group').style.display = 'none';
          // Reset additional directories
          document.getElementById('new-conversation-add-dirs').checked = false;
          document.getElementById('additional-dirs-section').style.display = 'none';
          document.getElementById('add-dir-manual').value = '';
          additionalDirs = [];
          renderAdditionalDirsList();
          // Reset toolset and custom tools
          document.getElementById('new-conversation-toolset-input').value = '';
          hideConversationToolsetDropdown();
          document.getElementById('conversation-custom-tool-input').value = '';
          conversationCustomTools = [];
          renderConversationCustomTools();
          setConversationTools(['Read', 'Edit', 'Glob', 'Bash']);
        }

        function onWorktreeChange() {
          var checked = document.getElementById('new-conversation-worktree').checked;
          document.getElementById('branch-name-group').style.display = checked ? 'block' : 'none';
        }

        function onConversationScheduleChange() {
          var checked = document.getElementById('new-conversation-schedule').checked;
          document.getElementById('conversation-schedule-type-group').style.display = checked ? 'block' : 'none';
          if (checked) {
            onConversationScheduleTypeChange();
          } else {
            document.getElementById('conversation-scheduled-for-group').style.display = 'none';
            document.getElementById('conversation-cron-group').style.display = 'none';
          }
        }

        function onConversationScheduleTypeChange() {
          var type = document.getElementById('new-conversation-schedule-type').value;
          document.getElementById('conversation-scheduled-for-group').style.display = type === 'once' ? 'block' : 'none';
          document.getElementById('conversation-cron-group').style.display = type === 'recurring' ? 'block' : 'none';
        }

        // Additional directories
        var additionalDirs = [];

        function onAddDirsChange() {
          var checked = document.getElementById('new-conversation-add-dirs').checked;
          document.getElementById('additional-dirs-section').style.display = checked ? 'block' : 'none';
          if (checked) {
            // Populate workspace dropdown
            var select = document.getElementById('add-dir-workspace-select');
            select.innerHTML = '<option value="">-- Select workspace --</option>';
            workspacesCache.forEach(function(ws) {
              var opt = document.createElement('option');
              opt.value = ws.path;
              opt.textContent = ws.name + ' (' + ws.path + ')';
              select.appendChild(opt);
            });
          }
        }

        function addDirFromWorkspace() {
          var select = document.getElementById('add-dir-workspace-select');
          var path = select.value;
          if (!path) {
            alert('Please select a workspace');
            return;
          }
          if (additionalDirs.indexOf(path) === -1) {
            additionalDirs.push(path);
            renderAdditionalDirsList();
          }
          select.value = '';
        }

        function addDirManually() {
          var input = document.getElementById('add-dir-manual');
          var path = input.value.trim();
          if (!path) {
            alert('Please enter a directory path');
            return;
          }
          if (additionalDirs.indexOf(path) === -1) {
            additionalDirs.push(path);
            renderAdditionalDirsList();
          }
          input.value = '';
        }

        function removeAdditionalDir(index) {
          additionalDirs.splice(index, 1);
          renderAdditionalDirsList();
        }

        function renderAdditionalDirsList() {
          var container = document.getElementById('additional-dirs-list');
          var group = document.getElementById('additional-dirs-list-group');
          if (additionalDirs.length === 0) {
            group.style.display = 'none';
            container.innerHTML = '';
            return;
          }
          group.style.display = 'block';
          container.innerHTML = additionalDirs.map(function(dir, idx) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f3f4f6;border-radius:4px;">' +
              '<span style="flex:1;font-family:monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(dir) + '</span>' +
              '<button type="button" onclick="removeAdditionalDir(' + idx + ')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;">&times;</button>' +
            '</div>';
          }).join('');
        }

        function onWorkspaceChange() {
          var workspaceId = document.getElementById('new-conversation-workspace').value;
          var worktreeOption = document.getElementById('worktree-option');
          var cwdGroup = document.getElementById('cwd-group');
          if (workspaceId) {
            worktreeOption.style.display = 'block';
            cwdGroup.style.display = 'none';
          } else {
            worktreeOption.style.display = 'none';
            cwdGroup.style.display = 'block';
          }
        }

        // Add event listener for workspace selection
        document.addEventListener('DOMContentLoaded', function() {
          var wsSelect = document.getElementById('new-conversation-workspace');
          if (wsSelect) {
            wsSelect.addEventListener('change', onWorkspaceChange);
          }
        });

        async function createConversation() {
          var name = document.getElementById('new-conversation-name').value.trim();
          var message = document.getElementById('new-conversation-message').value.trim();
          if (!message) {
            alert('Please enter a message');
            return;
          }
          var workspaceId = document.getElementById('new-conversation-workspace').value;
          var useWorktree = document.getElementById('new-conversation-worktree').checked;
          var branchName = document.getElementById('new-conversation-branch').value.trim();
          var cwd = document.getElementById('new-conversation-cwd').value.trim();
          var isScheduled = document.getElementById('new-conversation-schedule').checked;
          var scheduleType = document.getElementById('new-conversation-schedule-type').value;
          var scheduledFor = document.getElementById('new-conversation-scheduled-for').value;
          var cronExpression = document.getElementById('new-conversation-cron').value.trim();

          if (useWorktree && !branchName) {
            alert('Please enter a branch name for the worktree');
            return;
          }

          if (isScheduled) {
            if (scheduleType === 'once' && !scheduledFor) {
              alert('Please select a date/time for scheduling');
              return;
            }
            if (scheduleType === 'recurring' && !cronExpression) {
              alert('Please enter a cron expression');
              return;
            }
          }

          var body = { message: message };
          if (name) {
            body.title = name;
          }
          if (workspaceId) {
            body.workspaceId = workspaceId;
            body.useWorktree = useWorktree;
            if (useWorktree && branchName) {
              body.branchName = branchName;
            }
          } else if (cwd) {
            body.cwd = cwd;
          }

          if (isScheduled) {
            if (scheduleType === 'once' && scheduledFor) {
              body.scheduledFor = new Date(scheduledFor).toISOString();
            } else if (scheduleType === 'recurring' && cronExpression) {
              body.cronExpression = cronExpression;
            }
          }

          // Add additional directories if any
          if (additionalDirs.length > 0) {
            body.additionalDirectories = additionalDirs.slice();
          }

          // Add allowed tools
          var allowedTools = getConversationTools();
          if (allowedTools.length > 0) {
            body.allowedTools = allowedTools;
          }

          // Add max turns if specified
          var maxTurns = document.getElementById('new-conversation-max-turns').value;
          if (maxTurns) {
            body.maxTurns = parseInt(maxTurns, 10);
          }

          try {
            var res = await fetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!res.ok) {
              var err = await res.json();
              alert('Error: ' + (err.error || 'Unknown error'));
              return;
            }
            var conv = await res.json();
            closeNewConversationModal();
            window.location.href = '/conversations/' + conv.id;
          } catch (e) {
            console.error('Failed to create conversation:', e);
            alert('Failed to create conversation');
          }
        }

        // Initial fetch
        fetchStats();
        fetchJobs();
        fetchToolsets();
        fetchCustomTools();
        fetchTemplates();
        fetchWorkspaces().then(function() {
          fetchConversations();
        });

        // Poll every 2 seconds
        setInterval(function() {
          fetchStats();
          fetchJobs();
          fetchConversations();
        }, 2000);

        // Poll workspaces less frequently
        setInterval(fetchWorkspaces, 10000);
      </script>`)}

    </body>
  </html>
);

const QueueStats: FC = () => (
  <div class="stats-grid">
    <div class="stat-card scheduled">
      <h3>Scheduled</h3>
      <div class="value" id="stat-scheduled">-</div>
    </div>
    <div class="stat-card recurring">
      <h3>Recurring</h3>
      <div class="value" id="stat-recurring">-</div>
    </div>
    <div class="stat-card pending">
      <h3>Pending</h3>
      <div class="value" id="stat-pending">-</div>
    </div>
    <div class="stat-card processing">
      <h3>Processing</h3>
      <div class="value" id="stat-processing">-</div>
    </div>
    <div class="stat-card completed">
      <h3>Completed</h3>
      <div class="value" id="stat-completed">-</div>
    </div>
    <div class="stat-card failed">
      <h3>Failed</h3>
      <div class="value" id="stat-failed">-</div>
    </div>
    <div class="stat-card total">
      <h3>Total</h3>
      <div class="value" id="stat-total">-</div>
    </div>
  </div>
);

const JobList: FC = () => (
  <div class="jobs-section">
    <div class="jobs-header">
      <div>
        <h2>Recent Jobs</h2>
        <span class="refresh-info">Auto-refreshes every second</span>
      </div>
      <div class="job-buttons" style="display:flex;align-items:center;gap:12px;">
        <select id="job-status-filter" onchange="onJobStatusFilterChange()" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <button class="add-job-btn email" onclick="addJob('SendEmailJob')">+ Email</button>
        <button class="add-job-btn email" onclick="addJob('SendWelcomeEmailJob')">+ Welcome</button>
        <button class="add-job-btn report" onclick="addJob('GenerateReportJob')">+ Report</button>
        <button class="add-job-btn export" onclick="addJob('ExportDataJob')">+ Export</button>
        <button class="add-job-btn export" onclick="addJob('SpawnClaudeSessionJob')">+ Spawn Claude Session</button>
        <button class="add-job-btn schedule" onclick="openScheduleModal()">+ Schedule</button>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Job Class</th>
          <th>Status</th>
          <th>Schedule</th>
          <th>Args</th>
          <th>Attempts</th>
          <th>Created</th>
          <th>Error</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="jobs-tbody">
        <tr><td colSpan={9} class="empty-state">Loading...</td></tr>
      </tbody>
    </table>
    <div id="jobs-pagination" class="pagination" style="display: none;"></div>
  </div>
);

const ConversationsList: FC = () => (
  <div class="conversations-section">
    <div class="conversations-header">
      <div>
        <h2>Conversations</h2>
        <span class="refresh-info">Claude Code sessions with message history</span>
      </div>
      <div class="job-buttons" style="display:flex;align-items:center;gap:12px;">
        <select id="conversation-workspace-filter" onchange="onConversationWorkspaceChange()" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
          <option value="">-- Select workspace --</option>
        </select>
        <label class="show-archived-toggle">
          <input type="checkbox" id="show-archived-toggle" onchange="onShowArchivedChange()" />
          Show archived
        </label>
        <button class="add-job-btn export" onclick="openNewConversationModal()">+ New Conversation</button>
      </div>
    </div>
    <div id="conversations-list" class="conversations-list">
      <div class="empty-state">Select a workspace to view conversations</div>
    </div>
  </div>
);

const WorkspacesSection: FC = () => (
  <div class="workspaces-section">
    <div class="workspaces-header">
      <div>
        <h2>Workspaces</h2>
        <span class="refresh-info">Configured directories for conversations</span>
      </div>
      <div class="job-buttons">
        <button class="add-job-btn" onclick="openNewWorkspaceModal()">+ Add Workspace</button>
      </div>
    </div>
    <div id="workspaces-list" class="workspaces-list">
      <div class="empty-state">Loading...</div>
    </div>
  </div>
);

const NewWorkspaceModal: FC = () => (
  <div id="new-workspace-modal" class="modal" onclick="if(event.target===this)closeNewWorkspaceModal()">
    <div class="modal-content">
      <h3>Add Workspace</h3>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="new-workspace-name" placeholder="my-project" />
        <small>A short name for quick reference</small>
      </div>
      <div class="form-group">
        <label>Path</label>
        <input type="text" id="new-workspace-path" placeholder="/path/to/git/repository" />
        <small>Must be a git repository for worktree support</small>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-secondary" onclick="closeNewWorkspaceModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitNewWorkspace()">Add Workspace</button>
      </div>
    </div>
  </div>
);

const ToolsetsSection: FC = () => (
  <div class="toolsets-section">
    <div class="toolsets-header">
      <div>
        <h2>Toolsets</h2>
        <span class="refresh-info">Preset tool configurations for conversations</span>
      </div>
      <div class="job-buttons">
        <button class="btn btn-secondary" onclick="openCustomToolsModal()">Custom Tools</button>
        <button class="add-job-btn" onclick="openNewToolsetModal()">+ Add Toolset</button>
      </div>
    </div>
    <div id="toolsets-list" class="toolsets-list">
      <div class="empty-state">Loading...</div>
    </div>
  </div>
);

const NewToolsetModal: FC = () => (
  <div id="new-toolset-modal" class="modal" onclick="if(event.target===this)closeNewToolsetModal()">
    <div class="modal-content">
      <h3 id="toolset-modal-title">Add Toolset</h3>
      <input type="hidden" id="edit-toolset-id" value="" />
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="new-toolset-name" placeholder="read-only" />
        <small>A short name for this tool configuration</small>
      </div>
      <div class="form-group">
        <label>Common Tools</label>
        <div class="tools-checkboxes" id="toolset-tools-checkboxes">
          <label class="checkbox-label"><input type="checkbox" value="Read" checked /> Read</label>
          <label class="checkbox-label"><input type="checkbox" value="Edit" checked /> Edit</label>
          <label class="checkbox-label"><input type="checkbox" value="Write" /> Write</label>
          <label class="checkbox-label"><input type="checkbox" value="Glob" checked /> Glob</label>
          <label class="checkbox-label"><input type="checkbox" value="Grep" /> Grep</label>
          <label class="checkbox-label"><input type="checkbox" value="Bash" checked /> Bash</label>
          <label class="checkbox-label"><input type="checkbox" value="Task" /> Task</label>
          <label class="checkbox-label"><input type="checkbox" value="WebFetch" /> WebFetch</label>
          <label class="checkbox-label"><input type="checkbox" value="WebSearch" /> WebSearch</label>
          <label class="checkbox-label"><input type="checkbox" value="NotebookEdit" /> NotebookEdit</label>
        </div>
      </div>
      <div class="form-group">
        <label>Custom Tools</label>
        <div class="custom-tool-dropdown">
          <input type="text" id="toolset-custom-tool-input" placeholder="Type to search or add custom tools..." autocomplete="off" />
        </div>
        <small>Select from saved tools or type to add new ones</small>
        <div id="toolset-custom-tools-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="new-toolset-default" />
          Set as default
        </label>
        <small>This toolset will be preselected when starting new conversations</small>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-secondary" onclick="closeNewToolsetModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitToolset()">Save Toolset</button>
      </div>
    </div>
  </div>
);

const CustomToolsModal: FC = () => (
  <div id="custom-tools-modal" class="modal" onclick="if(event.target===this)closeCustomToolsModal()">
    <div class="modal-content" style="max-width:600px;">
      <h3 id="custom-tools-modal-title">Manage Custom Tools</h3>
      <input type="hidden" id="edit-custom-tool-id" value="" />
      <p style="color:#6b7280;margin-bottom:16px;font-size:14px;">
        Save frequently used custom tools (MCP tools, wildcards, etc.) for quick selection in conversations and toolsets.
      </p>

      <div id="custom-tools-add-form" class="form-group" style="background:#f9fafb;padding:12px;border-radius:8px;margin-bottom:16px;">
        <label id="custom-tools-form-label" style="font-weight:500;margin-bottom:8px;display:block;">Add New Custom Tool</label>
        <input type="text" id="new-custom-tool-name" placeholder="Tool name (e.g., mcp__notion__notion-search)" style="margin-bottom:8px;" />
        <input type="text" id="new-custom-tool-display" placeholder="Display name (optional, e.g., Notion Search)" style="margin-bottom:8px;" />
        <input type="text" id="new-custom-tool-desc" placeholder="Description (optional)" style="margin-bottom:8px;" />
        <button class="btn btn-primary" id="custom-tools-submit-btn" onclick="submitCustomTool()">Add Tool</button>
        <button class="btn btn-secondary" id="custom-tools-cancel-btn" style="display:none;margin-left:8px;" onclick="cancelEditCustomTool()">Cancel</button>
      </div>

      <div style="border:1px solid #e5e7eb;border-radius:8px;max-height:300px;overflow-y:auto;">
        <div id="custom-tools-list">
          <div class="empty-state" style="padding:20px;text-align:center;color:#6b7280;">Loading...</div>
        </div>
      </div>

      <div class="modal-buttons" style="margin-top:16px;">
        <button class="btn btn-secondary" onclick="closeCustomToolsModal()">Close</button>
      </div>
    </div>
  </div>
);

const TemplatesSection: FC = () => (
  <div class="templates-section">
    <div class="templates-header">
      <div>
        <h2>Templates</h2>
        <span class="refresh-info">Saved conversation presets</span>
      </div>
      <div class="job-buttons">
        <button class="add-job-btn" onclick="openNewTemplateModal()">+ Add Template</button>
      </div>
    </div>
    <div id="templates-list" class="templates-list">
      <div class="empty-state">Loading...</div>
    </div>
  </div>
);

const NewTemplateModal: FC = () => (
  <div id="new-template-modal" class="modal" onclick="if(event.target===this)closeNewTemplateModal()">
    <div class="modal-content">
      <h3 id="template-modal-title">Add Template</h3>
      <input type="hidden" id="edit-template-id" value="" />
      <div class="form-group">
        <label>Name *</label>
        <input type="text" id="new-template-name" placeholder="daily-standup" />
        <small>A unique name for this template</small>
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="new-template-description" placeholder="Morning standup check-in" />
      </div>
      <div class="form-group">
        <label>Initial Message</label>
        <textarea id="new-template-message" rows={4} placeholder="What would you like Claude to do?" style="width:100%;resize:vertical;"></textarea>
        <small>The prompt to start conversations with</small>
      </div>
      <div class="form-group">
        <label>Conversation Title (optional)</label>
        <input type="text" id="new-template-title" placeholder="e.g., Daily Standup" />
        <small>Default title for conversations created from this template</small>
      </div>
      <div class="form-group">
        <label>Workspace (optional)</label>
        <select id="new-template-workspace" onchange="onTemplateWorkspaceChange()">
          <option value="">-- No workspace --</option>
        </select>
      </div>
      <div class="form-group" id="template-worktree-option" style="display:none;">
        <label class="checkbox-label">
          <input type="checkbox" id="new-template-worktree" onchange="onTemplateWorktreeChange()" />
          Create worktree for each conversation
        </label>
      </div>
      <div class="form-group" id="template-branch-pattern-group" style="display:none;">
        <label>Branch Name Pattern</label>
        <input type="text" id="new-template-branch-pattern" placeholder="feature/{name}-{date}" />
        <small>Use {"{name}"} for title and {"{date}"} for current date</small>
      </div>
      <div class="form-group">
        <label>Toolset (optional)</label>
        <select id="new-template-toolset">
          <option value="">-- Use default tools --</option>
        </select>
        <small>Preset tool configuration for conversations</small>
      </div>
      <div class="form-group">
        <label>Additional Directories (optional)</label>
        <div class="dir-list" id="template-dirs-list"></div>
        <div class="add-row">
          <select id="template-dir-workspace-select" style="flex:1;">
            <option value="">-- Add from workspace --</option>
          </select>
          <button type="button" onclick="addTemplateDirFromWorkspace()">Add</button>
        </div>
        <div class="add-row">
          <input type="text" id="new-template-dir-input" placeholder="/path/to/directory" />
          <button type="button" onclick="addTemplateDirectory()">Add</button>
        </div>
        <small>Directories Claude can access beyond the working directory</small>
      </div>
      <div class="form-group">
        <label>Cron Expression (optional)</label>
        <input type="text" id="new-template-cron" placeholder="0 9 * * 1-5" />
        <small>For recurring conversations, e.g., "0 9 * * 1-5" = 9 AM weekdays</small>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-secondary" onclick="closeNewTemplateModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitTemplate()">Save Template</button>
      </div>
    </div>
  </div>
);

const NewConversationModal: FC = () => (
  <div id="new-conversation-modal" class="modal" onclick="if(event.target===this)closeNewConversationModal()">
    <div class="modal-content">
      <h3>New Conversation</h3>
      <div class="form-group">
        <label>Name (optional)</label>
        <input type="text" id="new-conversation-name" placeholder="e.g., Fix login bug, Add dark mode" />
      </div>
      <div class="form-group">
        <label>Initial Message</label>
        <textarea id="new-conversation-message" rows={4} placeholder="What would you like Claude to do?" style="width:100%;resize:vertical;"></textarea>
      </div>
      <div class="form-group">
        <label>Workspace (optional)</label>
        <select id="new-conversation-workspace">
          <option value="">-- Select workspace or enter path below --</option>
        </select>
      </div>
      <div class="form-group" id="worktree-option" style="display:none;">
        <label class="checkbox-label">
          <input type="checkbox" id="new-conversation-worktree" onchange="onWorktreeChange()" />
          Create worktree (allows parallel work in same repo)
        </label>
        <small>Creates a new branch and worktree for this conversation</small>
      </div>
      <div class="form-group" id="branch-name-group" style="display:none;">
        <label>Branch Name</label>
        <input type="text" id="new-conversation-branch" placeholder="feature/my-task" />
        <small>Name for the new git branch</small>
      </div>
      <div class="form-group" id="cwd-group">
        <label>Working Directory (if no workspace selected)</label>
        <input type="text" id="new-conversation-cwd" placeholder="/path/to/directory" />
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="new-conversation-schedule" onchange="onConversationScheduleChange()" />
          Schedule for later
        </label>
      </div>
      <div class="form-group" id="conversation-schedule-type-group" style="display:none;">
        <label>Schedule Type</label>
        <select id="new-conversation-schedule-type" onchange="onConversationScheduleTypeChange()">
          <option value="once">One-time</option>
          <option value="recurring">Recurring (cron)</option>
        </select>
      </div>
      <div class="form-group" id="conversation-scheduled-for-group" style="display:none;">
        <label>Run At</label>
        <input type="datetime-local" id="new-conversation-scheduled-for" />
      </div>
      <div class="form-group" id="conversation-cron-group" style="display:none;">
        <label>Cron Expression</label>
        <input type="text" id="new-conversation-cron" placeholder="0 9 * * *" />
        <small>Examples: "0 9 * * *" (9 AM daily), "0 0 * * 0" (midnight Sunday)</small>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="new-conversation-add-dirs" onchange="onAddDirsChange()" />
          Add additional directories
        </label>
        <small>Allow Claude to access directories beyond the working directory</small>
      </div>
      <div id="additional-dirs-section" style="display:none;">
        <div class="form-group">
          <label>Add from workspace</label>
          <div style="display:flex;gap:8px;">
            <select id="add-dir-workspace-select" style="flex:1;">
              <option value="">-- Select workspace --</option>
            </select>
            <button type="button" class="btn btn-secondary" onclick="addDirFromWorkspace()">Add</button>
          </div>
        </div>
        <div class="form-group">
          <label>Or enter path manually</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="add-dir-manual" placeholder="/path/to/directory" style="flex:1;" />
            <button type="button" class="btn btn-secondary" onclick="addDirManually()">Add</button>
          </div>
        </div>
        <div class="form-group" id="additional-dirs-list-group" style="display:none;">
          <label>Additional directories</label>
          <div id="additional-dirs-list" style="display:flex;flex-direction:column;gap:4px;"></div>
        </div>
      </div>
      <div class="form-group">
        <label>Add Toolset</label>
        <div class="custom-tool-dropdown">
          <input type="text" id="new-conversation-toolset-input" placeholder="Type to search toolsets..." autocomplete="off" />
        </div>
        <small>Search and select a toolset to add its tools</small>
      </div>
      <div class="form-group">
        <label>Common Tools</label>
        <div id="conversation-tools-list" class="tools-checkboxes">
          <label class="checkbox-label"><input type="checkbox" value="Read" checked /> Read</label>
          <label class="checkbox-label"><input type="checkbox" value="Edit" checked /> Edit</label>
          <label class="checkbox-label"><input type="checkbox" value="Write" /> Write</label>
          <label class="checkbox-label"><input type="checkbox" value="Glob" checked /> Glob</label>
          <label class="checkbox-label"><input type="checkbox" value="Grep" /> Grep</label>
          <label class="checkbox-label"><input type="checkbox" value="Bash" checked /> Bash</label>
          <label class="checkbox-label"><input type="checkbox" value="Task" /> Task</label>
          <label class="checkbox-label"><input type="checkbox" value="WebFetch" /> WebFetch</label>
          <label class="checkbox-label"><input type="checkbox" value="WebSearch" /> WebSearch</label>
          <label class="checkbox-label"><input type="checkbox" value="NotebookEdit" /> NotebookEdit</label>
        </div>
      </div>
      <div class="form-group">
        <label>Custom Tools</label>
        <div class="custom-tool-dropdown">
          <input type="text" id="conversation-custom-tool-input" placeholder="Type to search or add custom tools..." autocomplete="off" />
        </div>
        <small>Select from saved tools or type to add new ones</small>
        <div id="conversation-custom-tools-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>
      <div class="form-group">
        <label>Max Turns (optional)</label>
        <input type="number" id="new-conversation-max-turns" placeholder="e.g., 10" min="1" />
        <small>Limit the number of agentic turns Claude can take</small>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-secondary" onclick="closeNewConversationModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createConversation()">Start Conversation</button>
      </div>
    </div>
  </div>
);

const ScheduleModal: FC = () => (
  <div id="schedule-modal" class="modal" onclick="if(event.target===this)closeScheduleModal()">
    <div class="modal-content">
      <h3>Schedule a Job</h3>
      <div class="form-group">
        <label>Job Type</label>
        <select id="schedule-job-class">
          <option value="SendEmailJob">Send Email</option>
          <option value="SendWelcomeEmailJob">Send Welcome Email</option>
          <option value="GenerateReportJob">Generate Report</option>
          <option value="ExportDataJob">Export Data</option>
          <option value="SpawnClaudeSessionJob">Spawn Claude Session</option>
        </select>
      </div>
      <div class="form-group">
        <label>Schedule Type</label>
        <select id="schedule-type" onchange="updateScheduleType()">
          <option value="once">One-time (run at specific time)</option>
          <option value="recurring">Recurring (cron schedule)</option>
        </select>
      </div>
      <div class="form-group" id="scheduled-for-group">
        <label>Run At</label>
        <input type="datetime-local" id="scheduled-for" />
      </div>
      <div class="form-group" id="cron-group" style="display:none">
        <label>Cron Expression</label>
        <input type="text" id="cron-expression" placeholder="0 9 * * *" />
        <small>Examples: "0 9 * * *" (9 AM daily), "0 0 * * 0" (midnight Sunday), "*/5 * * * *" (every 5 min)</small>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-secondary" onclick="closeScheduleModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitScheduledJob()">Schedule Job</button>
      </div>
    </div>
  </div>
);

const ClaudePromptModal: FC = () => (
  <div id="claude-prompt-modal" class="modal" onclick="if(event.target===this)closeClaudePromptModal()">
    <div class="modal-content">
      <h3>Spawn Claude Session</h3>
      <div class="form-group">
        <label>Prompt</label>
        <textarea id="claude-prompt" rows={4} placeholder="Enter your prompt for Claude..." style="width:100%;resize:vertical;"></textarea>
      </div>
      <div class="form-group">
        <label>Working Directory (optional)</label>
        <input type="text" id="claude-cwd" placeholder="/path/to/directory" />
      </div>
      <div class="modal-buttons">
        <button class="btn btn-secondary" onclick="closeClaudePromptModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitClaudeSession()">Spawn Session</button>
      </div>
    </div>
  </div>
);

const Dashboard: FC = () => (
  <Layout>
    <h1>Queue Dashboard</h1>
    <QueueStats />
    <WorkspacesSection />
    <ToolsetsSection />
    <TemplatesSection />
    <ConversationsList />
    <JobList />
    <ScheduleModal />
    <ClaudePromptModal />
    <NewConversationModal />
    <NewWorkspaceModal />
    <NewToolsetModal />
    <CustomToolsModal />
    <NewTemplateModal />
  </Layout>
);

const JobDetailsPage: FC<{ jobId: string }> = ({ jobId }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <title>Job Details - #{jobId}</title>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
        .header h1 { font-size: 24px; }
        .back-link { color: #666; text-decoration: none; }
        .back-link:hover { color: #333; }
        .job-info { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .job-info h2 { margin-bottom: 15px; font-size: 18px; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }
        .info-item { }
        .info-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .info-value { font-size: 14px; font-weight: 500; }
        .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
        .status-completed { background: #d4edda; color: #155724; }
        .status-processing { background: #fff3cd; color: #856404; }
        .status-pending { background: #e2e3e5; color: #383d41; }
        .status-failed { background: #f8d7da; color: #721c24; }
        .conversation { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .conversation h2 { margin-bottom: 15px; font-size: 18px; }
        .messages { max-height: 500px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
        .message { margin-bottom: 15px; padding: 10px 15px; border-radius: 8px; }
        .message:last-child { margin-bottom: 0; }
        .message-user { background: #e3f2fd; margin-left: 50px; }
        .message-assistant { background: #f5f5f5; margin-right: 50px; }
        .message-system { background: #fff8e1; font-size: 12px; color: #666; }
        .message-result { background: #e8f5e9; font-size: 12px; }
        .message-label { font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
        .message-content { white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.5; }
        .message-content code { background: #eee; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
        .tool-use { background: #f0f0f0; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px; }
        .tool-name { font-weight: 600; color: #1976d2; }
        .follow-up { display: flex; gap: 10px; }
        .follow-up textarea { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; resize: vertical; min-height: 60px; font-family: inherit; font-size: 14px; }
        .follow-up button { padding: 10px 20px; background: #1976d2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
        .follow-up button:hover { background: #1565c0; }
        .follow-up button:disabled { background: #ccc; cursor: not-allowed; }
        .reset-btn { background: #dc2626; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-top: 12px; }
        .reset-btn:hover { background: #b91c1c; }
        .job-actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
        .cancel-btn { background: #fee2e2; color: #dc2626; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
        .cancel-btn:hover { background: #fecaca; }
        .pause-btn { background: #fef3c7; color: #d97706; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
        .pause-btn:hover { background: #fde68a; }
        .resume-btn { background: #d1fae5; color: #059669; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
        .resume-btn:hover { background: #a7f3d0; }
        .no-session { color: #666; font-style: italic; }
        .loading { text-align: center; padding: 40px; color: #666; }
        .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 8px; margin-bottom: 15px; }

        /* ============ Mobile Responsive Styles for Job Detail ============ */
        @media (max-width: 768px) {
          body { padding: 12px; }
          .container { max-width: 100%; }

          /* Header */
          .header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
            margin-bottom: 16px;
          }
          .header h1 { font-size: 18px; }
          #pause-btn { margin-left: 0 !important; width: 100%; }

          /* Job Info */
          .job-info { padding: 14px; margin-bottom: 14px; }
          .job-info h2 { font-size: 16px; margin-bottom: 12px; }
          .info-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .info-label { font-size: 10px; }
          .info-value { font-size: 13px; }

          /* Job Actions */
          .job-actions { margin-top: 12px; flex-direction: column; }
          .job-actions button { width: 100%; padding: 12px 16px; }

          /* Conversation/Messages */
          .conversation { padding: 14px; }
          .conversation h2 { font-size: 16px; margin-bottom: 12px; }
          .messages { max-height: calc(100vh - 400px); padding: 10px; }

          /* Messages */
          .message { padding: 10px 12px; margin-bottom: 12px; }
          .message-user { margin-left: 20px; }
          .message-assistant { margin-right: 20px; }
          .message-label { font-size: 10px; }
          .message-content { font-size: 13px; }
          .tool-use { padding: 6px; font-size: 11px; }

          /* Follow-up */
          .follow-up { flex-direction: column; gap: 8px; }
          .follow-up textarea {
            min-height: 80px;
            padding: 12px;
            font-size: 16px;
          }
          .follow-up button { width: 100%; padding: 14px 20px; font-size: 15px; }

          /* Action Buttons */
          .reset-btn, .cancel-btn, .pause-btn, .resume-btn {
            width: 100%;
            padding: 12px 16px;
          }
        }

        @media (max-width: 480px) {
          body { padding: 8px; }
          .header h1 { font-size: 16px; }
          .info-grid { grid-template-columns: 1fr; gap: 8px; }
          .message-user { margin-left: 10px; }
          .message-assistant { margin-right: 10px; }
        }
      `}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <a href="/" class="back-link">← Back to Dashboard</a>
          <h1>Job #{jobId}</h1>
          <button id="pause-btn" onclick="togglePolling()" style="margin-left:auto;padding:6px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;">Pause Polling</button>
        </div>
        <div id="job-details">
          <div class="loading">Loading job details...</div>
        </div>
      </div>
      {raw(`<script>
        const jobId = ${jobId};

        async function fetchJobDetails() {
          try {
            const res = await fetch('/api/jobs/' + jobId);
            if (!res.ok) {
              throw new Error('Job not found');
            }
            const job = await res.json();
            renderJobDetails(job);
          } catch (e) {
            document.getElementById('job-details').innerHTML = '<div class="error">Error loading job: ' + e.message + '</div>';
          }
        }

        function renderJobDetails(job) {
          const payload = JSON.parse(job.payload);
          const hasSession = !!job.sessionId;
          const isClaudeJob = payload.jobClass === 'SpawnClaudeSessionJob';

          let html = '<div class="job-info"><h2>Job Information</h2><div class="info-grid">';
          html += '<div class="info-item"><div class="info-label">Status</div><div class="info-value"><span class="status status-' + job.status + '">' + job.status + '</span></div></div>';
          html += '<div class="info-item"><div class="info-label">Job Class</div><div class="info-value">' + payload.jobClass + '</div></div>';
          html += '<div class="info-item"><div class="info-label">Created</div><div class="info-value">' + new Date(job.createdAt).toLocaleString() + '</div></div>';
          html += '<div class="info-item"><div class="info-label">Attempts</div><div class="info-value">' + job.attempts + '/' + job.maxAttempts + '</div></div>';
          if (job.sessionId) {
            html += '<div class="info-item"><div class="info-label">Session ID</div><div class="info-value" style="font-size:11px;word-break:break-all;">' + job.sessionId + '</div></div>';
          }
          html += '</div>';

          // Action buttons based on job status
          var hasActions = false;
          var actionsHtml = '<div class="job-actions">';
          if (job.status === 'processing') {
            actionsHtml += '<button class="reset-btn" onclick="resetJob()">Reset Job</button>';
            hasActions = true;
          }
          if (job.status === 'scheduled') {
            if (job.isRecurring) {
              actionsHtml += '<button class="pause-btn" onclick="pauseJob()">Pause Recurring Job</button>';
            } else {
              actionsHtml += '<button class="cancel-btn" onclick="cancelJob()">Cancel Job</button>';
            }
            hasActions = true;
          } else if (job.status === 'pending') {
            actionsHtml += '<button class="cancel-btn" onclick="cancelJob()">Cancel Job</button>';
            hasActions = true;
          } else if (job.status === 'failed' && job.error === 'Paused' && job.isRecurring) {
            actionsHtml += '<button class="resume-btn" onclick="resumeJob()">Resume Recurring Job</button>';
            hasActions = true;
          }
          actionsHtml += '</div>';
          if (hasActions) {
            html += actionsHtml;
          }
          html += '</div>';

          html += '<div class="conversation"><h2>Conversation</h2>';
          html += '<div class="messages" id="messages">';

          if (job.logs && job.logs.length > 0) {
            job.logs.forEach(function(log) {
              html += renderMessage(log);
            });
          } else {
            html += '<div class="loading">No messages yet</div>';
          }

          html += '</div>';

          if (isClaudeJob && hasSession) {
            html += '<div class="follow-up">';
            html += '<textarea id="follow-up-input" placeholder="Send a follow-up message..."></textarea>';
            html += '<button id="send-btn" onclick="sendFollowUp()">Send</button>';
            html += '</div>';
          } else if (isClaudeJob && !hasSession) {
            html += '<div class="no-session">Session not available for follow-up messages</div>';
          }

          html += '</div>';

          document.getElementById('job-details').innerHTML = html;

          // Scroll to bottom of messages
          var messagesDiv = document.getElementById('messages');
          if (messagesDiv) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
          }
        }

        function renderMessage(log) {
          const content = JSON.parse(log.content);
          let html = '<div class="message message-' + log.type + '">';
          html += '<div class="message-label">' + log.type + ' • ' + new Date(log.createdAt).toLocaleTimeString() + '</div>';

          if (log.type === 'user') {
            html += '<div class="message-content">' + escapeHtml(content.prompt) + '</div>';
          } else if (log.type === 'assistant') {
            if (content.content && Array.isArray(content.content)) {
              content.content.forEach(function(block) {
                if (block.text) {
                  html += '<div class="message-content">' + escapeHtml(block.text) + '</div>';
                } else if (block.type === 'tool_use') {
                  html += '<div class="tool-use"><span class="tool-name">' + block.name + '</span></div>';
                }
              });
            }
          } else if (log.type === 'result') {
            html += '<div class="message-content">Session ' + content.subtype;
            if (content.total_cost_usd) {
              html += ' • Cost: $' + content.total_cost_usd.toFixed(4);
            }
            if (content.num_turns) {
              html += ' • Turns: ' + content.num_turns;
            }
            html += '</div>';
          } else if (log.type === 'system') {
            html += '<div class="message-content">' + (content.subtype || 'system message') + '</div>';
          }

          html += '</div>';
          return html;
        }

        function escapeHtml(text) {
          if (!text) return '';
          var div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        async function sendFollowUp() {
          var input = document.getElementById('follow-up-input');
          var btn = document.getElementById('send-btn');
          var message = input.value.trim();

          if (!message) return;

          btn.disabled = true;
          btn.textContent = 'Sending...';

          try {
            var res = await fetch('/api/jobs/' + jobId + '/message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: message })
            });

            if (!res.ok) {
              var err = await res.json();
              throw new Error(err.error || 'Failed to send message');
            }

            input.value = '';
            await fetchJobDetails();
          } catch (e) {
            alert('Error: ' + e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = 'Send';
          }
        }

        async function resetJob() {
          if (!confirm('Reset this job back to pending? It will be retried.')) return;
          try {
            const res = await fetch('/api/jobs/' + jobId + '/reset', { method: 'POST' });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Failed to reset job');
            }
            await fetchJobDetails();
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }

        async function cancelJob() {
          if (!confirm('Are you sure you want to cancel this job?')) return;
          try {
            const res = await fetch('/api/jobs/' + jobId, { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Failed to cancel job');
            }
            await fetchJobDetails();
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }

        async function pauseJob() {
          try {
            const res = await fetch('/api/jobs/' + jobId + '/pause', { method: 'POST' });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Failed to pause job');
            }
            await fetchJobDetails();
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }

        async function resumeJob() {
          try {
            const res = await fetch('/api/jobs/' + jobId + '/resume', { method: 'POST' });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Failed to resume job');
            }
            await fetchJobDetails();
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }

        // Handle Ctrl+Enter to send message (Enter for newline)
        document.addEventListener('keydown', function(e) {
          if (e.target.id === 'follow-up-input' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            sendFollowUp();
          }
        });

        fetchJobDetails();

        // Auto-refresh every 5 seconds if job is processing
        var pollingPaused = false;
        setInterval(function() {
          if (pollingPaused) return;
          var statusEl = document.querySelector('.status-processing');
          if (statusEl) {
            fetchJobDetails();
          }
        }, 5000);

        function togglePolling() {
          pollingPaused = !pollingPaused;
          document.getElementById('pause-btn').textContent = pollingPaused ? 'Resume Polling' : 'Pause Polling';
        }
      </script>`)}
    </body>
  </html>
);

const ConversationDetailPage: FC<{ conversationId: string }> = ({ conversationId }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <title>Conversation #{conversationId}</title>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 24px; }
        .container { max-width: 1100px; margin: 0 auto; }
        .header { display: flex; align-items: center; gap: 18px; margin-bottom: 24px; }
        .header h1 { font-size: 26px; }
        .back-link { color: #666; text-decoration: none; font-size: 15px; }
        .back-link:hover { color: #333; }
        .conv-info { background: white; border-radius: 10px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .conv-info h2 { margin-bottom: 18px; font-size: 20px; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; }
        .info-item { }
        .info-label { font-size: 13px; color: #666; text-transform: uppercase; margin-bottom: 4px; }
        .info-value { font-size: 15px; font-weight: 500; }
        .status { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 13px; }
        .status-active { background: #d1fae5; color: #065f46; }
        .status-closed { background: #e5e7eb; color: #374151; }
        .conversation { background: white; border-radius: 10px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
        .conversation h2 { margin-bottom: 18px; font-size: 20px; flex-shrink: 0; }
        .messages { flex: 1; min-height: 350px; max-height: calc(100vh - 380px); overflow-y: auto; border: 1px solid #eee; border-radius: 10px; padding: 20px; margin-bottom: 18px; }
        .message { margin-bottom: 18px; padding: 14px 18px; border-radius: 10px; }
        .message:last-child { margin-bottom: 0; }
        .message-user { background: #e3f2fd; margin-left: 60px; }
        .message-assistant { background: #f5f5f5; margin-right: 60px; }
        .message-system { background: #fff8e1; font-size: 13px; color: #666; }
        .message-result { background: #e8f5e9; font-size: 13px; }
        .message-label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 6px; }
        .message-content { white-space: pre-wrap; word-break: break-word; font-size: 15px; line-height: 1.6; }
        .tool-use { background: #f0f0f0; padding: 10px; border-radius: 6px; margin-top: 10px; font-size: 13px; }
        .tool-name { font-weight: 600; color: #1976d2; }
        .follow-up { display: flex; gap: 12px; }
        .follow-up textarea { flex: 1; padding: 14px; border: 1px solid #ddd; border-radius: 10px; resize: vertical; min-height: 80px; font-family: inherit; font-size: 15px; }
        .follow-up button { padding: 14px 24px; background: #1976d2; color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 500; }
        .follow-up button:hover { background: #1565c0; }
        .follow-up button:disabled { background: #ccc; cursor: not-allowed; }
        .loading { text-align: center; padding: 50px; color: #666; font-size: 15px; }
        .error { background: #f8d7da; color: #721c24; padding: 18px; border-radius: 10px; margin-bottom: 18px; font-size: 15px; }
        .processing-indicator { background: #fff3cd; color: #856404; padding: 14px 18px; border-radius: 10px; margin-bottom: 18px; display: flex; align-items: center; gap: 12px; font-size: 15px; }
        .processing-indicator .spinner { width: 18px; height: 18px; border: 2px solid #856404; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .follow-up-container { margin-top: 14px; }
        .schedule-options { margin-top: 14px; padding: 16px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; }
        .schedule-options .form-group { margin-bottom: 14px; }
        .schedule-options .form-group:last-child { margin-bottom: 0; }
        .schedule-options label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151; }
        .schedule-options input, .schedule-options select { width: 100%; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
        .schedule-options small { color: #6b7280; font-size: 12px; }
        .checkbox-label { display: flex; align-items: center; cursor: pointer; font-size: 14px; color: #374151; }
        .checkbox-label input { width: auto; margin-right: 10px; }
        .conv-options { margin-top: 18px; border-top: 1px solid #e5e7eb; padding-top: 18px; }
        .conv-options-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
        .conv-options-header h3 { font-size: 15px; font-weight: 500; color: #374151; margin: 0; }
        .conv-options-toggle { background: none; border: none; color: #6b7280; cursor: pointer; font-size: 13px; }
        .conv-options-content { margin-top: 16px; display: none; }
        .conv-options-content.open { display: block; }
        .conv-options .form-group { margin-bottom: 16px; }
        .conv-options .form-group:last-child { margin-bottom: 0; }
        .conv-options label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #374151; }
        .conv-options small { color: #6b7280; font-size: 12px; display: block; margin-top: 6px; }
        .conv-options .dir-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .conv-options .dir-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-size: 12px; font-family: monospace; }
        .conv-options .dir-tag button { background: none; border: none; color: #0369a1; cursor: pointer; font-size: 13px; padding: 0; line-height: 1; }
        .conv-options .tool-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; background: #fef3c7; color: #92400e; border-radius: 6px; font-size: 12px; font-family: monospace; }
        .conv-options .tool-tag button { background: none; border: none; color: #92400e; cursor: pointer; font-size: 13px; padding: 0; line-height: 1; }
        .conv-options .add-row { display: flex; gap: 8px; margin-top: 8px; }
        .conv-options .add-row input { flex: 1; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; }
        .conv-options .add-row select { flex: 1; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; background: white; appearance: none; -webkit-appearance: none; -moz-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M2 4l4 4 4-4'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; cursor: pointer; }
        .conv-options .add-row select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        .conv-options .add-row select:hover { border-color: #9ca3af; }
        .conv-options .add-row button { padding: 10px 16px; background: #e5e7eb; color: #374151; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
        .conv-options .add-row button:hover { background: #d1d5db; }
        .conv-options .save-btn { margin-top: 16px; padding: 12px 20px; background: #1976d2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
        .conv-options .save-btn:hover { background: #1565c0; }
        .conv-options .save-btn:disabled { background: #ccc; cursor: not-allowed; }
        .conv-options .tools-checkboxes { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
        .conv-options .tools-checkboxes .checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; background: #f3f4f6; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
        .conv-options .tools-checkboxes .checkbox-label input { margin: 0; }

        /* Custom Tool Dropdown */
        .custom-tool-dropdown { position: relative; }
        .custom-tool-dropdown-menu { position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: white; border: 1px solid #d1d5db; border-top: none; border-radius: 0 0 6px 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 50; display: none; }
        .custom-tool-dropdown-menu.active { display: block; }
        .custom-tool-dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
        .custom-tool-dropdown-item:hover { background: #f3f4f6; }
        .custom-tool-dropdown-item-name { font-family: monospace; font-size: 13px; color: #1f2937; }
        .custom-tool-dropdown-item-display { font-size: 12px; color: #6b7280; }
        .custom-tool-dropdown-add { padding: 8px 12px; border-top: 1px solid #e5e7eb; color: #3b82f6; cursor: pointer; font-size: 13px; }
        .custom-tool-dropdown-add:hover { background: #f0f9ff; }
        .custom-tool-dropdown-empty { padding: 8px 12px; color: #6b7280; font-size: 13px; }

        /* ============ Large Screen Styles ============ */
        @media (min-width: 1400px) {
          .container { max-width: 1300px; }
          .messages { max-height: calc(100vh - 350px); }
        }

        /* ============ Mobile Responsive Styles for Conversation Detail ============ */
        @media (max-width: 768px) {
          body { padding: 0; background: #f5f5f5; }
          .container { max-width: 100%; padding: 0; }

          /* Header - sticky at top */
          .header {
            position: sticky;
            top: 0;
            z-index: 100;
            background: white;
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            margin-bottom: 0;
            padding: 12px 16px;
            border-bottom: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          }
          .back-link { font-size: 14px; }
          .header h1 {
            font-size: 16px;
            word-break: break-word;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          #pause-btn {
            margin-left: 0 !important;
            padding: 8px 12px;
            font-size: 13px;
          }

          /* Conversation Info - collapsible style */
          .conv-info {
            padding: 12px 16px;
            margin: 0;
            border-radius: 0;
            box-shadow: none;
            border-bottom: 1px solid #e5e7eb;
          }
          .conv-info h2 { font-size: 14px; margin-bottom: 10px; }
          .info-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          }
          .info-label { font-size: 10px; margin-bottom: 2px; }
          .info-value { font-size: 13px; word-break: break-word; }

          /* Conversation Options */
          .conv-options { margin-top: 12px; padding-top: 12px; }
          .conv-options-header h3 { font-size: 14px; }
          .conv-options .form-group { margin-bottom: 14px; }
          .conv-options label { font-size: 13px; }
          .conv-options small { font-size: 11px; }
          .conv-options .dir-list { gap: 6px; }
          .conv-options .dir-tag { font-size: 11px; padding: 6px 10px; max-width: 100%; word-break: break-all; }
          .conv-options .tool-tag { font-size: 11px; padding: 6px 10px; }
          .conv-options .add-row { flex-direction: column; gap: 8px; }
          .conv-options .add-row input, .conv-options .add-row select { width: 100%; padding: 12px 14px; font-size: 16px; }
          .conv-options .add-row button { width: 100%; padding: 12px 14px; font-size: 15px; }
          .conv-options .tools-checkboxes { gap: 8px; }
          .conv-options .tools-checkboxes .checkbox-label { font-size: 13px; padding: 8px 12px; }
          .conv-options .save-btn { width: 100%; padding: 14px 16px; font-size: 15px; }

          /* Messages Container - full width, more height */
          .conversation {
            padding: 0;
            border-radius: 0;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            min-height: calc(100vh - 200px);
            background: white;
          }
          .conversation h2 {
            font-size: 14px;
            margin: 0;
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
            background: #fafafa;
          }
          .messages {
            flex: 1;
            min-height: 0;
            max-height: none;
            height: calc(100vh - 280px);
            padding: 12px;
            border: none;
            border-radius: 0;
            margin: 0;
            -webkit-overflow-scrolling: touch;
          }

          /* Message Bubbles - full width on mobile */
          .message {
            padding: 12px 14px;
            margin-bottom: 10px;
            border-radius: 12px;
          }
          .message-user {
            margin-left: 0;
            margin-right: 0;
            background: #e3f2fd;
            border-left: 3px solid #1976d2;
          }
          .message-assistant {
            margin-left: 0;
            margin-right: 0;
            background: #f8f9fa;
            border-left: 3px solid #6b7280;
          }
          .message-system {
            border-left: 3px solid #f59e0b;
          }
          .message-result {
            border-left: 3px solid #10b981;
          }
          .message-label { font-size: 11px; margin-bottom: 6px; font-weight: 600; }
          .message-content { font-size: 15px; line-height: 1.6; }
          .tool-use { padding: 10px; margin-top: 10px; font-size: 13px; border-radius: 8px; }
          .tool-name { font-size: 13px; }

          /* Processing Indicator */
          .processing-indicator {
            padding: 12px 16px;
            font-size: 14px;
            margin: 0;
            border-radius: 0;
            border-bottom: 1px solid #fcd34d;
          }
          .processing-indicator .spinner { width: 16px; height: 16px; }

          /* Follow-up Form - sticky at bottom */
          .follow-up-container {
            margin: 0;
            padding: 10px 12px;
            background: white;
            border-top: 1px solid #e5e7eb;
            position: sticky;
            bottom: 0;
            z-index: 100;
          }
          .follow-up {
            flex-direction: row;
            align-items: flex-end;
            gap: 8px;
          }
          .follow-up textarea {
            flex: 1;
            min-height: 44px;
            max-height: 150px;
            padding: 10px 16px;
            font-size: 16px; /* Prevents iOS zoom */
            border-radius: 22px;
            border: 1px solid #d1d5db;
            background: #f3f4f6;
            line-height: 1.4;
            resize: none;
            overflow-y: auto;
            -webkit-appearance: none;
          }
          .follow-up textarea:focus {
            outline: none;
            border-color: #1976d2;
            background: white;
            box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
          }
          .follow-up textarea::placeholder {
            color: #9ca3af;
          }
          .follow-up button {
            flex-shrink: 0;
            width: 44px;
            height: 44px;
            min-width: 44px;
            padding: 0;
            font-size: 0;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .follow-up button::before {
            content: "↑";
            font-size: 20px;
            font-weight: bold;
          }
          .follow-up button:disabled {
            background: #e5e7eb;
          }
          .follow-up button:disabled::before {
            color: #9ca3af;
          }

          /* Schedule Options */
          .schedule-options { padding: 14px; margin-top: 10px; border-radius: 12px; }
          .schedule-options .form-group { margin-bottom: 12px; }
          .schedule-options label { font-size: 14px; }
          .schedule-options input, .schedule-options select {
            padding: 14px;
            font-size: 16px; /* Prevents iOS zoom */
            border-radius: 10px;
          }
          .schedule-options small { font-size: 12px; }

          /* Max turns field */
          .form-group input[type="number"] {
            width: 100% !important;
            padding: 14px;
            font-size: 16px;
          }

          /* Checkbox labels - larger touch targets */
          .checkbox-label {
            font-size: 15px;
            padding: 8px 0;
            min-height: 44px;
            display: flex;
            align-items: center;
          }
          .checkbox-label input {
            width: 22px;
            height: 22px;
            margin-right: 12px;
          }

          /* Error and Loading states */
          .loading, .error { padding: 24px 16px; font-size: 15px; }
          .error { margin: 12px 16px; border-radius: 12px; }
        }

        @media (max-width: 480px) {
          .header h1 { font-size: 15px; }
          .info-grid { grid-template-columns: 1fr; gap: 10px; }
          .info-value { font-size: 14px; }
          .messages {
            height: calc(100vh - 240px);
            padding: 10px;
          }
          .message-content { font-size: 14px; }
          .follow-up-container { padding: 8px 10px; }
          .follow-up { gap: 6px; }
          .follow-up textarea {
            min-height: 40px;
            padding: 10px 14px;
          }
          .follow-up button {
            width: 40px;
            height: 40px;
            min-width: 40px;
          }
        }

        /* Safe area insets for notched phones */
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          @media (max-width: 768px) {
            .follow-up-container {
              padding-bottom: calc(12px + env(safe-area-inset-bottom));
            }
          }
        }
      `}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <a href="/" class="back-link">← Back to Dashboard</a>
          <h1 id="conv-title" style="cursor:pointer;" onclick="editTitle()" title="Click to edit">Conversation #{conversationId}</h1>
          <button id="pause-btn" onclick="togglePolling()" style="margin-left:auto;padding:6px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;">Pause Polling</button>
        </div>
        <div id="conversation-details">
          <div class="loading">Loading conversation...</div>
        </div>
      </div>
      {raw(`<script>
        const conversationId = ${conversationId};

        var lastMessageCount = 0;
        var customToolsCache = [];
        var toolsetsCache = [];
        var commonToolsList = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit'];

        async function fetchCustomTools() {
          try {
            var res = await fetch('/api/custom-tools');
            customToolsCache = await res.json();
          } catch (e) {
            console.error('Failed to fetch custom tools:', e);
          }
        }

        async function fetchToolsets() {
          try {
            var res = await fetch('/api/toolsets');
            toolsetsCache = await res.json();
          } catch (e) {
            console.error('Failed to fetch toolsets:', e);
          }
        }

        function escapeHtml(text) {
          if (!text) return '';
          var div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function showCustomToolDropdown(inputId, listId, customToolsArrayName) {
          var input = document.getElementById(inputId);
          var menuId = inputId + '-dropdown';
          var menu = document.getElementById(menuId);

          if (!menu) {
            menu = document.createElement('div');
            menu.id = menuId;
            menu.className = 'custom-tool-dropdown-menu';
            input.parentNode.appendChild(menu);
          }

          var query = input.value.toLowerCase().trim();
          var currentTools = window[customToolsArrayName] || [];
          var toolsList = convCommonToolsList || commonToolsList;

          var matches = customToolsCache.filter(function(tool) {
            if (currentTools.indexOf(tool.name) !== -1) return false;
            if (toolsList.indexOf(tool.name) !== -1) return false;
            if (!query) return true;
            return tool.name.toLowerCase().includes(query) ||
                   (tool.displayName && tool.displayName.toLowerCase().includes(query));
          });

          // Clear and rebuild menu with event listeners
          menu.innerHTML = '';

          matches.forEach(function(tool) {
            var item = document.createElement('div');
            item.className = 'custom-tool-dropdown-item';
            item.innerHTML = '<div class="custom-tool-dropdown-item-name">' + escapeHtml(tool.name) + '</div>' +
              (tool.displayName ? '<div class="custom-tool-dropdown-item-display">' + escapeHtml(tool.displayName) + '</div>' : '');
            item.addEventListener('click', function() {
              selectConvCustomTool(tool.name);
            });
            menu.appendChild(item);
          });

          if (query && !matches.some(function(t) { return t.name.toLowerCase() === query; })) {
            var addItem = document.createElement('div');
            addItem.className = 'custom-tool-dropdown-add';
            addItem.textContent = 'Add "' + input.value.trim() + '"';
            addItem.addEventListener('click', function() {
              addConvToolFromInput();
            });
            menu.appendChild(addItem);
          }

          if (menu.children.length === 0 && !query) {
            menu.innerHTML = '<div class="custom-tool-dropdown-empty">No saved custom tools. Type to add one.</div>';
          } else if (menu.children.length === 0) {
            menu.innerHTML = '<div class="custom-tool-dropdown-empty">No matches. Press Enter to add.</div>';
          }

          menu.classList.add('active');
        }

        function hideCustomToolDropdown(inputId) {
          var menu = document.getElementById(inputId + '-dropdown');
          if (menu) {
            menu.classList.remove('active');
          }
        }

        function selectConvCustomTool(toolName) {
          if (convCustomTools.indexOf(toolName) === -1) {
            convCustomTools.push(toolName);
            renderConvCustomTools();
          }
          document.getElementById('conv-new-tool').value = '';
          hideCustomToolDropdown('conv-new-tool');
        }

        async function fetchConversation() {
          try {
            // Check if user is interacting with scheduling form or options - if so, skip full re-render
            var activeEl = document.activeElement;
            var isInteractingWithSchedule = activeEl && (
              activeEl.id === 'msg-schedule-type' ||
              activeEl.id === 'msg-scheduled-for' ||
              activeEl.id === 'msg-cron' ||
              activeEl.id === 'msg-schedule-checkbox' ||
              activeEl.id === 'msg-max-turns'
            );
            var isInteractingWithOptions = activeEl && (
              activeEl.id === 'conv-new-dir' ||
              activeEl.id === 'conv-new-tool'
            );

            // Preserve input value before re-render
            var inputEl = document.getElementById('follow-up-input');
            var savedInput = inputEl ? inputEl.value : '';
            var wasFocused = inputEl && activeEl === inputEl;
            var savedSelectionStart = inputEl ? inputEl.selectionStart : 0;
            var savedSelectionEnd = inputEl ? inputEl.selectionEnd : 0;

            // Preserve scroll position
            var messagesEl = document.getElementById('messages');
            var savedScrollTop = messagesEl ? messagesEl.scrollTop : 0;
            var wasAtBottom = messagesEl ? (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 50) : true;

            // Preserve scheduling form state
            var scheduleCheckbox = document.getElementById('msg-schedule-checkbox');
            var savedScheduleChecked = scheduleCheckbox ? scheduleCheckbox.checked : false;
            var scheduleTypeEl = document.getElementById('msg-schedule-type');
            var savedScheduleType = scheduleTypeEl ? scheduleTypeEl.value : 'once';
            var scheduledForEl = document.getElementById('msg-scheduled-for');
            var savedScheduledFor = scheduledForEl ? scheduledForEl.value : '';
            var cronEl = document.getElementById('msg-cron');
            var savedCron = cronEl ? cronEl.value : '';
            var maxTurnsEl = document.getElementById('msg-max-turns');
            var savedMaxTurns = maxTurnsEl ? maxTurnsEl.value : '';

            const res = await fetch('/api/conversations/' + conversationId);
            if (!res.ok) throw new Error('Conversation not found');
            const conv = await res.json();
            var newMessageCount = conv.messages ? conv.messages.length : 0;

            // Skip re-render entirely if user is typing and nothing has changed
            // This prevents DOM jitter while typing, especially on mobile
            if (wasFocused && newMessageCount === lastMessageCount) {
              return;
            }

            // If user is interacting with scheduling form or options, only update messages
            if ((isInteractingWithSchedule || isInteractingWithOptions) && messagesEl) {
              // Just update messages without full re-render
              var newMessagesHtml = '';
              if (conv.messages && conv.messages.length > 0) {
                conv.messages.forEach(function(msg) {
                  newMessagesHtml += renderMessage(msg);
                });
              } else {
                newMessagesHtml = '<div class="loading">No messages yet</div>';
              }
              messagesEl.innerHTML = newMessagesHtml;
              if (wasAtBottom) {
                messagesEl.scrollTop = messagesEl.scrollHeight;
              } else {
                messagesEl.scrollTop = savedScrollTop;
              }
              lastMessageCount = newMessageCount;
              return;
            }

            // Save options input values before re-render
            var savedNewDir = document.getElementById('conv-new-dir');
            var savedNewDirValue = savedNewDir ? savedNewDir.value : '';
            var savedNewTool = document.getElementById('conv-new-tool');
            var savedNewToolValue = savedNewTool ? savedNewTool.value : '';
            var savedToolsetInput = document.getElementById('conv-toolset-input');
            var savedToolsetValue = savedToolsetInput ? savedToolsetInput.value : '';

            // Save checkbox states before re-render
            var savedCheckboxStates = {};
            document.querySelectorAll('#conv-tools-checkboxes input[type="checkbox"]').forEach(function(cb) {
              savedCheckboxStates[cb.value] = cb.checked;
            });

            renderConversation(conv);

            // Only reload options if the panel isn't open (user not editing)
            if (!optionsPanelOpen) {
              loadConvOptions(conv);
            } else {
              // Just re-render the current state
              renderConvDirectories();
              renderConvCustomTools();
              // Restore checkbox states
              document.querySelectorAll('#conv-tools-checkboxes input[type="checkbox"]').forEach(function(cb) {
                if (savedCheckboxStates.hasOwnProperty(cb.value)) {
                  cb.checked = savedCheckboxStates[cb.value];
                }
              });
            }

            // Restore options panel state
            if (optionsPanelOpen) {
              var content = document.getElementById('options-content');
              var btn = document.getElementById('options-toggle-btn');
              if (content) content.classList.add('open');
              if (btn) btn.textContent = 'Hide';
            }

            // Restore options input values
            var newDirInput = document.getElementById('conv-new-dir');
            if (newDirInput && savedNewDirValue) {
              newDirInput.value = savedNewDirValue;
            }
            var newToolInput = document.getElementById('conv-new-tool');
            if (newToolInput && savedNewToolValue) {
              newToolInput.value = savedNewToolValue;
            }

            // Re-initialize input event listeners after re-render
            // (the DOM was recreated so event listeners were lost)
            if (optionsPanelOpen) {
              initConvToolInput();
              initConvToolsetInput();
              // Restore toolset input value
              var newToolsetInput = document.getElementById('conv-toolset-input');
              if (newToolsetInput && savedToolsetValue) {
                newToolsetInput.value = savedToolsetValue;
              }
            }

            // Restore scroll position
            var newMessagesEl = document.getElementById('messages');
            if (newMessagesEl) {
              if (wasAtBottom) {
                // Was at bottom - scroll to bottom to show new messages
                newMessagesEl.scrollTop = newMessagesEl.scrollHeight;
              } else {
                // Preserve scroll position - user is reading previous messages
                newMessagesEl.scrollTop = savedScrollTop;
              }
            }
            lastMessageCount = newMessageCount;

            // Restore input value and cursor position after re-render
            var newInputEl = document.getElementById('follow-up-input');
            if (newInputEl && savedInput) {
              newInputEl.value = savedInput;
              if (wasFocused) {
                newInputEl.focus();
                // Restore cursor to original position
                newInputEl.selectionStart = savedSelectionStart;
                newInputEl.selectionEnd = savedSelectionEnd;
              }
            }

            // Restore scheduling form state
            var newScheduleCheckbox = document.getElementById('msg-schedule-checkbox');
            if (newScheduleCheckbox && savedScheduleChecked) {
              newScheduleCheckbox.checked = true;
              document.getElementById('msg-schedule-options').style.display = 'block';
            }
            var newScheduleType = document.getElementById('msg-schedule-type');
            if (newScheduleType && savedScheduleType) {
              newScheduleType.value = savedScheduleType;
              // Update visibility based on schedule type
              if (savedScheduleType === 'recurring') {
                document.getElementById('msg-scheduled-for-group').style.display = 'none';
                document.getElementById('msg-cron-group').style.display = 'block';
              }
            }
            var newScheduledFor = document.getElementById('msg-scheduled-for');
            if (newScheduledFor && savedScheduledFor) {
              newScheduledFor.value = savedScheduledFor;
            }
            var newCron = document.getElementById('msg-cron');
            if (newCron && savedCron) {
              newCron.value = savedCron;
            }
            var newMaxTurns = document.getElementById('msg-max-turns');
            if (newMaxTurns && savedMaxTurns) {
              newMaxTurns.value = savedMaxTurns;
            }
          } catch (e) {
            document.getElementById('conversation-details').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
          }
        }

        // Store current conversation's archive state
        var currentConvIsArchived = false;

        function renderConversation(conv) {
          const hasActiveJob = conv.jobs && conv.jobs.some(j => j.status === 'processing' || j.status === 'pending');
          currentConvIsArchived = conv.isArchived;

          updateTitleDisplay(conv.title);

          let html = '<div class="conv-info"><h2>Conversation Info</h2><div class="info-grid">';
          html += '<div class="info-item"><div class="info-label">Status</div><div class="info-value"><span class="status status-' + conv.status + '">' + conv.status + '</span>' + (conv.isArchived ? '<span class="conversation-archived" style="margin-left:8px;">archived</span>' : '') + '</div></div>';
          html += '<div class="info-item"><div class="info-label">Created</div><div class="info-value">' + new Date(conv.createdAt).toLocaleString() + '</div></div>';
          html += '<div class="info-item"><div class="info-label">Messages</div><div class="info-value">' + conv.messages.length + '</div></div>';
          if (conv.workspace) {
            html += '<div class="info-item"><div class="info-label">Workspace</div><div class="info-value">' + escapeHtml(conv.workspace.name) + '</div></div>';
          }
          if (conv.worktreeBranch) {
            html += '<div class="info-item"><div class="info-label">Branch</div><div class="info-value" style="font-family:monospace;">' + escapeHtml(conv.worktreeBranch) + '</div></div>';
          }
          if (conv.cwd) {
            html += '<div class="info-item"><div class="info-label">Working Directory</div><div class="info-value" style="font-size:12px;word-break:break-all;">' + escapeHtml(conv.cwd) + '</div></div>';
          }
          // Archive action
          if (conv.isArchived) {
            html += '<div class="info-item"><div class="info-label">Archive</div><div class="info-value"><button onclick="unarchiveConversation()" style="padding:6px 12px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Unarchive</button></div></div>';
          } else {
            html += '<div class="info-item"><div class="info-label">Archive</div><div class="info-value"><button onclick="archiveConversation()" style="padding:6px 12px;background:#f59e0b;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Archive</button></div></div>';
          }
          html += '</div>';

          // Conversation Options section
          html += '<div class="conv-options">';
          html += '<div class="conv-options-header" onclick="toggleOptionsPanel()">';
          html += '<h3>Conversation Options</h3>';
          html += '<button type="button" class="conv-options-toggle" id="options-toggle-btn">Show</button>';
          html += '</div>';
          html += '<div class="conv-options-content" id="options-content">';

          // Toolset selector
          html += '<div class="form-group">';
          html += '<label>Add Toolset</label>';
          html += '<div class="add-row custom-tool-dropdown">';
          html += '<input type="text" id="conv-toolset-input" placeholder="Type to search toolsets..." autocomplete="off" />';
          html += '</div>';
          html += '<small>Search and select a toolset to add its tools</small>';
          html += '</div>';

          // Additional Directories
          html += '<div class="form-group">';
          html += '<label>Additional Directories</label>';
          html += '<div class="dir-list" id="conv-dirs-list"></div>';
          html += '<div class="add-row">';
          html += '<input type="text" id="conv-new-dir" placeholder="/path/to/directory" />';
          html += '<button type="button" onclick="addConvDirectory()">Add</button>';
          html += '</div>';
          html += '<small>Directories Claude can access beyond the working directory</small>';
          html += '</div>';

          // Allowed Tools
          html += '<div class="form-group">';
          html += '<label>Common Tools</label>';
          html += '<div class="tools-checkboxes" id="conv-tools-checkboxes">';
          html += '<label class="checkbox-label"><input type="checkbox" value="Read" /> Read</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="Edit" /> Edit</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="Write" /> Write</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="Glob" /> Glob</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="Grep" /> Grep</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="Bash" /> Bash</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="Task" /> Task</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="WebFetch" /> WebFetch</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="WebSearch" /> WebSearch</label>';
          html += '<label class="checkbox-label"><input type="checkbox" value="NotebookEdit" /> NotebookEdit</label>';
          html += '</div>';
          html += '</div>';

          html += '<div class="form-group">';
          html += '<label>Custom Tools</label>';
          html += '<div class="dir-list" id="conv-custom-tools-list"></div>';
          html += '<div class="add-row custom-tool-dropdown">';
          html += '<input type="text" id="conv-new-tool" placeholder="Type to search or add custom tools..." autocomplete="off" />';
          html += '</div>';
          html += '<small>Select from saved tools or type to add new ones</small>';
          html += '</div>';

          html += '<button type="button" class="save-btn" id="save-options-btn" onclick="saveConvOptions()">Save Options</button>';
          html += '</div>';
          html += '</div>';

          html += '</div>';

          html += '<div class="conversation"><h2>Messages</h2>';

          if (hasActiveJob) {
            html += '<div class="processing-indicator"><div class="spinner"></div>Processing message...</div>';
          }

          html += '<div class="messages" id="messages">';
          if (conv.messages && conv.messages.length > 0) {
            conv.messages.forEach(function(msg) {
              html += renderMessage(msg);
            });
          } else {
            html += '<div class="loading">No messages yet</div>';
          }
          html += '</div>';

          if (conv.status === 'active') {
            html += '<div class="follow-up-container">';
            html += '<div class="follow-up">';
            html += '<textarea id="follow-up-input" placeholder="Send a follow-up message..." ' + (hasActiveJob ? 'disabled' : '') + '></textarea>';
            html += '<button id="send-btn" onclick="sendMessage()" ' + (hasActiveJob ? 'disabled' : '') + '>Send</button>';
            html += '</div>';
            html += '<div style="margin-top:8px;"><label class="checkbox-label"><input type="checkbox" id="msg-schedule-checkbox" onchange="onMsgScheduleChange()" ' + (hasActiveJob ? 'disabled' : '') + ' /> Schedule for later</label></div>';
            html += '<div id="msg-schedule-options" class="schedule-options" style="display:none;">';
            html += '<div class="form-group"><label>Schedule Type</label><select id="msg-schedule-type" onchange="onMsgScheduleTypeChange()"><option value="once">One-time</option><option value="recurring">Recurring (cron)</option></select></div>';
            html += '<div class="form-group" id="msg-scheduled-for-group"><label>Run At</label><input type="datetime-local" id="msg-scheduled-for" /></div>';
            html += '<div class="form-group" id="msg-cron-group" style="display:none;"><label>Cron Expression</label><input type="text" id="msg-cron" placeholder="0 9 * * *" /><small>Examples: "0 9 * * *" (9 AM daily), "0 0 * * 0" (midnight Sunday)</small></div>';
            html += '</div>';
            html += '<div class="form-group" style="margin-top:8px;"><label>Max Turns (optional)</label><input type="number" id="msg-max-turns" placeholder="e.g., 10" min="1" style="width:100px;" ' + (hasActiveJob ? 'disabled' : '') + ' /><small style="margin-left:8px;">Limit agentic turns</small></div>';
            html += '</div>';
          }

          html += '</div>';
          document.getElementById('conversation-details').innerHTML = html;
        }

        function renderMessage(msg) {
          const content = JSON.parse(msg.content);
          let html = '<div class="message message-' + msg.role + '">';
          html += '<div class="message-label">' + msg.role + ' • ' + new Date(msg.createdAt).toLocaleTimeString() + '</div>';

          if (msg.role === 'user') {
            html += '<div class="message-content">' + escapeHtml(content.text || content.prompt) + '</div>';
          } else if (msg.role === 'assistant') {
            if (content.content && Array.isArray(content.content)) {
              content.content.forEach(function(block) {
                if (block.text) {
                  html += '<div class="message-content">' + escapeHtml(block.text) + '</div>';
                } else if (block.type === 'tool_use') {
                  html += '<div class="tool-use"><span class="tool-name">' + block.name + '</span></div>';
                }
              });
            }
          } else if (msg.role === 'result') {
            html += '<div class="message-content">Session ' + content.subtype;
            if (content.total_cost_usd) html += ' • Cost: $' + content.total_cost_usd.toFixed(4);
            if (content.num_turns) html += ' • Turns: ' + content.num_turns;
            html += '</div>';
          } else if (msg.role === 'system') {
            html += '<div class="message-content">' + (content.subtype || 'system') + '</div>';
          }

          html += '</div>';
          return html;
        }

        function escapeHtml(text) {
          if (!text) return '';
          var div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        // Archive/Unarchive functions
        async function archiveConversation() {
          if (!confirm('Archive this conversation? It will be hidden from the default view but can be restored later.')) return;
          try {
            var res = await fetch('/api/conversations/' + conversationId + '/archive', {
              method: 'POST'
            });
            if (!res.ok) {
              var data = await res.json();
              alert('Failed to archive: ' + (data.error || 'Unknown error'));
              return;
            }
            currentConvIsArchived = true;
            fetchConversation();
          } catch (e) {
            console.error('Failed to archive conversation:', e);
            alert('Failed to archive conversation');
          }
        }

        async function unarchiveConversation() {
          try {
            var res = await fetch('/api/conversations/' + conversationId + '/unarchive', {
              method: 'POST'
            });
            if (!res.ok) {
              var data = await res.json();
              alert('Failed to unarchive: ' + (data.error || 'Unknown error'));
              return;
            }
            currentConvIsArchived = false;
            fetchConversation();
          } catch (e) {
            console.error('Failed to unarchive conversation:', e);
            alert('Failed to unarchive conversation');
          }
        }

        // Conversation options state
        var convDirectories = [];
        var convCustomTools = [];
        var optionsPanelOpen = false;
        var convCommonToolsList = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit'];

        function toggleOptionsPanel() {
          optionsPanelOpen = !optionsPanelOpen;
          var content = document.getElementById('options-content');
          var btn = document.getElementById('options-toggle-btn');
          if (optionsPanelOpen) {
            content.classList.add('open');
            btn.textContent = 'Hide';
            // Initialize autocomplete dropdowns after opening
            setTimeout(function() {
              initConvToolInput();
              initConvToolsetInput();
            }, 0);
          } else {
            content.classList.remove('open');
            btn.textContent = 'Show';
          }
        }

        function showConvToolsetDropdown() {
          var input = document.getElementById('conv-toolset-input');
          var menuId = 'conv-toolset-dropdown';
          var menu = document.getElementById(menuId);

          if (!menu) {
            menu = document.createElement('div');
            menu.id = menuId;
            menu.className = 'custom-tool-dropdown-menu';
            input.parentNode.appendChild(menu);
          }

          var query = input.value.toLowerCase().trim();

          var matches = toolsetsCache.filter(function(ts) {
            if (!query) return true;
            return ts.name.toLowerCase().includes(query);
          });

          menu.innerHTML = '';

          matches.forEach(function(ts) {
            var item = document.createElement('div');
            item.className = 'custom-tool-dropdown-item';
            var toolsList = JSON.parse(ts.tools);
            item.innerHTML = '<div class="custom-tool-dropdown-item-name">' + escapeHtml(ts.name) + '</div>' +
              '<div class="custom-tool-dropdown-item-display">' + toolsList.slice(0, 5).join(', ') + (toolsList.length > 5 ? '...' : '') + '</div>';
            item.addEventListener('click', function() {
              addConvToolsetById(ts.id);
              input.value = '';
              hideConvToolsetDropdown();
            });
            menu.appendChild(item);
          });

          if (menu.children.length === 0) {
            menu.innerHTML = '<div class="custom-tool-dropdown-empty">No toolsets found</div>';
          }

          menu.classList.add('active');
        }

        function hideConvToolsetDropdown() {
          var menu = document.getElementById('conv-toolset-dropdown');
          if (menu) menu.classList.remove('active');
        }

        function addConvToolsetById(toolsetId) {
          var toolset = toolsetsCache.find(function(ts) { return ts.id === toolsetId; });
          if (!toolset) return;

          var tools = JSON.parse(toolset.tools);

          // Add common tools from toolset (check the checkboxes)
          var checkboxes = document.querySelectorAll('#conv-tools-checkboxes input[type="checkbox"]');
          checkboxes.forEach(function(cb) {
            if (tools.indexOf(cb.value) !== -1) {
              cb.checked = true;
            }
          });

          // Add custom tools from toolset (if not already present)
          tools.forEach(function(tool) {
            if (convCommonToolsList.indexOf(tool) === -1 && convCustomTools.indexOf(tool) === -1) {
              convCustomTools.push(tool);
            }
          });

          renderConvCustomTools();
        }

        var convToolsetClickListenerAdded = false;
        function initConvToolsetInput() {
          var input = document.getElementById('conv-toolset-input');
          if (!input || input.dataset.initialized) return;
          input.dataset.initialized = 'true';

          input.addEventListener('focus', function() {
            showConvToolsetDropdown();
          });

          input.addEventListener('input', function() {
            showConvToolsetDropdown();
          });

          if (!convToolsetClickListenerAdded) {
            convToolsetClickListenerAdded = true;
            document.addEventListener('click', function(e) {
              var currentInput = document.getElementById('conv-toolset-input');
              var menu = document.getElementById('conv-toolset-dropdown');
              if (menu && currentInput && !currentInput.contains(e.target) && !menu.contains(e.target)) {
                hideConvToolsetDropdown();
              }
            });
          }
        }

        function loadConvOptions(conv) {
          convDirectories = [];
          convCustomTools = [];
          var tools = [];
          if (conv.queryOptions) {
            try {
              var opts = JSON.parse(conv.queryOptions);
              if (opts.additionalDirectories) {
                convDirectories = opts.additionalDirectories;
              }
              if (opts.allowedTools) {
                tools = opts.allowedTools;
              }
            } catch (e) {}
          }
          renderConvDirectories();
          setConvToolCheckboxes(tools);
        }

        function setConvToolCheckboxes(tools) {
          var checkboxes = document.querySelectorAll('#conv-tools-checkboxes input[type="checkbox"]');
          convCustomTools = [];
          checkboxes.forEach(function(cb) {
            cb.checked = tools.indexOf(cb.value) !== -1;
          });
          // Extract custom tools (not in common list)
          tools.forEach(function(tool) {
            if (convCommonToolsList.indexOf(tool) === -1) {
              convCustomTools.push(tool);
            }
          });
          renderConvCustomTools();
        }

        function getConvAllTools() {
          var checkboxes = document.querySelectorAll('#conv-tools-checkboxes input[type="checkbox"]:checked');
          var tools = Array.from(checkboxes).map(function(cb) { return cb.value; });
          return tools.concat(convCustomTools);
        }

        function renderConvDirectories() {
          var container = document.getElementById('conv-dirs-list');
          if (!container) return;
          var html = '';
          convDirectories.forEach(function(dir, idx) {
            html += '<span class="dir-tag">' + escapeHtml(dir) + '<button type="button" onclick="removeConvDirectory(' + idx + ')">×</button></span>';
          });
          container.innerHTML = html;
        }

        function addConvDirectory() {
          var input = document.getElementById('conv-new-dir');
          var dir = input.value.trim();
          if (!dir) return;
          if (convDirectories.indexOf(dir) === -1) {
            convDirectories.push(dir);
            renderConvDirectories();
          }
          input.value = '';
        }

        function removeConvDirectory(idx) {
          convDirectories.splice(idx, 1);
          renderConvDirectories();
        }

        function renderConvCustomTools() {
          var container = document.getElementById('conv-custom-tools-list');
          if (!container) return;
          container.innerHTML = '';
          convCustomTools.forEach(function(tool, idx) {
            var span = document.createElement('span');
            span.className = 'tool-tag';
            span.appendChild(document.createTextNode(tool));
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '×';
            (function(index) {
              btn.addEventListener('click', function() {
                removeConvTool(index);
              });
            })(idx);
            span.appendChild(btn);
            container.appendChild(span);
          });
        }

        var convToolClickListenerAdded = false;
        function initConvToolInput() {
          var input = document.getElementById('conv-new-tool');
          if (!input || input.dataset.initialized) return;
          input.dataset.initialized = 'true';

          input.addEventListener('focus', function() {
            showCustomToolDropdown('conv-new-tool', 'conv-custom-tools-list', 'convCustomTools');
          });

          input.addEventListener('input', function() {
            showCustomToolDropdown('conv-new-tool', 'conv-custom-tools-list', 'convCustomTools');
          });

          input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              addConvToolFromInput();
            }
          });

          // Only add the document click listener once (it looks up the input dynamically)
          if (!convToolClickListenerAdded) {
            convToolClickListenerAdded = true;
            document.addEventListener('click', function(e) {
              var currentInput = document.getElementById('conv-new-tool');
              var menu = document.getElementById('conv-new-tool-dropdown');
              if (menu && currentInput && !currentInput.contains(e.target) && !menu.contains(e.target)) {
                hideCustomToolDropdown('conv-new-tool');
              }
            });
          }
        }

        function addConvToolFromInput() {
          var input = document.getElementById('conv-new-tool');
          var tool = input.value.trim();
          if (!tool) return;
          // Don't add if it's a common tool (should use checkbox) or already exists
          if (convCommonToolsList.indexOf(tool) !== -1) {
            alert('Use the checkbox above for common tools');
            return;
          }
          if (convCustomTools.indexOf(tool) === -1) {
            convCustomTools.push(tool);
            renderConvCustomTools();
          }
          input.value = '';
          hideCustomToolDropdown('conv-new-tool');
        }

        function addConvTool() {
          addConvToolFromInput();
        }

        function removeConvTool(idx) {
          convCustomTools.splice(idx, 1);
          renderConvCustomTools();
        }

        async function saveConvOptions() {
          var btn = document.getElementById('save-options-btn');
          btn.disabled = true;
          btn.textContent = 'Saving...';

          var allTools = getConvAllTools();

          try {
            var res = await fetch('/api/conversations/' + conversationId + '/options', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                additionalDirectories: convDirectories.length > 0 ? convDirectories : null,
                allowedTools: allTools.length > 0 ? allTools : null
              })
            });
            if (!res.ok) {
              var err = await res.json();
              throw new Error(err.error || 'Failed to save');
            }
            btn.textContent = 'Saved!';
            setTimeout(function() {
              btn.textContent = 'Save Options';
              btn.disabled = false;
            }, 1500);
          } catch (e) {
            alert('Error: ' + e.message);
            btn.textContent = 'Save Options';
            btn.disabled = false;
          }
        }

        function onMsgScheduleChange() {
          var checked = document.getElementById('msg-schedule-checkbox').checked;
          document.getElementById('msg-schedule-options').style.display = checked ? 'block' : 'none';
        }

        function onMsgScheduleTypeChange() {
          var type = document.getElementById('msg-schedule-type').value;
          document.getElementById('msg-scheduled-for-group').style.display = type === 'once' ? 'block' : 'none';
          document.getElementById('msg-cron-group').style.display = type === 'recurring' ? 'block' : 'none';
        }

        async function sendMessage() {
          var input = document.getElementById('follow-up-input');
          var btn = document.getElementById('send-btn');
          var message = input.value.trim();
          if (!message) return;

          var isScheduled = document.getElementById('msg-schedule-checkbox').checked;
          var scheduleType = document.getElementById('msg-schedule-type').value;
          var scheduledFor = document.getElementById('msg-scheduled-for').value;
          var cronExpression = document.getElementById('msg-cron').value.trim();

          if (isScheduled) {
            if (scheduleType === 'once' && !scheduledFor) {
              alert('Please select a date/time for scheduling');
              return;
            }
            if (scheduleType === 'recurring' && !cronExpression) {
              alert('Please enter a cron expression');
              return;
            }
          }

          btn.disabled = true;
          btn.textContent = 'Sending...';
          input.disabled = true;

          var body = { message: message };
          if (isScheduled) {
            if (scheduleType === 'once' && scheduledFor) {
              body.scheduledFor = new Date(scheduledFor).toISOString();
            } else if (scheduleType === 'recurring' && cronExpression) {
              body.cronExpression = cronExpression;
            }
          }

          // Add max turns if specified
          var maxTurnsInput = document.getElementById('msg-max-turns');
          if (maxTurnsInput && maxTurnsInput.value) {
            body.maxTurns = parseInt(maxTurnsInput.value, 10);
          }

          try {
            var res = await fetch('/api/conversations/' + conversationId + '/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!res.ok) {
              var err = await res.json();
              throw new Error(err.error || 'Failed to send');
            }
            input.value = '';
            // Reset scheduling options
            document.getElementById('msg-schedule-checkbox').checked = false;
            document.getElementById('msg-schedule-options').style.display = 'none';
            document.getElementById('msg-scheduled-for').value = '';
            document.getElementById('msg-cron').value = '';
            // Reset max turns
            var maxTurnsInput = document.getElementById('msg-max-turns');
            if (maxTurnsInput) maxTurnsInput.value = '';
            await fetchConversation();
          } catch (e) {
            alert('Error: ' + e.message);
            btn.disabled = false;
            btn.textContent = 'Send';
            input.disabled = false;
          }
        }

        // Handle Ctrl+Enter to send message (Enter for newline)
        document.addEventListener('keydown', function(e) {
          if (e.target.id === 'follow-up-input' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            sendMessage();
          }
        });

        // Auto-resize textarea as user types
        function autoResizeTextarea(textarea) {
          if (!textarea) return;
          textarea.style.height = 'auto';
          var newHeight = Math.min(textarea.scrollHeight, 150);
          textarea.style.height = newHeight + 'px';
        }

        document.addEventListener('input', function(e) {
          if (e.target.id === 'follow-up-input') {
            autoResizeTextarea(e.target);
          }
        });

        // Also handle paste events
        document.addEventListener('paste', function(e) {
          if (e.target.id === 'follow-up-input') {
            setTimeout(function() { autoResizeTextarea(e.target); }, 0);
          }
        });

        fetchConversation();
        fetchCustomTools();
        fetchToolsets();

        var pollingPaused = false;
        var pollingPausedByFocus = false;
        setInterval(function() {
          if (!pollingPaused && !pollingPausedByFocus) fetchConversation();
        }, 3000);

        // Pause polling when user is focused on the input to prevent jitter
        var pausePollingIds = ['follow-up-input', 'conv-new-tool', 'conv-new-dir', 'conv-toolset-input'];
        document.addEventListener('focusin', function(e) {
          if (pausePollingIds.indexOf(e.target.id) !== -1) {
            pollingPausedByFocus = true;
          }
        });
        document.addEventListener('focusout', function(e) {
          if (pausePollingIds.indexOf(e.target.id) !== -1) {
            // Small delay before resuming to avoid immediate re-render
            setTimeout(function() {
              pollingPausedByFocus = false;
            }, 500);
          }
        });

        function togglePolling() {
          pollingPaused = !pollingPaused;
          document.getElementById('pause-btn').textContent = pollingPaused ? 'Resume Polling' : 'Pause Polling';
        }

        var currentTitle = '';
        function updateTitleDisplay(title) {
          currentTitle = title || '';
          document.getElementById('conv-title').textContent = title || 'Conversation #' + conversationId;
          document.title = (title || 'Conversation #' + conversationId);
        }

        function editTitle() {
          var newTitle = prompt('Enter conversation name:', currentTitle);
          if (newTitle === null) return;
          saveTitle(newTitle.trim());
        }

        async function saveTitle(title) {
          try {
            var res = await fetch('/api/conversations/' + conversationId + '/title', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: title || null })
            });
            if (!res.ok) throw new Error('Failed to save title');
            updateTitleDisplay(title);
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }
      </script>`)}
    </body>
  </html>
);

// ============ Routes ============

// Dashboard page
app.get("/", (c) => {
  return c.html(<Dashboard />);
});

// Job details page
app.get("/jobs/:id", (c) => {
  const jobId = c.req.param("id");
  return c.html(<JobDetailsPage jobId={jobId} />);
});

// Conversation details page
app.get("/conversations/:id", (c) => {
  const conversationId = c.req.param("id");
  return c.html(<ConversationDetailPage conversationId={conversationId} />);
});

// API: Get queue statistics
app.get("/api/stats", async (c) => {
  const queue = c.req.query("queue") || "default";
  const stats = await getStats(queue);
  return c.json(stats);
});

/// API: Get list of recent jobs with pagination
app.get("/api/jobs", async (c) => {
  const queue = c.req.query("queue") || "default";
  const limit = parseInt(c.req.query("limit") || "5", 10);
  const page = parseInt(c.req.query("page") || "1", 10);
  const status = c.req.query("status") as
    | "scheduled"
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | undefined;
  const result = await getJobs(queue, limit, page, status);
  return c.json(result);
});

// API: Get registered job classes
app.get("/api/job-classes", (c) => {
  return c.json(getRegisteredJobs());
});

// API: Enqueue a job by class name (supports scheduling)
app.post("/api/jobs", async (c) => {
  const body = await c.req.json();
  const jobClass = body.jobClass;

  // Build scheduling options
  const options: {
    queue?: string;
    priority?: number;
    scheduledFor?: Date;
    cronExpression?: string;
  } = {
    queue: body.queue || "default",
    priority: body.priority || 0,
  };

  // Handle scheduling
  if (body.scheduledFor) {
    options.scheduledFor = new Date(body.scheduledFor);
  }
  if (body.cronExpression) {
    if (!isValidCronExpression(body.cronExpression)) {
      return c.json({ error: `Invalid cron expression: ${body.cronExpression}` }, 400);
    }
    options.cronExpression = body.cronExpression;
  }

  let job;

  // Dispatch to the appropriate job class with sample data
  switch (jobClass) {
    case "SendEmailJob":
      job = await SendEmailJob.performLater(
        {
          to: `user${Date.now()}@example.com`,
          subject: "Test Email",
          body: "This is a test email from the dashboard.",
        },
        options
      );
      break;
    case "SendWelcomeEmailJob":
      job = await SendWelcomeEmailJob.performLater(
        {
          userId: Math.floor(Math.random() * 1000),
          email: `newuser${Date.now()}@example.com`,
          name: "Test User",
        },
        options
      );
      break;
    case "GenerateReportJob":
      job = await GenerateReportJob.performLater(
        {
          reportType: "daily",
          userId: Math.floor(Math.random() * 100),
          startDate: "2025-01-01",
          endDate: "2025-01-07",
        },
        options
      );
      break;
    case "ExportDataJob":
      job = await ExportDataJob.performLater(
        {
          format: ["csv", "json", "pdf"][Math.floor(Math.random() * 3)] as "csv" | "json" | "pdf",
          tableName: "users",
          filters: { active: true },
        },
        options
      );
      break;
    case "SpawnClaudeSessionJob":
      if (!body.prompt) {
        return c.json({ error: "SpawnClaudeSessionJob requires 'prompt' in request body" }, 400);
      }
      job = await SpawnClaudeSessionJob.performLater(
        {
          prompt: body.prompt,
          cwd: body.cwd,
        },
        options
      );
      break;
    default:
      return c.json({ error: `Unknown job class: ${jobClass}` }, 400);
  }

  return c.json(job, 201);
});

// API: Get scheduled jobs
app.get("/api/scheduled-jobs", async (c) => {
  const queue = c.req.query("queue") || "default";
  const jobs = await getScheduledJobs(queue);
  return c.json(jobs);
});

// API: Get recurring jobs
app.get("/api/recurring-jobs", async (c) => {
  const queue = c.req.query("queue") || "default";
  const jobs = await getRecurringJobs(queue);
  return c.json(jobs);
});

// API: Cancel a scheduled job
app.delete("/api/jobs/:id", async (c) => {
  const jobId = parseInt(c.req.param("id"), 10);
  try {
    const job = await cancelScheduledJob(jobId);
    return c.json(job);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// API: Pause a recurring job
app.post("/api/jobs/:id/pause", async (c) => {
  const jobId = parseInt(c.req.param("id"), 10);
  try {
    const job = await pauseRecurringJob(jobId);
    return c.json(job);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// API: Resume a recurring job
app.post("/api/jobs/:id/resume", async (c) => {
  const jobId = parseInt(c.req.param("id"), 10);
  try {
    const job = await resumeRecurringJob(jobId);
    return c.json(job);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// API: Reset a stuck processing job back to pending
app.post("/api/jobs/:id/reset", async (c) => {
  const id = parseInt(c.req.param("id"));
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return c.json({ error: "Job not found" }, 404);
  if (job.status !== "processing") {
    return c.json({ error: "Only processing jobs can be reset" }, 400);
  }
  const updated = await prisma.job.update({
    where: { id },
    data: { status: "pending", processedAt: null },
  });
  return c.json(updated);
});

// API: Get job details
app.get("/api/jobs/:id", async (c) => {
  const jobId = parseInt(c.req.param("id"), 10);
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      conversation: true,
    },
  });
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }
  return c.json(job);
});

// ============ Conversation API ============

// Get conversations, optionally filtered by workspace with pagination
app.get("/api/conversations", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const limit = parseInt(c.req.query("limit") || "5", 10);
  const page = parseInt(c.req.query("page") || "1", 10);
  const includeArchived = c.req.query("includeArchived") === "true";
  const result = await getConversations(
    workspaceId ? parseInt(workspaceId, 10) : undefined,
    limit,
    page,
    includeArchived
  );
  return c.json(result);
});

// Create a new conversation
app.post("/api/conversations", async (c) => {
  const body = await c.req.json();

  let cwd = body.cwd;
  let worktreePath: string | undefined;
  let worktreeBranch: string | undefined;
  let workspaceId: number | undefined;

  // If workspace is provided, use its path
  if (body.workspaceId) {
    workspaceId = parseInt(body.workspaceId, 10);
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    // If worktree requested, create one
    if (body.useWorktree) {
      const branchName = body.branchName || `conv-${Date.now()}`;
      try {
        worktreePath = await createWorktree(workspace.path, branchName);
        worktreeBranch = branchName;
        cwd = worktreePath;
      } catch (error) {
        return c.json({
          error: `Failed to create worktree: ${error instanceof Error ? error.message : "Unknown error"}`
        }, 400);
      }
    } else {
      cwd = workspace.path;
    }
  }

  // Build query options if provided
  let queryOptions: string | undefined;
  if (body.additionalDirectories || body.allowedTools) {
    queryOptions = JSON.stringify({
      additionalDirectories: body.additionalDirectories,
      allowedTools: body.allowedTools,
    });
  }

  // Create conversation with workspace info
  const conversation = await prisma.conversation.create({
    data: {
      title: body.title,
      cwd,
      workspaceId,
      worktreePath,
      worktreeBranch,
      queryOptions,
    },
  });

  // If initial message provided, send it (with optional scheduling)
  if (body.message) {
    const scheduleOptions: { scheduledFor?: Date; cronExpression?: string; maxTurns?: number } = {};
    if (body.scheduledFor) {
      scheduleOptions.scheduledFor = new Date(body.scheduledFor);
    }
    if (body.cronExpression) {
      scheduleOptions.cronExpression = body.cronExpression;
    }
    if (body.maxTurns) {
      scheduleOptions.maxTurns = parseInt(body.maxTurns, 10);
    }
    await sendMessage(
      conversation.id,
      body.message,
      Object.keys(scheduleOptions).length > 0 ? scheduleOptions : undefined
    );
  }

  return c.json(conversation, 201);
});

// Get a conversation with messages
app.get("/api/conversations/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const conversation = await getConversation(id);

  if (!conversation) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  return c.json(conversation);
});

// Update conversation options
app.patch("/api/conversations/:id/options", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  const conversation = await getConversation(id);
  if (!conversation) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  // Parse existing options
  let existingOptions: Record<string, unknown> = {};
  if (conversation.queryOptions) {
    try {
      existingOptions = JSON.parse(conversation.queryOptions);
    } catch {
      // Ignore parse errors
    }
  }

  // Merge with new options
  const newOptions: Record<string, unknown> = { ...existingOptions };

  if (body.additionalDirectories !== undefined) {
    if (body.additionalDirectories === null || (Array.isArray(body.additionalDirectories) && body.additionalDirectories.length === 0)) {
      delete newOptions.additionalDirectories;
    } else {
      newOptions.additionalDirectories = body.additionalDirectories;
    }
  }

  if (body.allowedTools !== undefined) {
    if (body.allowedTools === null || (Array.isArray(body.allowedTools) && body.allowedTools.length === 0)) {
      delete newOptions.allowedTools;
    } else {
      newOptions.allowedTools = body.allowedTools;
    }
  }

  // Update the conversation
  const updated = await prisma.conversation.update({
    where: { id },
    data: {
      queryOptions: Object.keys(newOptions).length > 0 ? JSON.stringify(newOptions) : null,
    },
  });

  return c.json(updated);
});

// Update conversation title
app.patch("/api/conversations/:id/title", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  const conversation = await getConversation(id);
  if (!conversation) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: { title: body.title || null },
  });

  return c.json(updated);
});

// Send a message to a conversation (with optional scheduling)
app.post("/api/conversations/:id/messages", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  if (!body.message) {
    return c.json({ error: "Message is required" }, 400);
  }

  try {
    const scheduleOptions: { scheduledFor?: Date; cronExpression?: string; maxTurns?: number } = {};
    if (body.scheduledFor) {
      scheduleOptions.scheduledFor = new Date(body.scheduledFor);
    }
    if (body.cronExpression) {
      if (!isValidCronExpression(body.cronExpression)) {
        return c.json({ error: `Invalid cron expression: ${body.cronExpression}` }, 400);
      }
      scheduleOptions.cronExpression = body.cronExpression;
    }
    if (body.maxTurns) {
      scheduleOptions.maxTurns = parseInt(body.maxTurns, 10);
    }
    const job = await sendMessage(
      id,
      body.message,
      Object.keys(scheduleOptions).length > 0 ? scheduleOptions : undefined
    );
    return c.json({ job, message: "Message queued for processing" }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Archive a conversation
app.post("/api/conversations/:id/archive", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  try {
    const conversation = await archiveConversation(id);
    return c.json(conversation);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Unarchive a conversation
app.post("/api/conversations/:id/unarchive", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  try {
    const conversation = await unarchiveConversation(id);
    return c.json(conversation);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// ============ Workspace API ============

// Get all workspaces
app.get("/api/workspaces", async (c) => {
  const workspaces = await getWorkspaces();
  return c.json(workspaces);
});

// Create a new workspace
app.post("/api/workspaces", async (c) => {
  const body = await c.req.json();

  if (!body.name || !body.path) {
    return c.json({ error: "Name and path are required" }, 400);
  }

  try {
    const workspace = await createWorkspace(body.name, body.path);
    return c.json(workspace, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Get a workspace by ID
app.get("/api/workspaces/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const workspace = await getWorkspace(id);

  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json(workspace);
});

// Delete a workspace
app.delete("/api/workspaces/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);

  try {
    const workspace = await deleteWorkspace(id);
    return c.json(workspace);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// ============ Toolset API ============

// Get all toolsets
app.get("/api/toolsets", async (c) => {
  const toolsets = await prisma.toolset.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return c.json(toolsets);
});

// Create a new toolset
app.post("/api/toolsets", async (c) => {
  const body = await c.req.json();

  if (!body.name || !body.tools) {
    return c.json({ error: "Name and tools are required" }, 400);
  }

  if (!Array.isArray(body.tools) || body.tools.length === 0) {
    return c.json({ error: "Tools must be a non-empty array" }, 400);
  }

  try {
    // If this is set as default, unset other defaults first
    if (body.isDefault) {
      await prisma.toolset.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const toolset = await prisma.toolset.create({
      data: {
        name: body.name,
        tools: JSON.stringify(body.tools),
        isDefault: body.isDefault || false,
      },
    });
    return c.json(toolset, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Update a toolset
app.put("/api/toolsets/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  try {
    // If setting this as default, unset other defaults first
    if (body.isDefault) {
      await prisma.toolset.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const data: { name?: string; tools?: string; isDefault?: boolean } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.tools !== undefined) data.tools = JSON.stringify(body.tools);
    if (body.isDefault !== undefined) data.isDefault = body.isDefault;

    const toolset = await prisma.toolset.update({
      where: { id },
      data,
    });
    return c.json(toolset);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Delete a toolset
app.delete("/api/toolsets/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);

  try {
    const toolset = await prisma.toolset.delete({
      where: { id },
    });
    return c.json(toolset);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Set a toolset as default
app.post("/api/toolsets/:id/set-default", async (c) => {
  const id = parseInt(c.req.param("id"), 10);

  try {
    // Unset all defaults first
    await prisma.toolset.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });

    // Set this one as default
    const toolset = await prisma.toolset.update({
      where: { id },
      data: { isDefault: true },
    });
    return c.json(toolset);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// ============ Custom Tool API ============

// Get all custom tools
app.get("/api/custom-tools", async (c) => {
  const customTools = await prisma.customTool.findMany({
    orderBy: { name: "asc" },
  });
  return c.json(customTools);
});

// Create a custom tool
app.post("/api/custom-tools", async (c) => {
  const body = await c.req.json();

  if (!body.name) {
    return c.json({ error: "Name is required" }, 400);
  }

  try {
    const customTool = await prisma.customTool.create({
      data: {
        name: body.name,
        displayName: body.displayName || null,
        description: body.description || null,
      },
    });
    return c.json(customTool, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.includes("Unique constraint");
    return c.json({
      error: isDuplicate ? `A custom tool with name '${body.name}' already exists` : message
    }, 400);
  }
});

// Update a custom tool
app.put("/api/custom-tools/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  try {
    const data: { name?: string; displayName?: string | null; description?: string | null } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.displayName !== undefined) data.displayName = body.displayName || null;
    if (body.description !== undefined) data.description = body.description || null;

    const customTool = await prisma.customTool.update({
      where: { id },
      data,
    });
    return c.json(customTool);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Delete a custom tool
app.delete("/api/custom-tools/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);

  try {
    const customTool = await prisma.customTool.delete({
      where: { id },
    });
    return c.json(customTool);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// ============ Template API ============

// Get all templates
app.get("/api/templates", async (c) => {
  const templates = await prisma.conversationTemplate.findMany({
    orderBy: { name: "asc" },
    include: { workspace: true, toolset: true },
  });
  return c.json(templates);
});

// Get a single template
app.get("/api/templates/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);

  try {
    const template = await prisma.conversationTemplate.findUnique({
      where: { id },
      include: { workspace: true, toolset: true },
    });

    if (!template) {
      return c.json({ error: "Template not found" }, 404);
    }

    return c.json(template);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Create a new template
app.post("/api/templates", async (c) => {
  const body = await c.req.json();

  if (!body.name) {
    return c.json({ error: "Name is required" }, 400);
  }

  try {
    const template = await createTemplate({
      name: body.name,
      description: body.description,
      title: body.title,
      workspaceId: body.workspaceId,
      useWorktree: body.useWorktree || false,
      branchNamePattern: body.branchNamePattern,
      toolsetId: body.toolsetId,
      allowedTools: body.allowedTools,
      additionalDirectories: body.additionalDirectories,
      initialMessage: body.initialMessage,
      cronExpression: body.cronExpression,
    });
    return c.json(template, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Update a template
app.put("/api/templates/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  try {
    const template = await updateTemplate(id, {
      name: body.name,
      description: body.description,
      title: body.title,
      workspaceId: body.workspaceId,
      useWorktree: body.useWorktree,
      branchNamePattern: body.branchNamePattern,
      toolsetId: body.toolsetId,
      allowedTools: body.allowedTools,
      additionalDirectories: body.additionalDirectories,
      initialMessage: body.initialMessage,
      cronExpression: body.cronExpression,
    });
    return c.json(template);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// Delete a template
app.delete("/api/templates/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);

  try {
    const template = await deleteTemplate(id);
    return c.json(template);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

// ============ Server ============

const port = 4242;
console.log(`Queue Dashboard running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
