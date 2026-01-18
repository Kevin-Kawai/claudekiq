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
} from "./queue";
import {
  getRegisteredJobs,
  SendEmailJob,
  SendWelcomeEmailJob,
  GenerateReportJob,
  ExportDataJob,
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
        .refresh-info { font-size: 12px; color: #9ca3af; }
        .cron-badge { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; }
        .schedule-info { font-size: 12px; color: #6b7280; }
        .schedule-info small { color: #9ca3af; }
        .add-job-btn.schedule { background: #8b5cf6; }
        .add-job-btn.schedule:hover { background: #7c3aed; }
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
              '</tr>';
            }).join('');
          } catch (e) {
            console.error('Failed to fetch jobs:', e);
          }
        }

        async function addJob(jobClass) {
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

        // Initial fetch
        fetchStats();
        fetchJobs();

        // Poll every 1 second
        setInterval(function() {
          fetchStats();
          fetchJobs();
        }, 1000);
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
        </tr>
      </thead>
      <tbody id="jobs-tbody">
        <tr><td colSpan={8} class="empty-state">Loading...</td></tr>
      </tbody>
    </table>
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

const Dashboard: FC = () => (
  <Layout>
    <h1>Queue Dashboard</h1>
    <QueueStats />
    <JobList />
    <ScheduleModal />
  </Layout>
);

// ============ Routes ============

// Dashboard page
app.get("/", (c) => {
  return c.html(<Dashboard />);
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

// ============ Server ============

const port = 3001;
console.log(`Queue Dashboard running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
