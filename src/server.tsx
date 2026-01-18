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
        .refresh-info { font-size: 12px; color: #9ca3af; }
        .cron-badge { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; }
        .schedule-info { font-size: 12px; color: #6b7280; }
        .schedule-info small { color: #9ca3af; }
        .conversations-section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .conversations-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .conversations-list { padding: 0; }
        .conversation-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background 0.15s; }
        .conversation-item:hover { background: #f9fafb; }
        .conversation-item:last-child { border-bottom: none; }
        .conversation-info { flex: 1; }
        .conversation-title { font-weight: 500; margin-bottom: 4px; }
        .conversation-preview { font-size: 13px; color: #6b7280; max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .conversation-meta { font-size: 12px; color: #9ca3af; display: flex; gap: 12px; }
        .conversation-status { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
        .conversation-status.active { background: #d1fae5; color: #065f46; }
        .conversation-status.closed { background: #e5e7eb; color: #374151; }
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
        .form-group input[type="checkbox"] { width: auto; margin-right: 8px; }
        .checkbox-label { display: flex; align-items: center; cursor: pointer; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100; }
        .modal.active { display: flex; justify-content: center; align-items: center; }
        .modal-content { background: white; padding: 24px; border-radius: 12px; max-width: 500px; width: 90%; }
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

        async function fetchJobs() {
          try {
            const res = await fetch('/api/jobs');
            const jobs = await res.json();
            const tbody = document.getElementById('jobs-tbody');

            if (jobs.length === 0) {
              tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No jobs in queue</td></tr>';
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
              return '<tr>' +
                '<td>' + job.id + '</td>' +
                '<td><span class="job-class">' + jobClass + '</span></td>' +
                '<td><span class="status-badge status-' + job.status + '">' + job.status + '</span></td>' +
                '<td class="schedule-info">' + scheduleInfo + '</td>' +
                '<td class="args" title="' + argsStr.replace(/"/g, '&quot;') + '">' + argsStr + '</td>' +
                '<td>' + job.attempts + '/' + job.maxAttempts + '</td>' +
                '<td class="timestamp">' + created + '</td>' +
                '<td class="error-text" title="' + (job.error || '') + '">' + (job.error || '-') + '</td>' +
                '<td><a href="/jobs/' + job.id + '" class="view-link">View</a></td>' +
              '</tr>';
            }).join('');
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

        // ============ Conversations ============
        var selectedWorkspaceId = null;

        function onConversationWorkspaceChange() {
          var select = document.getElementById('conversation-workspace-filter');
          selectedWorkspaceId = select.value ? parseInt(select.value) : null;
          fetchConversations();
        }

        async function fetchConversations() {
          var container = document.getElementById('conversations-list');

          if (!selectedWorkspaceId) {
            container.innerHTML = '<div class="empty-state">Select a workspace to view conversations</div>';
            return;
          }

          try {
            var res = await fetch('/api/conversations?workspaceId=' + selectedWorkspaceId);
            var conversations = await res.json();

            if (conversations.length === 0) {
              container.innerHTML = '<div class="empty-state">No conversations in this workspace. Start one!</div>';
              return;
            }

            container.innerHTML = conversations.map(function(conv) {
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

              return '<div class="conversation-item" onclick="window.location.href=\\'/conversations/' + conv.id + '\\'">' +
                '<div class="conversation-info">' +
                  '<div class="conversation-title">' + escapeHtml(title) + ' ' + branchBadge + '</div>' +
                  '<div class="conversation-preview">' + escapeHtml(preview) + '</div>' +
                '</div>' +
                '<div class="conversation-meta">' +
                  '<span>' + msgCount + ' messages</span>' +
                  '<span>' + date + '</span>' +
                  '<span class="conversation-status ' + conv.status + '">' + conv.status + '</span>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (e) {
            console.error('Failed to fetch conversations:', e);
          }
        }

        function updateConversationWorkspaceFilter() {
          var select = document.getElementById('conversation-workspace-filter');
          var currentValue = select.value;
          select.innerHTML = '<option value="">-- Select workspace --</option>';
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
        fetchWorkspaces().then(function() {
          fetchConversations();
        });

        // Poll every 2 seconds
        setInterval(function() {
          fetchStats();
          fetchJobs();
          if (selectedWorkspaceId) {
            fetchConversations();
          }
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
      <div class="job-buttons">
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

const NewConversationModal: FC = () => (
  <div id="new-conversation-modal" class="modal" onclick="if(event.target===this)closeNewConversationModal()">
    <div class="modal-content">
      <h3>New Conversation</h3>
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
    <ConversationsList />
    <JobList />
    <ScheduleModal />
    <ClaudePromptModal />
    <NewConversationModal />
    <NewWorkspaceModal />
  </Layout>
);

const JobDetailsPage: FC<{ jobId: string }> = ({ jobId }) => (
  <html>
    <head>
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
        .no-session { color: #666; font-style: italic; }
        .loading { text-align: center; padding: 40px; color: #666; }
        .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
      `}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <a href="/" class="back-link">← Back to Dashboard</a>
          <h1>Job #{jobId}</h1>
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
          html += '</div></div>';

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

        // Handle Enter key in textarea (Shift+Enter for newline)
        document.addEventListener('keydown', function(e) {
          if (e.target.id === 'follow-up-input' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendFollowUp();
          }
        });

        fetchJobDetails();

        // Auto-refresh every 5 seconds if job is processing
        setInterval(function() {
          var statusEl = document.querySelector('.status-processing');
          if (statusEl) {
            fetchJobDetails();
          }
        }, 5000);
      </script>`)}
    </body>
  </html>
);

const ConversationDetailPage: FC<{ conversationId: string }> = ({ conversationId }) => (
  <html>
    <head>
      <title>Conversation #{conversationId}</title>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
        .header h1 { font-size: 24px; }
        .back-link { color: #666; text-decoration: none; }
        .back-link:hover { color: #333; }
        .conv-info { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .conv-info h2 { margin-bottom: 15px; font-size: 18px; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }
        .info-item { }
        .info-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .info-value { font-size: 14px; font-weight: 500; }
        .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
        .status-active { background: #d1fae5; color: #065f46; }
        .status-closed { background: #e5e7eb; color: #374151; }
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
        .tool-use { background: #f0f0f0; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px; }
        .tool-name { font-weight: 600; color: #1976d2; }
        .follow-up { display: flex; gap: 10px; }
        .follow-up textarea { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; resize: vertical; min-height: 60px; font-family: inherit; font-size: 14px; }
        .follow-up button { padding: 10px 20px; background: #1976d2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
        .follow-up button:hover { background: #1565c0; }
        .follow-up button:disabled { background: #ccc; cursor: not-allowed; }
        .loading { text-align: center; padding: 40px; color: #666; }
        .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .processing-indicator { background: #fff3cd; color: #856404; padding: 10px 15px; border-radius: 8px; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; }
        .processing-indicator .spinner { width: 16px; height: 16px; border: 2px solid #856404; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .follow-up-container { margin-top: 10px; }
        .schedule-options { margin-top: 10px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
        .schedule-options .form-group { margin-bottom: 10px; }
        .schedule-options .form-group:last-child { margin-bottom: 0; }
        .schedule-options label { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 500; color: #374151; }
        .schedule-options input, .schedule-options select { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }
        .schedule-options small { color: #6b7280; font-size: 11px; }
        .checkbox-label { display: flex; align-items: center; cursor: pointer; font-size: 13px; color: #374151; }
        .checkbox-label input { width: auto; margin-right: 8px; }
      `}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <a href="/" class="back-link">← Back to Dashboard</a>
          <h1>Conversation #{conversationId}</h1>
        </div>
        <div id="conversation-details">
          <div class="loading">Loading conversation...</div>
        </div>
      </div>
      {raw(`<script>
        const conversationId = ${conversationId};

        var lastMessageCount = 0;

        async function fetchConversation() {
          try {
            // Check if user is interacting with scheduling form - if so, skip full re-render
            var activeEl = document.activeElement;
            var isInteractingWithSchedule = activeEl && (
              activeEl.id === 'msg-schedule-type' ||
              activeEl.id === 'msg-scheduled-for' ||
              activeEl.id === 'msg-cron' ||
              activeEl.id === 'msg-schedule-checkbox'
            );

            // Preserve input value before re-render
            var inputEl = document.getElementById('follow-up-input');
            var savedInput = inputEl ? inputEl.value : '';
            var wasFocused = inputEl && activeEl === inputEl;

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

            const res = await fetch('/api/conversations/' + conversationId);
            if (!res.ok) throw new Error('Conversation not found');
            const conv = await res.json();
            var newMessageCount = conv.messages ? conv.messages.length : 0;

            // If user is interacting with scheduling form, only update messages
            if (isInteractingWithSchedule && messagesEl) {
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
              if (newMessageCount > lastMessageCount) {
                messagesEl.scrollTop = messagesEl.scrollHeight;
              }
              lastMessageCount = newMessageCount;
              return;
            }

            renderConversation(conv);

            // Restore scroll position
            var newMessagesEl = document.getElementById('messages');
            if (newMessagesEl) {
              if (newMessageCount > lastMessageCount || wasAtBottom) {
                // New messages or was at bottom - scroll to bottom
                newMessagesEl.scrollTop = newMessagesEl.scrollHeight;
              } else {
                // Preserve scroll position
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
                // Restore cursor to end
                newInputEl.selectionStart = newInputEl.selectionEnd = savedInput.length;
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
          } catch (e) {
            document.getElementById('conversation-details').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
          }
        }

        function renderConversation(conv) {
          const hasActiveJob = conv.jobs && conv.jobs.some(j => j.status === 'processing' || j.status === 'pending');

          let html = '<div class="conv-info"><h2>Conversation Info</h2><div class="info-grid">';
          html += '<div class="info-item"><div class="info-label">Status</div><div class="info-value"><span class="status status-' + conv.status + '">' + conv.status + '</span></div></div>';
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
          html += '</div></div>';

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
            await fetchConversation();
          } catch (e) {
            alert('Error: ' + e.message);
            btn.disabled = false;
            btn.textContent = 'Send';
            input.disabled = false;
          }
        }

        document.addEventListener('keydown', function(e) {
          if (e.target.id === 'follow-up-input' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });

        fetchConversation();
        setInterval(fetchConversation, 3000);
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

// API: Get list of recent jobs
app.get("/api/jobs", async (c) => {
  const queue = c.req.query("queue") || "default";
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const jobs = await getJobs(queue, limit);
  return c.json(jobs);
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

// Get conversations, optionally filtered by workspace
app.get("/api/conversations", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const conversations = await getConversations(
    workspaceId ? parseInt(workspaceId, 10) : undefined
  );
  return c.json(conversations);
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

  // Create conversation with workspace info
  const conversation = await prisma.conversation.create({
    data: {
      title: body.title,
      cwd,
      workspaceId,
      worktreePath,
      worktreeBranch,
    },
  });

  // If initial message provided, send it (with optional scheduling)
  if (body.message) {
    const scheduleOptions: { scheduledFor?: Date; cronExpression?: string } = {};
    if (body.scheduledFor) {
      scheduleOptions.scheduledFor = new Date(body.scheduledFor);
    }
    if (body.cronExpression) {
      scheduleOptions.cronExpression = body.cronExpression;
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

// Send a message to a conversation (with optional scheduling)
app.post("/api/conversations/:id/messages", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  if (!body.message) {
    return c.json({ error: "Message is required" }, 400);
  }

  try {
    const scheduleOptions: { scheduledFor?: Date; cronExpression?: string } = {};
    if (body.scheduledFor) {
      scheduleOptions.scheduledFor = new Date(body.scheduledFor);
    }
    if (body.cronExpression) {
      if (!isValidCronExpression(body.cronExpression)) {
        return c.json({ error: `Invalid cron expression: ${body.cronExpression}` }, 400);
      }
      scheduleOptions.cronExpression = body.cronExpression;
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

// ============ Server ============

const port = 3001;
console.log(`Queue Dashboard running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
