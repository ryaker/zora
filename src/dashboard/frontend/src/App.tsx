import React, { useState, useEffect, useRef } from 'react';
import { Activity, Shield, Terminal, Zap, Send, Info, Rocket, AlertTriangle, Copy, Check } from 'lucide-react';
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

const ZORA_VERSION = 'v0.6.0';

const SETUP_PROMPT = `I want to set up Zora, an autonomous AI agent for my computer. Please walk me through the setup step by step:

1. Check if I have Node.js 20+ installed
2. Install Zora: npm install -g zora
3. Run: zora init
4. Help me choose a security preset (Safe, Balanced, or Power)
5. Verify setup with: zora doctor

Ask me one question at a time and wait for my response before moving on.`;

const SetupNeededPanel: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

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
  const [logs, setLogs] = useState<string[]>(['Zora is running.', 'Waiting for tasks...']);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [fetchError, setFetchError] = useState(false);

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

  const handleSteer = async () => {
    if (!steerMsg) return;
    try {
      await axios.post('/api/steer', {
        jobId: selectedJob,
        message: steerMsg,
        author: 'operator',
        source: 'dashboard'
      });
      setLogs(prev => [`Message sent: ${steerMsg}`, ...prev].slice(0, 10));
      setSteerMsg('');
    } catch (err) {
      console.error('Steering message failed', err);
      setLogs(prev => ['Failed to send message', ...prev].slice(0, 10));
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

        {/* Center: Main View / Steering */}
        <div className="col-span-6 flex flex-col gap-4">
          <div className="lcars-bar bg-zora-cyan">Task Activity</div>
          <div className="flex-1 lcars-panel border-zora-cyan flex flex-col gap-4">
            <div className="flex-1 bg-black/60 p-4 font-data text-sm text-zora-cyan overflow-y-auto">
              {logs.map((log, i) => (
                <div key={i} className="mb-1">{`> ${log}`}</div>
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

        {/* Right Column: Policy & Info */}
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
            UPTIME: 04:20:12<br/>
            MEMORY: 128MB / 512MB<br/>
            THREADS: 04 ACTIVE
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
