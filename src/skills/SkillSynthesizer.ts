/**
 * SkillSynthesizer — Post-session autonomous skill generation.
 *
 * After a session completes, callers pass the SessionSummary to
 * maybeGenerateSkill().  If the session meets the complexity threshold
 * (tool_calls >= 8 OR turns >= 8) AND no semantically overlapping skill
 * already exists, the synthesizer:
 *
 *   1. Calls the LLM to generate a SKILL.md file.
 *   2. Presents it to the user (HITL gate) in one-shot mode.
 *   3. Writes it atomically to <skillsDir>/<slug>/SKILL.md.
 *   4. Updates the skills.lock.json integrity manifest.
 *
 * Design constraints (from spec):
 *   - No new npm dependencies — crypto, fs/promises, readline from Node built-ins.
 *   - Atomic writes via tmpfile + rename.
 *   - Uses existing LLMProvider interface; no new HTTP client.
 *   - Respects ZORA_HOME / baseDir — no hardcoded ~/.zora paths.
 *   - TypeScript strict mode; no `any`.
 *   - Under 300 lines.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { LLMProvider, AgentEvent, TaskContext } from '../types.js';
import type { ApprovalQueue } from '../core/approval-queue.js';
import { SkillsLock } from './SkillsLock.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-synthesizer');

// ─── Threshold ────────────────────────────────────────────────────────

export const SKILL_THRESHOLD = { toolCalls: 8, turns: 8 } as const;

// ─── Types ────────────────────────────────────────────────────────────

export interface SessionSummary {
  /** First user message or session title — becomes the task_summary in the prompt. */
  taskDescription: string;
  /** Total tool calls made during the session. */
  toolCalls: number;
  /** Total LLM turns consumed during the session. */
  turns: number;
}

export interface SkillSynthesizerOptions {
  /** Base Zora home directory (default: ~/.zora). */
  baseDir?: string;
  /**
   * LLM provider used to synthesize the SKILL.md content.
   * If omitted, synthesis is skipped (useful for testing the threshold logic
   * without a live provider).
   */
  provider?: LLMProvider;
  /**
   * Set to true to suppress the interactive HITL prompt (e.g. in tests or
   * daemon mode where stdin is not a TTY).  When true, the skill is written
   * without confirmation.
   */
  skipConfirmation?: boolean;
  /**
   * ApprovalQueue instance for daemon-mode HITL confirmation.
   * When stdin is not a TTY and an ApprovalQueue is provided, skill generation
   * goes through the queue (Telegram / channel-based approval) instead of
   * failing closed.
   */
  approvalQueue?: ApprovalQueue;
}

// ─── SkillSynthesizer ─────────────────────────────────────────────────

export class SkillSynthesizer {
  private readonly _skillsDir: string;
  private readonly _lock: SkillsLock;
  private _provider: LLMProvider | undefined;
  private readonly _skipConfirmation: boolean;
  private _approvalQueue: ApprovalQueue | undefined;

  constructor(options: SkillSynthesizerOptions = {}) {
    const baseDir = options.baseDir ?? path.join(os.homedir(), '.zora');
    this._skillsDir = path.join(baseDir, 'skills');
    this._lock = new SkillsLock(baseDir);
    this._provider = options.provider;
    this._skipConfirmation = options.skipConfirmation ?? false;
    this._approvalQueue = options.approvalQueue;
  }

  /**
   * Wire in an ApprovalQueue for daemon-mode HITL skill confirmation.
   * Called by Orchestrator after boot when the approval queue is configured.
   */
  setApprovalQueue(queue: ApprovalQueue): void {
    this._approvalQueue = queue;
  }

  /**
   * Wire in (or replace) the LLM provider used for synthesis.
   * Called by Orchestrator after boot when the first provider is selected.
   */
  setProvider(provider: LLMProvider): void {
    this._provider = provider;
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Threshold check: returns true when the session complexity warrants
   * saving a reusable skill.
   */
  shouldSynthesize(toolCalls: number, turns: number): boolean {
    return toolCalls >= SKILL_THRESHOLD.toolCalls || turns >= SKILL_THRESHOLD.turns;
  }

  /**
   * Scan existing SKILL.md files for semantic overlap with the given
   * task description.  Uses simple word-level overlap (v1 — no embeddings).
   *
   * @returns The path of the matching SKILL.md, or null if none found.
   */
  async findExistingSkill(taskDescription: string): Promise<string | null> {
    const descWords = tokenize(taskDescription);
    if (descWords.size === 0) return null;

    let entries: string[];
    try {
      entries = await fs.readdir(this._skillsDir);
    } catch {
      return null; // Skills dir doesn't exist yet
    }

    for (const entry of entries) {
      const skillPath = path.join(this._skillsDir, entry, 'SKILL.md');
      try {
        const stat = await fs.stat(path.join(this._skillsDir, entry));
        if (!stat.isDirectory()) continue;

        const content = await fs.readFile(skillPath, 'utf-8');
        const { name, description } = parseFrontmatter(content);
        const skillWords = tokenize(`${name} ${description}`);
        const overlap = intersection(descWords, skillWords);

        // Overlap ratio >= 0.5 against the smaller set → likely the same skill
        const smaller = Math.min(descWords.size, skillWords.size);
        if (smaller > 0 && overlap / smaller >= 0.5) {
          return skillPath;
        }
      } catch {
        // Skip directories without valid SKILL.md
      }
    }

    return null;
  }

  /**
   * Call the LLM to synthesize SKILL.md content for the given session.
   */
  async synthesize(session: SessionSummary): Promise<string> {
    if (!this._provider) {
      throw new Error('SkillSynthesizer: no provider configured for synthesis');
    }

    const prompt = buildSynthesisPrompt(session);

    // Minimal TaskContext — no history, no custom tools
    const taskContext: TaskContext = {
      jobId: `skill_synth_${Date.now()}`,
      task: prompt,
      requiredCapabilities: [],
      complexity: 'simple',
      resourceType: 'mixed',
      systemPrompt: 'You are a technical writer generating reusable skill documentation.',
      memoryContext: [],
      history: [],
    };

    let accumulated = '';
    for await (const event of this._provider.execute(taskContext)) {
      const e = event as AgentEvent;
      if (e.type === 'text') {
        const content = e.content as { text: string };
        accumulated += content.text;
      }
      if (e.type === 'done') {
        const content = e.content as { text?: string };
        // Only use done.content.text as fallback — don't overwrite streamed text
        if (content.text && accumulated.length === 0) accumulated = content.text;
        break;
      }
    }

    return accumulated.trim();
  }

  /**
   * Write a synthesized SKILL.md atomically and update the lock file.
   *
   * @param name  kebab-case slug (validated before calling)
   * @param content  Full SKILL.md text
   */
  async writeSkill(name: string, content: string): Promise<void> {
    validateSlug(name);

    const skillDir = path.join(this._skillsDir, name);
    await fs.mkdir(skillDir, { recursive: true });

    const dest = path.join(skillDir, 'SKILL.md');
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
    await fs.rename(tmp, dest);

    await this.updateLockFile(name, content);

    log.info({ skill: name, path: dest }, 'Skill written');
  }

  /**
   * Update the SHA-256 hash entry for a skill in skills.lock.json.
   */
  async updateLockFile(name: string, content: string): Promise<void> {
    await this._lock.update(name, content);
  }

  /**
   * Top-level entry point: check threshold, find duplicates, synthesize,
   * prompt for confirmation, and write.
   *
   * No-op when:
   *   - threshold not met
   *   - no provider is configured
   *   - a duplicate skill is found
   *   - user declines at the HITL prompt
   */
  async maybeGenerateSkill(session: SessionSummary): Promise<void> {
    if (!this.shouldSynthesize(session.toolCalls, session.turns)) {
      log.debug({ toolCalls: session.toolCalls, turns: session.turns }, 'Skill threshold not met — skipping');
      return;
    }

    if (!this._provider) {
      log.debug('No provider configured — skipping skill synthesis');
      return;
    }

    const existing = await this.findExistingSkill(session.taskDescription);
    if (existing) {
      log.debug({ existing }, 'Duplicate skill found — skipping synthesis');
      return;
    }

    let content: string;
    try {
      content = await this.synthesize(session);
    } catch (err) {
      log.warn({ err }, 'Skill synthesis LLM call failed — skipping');
      return;
    }

    if (!content) {
      log.warn('Skill synthesis returned empty content — skipping');
      return;
    }

    const { name } = parseFrontmatter(content);
    if (!name || !isValidSlug(name)) {
      log.warn({ name }, 'Synthesized skill has invalid slug — skipping');
      return;
    }

    const confirmed = await this._confirmWithUser(name, content);
    if (!confirmed) {
      log.info({ skill: name }, 'User declined skill save');
      return;
    }

    try {
      await this.writeSkill(name, content);
    } catch (err) {
      log.warn({ err, skill: name }, 'Failed to write skill file');
    }
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * HITL confirmation gate.
   *
   * In one-shot (ask) mode: print the proposed SKILL.md and prompt stdin.
   * When skipConfirmation is true: auto-confirm (tests/programmatic use).
   * When stdin is not a TTY and an ApprovalQueue is available: route through
   * out-of-band approval (Telegram, channel, etc.) — preserves HITL in daemon mode.
   * When stdin is not a TTY and no queue: fail closed.
   */
  private async _confirmWithUser(name: string, content: string): Promise<boolean> {
    if (this._skipConfirmation) {
      return true;
    }
    if (!process.stdin.isTTY) {
      // Daemon/non-interactive context — try out-of-band approval queue first.
      if (this._approvalQueue?.isEnabled()) {
        try {
          const approved = await this._approvalQueue.request({
            action: `Save auto-generated skill: ${name}\n\n${content.slice(0, 500)}${content.length > 500 ? '\n…(truncated)' : ''}`,
            score: 50,  // Medium risk — writing a new file to the skills dir
            jobId: `skill-synthesizer:${name}`,
            tool: 'SkillSynthesizer',
          });
          if (!approved) {
            log.info({ skill: name }, 'Daemon approval denied — skill not saved');
          }
          return approved;
        } catch (err) {
          log.warn({ err, skill: name }, 'Approval queue error — failing closed');
          return false;
        }
      }
      // No queue configured — fail closed to preserve HITL guarantee.
      log.warn({ skill: name }, 'Daemon mode with no ApprovalQueue — skill generation skipped (set approvalQueue to enable)');
      return false;
    }

    console.log('\n─────────────────────────────────────────');
    console.log(`[SKILL] Proposed skill: ${name}`);
    console.log('─────────────────────────────────────────');
    console.log(content);
    console.log('─────────────────────────────────────────');

    return new Promise<boolean>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('[SKILL] Save this skill? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }
}

// ─── Synthesis Prompt ─────────────────────────────────────────────────

function buildSynthesisPrompt(session: SessionSummary): string {
  const now = new Date().toISOString();
  return `You are writing a reusable skill file for the Zora agent framework.

The agent just completed the following task:
${session.taskDescription}

Session stats: ${session.toolCalls} tool calls, ${session.turns} turns.

Write a SKILL.md file in this exact format:
---
name: <kebab-case-slug, max 64 chars, lowercase>
description: <one sentence, what this skill does>
platforms: [macos, linux]
created: ${now}
tool_calls: ${session.toolCalls}
turns: ${session.turns}
---
## When to use
<2-3 sentences>

## Steps
<numbered list>

## Pitfalls
<bullet list>

Rules:
- name must match ^[a-z0-9][a-z0-9._-]*$ max 64 chars
- description under 120 chars
- No machine-specific paths
- No credentials or tokens`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

function validateSlug(name: string): void {
  if (!isValidSlug(name)) {
    throw new Error(`Invalid skill slug: "${name}" — must match ^[a-z0-9][a-z0-9._-]*$ (max 64 chars)`);
  }
}

/**
 * Minimal YAML frontmatter parser — only reads `name` and `description`.
 */
function parseFrontmatter(content: string): { name: string; description: string } {
  const result = { name: '', description: '' };
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  for (const line of match[1]!.split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
  }

  return result;
}

/**
 * Tokenise a string into lowercase words (3+ chars, letters only).
 * Used for simple semantic overlap detection.
 */
function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return new Set(words);
}

/**
 * Count the intersection size between two sets.
 */
function intersection(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) {
    if (b.has(word)) count++;
  }
  return count;
}
