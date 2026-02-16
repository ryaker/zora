import React, { useState, useEffect, useRef } from 'react';
import { Shield, Send, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

const ZORA_VERSION = 'v0.9.5';
const MAX_MESSAGES = 200;
let messageIdCounter = 0;

// ─── Types ──────────────────────────────────────────────────────────

interface Message {
  id: number;
  type: 'agent' | 'user' | 'system' | 'tool-call' | 'tool-result';
  content: string;
  timestamp: Date;
}

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

// ─── Helpers ────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function healthColor(score: number): string {
  if (score >= 0.7) return 'text-green-500';
  if (score >= 0.3) return 'text-zora-gold';
  return 'text-red-500';
}

function healthBarColor(score: number): string {
  if (score >= 0.7) return 'bg-green-500';
  if (score >= 0.3) return 'bg-zora-gold';
  return 'bg-red-500';
}

// ─── MessageBubble ──────────────────────────────────────────────────

const MessageBubble: React.FC<{ msg: Message }> = ({ msg }) => {
  const bubbleClass = {
    agent: 'bubble bubble-agent',
    user: 'bubble bubble-user',
    system: 'bubble bubble-system',
    'tool-call': 'bubble bubble-agent',
    'tool-result': 'bubble bubble-agent',
  }[msg.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={bubbleClass}
      data-testid={`bubble-${msg.type}`}
    >
      {msg.type === 'tool-call' && (
        <div className="tool-mini mb-1">TOOL_INVOKE</div>
      )}
      {msg.type === 'tool-result' && (
        <div className="tool-mini mb-1">TOOL_RESULT</div>
      )}
      <div>{msg.content}</div>
      <div className="text-[9px] opacity-40 mt-1">
        {msg.timestamp.toLocaleTimeString()}
      </div>
    </motion.div>
  );
};

// ─── App ────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [quotas, setQuotas] = useState<ProviderQuota[]>([]);
  const [steerMsg, setSteerMsg] = useState('');
  const [selectedJob, setSelectedJob] = useState('job_active');
  const [messages, setMessages] = useState<Message[]>([
    { id: ++messageIdCounter, type: 'system', content: 'Neural link established.', timestamp: new Date() },
    { id: ++messageIdCounter, type: 'agent', content: 'Neural interface active. All subsystems nominal.', timestamp: new Date() },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch health
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

  // Fetch quota
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

  // SSE event stream → chat messages
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;

        let msgType: Message['type'] = 'agent';
        let content = '';

        if (data.type === 'job_update') {
          msgType = 'system';
          content = `Job ${data.data?.jobId ?? 'unknown'}: ${data.data?.status ?? 'update'}`;
        } else if (data.type === 'tool_call') {
          msgType = 'tool-call';
          content = data.data?.tool ?? JSON.stringify(data);
        } else if (data.type === 'tool_result') {
          msgType = 'tool-result';
          content = data.data?.result ?? JSON.stringify(data);
        } else if (data.type === 'text_delta' || data.type === 'text.delta') {
          msgType = 'agent';
          content = data.data?.text ?? data.data?.delta ?? JSON.stringify(data);
        } else {
          msgType = 'system';
          content = JSON.stringify(data);
        }

        setMessages(prev => [
          ...prev,
          { id: ++messageIdCounter, type: msgType, content, timestamp: new Date() },
        ].slice(-MAX_MESSAGES));
      } catch {
        // Ignore parse errors from SSE
      }
    };
    return () => es.close();
  }, []);

  // Steering message handler
  const handleSteer = async () => {
    if (!steerMsg) return;
    const msgText = steerMsg;
    setSteerMsg('');
    // Add user message to chat immediately
    setMessages(prev => [
      ...prev,
      { id: ++messageIdCounter, type: 'user' as const, content: msgText, timestamp: new Date() },
    ].slice(-MAX_MESSAGES));

    try {
      await axios.post('/api/steer', {
        jobId: selectedJob,
        message: msgText,
        author: 'operator',
        source: 'dashboard',
      });
    } catch (err) {
      console.error('Steering message failed', err);
      setMessages(prev => [
        ...prev,
        { id: ++messageIdCounter, type: 'system' as const, content: 'Transmission failed. Check comms.', timestamp: new Date() },
      ].slice(-MAX_MESSAGES));
    }
  };

  const totalCost = quotas.reduce((sum, q) => sum + q.usage.totalCostUsd, 0);
  const totalRequests = quotas.reduce((sum, q) => sum + q.usage.requestCount, 0);

  return (
    <div className="h-screen w-screen flex flex-col bg-zora-obsidian relative overflow-hidden">
      <div className="scanline" />

      {/* Header Bar */}
      <div className="flex items-center gap-4 px-4 pt-4 pb-2">
        <div className="lcars-bar flex-1 bg-zora-gold">
          ZORA // TACTICAL INTERFACE
        </div>
        <div className="w-32 bg-zora-teal h-8 rounded-r-full" />
      </div>

      {/* Main Content: Sidebar + Chat + Status */}
      <div className="flex-1 flex min-h-0">

        {/* Left Sidebar Rail */}
        <div className="w-16 flex flex-col items-center py-4 gap-4 bg-zora-rail border-r border-zora-ghost/30">
          <div className="w-8 h-8 rounded-tl-xl border-t-2 border-l-2 border-zora-teal" />
          <div className="flex-1" />
          <div className="w-8 h-8 rounded-bl-xl border-b-2 border-l-2 border-zora-teal" />
        </div>

        {/* Center: Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2">
            <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
              Live Mission Logs
            </span>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-2 lcars-scrollbar">
            <AnimatePresence>
              {messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="px-4 py-3 border-t border-zora-ghost/30">
            <div className="flex gap-2">
              <input
                type="text"
                value={steerMsg}
                onChange={(e) => setSteerMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSteer()}
                placeholder="Inject directive message..."
                className="flex-1 bg-zora-rail border border-zora-ghost/50 rounded-lg px-4 py-2 font-data text-zora-gold text-sm focus:ring-2 focus:ring-zora-teal focus:border-transparent focus:outline-none placeholder:text-white/20"
              />
              <button
                onClick={handleSteer}
                className="bg-zora-teal text-zora-obsidian px-5 py-2 rounded-lg font-bold hover:bg-zora-cyan transition-colors flex items-center gap-2 text-sm"
              >
                <Send size={14} /> SEND
              </button>
            </div>
          </div>
        </div>

        {/* Right Status Panel */}
        <div className="w-80 flex flex-col border-l border-zora-ghost/30 bg-zora-rail/50 overflow-y-auto lcars-scrollbar">

          {/* Neural Subnets (Provider Health) */}
          <div className="px-4 py-3 border-b border-zora-ghost/30">
            <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
              Neural Subnets
            </span>
          </div>
          <div className="px-4 py-2 space-y-3">
            <AnimatePresence>
              {providers.map(p => {
                const quota = quotas.find(q => q.name === p.name);
                return (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={p.name}
                    className="p-2 bg-black/40 rounded-lg border-l-2 border-zora-teal"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-zora-cyan font-bold uppercase text-xs">{p.name}</span>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${p.valid ? 'bg-green-500' : 'bg-red-500'}`}
                        title={p.valid ? 'Connected' : 'Disconnected'}
                        data-testid={`provider-dot-${p.name}`}
                      />
                    </div>
                    {quota && (
                      <div className="space-y-1">
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
                        <div className="text-[9px] font-data text-white/50 space-y-0.5">
                          {quota.usage.totalCostUsd > 0 && (
                            <div className="flex justify-between">
                              <span>COST</span>
                              <span className="text-zora-gold">${quota.usage.totalCostUsd.toFixed(4)}</span>
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
                            <div className="text-zora-gold">COOLDOWN ACTIVE</div>
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

          {/* Safety Protocols */}
          <div className="px-4 py-3 border-t border-b border-zora-ghost/30">
            <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
              Safety Protocols
            </span>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-zora-gold mb-3">
              <Shield size={16} />
              <span className="text-xs font-bold uppercase">Active Integrity Shield</span>
            </div>
            <div className="text-[10px] font-data text-white/50 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span>SYSCALL_FILTER: ENABLED</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span>INTENT_CAPSULE: SIGNED</span>
              </div>
            </div>
          </div>

          {/* Mission Telemetry (Session Usage) */}
          <div className="px-4 py-3 border-t border-b border-zora-ghost/30">
            <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
              Mission Telemetry
            </span>
          </div>
          <div className="px-4 py-3 lcars-panel border-zora-teal">
            <div className="text-[10px] font-data text-white/60 space-y-2">
              <div className="flex justify-between items-center">
                <span>TOT_COST:</span>
                <span className="text-zora-gold font-bold">${totalCost.toFixed(4)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>REQUESTS:</span>
                <span className="text-zora-cyan font-bold">{totalRequests}</span>
              </div>
              {quotas.map(q => (
                <div key={q.name} className="flex justify-between items-center text-[9px]">
                  <span className="uppercase text-white/40">{q.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={healthColor(q.quota.healthScore)}>
                      {q.quota.isExhausted ? 'EXHAUSTED' : `${Math.round(q.quota.healthScore * 100)}%`}
                    </span>
                    {q.usage.totalCostUsd > 0 && (
                      <span className="text-zora-gold">${q.usage.totalCostUsd.toFixed(3)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 flex justify-between text-[10px] font-data text-white/40 uppercase tracking-widest border-t border-zora-ghost/30">
        <div>Zora {ZORA_VERSION}</div>
        <div>Operational Dashboard</div>
      </div>
    </div>
  );
};

export default App;
