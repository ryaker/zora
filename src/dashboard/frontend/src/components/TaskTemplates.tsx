import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, FileText, Search, Brain, Clock, Wrench } from 'lucide-react';

interface TaskTemplatesProps {
  onSubmitTask: (prompt: string) => void;
}

const TEMPLATE_CATEGORIES = [
  {
    icon: FolderOpen,
    label: 'Files',
    color: 'text-zora-teal',
    bgColor: 'bg-zora-teal/10',
    borderColor: 'border-zora-teal/30',
    tasks: [
      { label: 'Organize Downloads', prompt: 'Sort ~/Downloads by file type into subfolders and list what you moved' },
      { label: 'Find big files', prompt: 'Find the 10 largest files in my home directory with their sizes' },
      { label: 'Clean up Desktop', prompt: 'List everything on ~/Desktop grouped by age — what can I archive?' },
    ],
  },
  {
    icon: FileText,
    label: 'Summaries',
    color: 'text-zora-gold',
    bgColor: 'bg-zora-gold/10',
    borderColor: 'border-zora-gold/30',
    tasks: [
      { label: 'Folder overview', prompt: 'Give me a one-line summary of each item in ~/Projects' },
      { label: 'README roundup', prompt: 'Find all README files in ~/Projects and summarize each one' },
      { label: 'Recent changes', prompt: 'What files in ~/Documents were modified in the last 7 days?' },
    ],
  },
  {
    icon: Search,
    label: 'Search',
    color: 'text-zora-cyan',
    bgColor: 'bg-zora-cyan/10',
    borderColor: 'border-zora-cyan/30',
    tasks: [
      { label: 'Find TODOs', prompt: 'Search for TODO comments across all files in ~/Projects and list them' },
      { label: 'Find duplicates', prompt: 'Look for files with identical names across ~/Documents and ~/Desktop' },
      { label: 'Search content', prompt: 'Find all files containing the word "password" in my home directory' },
    ],
  },
  {
    icon: Brain,
    label: 'Memory',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    borderColor: 'border-purple-400/30',
    tasks: [
      { label: 'Set preferences', prompt: 'Remember: I prefer concise answers, dark mode, and bullet-point summaries' },
      { label: 'What do you know?', prompt: 'Show me everything you remember about me and my preferences' },
      { label: 'Project context', prompt: 'Remember: my main project is in ~/Projects/my-app and uses React + TypeScript' },
    ],
  },
  {
    icon: Wrench,
    label: 'Dev Tools',
    color: 'text-green-400',
    bgColor: 'bg-green-400/10',
    borderColor: 'border-green-400/30',
    tasks: [
      { label: 'Git status check', prompt: 'Check all git repos in ~/Projects and report which have uncommitted changes' },
      { label: 'Dependency audit', prompt: 'Check ~/Projects for any package.json files with outdated dependencies' },
      { label: 'Code summary', prompt: 'Analyze the file structure of ~/Projects/my-app and describe the architecture' },
    ],
  },
  {
    icon: Clock,
    label: 'Automate',
    color: 'text-rose-400',
    bgColor: 'bg-rose-400/10',
    borderColor: 'border-rose-400/30',
    tasks: [
      { label: 'Daily standup prep', prompt: 'Check my recent git commits across all repos and draft a standup summary' },
      { label: 'Weekly report', prompt: 'Summarize what changed in ~/Projects this week — new files, modifications, deletions' },
      { label: 'Backup check', prompt: 'List important config files in my home directory that should be backed up' },
    ],
  },
];

const TaskTemplates: React.FC<TaskTemplatesProps> = ({ onSubmitTask }) => {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div className="px-4 py-3">
      <div className="mb-3">
        <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
          Quick Tasks
        </span>
      </div>

      <div className="space-y-1.5">
        {TEMPLATE_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isExpanded = expanded === cat.label;

          return (
            <div key={cat.label}>
              <button
                onClick={() => setExpanded(isExpanded ? null : cat.label)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${
                  isExpanded
                    ? `${cat.bgColor} border ${cat.borderColor}`
                    : 'hover:bg-black/30 border border-transparent'
                }`}
              >
                <Icon size={14} className={cat.color} />
                <span className={`text-xs font-bold uppercase ${isExpanded ? cat.color : 'text-white/60'}`}>
                  {cat.label}
                </span>
                <span className="text-[9px] text-white/20 ml-auto">
                  {cat.tasks.length}
                </span>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    key={cat.label}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="pl-7 pb-2 space-y-1"
                  >
                    {cat.tasks.map((task, i) => (
                      <button
                        key={i}
                        onClick={() => onSubmitTask(task.prompt)}
                        className="w-full text-left px-3 py-1.5 rounded-md text-[11px] text-white/50 hover:text-zora-white hover:bg-black/30 transition-all"
                        title={task.prompt}
                      >
                        {task.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TaskTemplates;
