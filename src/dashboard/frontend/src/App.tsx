import React, { useState, useEffect, useRef } from 'react';
import { Activity, Shield, Terminal, Zap, Send, Info, Rocket, AlertTriangle, Copy, Check, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface ProviderStatus {
  name: string;
  valid: boolean;
  expiresAt: string | null;
  canAutoRefresh: boolean;
}

interface JobStatus {
  jobId: string;
  eventCount: number;
  lastActivity: string | null;
  status: string;
}

interface LogEntry {
  id: number;
  message: string;
}

interface SystemInfo {
  uptime: number;
  memory: { used: number; total: number };
  activeJobs: number;
  totalJobs: number;
}

const ZORA_VERSION = 'v0.9.0';
const MAX_LOGS = 100;
let logIdCounter = 0;

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

const SETUP_PROMPT = `I want to set up Zora, an autonomous AI agent for my computer. Please walk me through the setup step by step:

1. Check if I have Node.js 20+ installed
2. Install Zora: npm install -g zora
3. Run: zora init
4. Help me choose a security preset (Safe, Balanced, or Power)
5. Verify setup with: zora doctor

Ask me one question at a time and wait for my response before moving on.`;

const SetupNeededPanel: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_PROMPT);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg text-center"
      >
        <AlertTriangle size={48} className="text-zora-amber mx-auto mb-4" />
        <h2 className="text-2xl font-tactical text-zora-amber mb-4 uppercase tracking-wider">
          Zora needs setup
        </h2>
        <p className="text-white/70 font-data text-sm mb-6">
          Run <code className="text-zora-cyan bg-black/40 px-2 py-0.5">zora init</code> in your
          terminal to configure AI providers.
        </p>
        <div className="lcars-panel border-zora-cyan text-left mb-6">
          <p className="text-white/60 font-data text-xs mb-3">
            Or use our AI Setup Assistant — paste this prompt into ChatGPT, Claude, or Gemini:
          </p>
          <div className="bg-black/60 p-3 font-data text-xs text-zora-cyan mb-3 max-h-24 overflow-y-auto">
            {SETUP_PROMPT}
          </div>
          <button
            onClick={handleCopy}
            className="bg-zora-cyan text-black px-4 py-2 font-bold text-xs uppercase flex items-center gap-2 hover:bg-white transition-colors"
          >
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy Setup Prompt</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const WelcomePanel: React.FC = () => (
  <div className="flex-1 flex items-center justify-center">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg text-center"
    >
      <Rocket size={48} className="text-zora-cyan mx-auto mb-4" />
      <h2 className="text-2xl font-tactical text-zora-cyan mb-4 uppercase tracking-wider">
        Welcome to Zora
      </h2>
      <p className="text-white/70 font-data text-sm mb-6">
        Your AI agent is running and ready for tasks.
      </p>
      <div className="lcars-panel border-zora-amber text-left mb-6">
        <p className="text-zora-amber font-bold text-xs uppercase mb-3">Quick start</p>
        <div className="space-y-2 font-data text-xs text-white/60">
          <div className="bg-black/40 px-3 py-2">
            <code className="text-zora-cyan">zora ask "summarize the files in ~/Projects"</code>
          </div>
          <div className="bg-black/40 px-3 py-2">
            <code className="text-zora-cyan">zora ask "review my latest git commit"</code>
          </div>
          <div className="bg-black/40 px-3 py-2">
            <code className="text-zora-cyan">zora ask "find all TODO comments in this repo"</code>
          </div>
        </div>
      </div>
      <p className="text-white/40 font-data text-xs">
        Run a task from your terminal, then come back here to monitor progress.
      </p>
    </motion.div>
  </div>
);

const App: React.FC = () => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [steerMsg, setSteerMsg] = useState('');
  const [selectedJob, setSelectedJob] = useState('job_active');
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: ++logIdCounter, message: 'Zora is running.' },
    { id: ++logIdCounter, message: 'Waiting for tasks...' },
  ]);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await axios.get('/api/health');
        if (res.data.ok) setProviders(res.data.providers);
      } catch (err) {
        console.error('Health check failed', err);
        setFetchError(true);
      } finally {
        setHealthLoaded(true);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const res = await axios.get('/api/jobs');
        if (res.data.jobs) {
          setJobs(res.data.jobs);
          setSelectedJob(prev => (prev === 'job_active' && res.data.jobs.length > 0) ? res.data.jobs[0].jobId : prev);
        }
      } catch (err) {
        console.error('Jobs fetch failed', err);
        setFetchError(true);
      } finally {
        setJobsLoaded(true);
      }
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 15000);
    return () => clearInterval(interval);
  }, []);

  // SSE event stream for real-time activity feed
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') return;

        let message: string;
        switch (data.type) {
          case 'thinking':
            message = 'Agent is thinking...';
            break;
          case 'text':
            message = typeof data.data === 'object' && data.data?.text
              ? `Agent: ${data.data.text.slice(0, 200)}`
              : 'Agent response received';
            break;
          case 'tool_call':
            message = typeof data.data === 'object' && data.data?.name
              ? `Tool call: ${data.data.name}`
              : 'Tool invoked';
            break;
          case 'tool_result':
            message = 'Tool result received';
            break;
          case 'error':
            message = typeof data.data === 'object' && data.data?.message
              ? `Error: ${data.data.message}`
              : 'An error occurred';
            break;
          case 'done':
            message = 'Task completed';
            break;
          case 'steering':
            message = typeof data.data === 'object' && data.data?.message
              ? `Steering: ${data.data.message}`
              : 'Steering message received';
            break;
          case 'job_failed':
            message = typeof data.data === 'object' && data.data?.error
              ? `Job failed: ${data.data.error}`
              : 'Job failed';
            break;
          default:
            message = `Event: ${data.type}`;
        }

        setLogs(prev => [
          { id: ++logIdCounter, message },
          ...prev,
        ].slice(0, MAX_LOGS));

        // Refresh jobs list on completion/failure
        if (data.type === 'done' || data.type === 'job_failed') {
          axios.get('/api/jobs').then(res => {
            if (res.data.jobs) setJobs(res.data.jobs);
          }).catch((err) => {
            console.warn('[Dashboard] Failed to refresh jobs list:', err?.message ?? err);
          });
        }
      } catch {
        // Malformed SSE data — ignore
      }
    };

    eventSource.onerror = () => {
      console.warn('SSE connection lost, reconnecting...');
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // System info from server-side process metrics
  useEffect(() => {
    const fetchSystem = async () => {
      try {
        const res = await axios.get('/api/system');
        setSystem({
          ...res.data,
          activeJobs: jobs.filter(j => j.status === 'running' || j.status === 'active').length,
          totalJobs: jobs.length,
        });
      } catch {
        setSystem({
          uptime: 0,
          memory: { used: 0, total: 0 },
          activeJobs: jobs.filter(j => j.status === 'running' || j.status === 'active').length,
          totalJobs: jobs.length,
        });
      }
    };
    fetchSystem();
    const interval = setInterval(fetchSystem, 5000);
    return () => clearInterval(interval);
  }, [jobs]);

  const handleSteer = async () => {
    if (!steerMsg) return;
    try {
      await axios.post('/api/steer', {
        jobId: selectedJob,
        message: steerMsg,
        author: 'operator',
        source: 'dashboard'
      });
      setLogs(prev => [{ id: ++logIdCounter, message: `Message sent: ${steerMsg}` }, ...prev].slice(0, MAX_LOGS));
      setSteerMsg('');
    } catch (err) {
      console.error('Steering message failed', err);
      setLogs(prev => [{ id: ++logIdCounter, message: 'Failed to send message' }, ...prev].slice(0, MAX_LOGS));
    }
  };

  const handleSubmitTask = async () => {
    if (!taskPrompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await axios.post('/api/task', { prompt: taskPrompt.trim() });
      if (res.data.ok) {
        setLogs(prev => [
          { id: ++logIdCounter, message: `Task submitted: ${taskPrompt.trim()} (${res.data.jobId})` },
          ...prev,
        ].slice(0, MAX_LOGS));
        setTaskPrompt('');
      }
    } catch (err) {
      console.error('Task submission failed', err);
      setLogs(prev => [
        { id: ++logIdCounter, message: 'Failed to submit task' },
        ...prev,
      ].slice(0, MAX_LOGS));
    } finally {
      setSubmitting(false);
    }
  };

  // Wait for initial data load
  if (!healthLoaded || !jobsLoaded) {
    return (
      <div className="h-screen w-screen flex flex-col p-4 bg-zora-obsidian relative overflow-hidden">
        <div className="scanline" />
        <div className="flex items-center gap-4 mb-6">
          <div className="lcars-bar flex-1 bg-zora-amber">{'ZORA // DASHBOARD'}</div>
          <div className="w-32 bg-zora-cyan h-8 rounded-r-full" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-zora-cyan font-data text-sm animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  // No providers configured — show setup guide
  if (providers.length === 0) {
    return (
      <div className="h-screen w-screen flex flex-col p-4 bg-zora-obsidian relative overflow-hidden">
        <div className="scanline" />
        <div className="flex items-center gap-4 mb-6">
          <div className="lcars-bar flex-1 bg-zora-amber">{'ZORA // DASHBOARD'}</div>
          <div className="w-32 bg-zora-cyan h-8 rounded-r-full" />
        </div>
        <SetupNeededPanel />
        <div className="mt-4 flex justify-between text-[10px] font-data text-white/40 uppercase tracking-widest">
          <div>Zora {ZORA_VERSION}</div>
          <div>Dashboard</div>
        </div>
      </div>
    );
  }

  // Providers configured but no jobs yet — show welcome (only if no fetch errors)
  if (jobs.length === 0 && !fetchError) {
    return (
      <div className="h-screen w-screen flex flex-col p-4 bg-zora-obsidian relative overflow-hidden">
        <div className="scanline" />
        <div className="flex items-center gap-4 mb-6">
          <div className="lcars-bar flex-1 bg-zora-amber">{'ZORA // DASHBOARD'}</div>
          <div className="w-32 bg-zora-cyan h-8 rounded-r-full" />
        </div>
        <WelcomePanel />
        <div className="mt-4 flex justify-between text-[10px] font-data text-white/40 uppercase tracking-widest">
          <div>Zora {ZORA_VERSION}</div>
          <div>Dashboard</div>
        </div>
      </div>
    );
  }

  // Main dashboard — active jobs exist
  return (
    <div className="h-screen w-screen flex flex-col p-4 bg-zora-obsidian relative overflow-hidden">
      <div className="scanline" />

      {/* Header Bar */}
      <div className="flex items-center gap-4 mb-6">
        <div className="lcars-bar flex-1 bg-zora-amber">
          {'ZORA // DASHBOARD'}
        </div>
        <div className="w-32 bg-zora-cyan h-8 rounded-r-full" />
      </div>

      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">

        {/* Left Column: Health */}
        <div className="col-span-3 flex flex-col gap-4">
          <div className="lcars-bar bg-zora-magenta">Provider Status</div>
          <div className="flex-1 lcars-panel border-zora-magenta bg-zora-magenta/5 overflow-y-auto">
            <AnimatePresence>
              {providers.map(p => (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={p.name}
                  className="mb-4 p-2 bg-black/40 border-l-2 border-zora-cyan"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-zora-cyan font-bold uppercase text-xs">{p.name}</span>
                    <Activity size={14} className={p.valid ? 'text-green-500' : 'text-red-500'} />
                  </div>
                  <div className="text-[10px] font-data text-zora-amber uppercase">
                    {p.valid ? 'Connected' : 'Disconnected'}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Center: Task Input + Activity Feed */}
        <div className="col-span-6 flex flex-col gap-4">
          {/* Task Submission */}
          <div className="lcars-bar bg-zora-amber">Ask Zora</div>
          <div className="lcars-panel border-zora-amber">
            <div className="flex gap-2">
              <input
                type="text"
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitTask()}
                placeholder="Type your task here..."
                disabled={submitting}
                className="flex-1 bg-zora-gray border-b-2 border-zora-amber px-4 py-2 font-data text-zora-amber focus:ring-2 focus:ring-zora-cyan focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSubmitTask}
                disabled={submitting || !taskPrompt.trim()}
                className="bg-zora-amber text-black px-6 py-2 font-bold hover:bg-white transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Play size={16} /> {submitting ? '...' : 'RUN'}
              </button>
            </div>
            <div className="mt-2 text-[10px] font-data text-white/40">
              Examples: "Summarize ~/Projects/readme.md" &middot; "Find all TODO comments" &middot; "Review my last commit"
            </div>
          </div>

          {/* Activity Feed */}
          <div className="lcars-bar bg-zora-cyan">Task Activity</div>
          <div className="flex-1 lcars-panel border-zora-cyan flex flex-col gap-4">
            <div className="flex-1 bg-black/60 p-4 font-data text-sm text-zora-cyan overflow-y-auto">
              {logs.map((log) => (
                <div key={log.id} className="mb-1">{`> ${log.message}`}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={steerMsg}
                onChange={(e) => setSteerMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSteer()}
                placeholder="Send a message to the running task..."
                className="flex-1 bg-zora-gray border-b-2 border-zora-amber px-4 py-2 font-data text-zora-amber focus:ring-2 focus:ring-zora-cyan focus:outline-none"
              />
              <button
                onClick={handleSteer}
                className="bg-zora-amber text-black px-6 py-2 font-bold hover:bg-white transition-colors flex items-center gap-2"
              >
                <Send size={16} /> SEND
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Policy + Session Usage */}
        <div className="col-span-3 flex flex-col gap-4">
          <div className="lcars-bar bg-zora-amber">Security Policy</div>
          <div className="flex-1 lcars-panel border-zora-amber">
            <div className="flex items-center gap-2 text-zora-amber mb-4">
              <Shield size={18} />
              <span className="text-sm font-bold uppercase">Policy: Active</span>
            </div>
            <div className="text-[10px] font-data text-white/60 space-y-2">
              <div className="flex items-start gap-2">
                <Terminal size={12} className="mt-0.5 text-zora-cyan" />
                <span>Approved commands only</span>
              </div>
              <div className="flex items-start gap-2">
                <Zap size={12} className="mt-0.5 text-zora-magenta" />
                <span>Dangerous actions require approval</span>
              </div>
            </div>
          </div>
          <div className="h-32 lcars-panel border-zora-cyan bg-zora-cyan/5 text-zora-cyan text-[10px] font-data">
            <div className="flex items-center gap-2 mb-2 font-bold uppercase">
              <Info size={14} /> System Info
            </div>
            UPTIME: {system ? formatUptime(system.uptime) : '--:--:--'}<br/>
            MEMORY: {system ? `${system.memory.used}MB / ${system.memory.total}MB` : '-- / --'}<br/>
            TASKS: {system ? `${system.activeJobs} ACTIVE / ${system.totalJobs} TOTAL` : '-- / --'}
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="mt-4 flex justify-between text-[10px] font-data text-white/40 uppercase tracking-widest">
        <div>Zora {ZORA_VERSION}</div>
        <div>Dashboard</div>
      </div>
    </div>
  );
};

export default App;
