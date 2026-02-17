import React, { useState, useEffect } from 'react';
import { Shield, FolderOpen, FolderLock, Terminal, Ban, Eye, Edit3, ChevronDown, ChevronUp, CheckCircle, XCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface SecurityPolicy {
  preset: string;
  allowedPaths: string[];
  deniedPaths: string[];
  allowedCommands: string[];
  blockedCommands: string[];
}

const PRESET_INFO: Record<string, { label: string; description: string; color: string }> = {
  safe: {
    label: 'Safe',
    description: 'Zora can only look at files — never change or delete anything.',
    color: 'text-green-400',
  },
  balanced: {
    label: 'Balanced',
    description: 'Zora can read and write in your work folders. Dangerous commands are blocked.',
    color: 'text-zora-gold',
  },
  power: {
    label: 'Power',
    description: 'Broad access for experienced users. Still blocks truly dangerous actions.',
    color: 'text-orange-400',
  },
};

const SecuritySettings: React.FC = () => {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('folders');

  useEffect(() => {
    const fetchPolicy = async () => {
      try {
        const res = await axios.get('/api/policy');
        if (res.data.ok) {
          setPolicy(res.data.policy);
        }
      } catch {
        // If the API doesn't exist yet, show placeholder data
        setPolicy({
          preset: 'balanced',
          allowedPaths: ['~/Projects', '~/Documents', '~/Desktop'],
          deniedPaths: ['~/.ssh', '~/.gnupg', '~/.aws', '~/.zora/audit'],
          allowedCommands: ['git', 'ls', 'cat', 'grep', 'find', 'node', 'npm', 'python'],
          blockedCommands: ['sudo', 'rm -rf', 'chmod', 'chown', 'mkfs', 'dd'],
        });
      } finally {
        setLoading(false);
      }
    };
    fetchPolicy();
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  if (loading) {
    return (
      <div className="px-4 py-6 text-center">
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-[10px] font-data text-zora-teal"
        >
          Loading security settings...
        </motion.div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="px-4 py-4 text-[10px] font-data text-white/40">
        Unable to load security settings. Run <code className="text-zora-cyan">zora-agent doctor</code> to check.
      </div>
    );
  }

  const presetInfo = PRESET_INFO[policy.preset] || PRESET_INFO.balanced;

  return (
    <div className="space-y-0">
      {/* Current Preset */}
      <div className="px-4 py-3 border-b border-zora-ghost/30">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={14} className="text-zora-gold" />
          <span className="text-[10px] font-data text-zora-teal uppercase tracking-widest">
            Your Safety Level
          </span>
        </div>
        <div className="bg-black/40 rounded-lg p-3 border-l-2 border-zora-gold">
          <div className={`text-sm font-bold ${presetInfo.color} mb-1`}>
            {presetInfo.label} Mode
          </div>
          <div className="text-[10px] font-data text-white/50">
            {presetInfo.description}
          </div>
          <div className="text-[9px] font-data text-white/30 mt-2">
            Change with: <code className="text-zora-cyan">zora-agent init --force</code>
          </div>
        </div>
      </div>

      {/* Folders Zora Can Access */}
      <div className="border-b border-zora-ghost/30">
        <button
          onClick={() => toggleSection('folders')}
          className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FolderOpen size={12} className="text-green-400" />
            <span className="text-[10px] font-data text-white/60 uppercase tracking-wider">
              Folders Zora can see
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-data text-white/30">{policy.allowedPaths.length}</span>
            {expandedSection === 'folders' ? (
              <ChevronUp size={12} className="text-white/30" />
            ) : (
              <ChevronDown size={12} className="text-white/30" />
            )}
          </div>
        </button>
        <AnimatePresence>
          {expandedSection === 'folders' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-1">
                {policy.allowedPaths.map((path, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-data">
                    <CheckCircle size={10} className="text-green-400 flex-shrink-0" />
                    <span className="text-white/60">{path}</span>
                    <span className="text-white/20 ml-auto">
                      {policy.preset === 'safe' ? (
                        <span className="flex items-center gap-1">
                          <Eye size={8} /> read only
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Edit3 size={8} /> read & write
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Off-Limits Folders */}
      <div className="border-b border-zora-ghost/30">
        <button
          onClick={() => toggleSection('denied')}
          className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FolderLock size={12} className="text-red-400" />
            <span className="text-[10px] font-data text-white/60 uppercase tracking-wider">
              Off-limits folders
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-data text-white/30">{policy.deniedPaths.length}</span>
            {expandedSection === 'denied' ? (
              <ChevronUp size={12} className="text-white/30" />
            ) : (
              <ChevronDown size={12} className="text-white/30" />
            )}
          </div>
        </button>
        <AnimatePresence>
          {expandedSection === 'denied' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-1">
                {policy.deniedPaths.map((path, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-data">
                    <XCircle size={10} className="text-red-400 flex-shrink-0" />
                    <span className="text-white/60">{path}</span>
                    <span className="text-white/20 ml-auto text-[9px]">
                      {path.includes('.ssh') && 'SSH keys'}
                      {path.includes('.gnupg') && 'encryption keys'}
                      {path.includes('.aws') && 'AWS credentials'}
                      {path.includes('audit') && 'audit logs'}
                    </span>
                  </div>
                ))}
                <div className="flex items-start gap-2 mt-2 text-[9px] font-data text-white/25">
                  <Info size={10} className="flex-shrink-0 mt-0.5" />
                  <span>These folders are always blocked, regardless of your safety level.</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Commands */}
      <div className="border-b border-zora-ghost/30">
        <button
          onClick={() => toggleSection('commands')}
          className="w-full px-4 py-2 flex items-center justify-between hover:bg-black/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Terminal size={12} className="text-zora-cyan" />
            <span className="text-[10px] font-data text-white/60 uppercase tracking-wider">
              Allowed commands
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-data text-white/30">{policy.allowedCommands.length}</span>
            {expandedSection === 'commands' ? (
              <ChevronUp size={12} className="text-white/30" />
            ) : (
              <ChevronDown size={12} className="text-white/30" />
            )}
          </div>
        </button>
        <AnimatePresence>
          {expandedSection === 'commands' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3">
                <div className="flex flex-wrap gap-1 mb-3">
                  {policy.allowedCommands.map((cmd, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-900/30 rounded text-[9px] font-data text-green-400 border border-green-800/30"
                    >
                      <CheckCircle size={8} /> {cmd}
                    </span>
                  ))}
                </div>
                <div className="text-[9px] font-data text-white/30 mb-2 uppercase">Always blocked:</div>
                <div className="flex flex-wrap gap-1">
                  {policy.blockedCommands.map((cmd, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-900/20 rounded text-[9px] font-data text-red-400/70 border border-red-800/20"
                    >
                      <Ban size={8} /> {cmd}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Audit Log Quick Link */}
      <div className="px-4 py-3">
        <div className="text-[9px] font-data text-white/25 space-y-1">
          <div>Every action Zora takes is logged and tamper-proof.</div>
          <div>
            View the full log: <code className="text-zora-cyan">zora-agent audit show</code>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SecuritySettings;
