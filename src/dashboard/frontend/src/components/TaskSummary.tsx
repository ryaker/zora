import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, FileText, Terminal, Eye, AlertTriangle, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface TaskStep {
  type: 'read' | 'write' | 'shell' | 'think' | 'error';
  label: string;
  detail?: string;
  timestamp: Date;
}

interface TaskSummaryProps {
  steps: TaskStep[];
  isRunning: boolean;
  taskPrompt?: string;
}

const STEP_ICONS: Record<TaskStep['type'], React.ElementType> = {
  read: Eye,
  write: FileText,
  shell: Terminal,
  think: Clock,
  error: AlertTriangle,
};

const STEP_COLORS: Record<TaskStep['type'], string> = {
  read: 'text-zora-cyan',
  write: 'text-zora-gold',
  shell: 'text-green-400',
  think: 'text-zora-blue',
  error: 'text-red-400',
};

const STEP_LABELS: Record<TaskStep['type'], string> = {
  read: 'Read',
  write: 'Created',
  shell: 'Ran',
  think: 'Thinking',
  error: 'Error',
};

const TaskSummary: React.FC<TaskSummaryProps> = ({ steps, isRunning, taskPrompt }) => {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  if (steps.length === 0 && !isRunning) return null;

  const readCount = steps.filter(s => s.type === 'read').length;
  const writeCount = steps.filter(s => s.type === 'write').length;
  const shellCount = steps.filter(s => s.type === 'shell').length;
  const errorCount = steps.filter(s => s.type === 'error').length;

  return (
    <div className="border-t border-zora-ghost/30">
      {/* Header bar */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
            {isRunning ? 'Task In Progress' : 'What Just Happened'}
          </span>
          {isRunning && (
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-zora-teal"
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Quick stats */}
          <div className="flex items-center gap-2 text-[9px] font-data text-white/40">
            {readCount > 0 && (
              <span className="flex items-center gap-1">
                <Eye size={10} className="text-zora-cyan" /> {readCount}
              </span>
            )}
            {writeCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText size={10} className="text-zora-gold" /> {writeCount}
              </span>
            )}
            {shellCount > 0 && (
              <span className="flex items-center gap-1">
                <Terminal size={10} className="text-green-400" /> {shellCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1">
                <AlertTriangle size={10} className="text-red-400" /> {errorCount}
              </span>
            )}
          </div>
          {isCollapsed ? (
            <ChevronDown size={14} className="text-white/30" />
          ) : (
            <ChevronUp size={14} className="text-white/30" />
          )}
        </div>
      </button>

      {/* Steps timeline */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {taskPrompt && (
              <div className="px-4 pb-2">
                <div className="text-[10px] font-data text-white/30 italic truncate">
                  "{taskPrompt}"
                </div>
              </div>
            )}

            <div className="px-4 pb-3 max-h-40 overflow-y-auto lcars-scrollbar">
              <div className="space-y-1">
                {steps.map((step, i) => {
                  const Icon = STEP_ICONS[step.type];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-2 text-[10px] font-data"
                    >
                      <Icon size={12} className={`${STEP_COLORS[step.type]} mt-0.5 flex-shrink-0`} />
                      <span className={`${STEP_COLORS[step.type]} font-bold uppercase w-12 flex-shrink-0`}>
                        {STEP_LABELS[step.type]}
                      </span>
                      <span className="text-white/50 truncate flex-1">
                        {step.label}
                      </span>
                      <span className="text-white/20 flex-shrink-0">
                        {step.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </motion.div>
                  );
                })}

                {isRunning && (
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="flex items-center gap-2 text-[10px] font-data text-zora-teal"
                  >
                    <Clock size={12} />
                    <span>Working...</span>
                  </motion.div>
                )}
              </div>
            </div>

            {!isRunning && steps.length > 0 && (
              <div className="px-4 pb-3">
                <div className="flex items-center gap-2 text-[10px] font-data text-green-400/70">
                  <CheckCircle size={12} />
                  <span>
                    Task complete{readCount + writeCount + shellCount > 0 ? ' — ' : ''}
                    {readCount > 0 ? `read ${readCount} file${readCount > 1 ? 's' : ''}` : ''}
                    {readCount > 0 && writeCount > 0 ? ', ' : ''}
                    {writeCount > 0 ? `created ${writeCount} file${writeCount > 1 ? 's' : ''}` : ''}
                    {(readCount > 0 || writeCount > 0) && shellCount > 0 ? ', ' : ''}
                    {shellCount > 0 ? `ran ${shellCount} command${shellCount > 1 ? 's' : ''}` : ''}
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TaskSummary;
export type { TaskStep };
