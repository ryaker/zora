import React, { useState, useEffect, useRef } from 'react';
import { Shield, Send, Gauge, Sparkles, LayoutGrid, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

import WelcomeOnboarding from './components/WelcomeOnboarding';
import { TLCIPanel } from './components/TLCIPanel.js';
import TaskTemplates from './components/TaskTemplates';
import TaskSummary, { type TaskStep } from './components/TaskSummary';
import SecuritySettings from './components/SecuritySettings';

const ZORA_VERSION = 'v0.9.5';
const MAX_MESSAGES = 200;
const ONBOARDING_KEY = 'zora_onboarding_complete';

// Authenticate all axios calls and EventSource using the token injected by the server.
// window.__ZORA_TOKEN__ is set by server.ts in <script> when ZORA_DASHBOARD_TOKEN is configured.
const _zoraToken = (window as { __ZORA_TOKEN__?: string }).__ZORA_TOKEN__;
if (_zoraToken) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${_zoraToken}`;
}
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

type RightPanelTab = 'status' | 'templates' | 'security';

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

// ─── ToolGroup — collapsible group of consecutive tool calls ─────────

interface ToolGroupItem { id: number; tool: string; type: 'tool-call' | 'tool-result'; timestamp: Date }

const ToolGroup: React.FC<{ items: ToolGroupItem[] }> = ({ items }) => {
  const [open, setOpen] = React.useState(false);
  const calls = items.filter(i => i.type === 'tool-call');
  const toolNames = [...new Set(calls.map(i => i.tool))];
  const summary = toolNames.length <= 3
    ? toolNames.join(', ')
    : `${toolNames.slice(0, 2).join(', ')} +${toolNames.length - 2} more`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="bubble bubble-tool self-start w-full max-w-[90%]"
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 font-data text-[10px] uppercase tracking-widest text-zora-gold/60 hover:text-zora-gold/90 transition-colors"
      >
        <span>⚙</span>
        <span className="font-mono normal-case tracking-normal text-white/50">{summary}</span>
        <span className="text-white/25 ml-1">({calls.length} calls)</span>
        <span className="ml-auto text-[9px] opacity-40">{items[0].timestamp.toLocaleTimeString()}</span>
        <span className="opacity-40">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 border-t border-white/10 pt-2 flex flex-col gap-1">
          {items.map(item => (
            <div key={item.id} className={`flex items-center gap-2 text-[10px] font-mono ${
              item.type === 'tool-call' ? 'text-zora-gold/50' : 'text-zora-cyan/40'
            }`}>
              <span>{item.type === 'tool-call' ? '→' : '←'}</span>
              <span>{item.tool}</span>
              <span className="ml-auto text-[9px] opacity-30">{item.timestamp.toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

// ─── MessageBubble ──────────────────────────────────────────────────

const MessageBubble: React.FC<{ msg: Message }> = ({ msg }) => {
  const bubbleClass = {
    agent: 'bubble bubble-agent',
    user: 'bubble bubble-user',
    system: 'bubble bubble-system',
    'tool-call': 'bubble bubble-tool',
    'tool-result': 'bubble bubble-tool',
  }[msg.type] ?? 'bubble bubble-system';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={bubbleClass}
      data-testid={`bubble-${msg.type}`}
    >
      {msg.type === 'agent' ? (
        <div
          style={{ fontFamily: 'var(--font-prose)', fontSize: '0.875rem', lineHeight: '1.7' }}
          className="text-zora-white max-w-none
            [&_p]:mb-3 [&_p:last-child]:mb-0
            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1
            [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
            [&_pre]:bg-black/50 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:my-2
            [&_code]:bg-black/40 [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:text-zora-gold [&_code]:font-mono
            [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-zora-cyan
            [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-zora-cyan
            [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-zora-teal
            [&_blockquote]:border-l-2 [&_blockquote]:border-zora-teal/40 [&_blockquote]:pl-3 [&_blockquote]:opacity-70 [&_blockquote]:my-2
            [&_hr]:border-white/10 [&_hr]:my-3
            [&_strong]:text-zora-white [&_strong]:font-semibold
            [&_table]:text-xs [&_table]:my-2 [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-zora-teal [&_th]:font-data [&_th]:uppercase [&_th]:text-[9px]"
        >
          <ReactMarkdown>{msg.content}</ReactMarkdown>
        </div>
      ) : (
        <div>{msg.content}</div>
      )}
      <div className="text-[9px] opacity-30 mt-1.5">
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
    { id: ++messageIdCounter, type: 'system', content: 'Zora is ready.', timestamp: new Date() },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDING_KEY);
    } catch {
      return true;
    }
  });

  // Right panel tab
  const [rightTab, setRightTab] = useState<RightPanelTab>('status');

  // Task tracking
  const [taskSteps, setTaskSteps] = useState<TaskStep[]>([]);
  const [taskRunning, setTaskRunning] = useState(false);
  const [currentTaskPrompt, setCurrentTaskPrompt] = useState<string | undefined>();

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, 'true');
    } catch {
      // localStorage unavailable, that's okay
    }
  };

  const handleSubmitTask = async (prompt: string) => {
    if (taskRunning) return;

    // Add user message
    setMessages(prev => [
      ...prev,
      { id: ++messageIdCounter, type: 'user' as const, content: prompt, timestamp: new Date() },
    ].slice(-MAX_MESSAGES));

    // Start task tracking
    setCurrentTaskPrompt(prompt);
    setTaskRunning(true);
    setTaskSteps([]);

    try {
      await axios.post('/api/steer', {
        jobId: selectedJob,
        message: prompt,
        author: 'operator',
        source: 'dashboard',
      });
    } catch (err) {
      console.error('Task submission failed', err);
      setMessages(prev => [
        ...prev,
        { id: ++messageIdCounter, type: 'system' as const, content: 'Failed to send task. Check that Zora is running.', timestamp: new Date() },
      ].slice(-MAX_MESSAGES));
      setTaskRunning(false);
    }
  };

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Hydrate chat history from stored sessions on first load
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await axios.get('/api/history', { params: { limit: 1 } });
        const items: Array<{ jobId: string; event: { type: string; content?: Record<string, unknown>; timestamp?: string } }> = res.data?.events ?? [];
        if (items.length === 0) return;

        const historical: Message[] = [];
        for (const { event } of items) {
          const ts = event.timestamp ? new Date(event.timestamp) : new Date();
          if (event.type === 'text' || event.type === 'text_delta') {
            const text = (event.content as Record<string, unknown>)?.text as string ?? '';
            if (!text.trim()) continue;
            // Merge consecutive text events into one agent bubble
            const last = historical[historical.length - 1];
            if (last?.type === 'agent') {
              last.content += text;
            } else {
              historical.push({ id: ++messageIdCounter, type: 'agent', content: text, timestamp: ts });
            }
          } else if (event.type === 'tool_call') {
            const tool = (event.content as Record<string, unknown>)?.tool as string ?? 'tool';
            historical.push({ id: ++messageIdCounter, type: 'tool-call', content: tool, timestamp: ts });
          } else if (event.type === 'job_update') {
            const status = (event.content as Record<string, unknown>)?.status as string ?? 'update';
            if (status === 'started' || status === 'completed' || status === 'failed') {
              historical.push({ id: ++messageIdCounter, type: 'system', content: `Task ${status}`, timestamp: ts });
            }
          } else if (event.type === 'error') {
            const msg = (event.content as Record<string, unknown>)?.message as string ?? 'Error';
            historical.push({ id: ++messageIdCounter, type: 'system', content: msg, timestamp: ts });
          }
        }

        if (historical.length > 0) {
          setMessages([
            { id: ++messageIdCounter, type: 'system', content: '— session history —', timestamp: new Date(0) },
            ...historical,
            { id: ++messageIdCounter, type: 'system', content: 'Zora is ready.', timestamp: new Date() },
          ]);
        }
      } catch {
        // History unavailable, start fresh
      }
    };
    loadHistory();
  }, []);

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

  // SSE event stream → chat messages + task step tracking
  useEffect(() => {
    const reconcileJobState = async () => {
      try {
        const res = await axios.get('/api/jobs');
        const jobs: Array<{ status: string }> = res.data?.jobs ?? [];
        const hasRunning = jobs.some((j) => j.status === 'running');
        if (!hasRunning) setTaskRunning(false);
      } catch {
        // ignore — daemon may still be starting
      }
    };

    // EventSource cannot set headers — pass token as query param; server promotes it to header
    const sseUrl = _zoraToken
      ? `/api/events?token=${encodeURIComponent(_zoraToken)}`
      : '/api/events';
    const es = new EventSource(sseUrl);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') {
          // Reconnect: reconcile UI state against actual backend job state
          reconcileJobState();
          return;
        }

        let msgType: Message['type'] = 'agent';
        let content = '';

        if (data.type === 'job_update') {
          msgType = 'system';
          content = `Task ${data.data?.status === 'completed' ? 'completed' : data.data?.status ?? 'update'}`;
          // Track task completion
          if (data.data?.status === 'completed' || data.data?.status === 'failed') {
            setTaskRunning(false);
          }
        } else if (data.type === 'tool_call') {
          msgType = 'tool-call';
          content = data.data?.tool ?? JSON.stringify(data);
          // Track as a task step
          const toolName = data.data?.tool ?? 'unknown';
          let stepType: TaskStep['type'] = 'think';
          if (toolName.toLowerCase().includes('read') || toolName.toLowerCase().includes('glob') || toolName.toLowerCase().includes('grep')) {
            stepType = 'read';
          } else if (toolName.toLowerCase().includes('write') || toolName.toLowerCase().includes('edit')) {
            stepType = 'write';
          } else if (toolName.toLowerCase().includes('bash') || toolName.toLowerCase().includes('shell')) {
            stepType = 'shell';
          }
          setTaskSteps(prev => [...prev, {
            type: stepType,
            label: content,
            timestamp: new Date(),
          }]);
        } else if (data.type === 'tool_result') {
          msgType = 'tool-result';
          content = data.data?.result ?? JSON.stringify(data);
        } else if (data.type === 'text_delta' || data.type === 'text.delta' || data.type === 'text') {
          // Append to the last agent message rather than creating a new bubble per delta
          const text = data.data?.text ?? data.data?.delta ?? '';
          if (text) {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.type === 'agent') {
                const updated = { ...last, content: last.content + text };
                return [...prev.slice(0, -1), updated];
              }
              return [...prev, { id: ++messageIdCounter, type: 'agent' as const, content: text, timestamp: new Date() }].slice(-MAX_MESSAGES);
            });
          }
          return; // handled above, skip the generic push below
        } else if (data.type === 'error') {
          msgType = 'system';
          content = data.data?.message ?? 'An error occurred';
          setTaskSteps(prev => [...prev, {
            type: 'error',
            label: content,
            timestamp: new Date(),
          }]);
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
    handleSubmitTask(msgText);
  };

  const totalCost = quotas.reduce((sum, q) => sum + q.usage.totalCostUsd, 0);
  const totalRequests = quotas.reduce((sum, q) => sum + q.usage.requestCount, 0);

  return (
    <div className="h-screen w-screen flex flex-col bg-zora-obsidian relative overflow-hidden">
      <div className="scanline" />

      {/* Onboarding Overlay */}
      {showOnboarding && (
        <WelcomeOnboarding
          onComplete={handleOnboardingComplete}
          onSubmitTask={(prompt) => {
            handleOnboardingComplete();
            handleSubmitTask(prompt);
          }}
        />
      )}

      {/* Header Bar */}
      <div className="flex items-center gap-4 px-4 pt-4 pb-2">
        <div className="lcars-bar flex-1 bg-zora-gold">
          ZORA {'/'} DASHBOARD
        </div>
        <div className="flex items-center gap-2">
          {providers.length > 0 && (
            <div className="flex items-center gap-1.5 text-[9px] font-data text-white/40">
              {providers.map(p => (
                <div key={p.name} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${p.valid ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="uppercase">{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="w-32 bg-zora-teal h-8 rounded-r-full" />
      </div>

      {/* Main Content: Sidebar + Chat + Status */}
      <div className="flex-1 flex min-h-0">

        {/* Left Sidebar Rail */}
        <div className="w-16 flex flex-col items-center py-4 gap-4 bg-zora-rail border-r border-zora-ghost/30">
          <div className="w-8 h-8 rounded-tl-xl border-t-2 border-l-2 border-zora-teal" />
          <div className="flex-1" />
          <button
            onClick={() => setShowOnboarding(true)}
            className="w-8 h-8 flex items-center justify-center text-white/30 hover:text-zora-teal transition-colors"
            title="Show welcome guide"
          >
            <Sparkles size={16} />
          </button>
          <div className="w-8 h-8 rounded-bl-xl border-b-2 border-l-2 border-zora-teal" />
        </div>

        {/* Center: Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2">
            <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
              Activity Feed
            </span>
          </div>

          {/* Chat messages — consecutive tool-calls/results are grouped */}
          <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-2 lcars-scrollbar">
            <AnimatePresence>
              {(() => {
                type Segment =
                  | { kind: 'msg'; msg: Message }
                  | { kind: 'tools'; items: ToolGroupItem[]; key: number };
                const segments: Segment[] = [];
                for (const msg of messages) {
                  if (msg.type === 'tool-call' || msg.type === 'tool-result') {
                    const last = segments[segments.length - 1];
                    const item: ToolGroupItem = { id: msg.id, tool: msg.content, type: msg.type, timestamp: msg.timestamp };
                    if (last?.kind === 'tools') {
                      last.items.push(item);
                    } else {
                      segments.push({ kind: 'tools', items: [item], key: msg.id });
                    }
                  } else {
                    segments.push({ kind: 'msg', msg });
                  }
                }
                return segments.map(seg =>
                  seg.kind === 'tools'
                    ? <ToolGroup key={seg.key} items={seg.items} />
                    : <MessageBubble key={seg.msg.id} msg={seg.msg} />
                );
              })()}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>

          {/* Task Summary Panel */}
          <TaskSummary
            steps={taskSteps}
            isRunning={taskRunning}
            taskPrompt={currentTaskPrompt}
          />

          {/* Input bar */}
          <div className="px-4 py-3 border-t border-zora-ghost/30">
            <div className="flex gap-2">
              <input
                type="text"
                value={steerMsg}
                onChange={(e) => setSteerMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSteer()}
                placeholder="Ask Zora to do something..."
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
        <div className="w-80 flex flex-col border-l border-zora-ghost/30 bg-zora-rail/50">

          {/* Tab Navigation */}
          <div className="flex border-b border-zora-ghost/30">
            <button
              onClick={() => setRightTab('status')}
              className={`flex-1 px-3 py-2 text-[9px] font-data uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                rightTab === 'status'
                  ? 'text-zora-teal border-b-2 border-zora-teal bg-black/20'
                  : 'text-white/30 hover:text-white/50'
              }`}
            >
              <Gauge size={10} /> Status
            </button>
            <button
              onClick={() => setRightTab('templates')}
              className={`flex-1 px-3 py-2 text-[9px] font-data uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                rightTab === 'templates'
                  ? 'text-zora-teal border-b-2 border-zora-teal bg-black/20'
                  : 'text-white/30 hover:text-white/50'
              }`}
            >
              <LayoutGrid size={10} /> Tasks
            </button>
            <button
              onClick={() => setRightTab('security')}
              className={`flex-1 px-3 py-2 text-[9px] font-data uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                rightTab === 'security'
                  ? 'text-zora-teal border-b-2 border-zora-teal bg-black/20'
                  : 'text-white/30 hover:text-white/50'
              }`}
            >
              <Shield size={10} /> Safety
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto lcars-scrollbar">

            {/* STATUS TAB */}
            {rightTab === 'status' && (
              <>
                {/* AI Provider Health */}
                <div className="px-4 py-3 border-b border-zora-ghost/30">
                  <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
                    AI Providers
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
                                      {formatTokens(quota.usage.totalInputTokens)} in / {formatTokens(quota.usage.totalOutputTokens)} out
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
                  {providers.length === 0 && (
                    <div className="text-[10px] font-data text-white/30 py-4 text-center">
                      No AI providers detected.<br />
                      Run <code className="text-zora-cyan">zora-agent doctor</code> to check.
                    </div>
                  )}
                </div>

                {/* Session Stats */}
                <div className="px-4 py-3 border-t border-b border-zora-ghost/30">
                  <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
                    Session Stats
                  </span>
                </div>
                <div className="px-4 py-3 lcars-panel border-zora-teal">
                  <div className="text-[10px] font-data text-white/60 space-y-2">
                    <div className="flex justify-between items-center">
                      <span>TOTAL COST:</span>
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

                {/* TLCI Cost Tracker Panel */}
                <div className="px-4 py-3">
                  <TLCIPanel />
                </div>
              </>
            )}

            {/* TEMPLATES TAB */}
            {rightTab === 'templates' && (
              <TaskTemplates onSubmitTask={handleSubmitTask} />
            )}

            {/* SECURITY TAB */}
            {rightTab === 'security' && (
              <SecuritySettings />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 flex justify-between text-[10px] font-data text-white/40 uppercase tracking-widest border-t border-zora-ghost/30">
        <div>Zora {ZORA_VERSION}</div>
        <div>Dashboard</div>
      </div>
    </div>
  );
};

export default App;
