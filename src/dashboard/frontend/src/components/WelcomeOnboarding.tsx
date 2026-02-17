import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Shield, Brain, ArrowRight, Check, Sparkles } from 'lucide-react';

interface WelcomeOnboardingProps {
  onComplete: () => void;
  onSubmitTask: (prompt: string) => void;
}

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Zora',
    subtitle: 'Your personal AI assistant that actually does things',
  },
  {
    id: 'how-it-works',
    title: 'How Zora Works',
    subtitle: 'Three things to know before you start',
  },
  {
    id: 'try-it',
    title: 'Try Your First Task',
    subtitle: 'Click one to get started, or type your own',
  },
];

const QUICK_TASKS = [
  {
    emoji: '📂',
    label: 'Organize my Downloads',
    prompt: 'List everything in ~/Downloads grouped by file type, and tell me which files are oldest',
  },
  {
    emoji: '📝',
    label: 'Summarize a folder',
    prompt: 'Give me a one-line summary of each item in ~/Projects (or ~/Documents if Projects doesn\'t exist)',
  },
  {
    emoji: '🔍',
    label: 'Find large files',
    prompt: 'Find the 10 largest files in my home directory and tell me their sizes',
  },
  {
    emoji: '🧠',
    label: 'Teach Zora about me',
    prompt: 'Remember that I prefer concise, direct answers and I\'m a non-technical user',
  },
  {
    emoji: '📊',
    label: 'Project status check',
    prompt: 'Check ~/Projects for any git repos and tell me which have uncommitted changes',
  },
  {
    emoji: '🗑️',
    label: 'Clean up suggestions',
    prompt: 'Look at my ~/Downloads and ~/Desktop folders and suggest files I might want to clean up or archive',
  },
];

const WelcomeOnboarding: React.FC<WelcomeOnboardingProps> = ({ onComplete, onSubmitTask }) => {
  const [step, setStep] = useState(0);

  const nextStep = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const handleTaskClick = (prompt: string) => {
    onSubmitTask(prompt);
    onComplete();
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-40 bg-zora-obsidian/95 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl w-full"
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-zora-teal' : i < step ? 'bg-zora-teal/40' : 'bg-zora-ghost'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Welcome */}
          {step === 0 && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-zora-teal/20 border border-zora-teal/30 flex items-center justify-center mx-auto mb-6">
                <Sparkles size={32} className="text-zora-teal" />
              </div>
              <h1 className="text-3xl font-tactical font-bold text-zora-white mb-3">
                {STEPS[0].title}
              </h1>
              <p className="text-zora-blue/70 text-lg mb-2">
                {STEPS[0].subtitle}
              </p>
              <p className="text-white/40 text-sm max-w-md mx-auto mb-10">
                Tell Zora what you need in plain English — organize files, summarize documents,
                automate tasks — and it handles it while you do something else.
              </p>

              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-zora-teal/70">
                  <Shield size={14} />
                  <span>No API keys. No surprise bills. Uses your existing subscription.</span>
                </div>
              </div>

              <button
                onClick={nextStep}
                className="mt-8 bg-zora-teal text-zora-obsidian px-8 py-3 rounded-xl font-bold hover:bg-zora-cyan transition-colors flex items-center gap-2 mx-auto text-sm"
              >
                Get Started <ArrowRight size={16} />
              </button>

              <button
                onClick={handleSkip}
                className="mt-3 text-white/30 text-xs hover:text-white/50 transition-colors"
              >
                Skip intro — I know what I'm doing
              </button>
            </motion.div>
          )}

          {/* Step 2: How it works */}
          {step === 1 && (
            <motion.div
              key="how-it-works"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 className="text-2xl font-tactical font-bold text-zora-white mb-2 text-center">
                {STEPS[1].title}
              </h2>
              <p className="text-zora-blue/50 text-center mb-8">{STEPS[1].subtitle}</p>

              <div className="space-y-4">
                <div className="flex gap-4 p-4 bg-black/40 rounded-xl border-l-4 border-zora-teal">
                  <div className="w-10 h-10 rounded-lg bg-zora-teal/20 flex items-center justify-center flex-shrink-0">
                    <Zap size={20} className="text-zora-teal" />
                  </div>
                  <div>
                    <h3 className="text-zora-white font-bold text-sm mb-1">It takes action, not just talks</h3>
                    <p className="text-white/40 text-xs leading-relaxed">
                      Unlike chatbots, Zora actually reads your files, runs commands, and creates output.
                      When you say "organize my downloads," it really moves the files.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 bg-black/40 rounded-xl border-l-4 border-zora-gold">
                  <div className="w-10 h-10 rounded-lg bg-zora-gold/20 flex items-center justify-center flex-shrink-0">
                    <Shield size={20} className="text-zora-gold" />
                  </div>
                  <div>
                    <h3 className="text-zora-white font-bold text-sm mb-1">You set the boundaries</h3>
                    <p className="text-white/40 text-xs leading-relaxed">
                      Zora only accesses folders you've allowed. Destructive commands are blocked.
                      Every action is logged. You can review everything it did anytime.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 bg-black/40 rounded-xl border-l-4 border-zora-cyan">
                  <div className="w-10 h-10 rounded-lg bg-zora-cyan/20 flex items-center justify-center flex-shrink-0">
                    <Brain size={20} className="text-zora-cyan" />
                  </div>
                  <div>
                    <h3 className="text-zora-white font-bold text-sm mb-1">It remembers and learns</h3>
                    <p className="text-white/40 text-xs leading-relaxed">
                      Tell Zora your preferences once and it remembers across sessions.
                      "I prefer TypeScript" or "keep answers short" — it adapts to how you work.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center mt-8">
                <button
                  onClick={nextStep}
                  className="bg-zora-teal text-zora-obsidian px-8 py-3 rounded-xl font-bold hover:bg-zora-cyan transition-colors flex items-center gap-2 text-sm"
                >
                  Show Me What It Can Do <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Try a task */}
          {step === 2 && (
            <motion.div
              key="try-it"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 className="text-2xl font-tactical font-bold text-zora-white mb-2 text-center">
                {STEPS[2].title}
              </h2>
              <p className="text-zora-blue/50 text-center mb-6">{STEPS[2].subtitle}</p>

              <div className="grid grid-cols-2 gap-3">
                {QUICK_TASKS.map((task, i) => (
                  <button
                    key={i}
                    onClick={() => handleTaskClick(task.prompt)}
                    className="text-left p-4 bg-black/40 rounded-xl border border-zora-ghost/30 hover:border-zora-teal/50 hover:bg-black/60 transition-all group"
                  >
                    <div className="text-2xl mb-2">{task.emoji}</div>
                    <div className="text-zora-white text-sm font-bold mb-1 group-hover:text-zora-teal transition-colors">
                      {task.label}
                    </div>
                    <div className="text-white/30 text-xs line-clamp-2">
                      {task.prompt}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex justify-center mt-6">
                <button
                  onClick={handleSkip}
                  className="text-white/40 text-xs hover:text-white/60 transition-colors flex items-center gap-1"
                >
                  <Check size={12} /> Skip to dashboard — I'll explore on my own
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default WelcomeOnboarding;
