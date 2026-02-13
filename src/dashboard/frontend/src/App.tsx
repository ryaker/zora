import React, { useState, useEffect } from 'react';
import { Activity, Shield, Terminal, Zap, Send, Info, DollarSign, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface ProviderStatus {
  name: string;
  valid: boolean;
  expiresAt: string | null;
  canAutoRefresh: boolean;
}

interface ProviderQuota {
  name: string;
  auth: { valid: boolean; expiresAt: string | null };
  quota: { isExhausted: boolean; remainingRequests: number | null; cooldownUntil: string | null; healthScore: number };
  usage: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; requestCount: number; lastRequestAt: string | null };
  costTier: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function healthColor(score: number): string {
  if (score >= 0.7) return 'text-green-500';
  if (score >= 0.3) return 'text-zora-amber';
  return 'text-red-500';
}

function healthBarColor(score: number): string {
  if (score >= 0.7) return 'bg-green-500';
  if (score >= 0.3) return 'bg-zora-amber';
  return 'bg-red-500';
}

const App: React.FC = () => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [quotas, setQuotas] = useState<ProviderQuota[]>([]);
  const [steerMsg, setSteerMsg] = useState('');
  const [selectedJob, setSelectedJob] = useState('job_active');
  const [logs, setLogs] = useState<string[]>(['Zora is running.', 'Waiting for tasks...']);

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

  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const res = await axios.get('/api/quota');
        if (res.data.ok) setQuotas(res.data.providers);
      } catch (err) {
        console.error('Quota fetch failed', err);
      }
    };

    fetchQuota();
    const interval = setInterval(fetchQuota, 10000);
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
      setLogs(prev => [`Message sent: ${steerMsg}`, ...prev].slice(0, 50));
      setSteerMsg('');
    } catch (err) {
      console.error('Steering message failed', err);
      setLogs(prev => ['Failed to send message', ...prev].slice(0, 50));
    }
  };

  const totalCost = quotas.reduce((sum, q) => sum + q.usage.totalCostUsd, 0);
  const totalRequests = quotas.reduce((sum, q) => sum + q.usage.requestCount, 0);

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

        {/* Left Column: Provider Status + Quota */}
        <div className="col-span-3 flex flex-col gap-4">
          <div className="lcars-bar bg-zora-magenta">Provider Status</div>
          <div className="flex-1 lcars-panel border-zora-magenta bg-zora-magenta/5 overflow-y-auto">
            <AnimatePresence>
              {providers.map(p => {
                const quota = quotas.find(q => q.name === p.name);
                return (
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
                    <div className="text-[10px] font-data text-zora-amber uppercase mb-2">
                      {p.valid ? 'Connected' : 'Disconnected'}
                    </div>
                    {quota && (
                      <div className="space-y-1">
                        {/* Health Score Bar */}
                        <div className="flex items-center gap-2">
                          <Gauge size={10} className={healthColor(quota.quota.healthScore)} />
                          <div className="flex-1 h-1.5 bg-black/60 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${healthBarColor(quota.quota.healthScore)}`}
                              style={{ width: `${quota.quota.healthScore * 100}%` }}
                            />
                          </div>
                          <span className={`text-[9px] font-data ${healthColor(quota.quota.healthScore)}`}>
                            {Math.round(quota.quota.healthScore * 100)}%
                          </span>
                        </div>
                        {/* Usage Stats */}
                        <div className="text-[9px] font-data text-white/50 space-y-0.5">
                          {quota.usage.totalCostUsd > 0 && (
                            <div className="flex justify-between">
                              <span>COST</span>
                              <span className="text-zora-amber">${quota.usage.totalCostUsd.toFixed(4)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>REQUESTS</span>
                            <span className="text-zora-cyan">{quota.usage.requestCount}</span>
                          </div>
                          {(quota.usage.totalInputTokens > 0 || quota.usage.totalOutputTokens > 0) && (
                            <div className="flex justify-between">
                              <span>TOKENS</span>
                              <span className="text-zora-cyan">
                                {formatTokens(quota.usage.totalInputTokens)}in / {formatTokens(quota.usage.totalOutputTokens)}out
                              </span>
                            </div>
                          )}
                          {quota.quota.isExhausted && (
                            <div className="text-red-500 font-bold mt-1">QUOTA EXHAUSTED</div>
                          )}
                          {quota.quota.cooldownUntil && (
                            <div className="text-zora-amber">COOLDOWN ACTIVE</div>
                          )}
                          <div className="flex justify-between">
                            <span>TIER</span>
                            <span className="text-white/40 uppercase">{quota.costTier}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
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
          <div className="lcars-bar bg-zora-cyan">Session Usage</div>
          <div className="h-36 lcars-panel border-zora-cyan bg-zora-cyan/5 text-zora-cyan text-[10px] font-data">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <DollarSign size={11} />
                  <span className="uppercase">Total Cost</span>
                </div>
                <span className="text-zora-amber font-bold">${totalCost.toFixed(4)}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <Activity size={11} />
                  <span className="uppercase">Requests</span>
                </div>
                <span className="font-bold">{totalRequests}</span>
              </div>
              {quotas.map(q => (
                <div key={q.name} className="flex justify-between items-center text-[9px]">
                  <span className="uppercase text-white/40">{q.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={healthColor(q.quota.healthScore)}>
                      {q.quota.isExhausted ? 'EXHAUSTED' : `${Math.round(q.quota.healthScore * 100)}%`}
                    </span>
                    {q.usage.totalCostUsd > 0 && (
                      <span className="text-zora-amber">${q.usage.totalCostUsd.toFixed(3)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
