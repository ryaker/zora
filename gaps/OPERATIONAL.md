> **NOTE (2026-02-14):** Many gaps described in this document have been resolved.
> The authoritative status is in `gaps/wsjf-scores.json` — run `./gaps/tracker.sh stream`
> to see current state. Code descriptions below may reference old/stub implementations
> that have since been replaced with working code.

## 10. OPERATIONAL GAPS (5 gaps)

### Root Cause Analysis

**Problem:** The Zora framework cannot run as a production service due to incomplete operational infrastructure. CLI daemon commands are non-functional stubs, dashboard API endpoints return placeholder data instead of real system state, and the frontend UI has never been compiled. Additionally, critical resource management gaps (unbounded buffering in streaming providers) and observability gaps (no structured logging) prevent operational monitoring and debugging.

**Risk Profile:**
- **Immediate (S2):** Cannot start/stop system as daemon; dashboard shows no active jobs; UI never loads
- **Operational (S2):** Unbounded buffer in GeminiProvider consumes all RAM on extended sessions; scattered console.log calls prevent debugging
- **Production Impact:** Service cannot be deployed, monitored, or managed; complete operational blindness
- **Resource Leaks:** Streaming provider buffers accumulate indefinitely; no memory boundaries

---

#### OPS-01: CLI Daemon Commands Are Stubs

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** Yes
**Category:** SERVICE MANAGEMENT
**Files Affected:** 1
**Impact Level:** 5/5

**Description:**

The CLI daemon commands (start, stop, status) are non-functional stubs that cannot actually manage the Zora service as a daemon process:

```typescript
// Problematic code at src/cli/index.ts
case 'start':
  console.log('Starting Zora agent...');
  console.log('PID: 12345'); // Hardcoded, not actual process
  break;

case 'stop':
  console.log('Stopping Zora agent...');
  // No-op: does nothing
  break;

case 'status':
  console.log('Agent status: running'); // Simulated data
  console.log('Sessions: 2, Tasks: 5'); // Placeholder values
  break;
```

The implementation has critical deficiencies:

**Specific Failure Modes:**
- `start` command logs hardcoded PID 12345; no actual process spawned
- `stop` command does nothing; running processes not terminated
- `status` command returns simulated data; actual system state invisible
- No pidfile management; multiple instances can start simultaneously
- No signal handling (SIGTERM, SIGINT); process termination impossible
- Cannot integrate with systemd/init systems; service unmanageable

**Impact Assessment:**
- **Service Management:** CRITICAL - Cannot start/stop Zora as service
- **Production Readiness:** CRITICAL - No daemon process management
- **System Integration:** SEVERE - Cannot integrate with init systems or process managers
- **Operability:** Blocks R11, R12, R13 in roadmap (daemon service requirements)
- **Debugging:** No PID tracking; impossible to identify running processes

**Roadmap Blocking:**
- R11: Service daemon with graceful shutdown
- R12: Health check endpoints for monitoring
- R13: Process lifecycle management (reload config, etc.)

**Recommended Solution:**

1. **Implement proper daemon spawning for `start` command:**
   ```typescript
   case 'start': {
     // Check if already running
     const pidFile = '/var/run/zora.pid';
     if (fs.existsSync(pidFile)) {
       const existingPid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
       try {
         process.kill(existingPid, 0); // Check if process exists
         console.error('Zora is already running (PID: ' + existingPid + ')');
         process.exit(1);
       } catch (e) {
         // Process doesn't exist; remove stale pidfile
         fs.unlinkSync(pidFile);
       }
     }

     // Spawn daemon process
     const child = spawn('node', ['src/index.ts'], {
       detached: true,
       stdio: 'ignore'
     });

     // Write pidfile
     fs.writeFileSync(pidFile, String(child.pid));

     // Unref child so parent can exit
     child.unref();

     console.log('Zora started successfully (PID: ' + child.pid + ')');
     break;
   }
   ```

2. **Implement signal handling in main process for `stop` command:**
   ```typescript
   process.on('SIGTERM', () => {
     logger.info('SIGTERM received; shutting down gracefully');
     gracefulShutdown()
       .then(() => {
         logger.info('Shutdown complete');
         process.exit(0);
       })
       .catch((err) => {
         logger.error('Error during shutdown', err);
         process.exit(1);
       });
   });

   process.on('SIGINT', () => {
     logger.info('SIGINT received; shutting down gracefully');
     gracefulShutdown().catch(() => process.exit(1));
   });
   ```

3. **Implement real status checking:**
   ```typescript
   case 'status': {
     const pidFile = '/var/run/zora.pid';
     if (!fs.existsSync(pidFile)) {
       console.log('Zora is not running');
       process.exit(1);
     }

     const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
     try {
       process.kill(pid, 0); // Check if process exists
       console.log('Zora is running (PID: ' + pid + ')');

       // Query actual status from running process
       const status = await queryDaemonStatus(pid);
       console.log('Status:', status.state);
       console.log('Active sessions:', status.sessions);
       console.log('Uptime:', formatUptime(status.uptime));
     } catch (e) {
       console.error('Zora is not running (stale pidfile found)');
       fs.unlinkSync(pidFile);
       process.exit(1);
     }
     break;
   }
   ```

4. **Add pidfile and lifecycle management utilities:**
   - Create pidfile on startup
   - Validate pidfile on startup (remove stale files)
   - Remove pidfile on graceful shutdown
   - Implement process health checks via IPC or health endpoint
   - Add configuration reload via SIGHUP

5. **Integrate with systemd/init:**
   - Create systemd unit file for Zora service
   - Support for `systemctl start/stop/restart zora`
   - Automatic restart on failure
   - Proper logging integration

**Success Criteria:**
- `start` command spawns actual daemon process and writes pidfile
- `stop` command sends SIGTERM and waits for graceful shutdown
- `status` command reports accurate running state and active sessions
- Multiple start attempts prevented; stale pidfiles cleaned up
- Graceful shutdown completes within 30 seconds
- SIGTERM/SIGINT handled properly; database connections closed
- Process integrates with systemd unit file

**Verification:**
- Manual testing: start/stop/status work correctly
- PID tracking: pidfile accurate after start
- Graceful shutdown: all connections closed on SIGTERM
- Integration tests verify daemon lifecycle
- systemd integration verified on Linux

**Dependencies:**
- Unblocks OPS-02, OPS-03 (dashboard and frontend require running daemon)
- Enables R11, R12, R13 in roadmap

---

#### OPS-02: Dashboard `GET /api/jobs` Returns Empty Placeholder

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** Yes
**Category:** API IMPLEMENTATION
**Files Affected:** 1
**Impact Level:** 4/5

**Description:**

The dashboard API endpoint for listing active jobs returns a hardcoded empty array instead of querying actual system state:

```typescript
// Problematic code at src/dashboard/server.ts:116
app.get('/api/jobs', (req, res) => {
  // return a placeholder
  res.json({ jobs: [] });
});
```

This endpoint is critical for dashboard functionality but currently:

**Specific Failure Modes:**
- Always returns empty array regardless of actual active sessions
- Dashboard shows "No active jobs" even when jobs running
- No way to monitor active sessions from UI
- Frontend has no data to display; appears broken
- Cannot see job progress, status, or metrics
- Operations team cannot monitor system activity

**Impact Assessment:**
- **Dashboard Functionality:** CRITICAL - Core feature (active jobs) non-functional
- **Operational Visibility:** CRITICAL - No way to monitor what system is doing
- **User Feedback:** SEVERE - Dashboard appears broken; no data displayed
- **Monitoring:** SEVERE - Cannot check system state from UI
- **Blocking Roadmap:** Blocks R14 (operational dashboard)

**Roadmap Blocking:**
- R14: Operational dashboard with job monitoring

**Recommended Solution:**

1. **Query SessionManager for active sessions:**
   ```typescript
   app.get('/api/jobs', (req, res) => {
     try {
       const sessions = SessionManager.listSessions();

       const jobs = sessions.map(session => ({
         id: session.id,
         status: session.status, // running, paused, completed, failed
         progress: session.progress, // 0-100
         startTime: session.startTime,
         currentTask: session.currentTask,
         agentId: session.agentId,
         userId: session.userId,
         metrics: {
           tokensUsed: session.metrics.tokensUsed,
           completionTime: session.metrics.completionTime,
           errors: session.metrics.errors
         }
       }));

       res.json({
         jobs,
         timestamp: Date.now(),
         count: jobs.length
       });
     } catch (err) {
       logger.error('Error listing jobs', err);
       res.status(500).json({ error: 'Failed to list jobs' });
     }
   });
   ```

2. **Add additional endpoints for detailed job information:**
   ```typescript
   // Get specific job details
   app.get('/api/jobs/:jobId', (req, res) => {
     try {
       const job = SessionManager.getSession(req.params.jobId);
       if (!job) {
         return res.status(404).json({ error: 'Job not found' });
       }
       res.json(job);
     } catch (err) {
       res.status(500).json({ error: err.message });
     }
   });

   // Get job events/logs
   app.get('/api/jobs/:jobId/events', (req, res) => {
     try {
       const events = EventLog.getJobEvents(req.params.jobId);
       res.json({ events });
     } catch (err) {
       res.status(500).json({ error: err.message });
     }
   });
   ```

3. **Implement real-time updates via WebSocket:**
   - Clients can subscribe to job updates
   - Send events as jobs start, progress, complete
   - Live dashboard update without polling

4. **Add filtering and pagination:**
   ```typescript
   app.get('/api/jobs', (req, res) => {
     const status = req.query.status; // filter by status
     const limit = parseInt(req.query.limit) || 50; // pagination
     const offset = parseInt(req.query.offset) || 0;

     let jobs = SessionManager.listSessions();

     if (status) {
       jobs = jobs.filter(j => j.status === status);
     }

     const paginated = jobs.slice(offset, offset + limit);

     res.json({
       jobs: paginated,
       total: jobs.length,
       limit,
       offset
     });
   });
   ```

5. **Add metrics aggregation endpoint:**
   ```typescript
   app.get('/api/metrics', (req, res) => {
     const sessions = SessionManager.listSessions();
     const metrics = {
       totalSessions: sessions.length,
       activeSessions: sessions.filter(s => s.status === 'running').length,
       completedSessions: sessions.filter(s => s.status === 'completed').length,
       failedSessions: sessions.filter(s => s.status === 'failed').length,
       totalTokensUsed: sessions.reduce((sum, s) => sum + s.metrics.tokensUsed, 0),
       averageCompletionTime: calculateAverage(sessions.map(s => s.metrics.completionTime))
     };
     res.json(metrics);
   });
   ```

**Success Criteria:**
- `GET /api/jobs` returns actual active sessions from SessionManager
- Response includes job status, progress, timing, and metrics
- Filtered and paginated results supported
- Error handling returns appropriate HTTP status codes
- Dashboard UI updates properly with real data
- Performance: endpoint responds within 100ms

**Verification:**
- Unit tests verify SessionManager data reflected in response
- Integration tests verify endpoint with multiple active sessions
- Dashboard UI properly displays returned job data
- Response schema validated against API specification

**Dependencies:**
- Depends on OPS-01 (daemon must be running to have sessions)
- Unblocks dashboard functionality and R14 roadmap item

---

#### OPS-03: No Frontend Build Output

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** Yes
**Category:** BUILD SYSTEM
**Files Affected:** 1+ (all dashboard frontend files)
**Impact Level:** 4/5

**Description:**

The dashboard frontend React application exists in source form but has never been compiled to a production build. The expected output directory `/src/dashboard/frontend/dist/` is empty or missing:

```
/src/dashboard/frontend/
├── src/
│   ├── App.tsx
│   ├── components/
│   └── pages/
├── package.json
├── vite.config.ts
└── dist/  ← EMPTY - no compiled output
```

This prevents the dashboard UI from loading at all:

**Specific Failure Modes:**
- Dashboard server has no static files to serve
- Browser requests to `/` receive 404 or error
- React components never compiled to JavaScript
- Vite build process never run
- No CSS compilation; styles missing
- All frontend assets unavailable

**Impact Assessment:**
- **UI Accessibility:** CRITICAL - Dashboard UI never loads
- **User Experience:** CRITICAL - Operators cannot use dashboard
- **Deployment:** CRITICAL - Cannot serve dashboard in production
- **Development:** SEVERE - Frontend changes never deployed
- **Blocking Roadmap:** Blocks R15 (dashboard UI operational)

**Roadmap Blocking:**
- R15: Dashboard UI fully operational

**Recommended Solution:**

1. **Add postinstall script to build frontend automatically:**
   ```json
   // In package.json
   {
     "scripts": {
       "build": "npm run build:frontend && npm run build:backend",
       "build:frontend": "cd src/dashboard/frontend && npm install && npm run build",
       "build:backend": "tsc",
       "start": "node dist/src/cli/index.js",
       "dev": "ts-node src/cli/index.ts"
     }
   }
   ```

2. **Configure dashboard server to serve built frontend:**
   ```typescript
   // In src/dashboard/server.ts
   import path from 'path';
   import express from 'express';

   const app = express();

   // Serve static frontend files
   const distPath = path.join(__dirname, '../dashboard/frontend/dist');
   app.use(express.static(distPath));

   // API routes
   app.use('/api', apiRoutes);

   // Fallback to index.html for SPA routing
   app.get('*', (req, res) => {
     res.sendFile(path.join(distPath, 'index.html'));
   });
   ```

3. **Run build on first startup if dist missing:**
   ```typescript
   async function ensureFrontendBuilt() {
     const distPath = path.join(__dirname, '../dashboard/frontend/dist');

     if (!fs.existsSync(distPath)) {
       logger.info('Frontend build missing; building now...');
       await exec('npm run build:frontend', { cwd: __dirname });
       logger.info('Frontend build complete');
     }
   }

   // Call before starting server
   await ensureFrontendBuilt();
   startDashboardServer();
   ```

4. **Verify build output in CI/CD:**
   - Build frontend in CI pipeline
   - Verify dist/ directory has expected files (index.html, main.js, etc.)
   - Fail build if frontend compilation fails
   - Include frontend in deployment artifacts

5. **Add development hot reload:**
   ```typescript
   // In development mode, proxy to Vite dev server
   if (process.env.NODE_ENV === 'development') {
     const { createProxyMiddleware } = require('http-proxy-middleware');
     app.use('/', createProxyMiddleware({
       target: 'http://localhost:5173', // Vite dev server
       changeOrigin: true,
       ws: true
     }));
   }
   ```

**Success Criteria:**
- `npm run build` compiles frontend and backend successfully
- `/src/dashboard/frontend/dist/` contains compiled React app
- index.html, main.js, and CSS files present in dist/
- Dashboard server serves static files correctly
- Browser can load dashboard UI
- React components render without errors
- API calls from frontend work correctly

**Verification:**
- Manual build: `npm run build` succeeds
- Static files accessible: curl http://localhost:3000/
- Dashboard UI renders: browser shows dashboard page
- CI/CD verifies frontend compilation
- Deployment includes frontend build artifacts

**Dependencies:**
- Depends on OPS-02 (API endpoints must be working)
- Unblocks R15 and complete dashboard functionality

---

#### OPS-04: GeminiProvider Unbounded Buffer

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** No
**Category:** RESOURCE MANAGEMENT
**Files Affected:** 1
**Impact Level:** 3/5

**Description:**

The GeminiProvider accumulates streaming output in a buffer without size limits, causing runaway memory consumption on extended or high-volume sessions:

```typescript
// Problematic code at src/providers/gemini-provider.ts:149
private buffer = '';

async onStreamChunk(chunk: string) {
  this.buffer += chunk; // Buffer grows indefinitely
  // Process and accumulate...
}
```

This implementation has critical resource management deficiencies:

**Specific Failure Modes:**
- Buffer accumulates all streaming output without limit
- Long conversations or high-volume output exhaust RAM
- No truncation or cleanup mechanism
- Memory usage grows proportionally with session duration
- System eventually runs out of memory; crashes or freezes
- Particularly severe with verbose providers or large tool outputs

**Impact Assessment:**
- **Resource Leaks:** CRITICAL - Unbounded memory growth
- **Availability:** CRITICAL - System crashes under sustained load
- **Production Readiness:** CRITICAL - Cannot handle extended sessions
- **Operational Impact:** SEVERE - Requires manual restart/cleanup
- **Blocking Roadmap:** Blocks R28 (production resource management)

**Roadmap Blocking:**
- R28: Production resource management and monitoring

**Recommended Solution:**

1. **Implement 50MB buffer cap with truncation:**
   ```typescript
   private buffer = '';
   private readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB
   private bufferTruncated = false;

   async onStreamChunk(chunk: string) {
     this.buffer += chunk;

     if (this.buffer.length > this.MAX_BUFFER_SIZE) {
       if (!this.bufferTruncated) {
         logger.warn('GeminiProvider buffer exceeding limit; truncating', {
           currentSize: this.buffer.length,
           limit: this.MAX_BUFFER_SIZE,
           provider: 'gemini'
         });
         this.bufferTruncated = true;
       }

       // Keep most recent MAX_BUFFER_SIZE bytes
       const excess = this.buffer.length - this.MAX_BUFFER_SIZE;
       this.buffer = this.buffer.slice(excess);

       // Emit warning event
       this.emit('warning', {
         type: 'buffer_truncated',
         size: excess,
         message: 'Output buffer truncated; excess data discarded'
       });
     }

     // Process chunk...
     this.processChunk(chunk);
   }
   ```

2. **Add buffer metrics and monitoring:**
   ```typescript
   getBufferMetrics() {
     return {
       currentSize: this.buffer.length,
       maxSize: this.MAX_BUFFER_SIZE,
       utilizationPercent: (this.buffer.length / this.MAX_BUFFER_SIZE) * 100,
       truncated: this.bufferTruncated,
       chunks: this.chunkCount,
       timestamp: Date.now()
     };
   }

   // Emit metrics periodically
   setInterval(() => {
     const metrics = this.getBufferMetrics();
     if (metrics.utilizationPercent > 80) {
       logger.warn('GeminiProvider buffer utilization high', metrics);
     }
   }, 30000); // Every 30 seconds
   ```

3. **Implement buffer cleanup on completion:**
   ```typescript
   async complete() {
     const finalSize = this.buffer.length;
     this.buffer = ''; // Clear buffer
     this.bufferTruncated = false;

     logger.info('GeminiProvider session complete; buffer cleared', {
       finalSize,
       truncated: this.bufferTruncated
     });
   }
   ```

4. **Add configuration for buffer limits:**
   ```typescript
   interface ProviderConfig {
     maxBufferSize?: number; // Bytes
     bufferTruncationPolicy?: 'discard' | 'spillToDisk';
   }

   // Allow operators to tune limits per environment
   const config = {
     maxBufferSize: process.env.PROVIDER_MAX_BUFFER || 50 * 1024 * 1024,
     bufferTruncationPolicy: 'discard' // or 'spillToDisk' for temp storage
   };
   ```

5. **Consider spill-to-disk for large outputs:**
   ```typescript
   async onStreamChunk(chunk: string) {
     // Attempt to add to buffer
     if (this.buffer.length + chunk.length > this.MAX_BUFFER_SIZE) {
       // Spill to temp file instead of discarding
       if (!this.tempFile) {
         this.tempFile = fs.createWriteStream(
           path.join(os.tmpdir(), `zora-buffer-${this.sessionId}.tmp`)
         );
       }
       this.tempFile.write(chunk);
     } else {
       this.buffer += chunk;
     }
   }
   ```

**Success Criteria:**
- Buffer size capped at 50MB maximum
- Truncation warning logged when limit exceeded
- Metrics endpoint reports buffer utilization
- Extended sessions do not consume unlimited memory
- No crashes due to buffer exhaustion
- Operations can monitor buffer health

**Verification:**
- Unit tests verify buffer truncation at limit
- Load testing with extended sessions confirms bounded memory
- Metrics show 0% memory growth after limit reached
- Warning events emitted correctly on truncation
- No data corruption from truncation

**Dependencies:**
- Independent of other gaps; can be fixed immediately
- Enables R28 (production resource management)

---

#### OPS-05: No Structured Logging

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** No
**Category:** OBSERVABILITY
**Files Affected:** 36+ (distributed console.log calls)
**Impact Level:** 3/5

**Description:**

The Zora codebase contains 136 scattered `console.log` calls with inconsistent formatting, preventing structured observability and making debugging and monitoring extremely difficult:

```typescript
// Examples of inconsistent logging scattered throughout codebase
console.log('Agent started'); // No timestamp
console.log(`Processing: ${task}`); // Inline data, hard to parse
console.error('Error:', err); // Unstructured error format
console.warn('Warning'); // No context
// No trace IDs, no request IDs, no structured fields
```

This implementation has critical observability deficiencies:

**Specific Failure Modes:**
- No timestamp on console output; cannot correlate with events
- No structured fields; logs hard to parse and search
- No log levels consistently applied
- No trace IDs for request tracking across components
- No correlation with metrics or alarms
- Console output lost when redirected or piped
- Impossible to debug production issues with only console.log
- No log rotation or storage; logs fill up disk or disappear

**Impact Assessment:**
- **Operability:** CRITICAL - Cannot debug production issues
- **Monitoring:** CRITICAL - No structured logs for alerting/dashboards
- **Security:** SEVERE - No audit trail or security event tracking
- **Compliance:** SEVERE - Cannot meet audit logging requirements
- **Troubleshooting:** SEVERE - Production support blind without logs
- **Blocking Roadmap:** Blocks R23 (operational observability)

**Roadmap Blocking:**
- R23: Production operational observability and monitoring

**Recommended Solution:**

1. **Implement structured JSON logger (pino or winston):**
   ```typescript
   // Create logger utility
   // src/utils/logger.ts
   import pino from 'pino';
   import path from 'path';

   const logger = pino({
     level: process.env.LOG_LEVEL || 'info',
     transport: {
       target: 'pino-pretty',
       options: {
         colorize: true,
         translateTime: 'SYS:standard',
         singleLine: false
       }
     },
     timestamp: pino.stdTimeFunctions.isoTime
   });

   // In production, add file rotation
   if (process.env.NODE_ENV === 'production') {
     const transport = pino.transport({
       targets: [
         {
           level: 'info',
           target: 'pino/file',
           options: { destination: '/var/log/zora/app.log' }
         },
         {
           level: 'error',
           target: 'pino/file',
           options: { destination: '/var/log/zora/error.log' }
         }
       ]
     });
     logger.addTransport(transport);
   }

   export { logger };
   ```

2. **Replace all console.log calls with structured logging:**
   ```typescript
   // Before
   console.log('Processing task:', task.id);
   console.error('Error processing task:', err);

   // After
   logger.info({ taskId: task.id }, 'Processing task');
   logger.error({
     taskId: task.id,
     error: err.message,
     stack: err.stack
   }, 'Error processing task');
   ```

3. **Add request/trace ID propagation:**
   ```typescript
   // Create middleware for request tracking
   import { v4 as uuidv4 } from 'uuid';

   app.use((req, res, next) => {
     req.id = req.headers['x-request-id'] || uuidv4();
     req.logger = logger.child({ requestId: req.id });
     next();
   });

   // Use in all handlers
   app.get('/api/jobs', (req, res) => {
     req.logger.info('Fetching jobs list');
     const jobs = JobManager.list();
     req.logger.info({ jobCount: jobs.length }, 'Jobs fetched successfully');
     res.json(jobs);
   });
   ```

4. **Implement structured context logging:**
   ```typescript
   // Log events with consistent structure
   logger.info({
     event: 'session_started',
     sessionId: session.id,
     userId: session.userId,
     timestamp: Date.now(),
     metadata: {
       provider: 'gemini',
       model: 'gemini-pro',
       maxTokens: 4096
     }
   }, 'Session initialized');

   logger.error({
     event: 'provider_error',
     sessionId: session.id,
     provider: 'gemini',
     error: err.message,
     errorCode: err.code,
     retryCount: retryAttempt,
     timestamp: Date.now()
   }, 'Provider invocation failed');
   ```

5. **Add log levels and filtering:**
   ```typescript
   // Use appropriate log levels
   logger.trace({ details }, 'Detailed trace information');
   logger.debug({ debugInfo }, 'Debug-level information');
   logger.info({ event }, 'Informational message');
   logger.warn({ issue }, 'Warning condition');
   logger.error({ error }, 'Error condition');
   logger.fatal({ critical }, 'Fatal error requiring shutdown');

   // Filter by level in different environments
   // Development: DEBUG+
   // Staging: INFO+
   // Production: WARN+
   ```

6. **Add performance/metrics logging:**
   ```typescript
   const start = Date.now();
   const result = await provider.invoke(request);
   const duration = Date.now() - start;

   logger.info({
     event: 'provider_invocation_complete',
     provider: 'gemini',
     duration,
     tokensUsed: result.tokens,
     success: true,
     durationExceeded: duration > 5000 ? 'yes' : 'no'
   }, 'Provider invocation completed');
   ```

7. **Set up log aggregation in production:**
   - Centralized log collection (ELK, Splunk, CloudWatch)
   - Log retention policies
   - Automated alerts on error patterns
   - Dashboard for log searching and analysis

**Success Criteria:**
- All 136 console.log calls replaced with structured logger
- Structured JSON format with timestamp, level, and context
- Request/trace ID propagation through entire stack
- Log rotation and retention configured
- Error events include stack traces and context
- Performance metrics logged for monitoring
- Zero console.log in production code

**Verification:**
- Code audit confirms no raw console.log calls (only logger.*)
- Integration tests verify structured log format
- Logs can be parsed and searched programmatically
- Metrics dashboard displays log-based statistics
- Compliance audit confirms audit trail completeness
- Production logs demonstrate structured format

**Dependencies:**
- Independent of other gaps; can be fixed immediately
- Enables R23 (operational observability)

---

### Summary Table: Operational Gaps

| Gap ID | Issue | Risk Level | Effort | Blocking | Priority |
|--------|-------|-----------|--------|----------|----------|
| **OPS-01** | CLI Daemon Commands Are Stubs | Service management | 3h | Yes | P0 |
| **OPS-02** | Dashboard `GET /api/jobs` Returns Empty Placeholder | Observability | 2h | Yes | P0 |
| **OPS-03** | No Frontend Build Output | UI delivery | 1h | Yes | P0 |
| **OPS-04** | GeminiProvider Unbounded Buffer | Resource leak | 1h | No | P1 |
| **OPS-05** | No Structured Logging | Observability | 3h | No | P1 |

**Total Effort:** 10 hours
**Critical Path (P0):** 6 hours (OPS-01, OPS-02, OPS-03)
**Production Blockers:** 3 gaps (OPS-01, OPS-02, OPS-03)

**Parallelization:** OPS-01, OPS-02, OPS-03 can be worked in parallel; OPS-02 requires OPS-01 for actual session data; OPS-04 and OPS-05 independent of others

---

