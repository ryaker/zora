import React, { useState, useEffect } from 'react';
import { Activity, Shield, Terminal, Zap, Send, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface ProviderStatus {
  name: string;
  valid: boolean;
  expiresAt: string | null;
  canAutoRefresh: boolean;
}

const App: React.FC = () => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [steerMsg, setSteerMsg] = useState('');
  const [selectedJob, setSelectedJob] = useState('job_active');
  const [logs, setLogs] = useState<string[]>(['Zora is running.', 'Waiting for tasks...']);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await axios.get('/api/health');
        if (res.data.ok) setProviders(res.data.providers);
      } catch (err) {
        console.error('Health check failed');
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
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
      setLogs(prev => ['Failed to send message', ...prev]);
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
