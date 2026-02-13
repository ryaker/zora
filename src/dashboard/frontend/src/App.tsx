import React, { useState, useEffect, useRef } from 'react';
import { Activity, Shield, Terminal, Zap, Send, Info, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface ProviderStatus {
  name: string;
  valid: boolean;
  expiresAt: string | null;
  canAutoRefresh: boolean;
}

const MAX_LOGS = 50;

let logIdCounter = 0;

interface LogEntry {
  id: number;
  message: string;
}

const App: React.FC = () => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [steerMsg, setSteerMsg] = useState('');
  const [selectedJob, setSelectedJob] = useState('job_active');
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: ++logIdCounter, message: 'Zora is running.' },
    { id: ++logIdCounter, message: 'Waiting for tasks...' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await axios.get('/api/health');
        if (res.data.ok) setProviders(res.data.providers);
      } catch (err) {
        console.error('Health check failed', err);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // SSE connection for real-time events
  useEffect(() => {
    const es = new EventSource('/api/events');
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        switch (event.type) {
          case 'connected':
            break;
          case 'job_started':
            setLogs(prev => [{ id: ++logIdCounter, message: `Task started: ${event.data?.prompt ?? event.data?.jobId}` }, ...prev].slice(0, MAX_LOGS));
            if (event.data?.jobId) setSelectedJob(event.data.jobId);
            break;
          case 'job_progress':
            setLogs(prev => [{ id: ++logIdCounter, message: event.data?.message ?? '...' }, ...prev].slice(0, MAX_LOGS));
            break;
          case 'job_completed':
            setLogs(prev => [{ id: ++logIdCounter, message: `Task completed: ${event.data?.jobId}` }, ...prev].slice(0, MAX_LOGS));
            break;
          case 'job_failed':
            setLogs(prev => [{ id: ++logIdCounter, message: `Task failed: ${event.data?.error ?? event.data?.jobId}` }, ...prev].slice(0, MAX_LOGS));
            break;
          default:
            if (event.data?.message) {
              setLogs(prev => [{ id: ++logIdCounter, message: event.data.message }, ...prev].slice(0, MAX_LOGS));
            }
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', e.data, err);
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => es.close();
  }, []);

  const handleSubmitTask = async () => {
    if (!taskPrompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await axios.post('/api/task', { prompt: taskPrompt.trim() });
      if (res.data.ok) {
        setLogs(prev => [{ id: ++logIdCounter, message: `Task submitted: ${taskPrompt.trim()}` }, ...prev].slice(0, MAX_LOGS));
        setSelectedJob(res.data.jobId);
        setTaskPrompt('');
      }
    } catch (err) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? err.response.data.error
        : 'Failed to submit task';
      setLogs(prev => [{ id: ++logIdCounter, message: msg }, ...prev].slice(0, MAX_LOGS));
    } finally {
      setSubmitting(false);
    }
  };

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
      setLogs(prev => [{ id: ++logIdCounter, message: 'Failed to send message' }, ...prev].slice(0, MAX_LOGS));
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col p-4 bg-zora-obsidian relative overflow-hidden">
      <div className="scanline" />

      {/* Header Bar */}
      <div className="flex items-center gap-4 mb-6">
        <div className="lcars-bar flex-1 bg-zora-amber">
          ZORA // DASHBOARD
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
        <div>Zora v0.6.0</div>
        <div>Dashboard</div>
      </div>
    </div>
  );
};

export default App;
